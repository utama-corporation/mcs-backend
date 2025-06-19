const { pool } = require('../../../../db');

async function renderHeaderInfo(doc, noSO) {
  // Inisialisasi nilai default
  let tanggal = '-';
  let perusahaan = '-';
  let lokasi = '-';

  try {
    // 1. Ambil data tanggal
    const [tanggalResult] = await pool.query(
      `SELECT Tanggal FROM tb_stockopname_h WHERE NoSO = ?`,
      [noSO]
    );

    if (tanggalResult.length > 0) {
      const date = new Date(tanggalResult[0].Tanggal);
      tanggal = date.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'long',
        year: 'numeric'
      }); // contoh: 10 Juni 2025
    }

    // 2. Ambil data semua perusahaan
    const [perusahaanResult] = await pool.query(
      `SELECT tc.company_name 
       FROM tb_stockopname_dcompany tsd
       LEFT JOIN tb_company tc ON tsd.IdCompany = tc.id_company 
       WHERE tsd.NoSO = ?`,
      [noSO]
    );

    if (perusahaanResult.length > 0) {
      // Gabungkan nama-nama perusahaan dengan koma
      perusahaan = perusahaanResult
        .map(p => p.company_name || '-')
        .join(', ');
    }

    // 3. Ambil data semua lokasi
    const [lokasiResult] = await pool.query(
      `SELECT tl.location_name 
       FROM tb_stockopname_dlocation tsl
       LEFT JOIN tb_location_asset tl ON tsl.IdLocation = tl.location_code 
       WHERE tsl.NoSO = ?`,
      [noSO]
    );

    if (lokasiResult.length > 0) {
      // Gabungkan nama-nama lokasi dengan koma
      lokasi = lokasiResult
        .map(l => l.location_name || '-')
        .join(', ');
    }

  } catch (error) {
    console.error('Error fetching header info:', error);
    // Gunakan nilai default jika terjadi error
  }

  // Render ke PDF
  const rows = [
    ['Tanggal', ': ', tanggal],
    ['Perusahaan', ': ', perusahaan],
    ['Lokasi', ': ', lokasi]
  ];

  // Lebar kolom
  const labelWidth = 90;
  const separatorWidth = 10;
  const valueWidth = 300;

  doc.fontSize(12).font('Helvetica-Bold');

  rows.forEach(([label, separator, value]) => {
    const x = doc.page.margins.left;
    const y = doc.y;

    doc.text(label, x, y, {
      width: labelWidth,
      align: 'left'
    });

    doc.text(separator, x + labelWidth, y, {
      width: separatorWidth,
      align: 'center'
    });

    doc.text(value, x + labelWidth + separatorWidth, y, {
      width: valueWidth,
      align: 'left'
    });

    doc.moveDown(0.5);
  });

  doc.moveDown(0.5);
}

module.exports = { renderHeaderInfo };
