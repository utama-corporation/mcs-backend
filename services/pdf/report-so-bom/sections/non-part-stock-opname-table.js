const { pool } = require('../../../../db');

function getTextHeight(doc, text, options) {
  return doc.heightOfString(String(text ?? '-'), options);
}

function formatQty(value) {
  const number = parseFloat(value);
  return Number.isInteger(number) ? number.toString() : number.toFixed(2).replace(/\.0+$/, '');
}

async function renderNonPartTable(doc, noSO) {
    // 1. Ambil data non-parts
    const [nonParts] = await pool.query(
      `SELECT non_part_name AS name, qty, remark FROM tb_stockopname_non_parts WHERE NoSO = ?`,
      [noSO]
    );
  
    // 2. Ambil data BOM yang QtyFound > qty_on_hand
    const [bomParts] = await pool.query(`
      SELECT 
        bom.part AS name,
        hasil.QtyFound,
        bom.qty_on_hand,
        (hasil.QtyFound - bom.qty_on_hand) AS selisih,
        hasil.Remark
      FROM tb_parts_bom bom
      JOIN (
        SELECT DISTINCT AssetCode FROM tb_stockopname_d WHERE NoSO = ?
      ) stok ON bom.AssetCode = stok.AssetCode
      LEFT JOIN tb_stockopname_hasil_bom hasil 
        ON bom.id = hasil.IdBOM AND hasil.NoSO = ?
      WHERE bom.level != 'relationship'
        AND hasil.QtyFound IS NOT NULL
        AND hasil.QtyFound > bom.qty_on_hand
    `, [noSO, noSO]);
    
  
    // 3. Transformasi bomParts
    const transformedBOM = bomParts.map(row => ({
      name: row.name,
      qty: row.selisih, // gunakan hasil pengurangan
      remark: row.Remark
    }));
    
  
    // 4. Gabungkan keduanya
    const combinedRows = [...nonParts, ...transformedBOM];
  
    // === PDF rendering ===
  
    const startX = doc.page.margins.left;
    const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidths = [30, 220, 100, tableWidth - (30 + 220 + 100)];
    const headers = ['No', 'Nama Alat Kerja', 'Jumlah Fisik', 'Keterangan'];
  
    let y = doc.y + 20;
  
    doc.fontSize(13)
       .font('Helvetica-Bold')
       .text('II. Alat Kerja Diluar Daftar SO ', startX, y, { align: 'left' });
  
    y += 20;
  
    if (!combinedRows.length) {
      doc.fontSize(10)
         .font('Helvetica-Oblique')
         .text('Tidak ada data tambahan atau selisih fisik.', startX, y);
      doc.y = y + 20;
      return;
    }
  
    doc.fontSize(10).font('Helvetica-Bold');
  
    // Header
    const headerMaxHeight = Math.max(...headers.map((h, i) => getTextHeight(doc, h, { width: colWidths[i] - 6 })));
    const headerRowHeight = headerMaxHeight + 10;
  
    let x = startX;
    for (let i = 0; i < headers.length; i++) {
      doc.rect(x, y, colWidths[i], headerRowHeight).stroke();
      const textY = y + (headerRowHeight - getTextHeight(doc, headers[i], { width: colWidths[i] - 6 })) / 2;
      doc.text(headers[i], x + 3, textY, {
        width: colWidths[i] - 6,
        align: 'center'
      });
      x += colWidths[i];
    }
    y += headerRowHeight;
  
    doc.font('Helvetica').fontSize(10);
    let nomor = 1;
    let totalQty = 0;
  
    for (const row of combinedRows) {
      const qtyValue = parseFloat(row.qty) || 0;
      totalQty += qtyValue;
  
      const data = [
        nomor.toString(),
        row.name || '-',
        formatQty(row.qty ?? '-'),
        row.remark || '-'
      ];
  
      const maxHeight = Math.max(...data.map((d, i) => getTextHeight(doc, d, { width: colWidths[i] - 6 })));
      const rowHeight = maxHeight + 10;
  
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage(); y = 40;
      }
  
      x = startX;
      for (let i = 0; i < data.length; i++) {
        doc.rect(x, y, colWidths[i], rowHeight).stroke();
        const align = i === 0 || i === 2 ? 'center' : 'left';
        doc.text(data[i], x + 3, y + 5, {
          width: colWidths[i] - 6,
          align
        });
        x += colWidths[i];
      }
  
      y += rowHeight;
      nomor++;
    }
  
    // Tambahkan Total PCS
    const totalLabel = 'TOTAL';
    const totalQtyFormatted = formatQty(totalQty);
  
    const labelHeight = getTextHeight(doc, totalLabel, { width: colWidths[0] + colWidths[1] - 6 });
    const totalRowHeight = labelHeight + 10;
  
    if (y + totalRowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage(); y = 40;
    }
  
    x = startX;
    doc.font('Helvetica-Bold');
  
    // Gabungkan kolom No dan Nama untuk Total Label
    doc.rect(x, y, colWidths[0] + colWidths[1], totalRowHeight).stroke();
    doc.text(totalLabel, x + 3, y + 5, {
      width: colWidths[0] + colWidths[1] - 6,
      align: 'center'
    });
  
    x += colWidths[0] + colWidths[1];
  
    // Kolom Total Qty
    doc.rect(x, y, colWidths[2], totalRowHeight).stroke();
    doc.text(totalQtyFormatted, x + 3, y + 5, {
      width: colWidths[2] - 6,
      align: 'center'
    });
  
    // Kosongkan kolom terakhir
    x += colWidths[2];
    doc.rect(x, y, colWidths[3], totalRowHeight).stroke();
  
    doc.y = y + totalRowHeight + 10;
  }
  
  

module.exports = { renderNonPartTable };
