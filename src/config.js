require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT) || 3000,
  printerName: process.env.PRINTER_NAME || '',
  eventName: process.env.EVENT_NAME || 'INDONESIA MINER 2026',
  eventSubtitle: process.env.EVENT_SUBTITLE || 'CONFERENCE AND EXHIBITION',
  sponsorName: process.env.SPONSOR_NAME || 'FLS',
  defaultCopies: parseInt(process.env.DEFAULT_COPIES) || 1,
};
