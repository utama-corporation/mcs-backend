function renderCommentBox(doc) {
  const startX = doc.page.margins.left;
  const boxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const boxHeight = 100;

  const fontSize = 12;
  const spacing = 5; // jarak antar teks dan box
  const titleHeight = fontSize + spacing; // kira-kira tinggi teks judul
  const totalHeightNeeded = titleHeight + boxHeight;

  // Cek apakah muat di halaman
  const currentY = doc.y;
  const maxY = doc.page.height - doc.page.margins.bottom;

  if (currentY + totalHeightNeeded > maxY) {
    doc.addPage(); // pindah ke halaman baru jika tidak cukup
  }

  const y = doc.y;

  doc.font('Helvetica-Bold').fontSize(fontSize).text('IV. Tanggapan PIC Terkait Selisih', startX, y);
  doc.rect(startX, y + titleHeight, boxWidth, boxHeight).stroke();

  doc.y = y + titleHeight + boxHeight + spacing;
}

module.exports = { renderCommentBox };
