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
  // null/undefined → show all (fallback). Empty array [] → no access row (e.g. Working Pass).
  if (access === null || access === undefined) {
    return ['CONFERENCE', 'EXHIBITION', 'NETWORKING FUNCTIONS'].join('&nbsp;&nbsp;&#8212;&nbsp;&nbsp;');
  }
  if (access.length === 0) return null;
  return access.map(a => a.toUpperCase()).join('&nbsp;&nbsp;&#8212;&nbsp;&nbsp;');
}

function buildBadgeHtml(data, qrDataUrl, previewMode = false) {
  const {
    display_name,
    name,
    company = '',
    department = '',
    job_title = '',
    ticket_type = 'DELEGATE',
    access,
    access_areas,
  } = data;

  // Normalize: PHP sends access_areas + job_title, Flutter may send access + department
  const resolvedDept = department || job_title;
  const resolvedAccess = access_areas !== undefined ? access_areas : access;

  const primaryName = display_name || (name ? name.split(' ')[0] : '');
  const secondaryName = display_name
    ? name
    : (name ? name.split(' ').slice(1).join(' ') : '');

  const primaryFontSize = getFontSize(primaryName, 10, 34, 18);

  const { contentTop, contentHeight, footerTop, footerHeight } = LAYOUT;

  const templateDataUrl = previewMode ? (() => {
    try {
      const imgPath = path.join(__dirname, '..', 'public', 'template-empty.png');
      const buf = fs.readFileSync(imgPath);
      return `data:image/png;base64,${buf.toString('base64')}`;
    } catch { return null; }
  })() : null;

  const previewBg = templateDataUrl ? `
  .template-bg {
    position: absolute;
    top: 0; left: 0;
    width: 105mm; height: 150mm;
    background: url('${templateDataUrl}') no-repeat top left / 100% 100%;
    z-index: 0;
  }
  .content, .footer { z-index: 1; }
  ` : '';

  const previewDivs = templateDataUrl ? `<div class="template-bg"></div>` : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  html, body {
    width: 105mm;
    height: 150mm;
    background: transparent;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    font-family: 'Tahoma', Geneva, sans-serif;
  }
  ${previewBg}

  /* Names top + QR bottom-right — overlaid on white box of pre-printed template */
  .content {
    position: absolute;
    top: ${contentTop}mm;
    left: 5mm;
    right: 5mm;
    height: ${contentHeight}mm;
    display: flex;
    flex-direction: column;
    padding: 5mm 2mm 4mm 6mm;
  }

  .name-primary {
    font-size: ${primaryFontSize}pt;
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

  /* QR floats to bottom-right, with some margin from edge */
  .qr-wrap {
    flex: 1;
    display: flex;
    justify-content: flex-end;
    align-items: flex-end;
    padding-right: 5mm;
    padding-bottom: 2mm;
  }

  .qr-wrap img {
    width: 30mm;
    height: 30mm;
  }

  /* DELEGATE + access — overlaid on gold footer of pre-printed template */
  .footer {
    position: absolute;
    top: ${footerTop}mm;
    left: 0;
    right: 0;
    height: ${footerHeight}mm;
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
  }

  .access-row {
    width: 100%;
    text-align: center;
    font-size: 8pt;
    font-weight: 700;
    color: #000;
    letter-spacing: 0.3pt;
  }
</style>
</head>
<body>
${previewDivs}
<div class="content">
  <div class="name-primary">${primaryName}</div>
  ${secondaryName ? `<div class="name-secondary">${secondaryName}</div>` : ''}
  ${resolvedDept ? `<div class="dept">${resolvedDept}</div>` : ''}
  ${company ? `<div class="company">${company}</div>` : ''}
  <div class="qr-wrap">
    <img src="${qrDataUrl}" alt="QR">
  </div>
</div>

<div class="footer">
  <div class="ticket-type">${ticket_type.toUpperCase()}</div>
  ${(() => { const row = buildAccessRow(resolvedAccess); return row ? `<div class="access-row">${row}</div>` : ''; })()}
</div>

</body>
</html>`;
}

async function generateBadgePdf(data) {
  const qrContent = data.qr_code || data.badge_id || data.guest_id || 'NO-QR';
  const qrDataUrl = await QRCode.toDataURL(qrContent, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 300,
    color: { dark: '#000000', light: '#ffffff' },
  });

  const html = buildBadgeHtml(data, qrDataUrl);
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfPath = path.join(TEMP_DIR, `badge_${Date.now()}.pdf`);
    await page.pdf({
      path: pdfPath,
      width: '105mm',
      height: '150mm',
      printBackground: false, // transparent — only text+QR prints over pre-printed template
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    return pdfPath;
  } finally {
    await page.close();
  }
}

async function generateBadgeHtmlPreview(data) {
  const qrContent = data.qr_code || data.badge_id || data.guest_id || 'NO-QR';
  const qrDataUrl = await QRCode.toDataURL(qrContent, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 300,
    color: { dark: '#000000', light: '#ffffff' },
  });
  return buildBadgeHtml(data, qrDataUrl, true);
}

async function closeBrowser() {
  if (browser) await browser.close();
}

module.exports = { generateBadgePdf, generateBadgeHtmlPreview, closeBrowser };
