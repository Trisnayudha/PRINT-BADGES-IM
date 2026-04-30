const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { generateBadgePdf, generateBadgeHtmlPreview, closeBrowser } = require('./badge-generator');
const { printPdf, listPrinters } = require('./printer');
const queue = require('./print-queue');

const RAW_TYPES = new Set(['Platinum', 'Gold', 'Silver', 'Speaker', 'Delegate Speaker']);

function mapTicketType(typeVal, title = '') {
  const all      = ['Conference', 'Exhibition', 'Networking Functions'];
  const exhibitor = ['Exhibition', 'Networking Functions'];

  if (typeVal === 'Platinum' || typeVal === 'Delegate Speaker') {
    return { ticket_type: 'Delegate', ticket_color: '#1428DF', access_areas: all };
  }
  if (typeVal === 'Speaker') {
    return { ticket_type: 'Speaker Pass', ticket_color: '#D60000', access_areas: all };
  }
  if (typeVal === 'Gold') {
    if (title.includes('Workshop')) return { ticket_type: 'Workshop Pass', ticket_color: '#DAA520', access_areas: all };
    if (title.includes('Working'))  return { ticket_type: 'Working Pass',  ticket_color: '#DAA520', access_areas: [] };
    if (title.includes('Upgrade'))  return { ticket_type: 'Exhibitor Pass', ticket_color: '#FFD700', access_areas: all };
    return { ticket_type: 'Exhibitor Pass', ticket_color: '#FFD700', access_areas: exhibitor };
  }
  if (typeVal === 'Silver') {
    if (title.includes('Workshop'))              return { ticket_type: 'Workshop Pass',   ticket_color: '#DAA520', access_areas: all };
    if (title.includes('Explore'))               return { ticket_type: 'Explore Pass',    ticket_color: '#F97316', access_areas: ['Exhibition'] };
    if (title.includes('Investor'))              return { ticket_type: 'Investor Pass',   ticket_color: '#1E90FF', access_areas: all };
    if (title.includes('Mining'))                return { ticket_type: 'Mining Pass',     ticket_color: '#228B22', access_areas: all };
    if (title.includes('Media'))                 return { ticket_type: 'Media Pass',      ticket_color: '#8A2BE2', access_areas: all };
    if (title.includes('Networking'))            return { ticket_type: 'Networking Pass', ticket_color: '#00CED1', access_areas: ['Networking Functions'] };
    if (title.includes('Exhibitor') || title.includes('Exhibition'))
                                                 return { ticket_type: 'Exhibitor Pass',  ticket_color: '#FFD700', access_areas: exhibitor };
    return { ticket_type: 'Working Pass', ticket_color: '#DAA520', access_areas: [] };
  }
  return null; // already mapped — leave as-is
}

// Resolve ticket fields: if raw DB type is detected, apply mapping.
// If already mapped by PHP webhook, pass through unchanged.
function resolveTicketFields(data) {
  const typeVal = data.ticket_type;
  if (!typeVal || !RAW_TYPES.has(typeVal)) return data;

  const mapped = mapTicketType(typeVal, data.ticket_title || data.title || '');
  if (!mapped) return data;

  return {
    ...data,
    ...mapped,
    // don't overwrite access_areas if caller explicitly provided it alongside a raw type
    access_areas: data.access_areas !== undefined ? data.access_areas : mapped.access_areas,
  };
}

const app = express();
app.use(cors());
app.use(express.json());
app.use((req, _, next) => { req.headers['ngrok-skip-browser-warning'] = '1'; next(); });
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Ngrok tunnel URL (reads from ngrok local API)
app.get('/api/ngrok', async (_, res) => {
  try {
    const r = await fetch('http://127.0.0.1:4040/api/tunnels');
    if (!r.ok) return res.json({ url: null });
    const { tunnels } = await r.json();
    const https = tunnels.find(t => t.proto === 'https');
    res.json({ url: https ? https.public_url : null });
  } catch {
    res.json({ url: null });
  }
});

// ── Health check (for tablet connectivity test)
app.get('/health', (_, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    printer: config.printerName || '(default)',
    event: config.eventName,
  });
});

// ── List available printers
app.get('/api/printers', async (_, res) => {
  try {
    const printers = await listPrinters();
    res.json({ printers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Queue status
app.get('/api/queue', (_, res) => {
  res.json({ jobs: queue.getAllJobs() });
});

// ── Remove one job from queue
app.delete('/api/queue/:id', (req, res) => {
  queue.removeJob(req.params.id);
  res.json({ ok: true });
});

// ── Retry all failed/pending jobs
app.post('/api/queue/retry', async (_, res) => {
  const pending = queue.getPendingJobs();
  res.json({ retrying: pending.length });
  for (const job of pending) {
    await processPrintJob(job.id, job.data, job.data.copies || config.defaultCopies);
  }
});

// ── Badge HTML preview (for UI live preview)
app.post('/api/preview', async (req, res) => {
  try {
    const html = await generateBadgeHtmlPreview(resolveTicketFields(req.body));
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MAIN: Print badge
app.post('/print', async (req, res) => {
  const data = resolveTicketFields(req.body);

  if (!data || (!data.name && !data.display_name)) {
    return res.status(400).json({ error: 'name or display_name is required' });
  }

  const copies = data.copies || config.defaultCopies;
  const job = queue.addJob({ ...data, copies });

  // Respond immediately so tablet doesn't wait
  res.json({ success: true, job_id: job.id, status: 'processing' });

  await processPrintJob(job.id, data, copies);
});

async function processPrintJob(jobId, data, copies) {
  queue.updateJob(jobId, { status: 'printing', last_attempt: new Date().toISOString() });

  let pdfPath = null;
  try {
    pdfPath = await generateBadgePdf(data);
    await printPdf(pdfPath, copies);
    queue.updateJob(jobId, { status: 'done', error: null });
    console.log(`[PRINTED] ${data.display_name || data.name} | job ${jobId}`);
  } catch (err) {
    const errMsg = err?.message || String(err) || 'unknown error';
    const retries = (queue.getAllJobs().find(j => j.id === jobId)?.retries || 0) + 1;
    queue.updateJob(jobId, { status: 'failed', error: errMsg, retries });
    console.error(`[FAILED] job ${jobId}: ${errMsg}`);
  } finally {
    if (pdfPath && fs.existsSync(pdfPath)) {
      fs.unlinkSync(pdfPath);
    }
  }
}

// ── Auto-retry failed jobs every 60 seconds
setInterval(async () => {
  const pending = queue.getPendingJobs();
  if (pending.length === 0) return;
  console.log(`[QUEUE] Retrying ${pending.length} pending job(s)...`);
  for (const job of pending) {
    await processPrintJob(job.id, job.data, job.data.copies || config.defaultCopies);
  }
}, 60_000);

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`\n✓ IM Scan Print Server running on port ${config.port}`);
  console.log(`  Health check: http://localhost:${config.port}/health`);
  console.log(`  Monitor UI:   http://localhost:${config.port}/`);
  console.log(`  Printer:      ${config.printerName || '(default system printer)'}`);
  console.log(`  Event:        ${config.eventName}\n`);
});

process.on('SIGTERM', async () => {
  await closeBrowser();
  server.close();
});

process.on('SIGINT', async () => {
  await closeBrowser();
  server.close();
  process.exit(0);
});
