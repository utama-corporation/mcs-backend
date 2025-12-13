const PDFDocument = require('pdfkit');
const { renderHasilStockOpnameTable } = require('./sections/hasil-stock-opname-table');
const { renderCommentBox } = require('./sections/comment-box');
const { renderJadwalRealisasiTable } = require('./sections/jadwal-realisasi-section');
const { renderTandaTanganBox } = require('./sections/tanda-tangan-section');
const { renderHeaderInfo } = require('./sections/header-info-section');
const { renderNonPartTable } = require('./sections/non-part-stock-opname-table');
const { renderRangkumanSelisihStockOpname } = require('./sections/rangkuman-selisih-stock-opname');
const { renderRangkumanSO6BulanTotals } = require('./sections/rangkuman-so-6bulan');



function drawSeparator(doc, { dashed = false, color = '#999', thick = 0.5, gap = 8 } = {}) {
  const { left, right } = doc.page.margins;
  const x1 = left;
  const x2 = doc.page.width - right;
  const y  = doc.y + gap;     // beri jarak kecil dari konten sebelumnya

  doc.save();
  if (dashed) doc.dash(3, { space: 3 });
  doc.lineWidth(thick).strokeColor(color)
     .moveTo(x1, y).lineTo(x2, y).stroke();
  doc.undash(); // reset dash
  doc.restore();

  doc.y = y;       // set Y di posisi garis
  doc.moveDown(0.8); // beri jarak setelah garis
}


async function generateStockOpnameBomPdf(res, metadata) {
  const { noSO } = metadata;
  const MINIMUM_BOTTOM_MARGIN = 80; // Margin minimum di bagian bawah halaman

  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  doc.pipe(res);

  // Render judul utama
  doc.fontSize(16).font('Helvetica-Bold').text('BERITA ACARA STOCK OPNAME', { align: 'center' });
  doc.moveDown(1.5);

  // Render header info
  await renderHeaderInfo(doc, noSO);
  
  // Cek apakah perlu page break sebelum tabel utama
  const currentY = doc.y + 20; // tambahan spacing
  if (currentY > doc.page.height - doc.page.margins.bottom - MINIMUM_BOTTOM_MARGIN - 100) {
    doc.addPage();
  } else {
    doc.moveDown(1);
  }

  await renderRangkumanSelisihStockOpname(doc, noSO);

    // Cek spacing sebelum non-part table
    if (doc.y > doc.page.height - doc.page.margins.bottom - MINIMUM_BOTTOM_MARGIN - 80) {
      doc.addPage();
    } else {
      doc.moveDown(0.1);
    }

    drawSeparator(doc, { color: 'black', thick: 5 });

    await renderRangkumanSO6BulanTotals(doc, noSO);

    drawSeparator(doc, { color: 'black', thick: 5 });

      // Cek spacing sebelum non-part table
      if (doc.y > doc.page.height - doc.page.margins.bottom - MINIMUM_BOTTOM_MARGIN - 80) {
        doc.addPage();
      } else {
        doc.moveDown(1.5);
      }

  // Render tabel hasil stock opname
  await renderHasilStockOpnameTable(doc, noSO);

  // Cek spacing sebelum non-part table
  if (doc.y > doc.page.height - doc.page.margins.bottom - MINIMUM_BOTTOM_MARGIN - 80) {
    doc.addPage();
  } else {
    doc.moveDown(1.5);
  }

  // Render tabel non-part
  await renderNonPartTable(doc, noSO);

  // Cek spacing sebelum comment box
  if (doc.y > doc.page.height - doc.page.margins.bottom - MINIMUM_BOTTOM_MARGIN - 60) {
    doc.addPage();
  } else {
    doc.moveDown(1.5);
  }

  // Render comment box
  renderCommentBox(doc);

  // Cek spacing sebelum jadwal realisasi
  if (doc.y > doc.page.height - doc.page.margins.bottom - MINIMUM_BOTTOM_MARGIN - 80) {
    doc.addPage();
  } else {
    doc.moveDown(1.5);
  }

  // Render jadwal realisasi table
  await renderJadwalRealisasiTable(doc, noSO);

  // Cek spacing sebelum tanda tangan - ini penting karena tanda tangan harus lengkap
  const signatureHeight = 120; // estimasi tinggi untuk tanda tangan section
  if (doc.y > doc.page.height - doc.page.margins.bottom - MINIMUM_BOTTOM_MARGIN - signatureHeight) {
    doc.addPage();
  } else {
    doc.moveDown(2);
  }

  // Render tanda tangan box
  renderTandaTanganBox(doc);

  doc.end();
}

module.exports = { generateStockOpnameBomPdf };