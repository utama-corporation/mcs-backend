const PDFDocument = require('pdfkit');
const { printAllGroupedByLocation } = require('./sections/hasil-stock-opname-table');
const { renderHeaderInfo } = require('./sections/header-info-section');
const { printStockOpnameSummary } = require('./sections/rangkuman-stock-opname-table');
const { renderCommentBox } = require('./sections/comment-box');
const { renderJadwalRealisasiTable } = require('./sections/jadwal-realisasi-section');
const { renderTandaTanganBox } = require('./sections/tanda-tangan-section');




async function generateStockOpnameAssetPdf(res, metadata) {
  const { noSO, tanggal = '-', perusahaan = '-', lokasi = '-', lockedDate = '-' } = metadata;

  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  doc.pipe(res);

  doc.fontSize(16).font('Helvetica-Bold').text('BERITA ACARA STOCK OPNAME', { align: 'center' });
  doc.moveDown(1.5);

  renderHeaderInfo(doc, { tanggal, perusahaan });

  await printAllGroupedByLocation(doc, noSO);

  await printStockOpnameSummary(doc, noSO)

  doc.moveDown(1.5);

  renderCommentBox(doc);

  doc.moveDown(1.5);

  renderJadwalRealisasiTable(doc, tanggal, lockedDate); 

  doc.moveDown(2);

  renderTandaTanganBox(doc);



  doc.end();
}

module.exports = { generateStockOpnameAssetPdf };
