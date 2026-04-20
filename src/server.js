const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { generateBadgePdf, closeBrowser } = require('./badge-generator');
const { printPdf, listPrinters } = require('./printer');
const queue = require('./print-queue');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

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

// ── MAIN: Print badge
app.post('/print', async (req, res) => {
  const data = req.body;

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
