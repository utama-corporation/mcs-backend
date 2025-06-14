function renderHeaderInfo(doc, { tanggal = '-', perusahaan = '-', lokasi = '-' }) {
    const rows = [
      ['Tanggal', ': ', tanggal],
      ['Perusahaan', ': ', perusahaan],
      ['Lokasi', ': ', lokasi]
    ];
  
    // Lebar kolom
    const labelWidth = 90;    // Lebar kolom label
    const separatorWidth = 10; // Lebar kolom separator
    const valueWidth = 300;   // Lebar kolom value (sesuaikan dengan kebutuhan)
  
    doc.fontSize(12).font('Helvetica-Bold');
  
    rows.forEach(([label, separator, value]) => {
      const x = doc.page.margins.left;
      const y = doc.y;
  
      // Label (rata kanan)
      doc.text(label, x, y, {
        width: labelWidth,
        align: 'left'
      });
  
      // Separator ":"
      doc.text(separator, x + labelWidth, y, {
        width: separatorWidth,
        align: 'center'
      });
  
      // Value (rata kiri)
      doc.text(value, x + labelWidth + separatorWidth, y, {
        width: valueWidth,
        align: 'left'
      });
  
      doc.moveDown(0.5);
    });
  
    doc.moveDown(0.5);
  }
  
  module.exports = { renderHeaderInfo };