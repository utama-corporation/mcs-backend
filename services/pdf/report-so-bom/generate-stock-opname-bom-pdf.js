const PDFDocument = require('pdfkit');
const { renderHasilStockOpnameTable } = require('./sections/hasil-stock-opname-table');
const { renderCommentBox } = require('./sections/comment-box');
const { renderJadwalRealisasiTable } = require('./sections/jadwal-realisasi-section');
const { renderTandaTanganBox } = require('./sections/tanda-tangan-section');
const { renderHeaderInfo } = require('./sections/header-info-section');
const { renderNonPartTable } = require('./sections/non-part-stock-opname-table');



async function generateStockOpnameBomPdf(res, metadata) {
  const { noSO } = metadata;

  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  doc.pipe(res);

  doc.fontSize(16).font('Helvetica-Bold').text('BERITA ACARA STOCK OPNAME', { align: 'center' });
  doc.moveDown(1.5);

  await renderHeaderInfo(doc, noSO);

  doc.moveDown(1);

  await renderHasilStockOpnameTable(doc, noSO);

  doc.moveDown(1.5);

  await renderNonPartTable(doc, noSO);

  doc.moveDown(1.5);

  renderCommentBox(doc);

  doc.moveDown(1.5);

  await renderJadwalRealisasiTable(doc, noSO); 

  doc.moveDown(2);

  renderTandaTanganBox(doc);



  doc.end();
}

module.exports = { generateStockOpnameBomPdf };
