const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const config = require('./config');

const isWindows = process.platform === 'win32';

async function printPdf(pdfPath, copies = 1) {
  if (isWindows) {
    const { print } = require('pdf-to-printer');
    const options = {
      scale: 'fit',
      side: 'simplex',
      ...(config.printerName ? { printer: config.printerName } : {}),
    };
    for (let i = 0; i < copies; i++) {
      await print(pdfPath, options);
    }
  } else {
    const args = ['-n', String(copies)];
    if (config.printerName) args.push('-d', config.printerName.replace(/ /g, '_'));
    args.push(pdfPath);
    await execFileAsync('lp', args);
  }
}

async function listPrinters() {
  if (isWindows) {
    const { getPrinters } = require('pdf-to-printer');
    return await getPrinters();
  } else {
    const { stdout } = await execFileAsync('lpstat', ['-a']);
    return stdout
      .split('\n')
      .filter(Boolean)
      .map(line => ({ name: line.split(' ')[0] }));
  }
}

module.exports = { printPdf, listPrinters };
