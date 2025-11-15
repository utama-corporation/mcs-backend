const { pool } = require('../../../../db');

async function renderJadwalRealisasiTable(doc, noSO) {
  const startX = doc.page.margins.left;
  const padding = 5;
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const col1Width = tableWidth * 0.4;
  const col2Width = tableWidth * 0.3;
  const col3Width = tableWidth * 0.3;

  const headerHeight = 20;
  const rowHeight = 20;
  const sectionSpacing = 10;

  // Ambil data tanggal & lockedDate
  let tanggal = '-';
  let lockedDate = '-';

  try {
    const [result] = await pool.query(
      `SELECT Tanggal, LockedDate FROM tb_stockopname_h WHERE NoSO = ?`,
      [noSO]
    );

    if (result.length > 0) {
      const tanggalDate = result[0].Tanggal ? new Date(result[0].Tanggal) : null;
      const lockedDateDate = result[0].LockedDate ? new Date(result[0].LockedDate) : null;

      if (tanggalDate) {
        tanggal = tanggalDate.toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        });
      }

      if (lockedDateDate) {
        lockedDate = lockedDateDate.toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        });
      }
    }
  } catch (error) {
    console.error('Error fetching Jadwal vs Realisasi:', error);
  }

  // Hitung apakah perlu pindah halaman
  const estimatedTitleHeight = doc.heightOfString('VI. Jadwal VS Realisasi SO', {
    width: tableWidth,
    align: 'left'
  });

  const totalHeightNeeded = estimatedTitleHeight + headerHeight + rowHeight + sectionSpacing + 20;
  const availableHeight = doc.page.height - doc.y - doc.page.margins.bottom;

  if (totalHeightNeeded > availableHeight) {
    doc.addPage();
  }

  let y = doc.y + 20;

  // Judul
  doc.font('Helvetica-Bold').fontSize(12).text('VI. Jadwal VS Realisasi SO');
  y = doc.y + 10;

  // Header kolom
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

  // Baris isi
  doc.font('Helvetica').fontSize(10);
  currentX = startX;
  const rowData = ['Stock Opname', tanggal, lockedDate];

  [col1Width, col2Width, col3Width].forEach((width, index) => {
    doc.rect(currentX, y, width, rowHeight).stroke();
    doc.text(rowData[index], currentX + padding, y + padding, {
      width: width - 2 * padding,
      align: 'center',
    });
    currentX += width;
  });

  doc.y = y + rowHeight + sectionSpacing;
}

module.exports = { renderJadwalRealisasiTable };
