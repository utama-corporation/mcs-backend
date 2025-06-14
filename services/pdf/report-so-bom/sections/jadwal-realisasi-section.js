function renderJadwalRealisasiTable(doc, tanggal, lockedDate) {
    const startX = doc.page.margins.left;
    let y = doc.y + 20;
  
    doc.font('Helvetica-Bold').fontSize(12).text('IV. Jadwal VS Realisasi SO');
  
    const padding = 5;
    const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  
    const col1Width = tableWidth * 0.4; // Kolom Kegiatan
    const col2Width = tableWidth * 0.3; // Jadwal
    const col3Width = tableWidth * 0.3; // Realisasi
    const headerHeight = 20;
    const rowHeight = 20;
  
    // Header
    doc.font('Helvetica-Bold').fontSize(10);
    const headers = ['Kegiatan', 'Jadwal', 'Realisasi'];
    let currentX = startX;
    [col1Width, col2Width, col3Width].forEach((width, index) => {
      doc.rect(currentX, y, width, headerHeight).stroke();
      doc.text(headers[index], currentX + padding, y + padding, {
        width: width - 2 * padding,
        align: 'center',
      });
      currentX += width;
    });
  
    y += headerHeight;
  
    // Baris isi data
    doc.font('Helvetica').fontSize(10);
    currentX = startX;
    const rowData = ['Stock Opname', tanggal ?? '-', lockedDate ?? '-'];
    [col1Width, col2Width, col3Width].forEach((width, index) => {
      doc.rect(currentX, y, width, rowHeight).stroke();
      doc.text(rowData[index], currentX + padding, y + padding, {
        width: width - 2 * padding,
        align: 'center',
      });
      currentX += width;
    });
  
    doc.y = y + rowHeight + 10; // Update posisi y selanjutnya
  }
  
  module.exports = { renderJadwalRealisasiTable };
  