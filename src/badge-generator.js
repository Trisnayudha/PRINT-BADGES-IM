const puppeteer = require('puppeteer');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const TEMP_DIR = path.join(__dirname, '..', 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Measured from template-empty.png (1240×1772px = 105×150mm)
// White content box:  top=38.3mm, bottom=119.4mm  (height=81.1mm)
// Gold footer area:   top=119.5mm, bottom=150mm    (height=30.5mm)
const LAYOUT = {
  contentTop: 38.5,
  contentHeight: 81,
  footerTop: 119.5,
  footerHeight: 30.5,
};

// Template reference: 1240 x 1772 px == 105 x 150 mm
// Use px to make adjustment easier, then convert to mm internally.
const MM_PER_PX = 150 / 1772;
const pxToMm = (px) => px * MM_PER_PX;

// Quick layout tuning (px). Positive value = move down, negative = move up.
// Fokus utama: delegate/non-working badge.
// Example: BADGE_ALL_Y_PX=20 npm start
function numEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const ADJUST = {
  allYPx: numEnv('BADGE_ALL_Y_PX', 0),
  delegateContentYPx: numEnv('BADGE_DELEGATE_CONTENT_Y_PX', 35),
  nameBlockYPx: numEnv('BADGE_NAME_BLOCK_Y_PX', 0),
  passRowYPx: numEnv('BADGE_PASS_ROW_Y_PX', 0),
  qrYPx: numEnv('BADGE_QR_Y_PX', 0),
};

let browser = null;

async function getBrowser() {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browser;
}

function getFontSize(text, maxLen, baseSize, minSize) {
  if (!text || text.length <= maxLen) return baseSize;
  return Math.max(Math.round(baseSize * maxLen / text.length), minSize);
}

function buildAccessRow(access) {
  // null/undefined -> show all (fallback). Empty array [] -> no access row (e.g. Working Pass).
  if (access === null || access === undefined) {
    return ['CONFERENCE', 'EXHIBITION', 'NETWORKING FUNCTIONS'].join('&nbsp;&nbsp;&#8212;&nbsp;&nbsp;');
  }
  if (access.length === 0) return null;
  return access.map(a => a.toUpperCase()).join('&nbsp;&nbsp;&#8212;&nbsp;&nbsp;');
}

function buildBadgeSection(data, qrDataUrl, previewMode = false) {
  const {
    display_name,
    name,
    company = '',
    department = '',
    job_title = '',
    ticket_type = 'DELEGATE',
    access,
    access_areas,
    badge_format,
  } = data;

  // Normalize: PHP sends access_areas + job_title, Flutter may send access + department
  const resolvedDept = department || job_title;
  const resolvedAccess = access_areas !== undefined ? access_areas : access;
  const isWorkingPassFormat = badge_format === 'badge_working_pass';

  const primaryName = display_name || (name ? name.split(' ')[0] : '');
  const secondaryName = display_name
    ? name
    : (name ? name.split(' ').slice(1).join(' ') : '');

  const primaryFontSize = getFontSize(primaryName, 10, 34, 18);

  const { contentTop, contentHeight, footerTop, footerHeight } = LAYOUT;
  const adjustedContentTop = contentTop
    + pxToMm(ADJUST.allYPx)
    + pxToMm(ADJUST.nameBlockYPx)
    + (isWorkingPassFormat ? 0 : pxToMm(ADJUST.delegateContentYPx));
  const adjustedFooterTop = footerTop + pxToMm(ADJUST.allYPx) + pxToMm(ADJUST.passRowYPx);

  const templateImage = isWorkingPassFormat ? 'badge_working_pass.png' : 'template-empty.png';
  const templateDataUrl = previewMode ? (() => {
    try {
      const preferredPath = path.join(__dirname, '..', 'public', templateImage);
      const fallbackPath = path.join(__dirname, '..', 'public', 'template-empty.png');
      const imgPath = fs.existsSync(preferredPath) ? preferredPath : fallbackPath;
      const buf = fs.readFileSync(imgPath);
      return `data:image/png;base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  })() : null;

  const previewDivs = templateDataUrl
    ? `<div class="template-bg" style="background-image:url('${templateDataUrl}')"></div>`
    : '';

  return `<section class="badge-page">
${previewDivs}
<div class="content ${isWorkingPassFormat ? 'working-pass' : ''}" style="top: ${adjustedContentTop}mm; height: ${contentHeight}mm;">
  <div class="name-primary" style="font-size: ${primaryFontSize}pt;">${primaryName}</div>
  ${secondaryName ? `<div class="name-secondary">${secondaryName}</div>` : ''}
  ${resolvedDept ? `<div class="dept">${resolvedDept}</div>` : ''}
  ${company ? `<div class="company">${company}</div>` : ''}
  ${isWorkingPassFormat ? '' : `<div class="qr-wrap"><img src="${qrDataUrl}" alt="QR"></div>`}
</div>

${isWorkingPassFormat ? '' : `<div class="footer" style="top: ${adjustedFooterTop}mm; height: ${footerHeight}mm;">
  <div class="ticket-type">${ticket_type.toUpperCase()}</div>
  ${(() => { const row = buildAccessRow(resolvedAccess); return row ? `<div class="access-row">${row}</div>` : ''; })()}
</div>`}
</section>`;
}

function buildBadgeHtml(items, qrDataUrls, previewMode = false) {
  const pages = items.map((item, idx) => buildBadgeSection(item, qrDataUrls[idx], previewMode)).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  html, body {
    width: 105mm;
    background: transparent;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    font-family: 'Tahoma', Geneva, sans-serif;
  }

  .badge-page {
    width: 105mm;
    height: 150mm;
    position: relative;
    page-break-after: always;
    break-after: page;
    overflow: hidden;
  }

  .badge-page:last-child {
    page-break-after: auto;
    break-after: auto;
  }

  .template-bg {
    position: absolute;
    top: 0;
    left: 0;
    width: 105mm;
    height: 150mm;
    background-repeat: no-repeat;
    background-position: top left;
    background-size: 100% 100%;
    z-index: 0;
  }

  .content, .footer { z-index: 1; }

  /* Names top + optional QR bottom-right — overlaid on white box of pre-printed template */
  .content {
    position: absolute;
    left: 5mm;
    right: 5mm;
    display: flex;
    flex-direction: column;
    padding: 5mm 2mm 4mm 6mm;
  }

  .content.working-pass {
    top: 0 !important;
    left: 0;
    right: 0;
    height: 150mm !important;
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: 0 10mm;
  }

  .name-primary {
    font-weight: 900;
    color: #000;
    line-height: 1;
    margin-bottom: 2mm;
  }

  .name-secondary {
    font-size: 20pt;
    font-weight: 400;
    color: #000;
    line-height: 1.2;
    margin-bottom: 3mm;
  }

  .dept {
    font-size: 12pt;
    color: #000;
    font-weight: 400;
    margin-bottom: 1.5mm;
  }

  .company {
    font-size: 12pt;
    font-weight: 400;
    color: #000;
    line-height: 1.3;
  }

  /* Working pass only: make display name + company more prominent */
  .content.working-pass .name-primary {
    font-size: 44pt !important;
    line-height: 1;
  }

  .content.working-pass .company {
    font-size: 18pt;
    line-height: 1.25;
  }

  .qr-wrap {
    flex: 1;
    display: flex;
    justify-content: flex-end;
    align-items: flex-end;
    padding-right: 5mm;
    padding-bottom: ${2 + pxToMm(ADJUST.qrYPx)}mm;
  }

  .qr-wrap img {
    width: 30mm;
    height: 30mm;
  }

  .footer {
    position: absolute;
    left: 0;
    right: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 3mm;
  }

  .ticket-type {
    width: 100%;
    text-align: center;
    font-size: 22pt;
    font-weight: 900;
    color: #000;
    letter-spacing: 0.5pt;
    text-decoration: none !important;
  }

  .access-row {
    width: 100%;
    text-align: center;
    font-size: 8pt;
    font-weight: 700;
    color: #000;
    letter-spacing: 0.3pt;
    text-decoration: none !important;
  }

  .ticket-type *, .access-row * {
    text-decoration: none !important;
  }

  @page {
    size: 105mm 150mm;
    margin: 0;
  }
</style>
</head>
<body>
${pages}
</body>
</html>`;
}

async function buildQrDataUrls(items) {
  return Promise.all(items.map(async (data) => {
    if (data.badge_format === 'badge_working_pass') return '';

    const qrContent = data.qr_code || data.badge_id || data.guest_id || 'NO-QR';
    return QRCode.toDataURL(qrContent, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 300,
      color: { dark: '#000000', light: '#ffffff' },
    });
  }));
}

async function generateBadgePdf(data) {
  const items = Array.isArray(data) ? data : [data];
  const qrDataUrls = await buildQrDataUrls(items);
  const html = buildBadgeHtml(items, qrDataUrls);
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfPath = path.join(TEMP_DIR, `badge_${Date.now()}.pdf`);
    await page.pdf({
      path: pdfPath,
      preferCSSPageSize: true,
      printBackground: false, // transparent — only text+QR prints over pre-printed template
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    return pdfPath;
  } finally {
    await page.close();
  }
}

async function generateBadgeHtmlPreview(data) {
  const items = Array.isArray(data) ? data : [data];
  const qrDataUrls = await buildQrDataUrls(items);
  return buildBadgeHtml(items, qrDataUrls, true);
}

async function closeBrowser() {
  if (browser) await browser.close();
}

module.exports = { generateBadgePdf, generateBadgeHtmlPreview, closeBrowser };
