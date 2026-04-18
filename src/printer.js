const { print, getPrinters } = require('pdf-to-printer');
const config = require('./config');

async function printPdf(pdfPath, copies = 1) {
  const options = {
    scale: 'noscale',
    side: 'one-sided',
    ...(config.printerName ? { printer: config.printerName } : {}),
  };

  for (let i = 0; i < copies; i++) {
    await print(pdfPath, options);
  }
}

async function listPrinters() {
  return await getPrinters();
}

module.exports = { printPdf, listPrinters };
