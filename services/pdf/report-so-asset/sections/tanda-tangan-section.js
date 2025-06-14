function renderTandaTanganBox(doc) {
    const startX = doc.page.margins.left;
    const boxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const boxHeight = 80;
    const headerHeight = 20;
    const padding = 5;
    const y = doc.y + 20;
  
    const requiredHeight = headerHeight + boxHeight + 30;
    if (y + requiredHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
  
    const updatedY = doc.y + 10;
    const labels = ['Divisi Yang di SO', 'Pelaksana SO', 'Pendamping SO', 'Diketahui Oleh'];
    const columnCount = labels.length;
    const columnWidth = boxWidth / columnCount;
  
    for (let i = 0; i < columnCount; i++) {
      const currentX = startX + i * columnWidth;
  
      // Kotak label
      doc.font('Helvetica-Bold').fontSize(10);
      doc.rect(currentX, updatedY, columnWidth, headerHeight).stroke();
      doc.text(labels[i], currentX + padding, updatedY + padding, {
        width: columnWidth - 2 * padding,
        align: 'center',
      });
  
      // Kotak tanda tangan
      doc.rect(currentX, updatedY + headerHeight, columnWidth, boxHeight).stroke();
    }
  
    doc.y = updatedY + headerHeight + boxHeight + 10;
  }
  
  module.exports = { renderTandaTanganBox };
  