const PDFDocument = require('pdfkit');
const { printAllGroupedByLocation } = require('./sections/hasil-stock-opname-table');
const { renderHeaderInfo } = require('./sections/header-info-section');
const { printStockOpnameSummary } = require('./sections/rangkuman-stock-opname-table');
const { renderCommentBox } = require('./sections/comment-box');
const { renderJadwalRealisasiTable } = require('./sections/jadwal-realisasi-section');
const { renderTandaTanganBox } = require('./sections/tanda-tangan-section');
const { printStockOpnameHistory } = require('./sections/rangkuman-so-6bulan');


async function generateStockOpnameAssetPdf(res, metadata) {
  const { noSO, tanggal = '-', perusahaan = '-', lokasi = '-', lockedDate = '-' } = metadata;
  const MINIMUM_BOTTOM_MARGIN = 80;

  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  doc.pipe(res);

  // 🔹 Helper
  function ensureSpace(neededHeight) {
    const availableSpace =
      doc.page.height - doc.y - doc.page.margins.bottom - MINIMUM_BOTTOM_MARGIN;

    if (availableSpace < neededHeight) {
      doc.addPage();
    } else {
      doc.moveDown(1.5);
    }
  }

  // 🔹 Judul utama
  doc.fontSize(16).font('Helvetica-Bold').text('BERITA ACARA STOCK OPNAME', { align: 'center' });
  doc.moveDown(1.5);

  // 🔹 Header info
  renderHeaderInfo(doc, { tanggal, perusahaan });

  // 🔹 Tabel hasil opname by lokasi
  ensureSpace(200);
  await printAllGroupedByLocation(doc, noSO);

  
  ensureSpace(200);
  await printStockOpnameHistory(doc, noSO);

  // 🔹 Rangkuman opname
  ensureSpace(150);
  await printStockOpnameSummary(doc, noSO);


  // 🔹 Comment box
  ensureSpace(100);
  renderCommentBox(doc);

  // 🔹 Jadwal realisasi
  ensureSpace(160);
  renderJadwalRealisasiTable(doc, tanggal, lockedDate);

  // 🔹 Tanda tangan (wajib full section)
  ensureSpace(120);
  renderTandaTanganBox(doc);

  doc.end();
}

module.exports = { generateStockOpnameAssetPdf };
