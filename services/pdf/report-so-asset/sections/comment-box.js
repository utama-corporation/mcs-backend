function renderCommentBox(doc) {
    const startX = doc.page.margins.left;
    const boxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const boxHeight = 100;
  
    const y = doc.y;
  
    doc.font('Helvetica-Bold').fontSize(12).text('IV. Tanggapan PIC Terkait Selisih', startX, y);
    doc.rect(startX, y + 20, boxWidth, boxHeight).stroke();
  
    doc.y = y + 20 + boxHeight + 5;
  }
  
  module.exports = { renderCommentBox };
  