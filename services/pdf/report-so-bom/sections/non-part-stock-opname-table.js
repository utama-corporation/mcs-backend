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
    const MINIMUM_BOTTOM_MARGIN = 80; // Margin minimum di bagian bawah halaman

    let y = doc.y + 20;

    if (!combinedRows.length) {
      doc.fontSize(13)
         .font('Helvetica-Bold')
         .text('IV. Alat Kerja Diluar Daftar SO ', startX, y, { align: 'left' });
      y += 20;
      doc.fontSize(10)
         .font('Helvetica-Oblique')
         .text('Tidak ditemukan adanya data tambahan atau kelebihan jumlah fisik.', startX, y);
      doc.y = y + 20;
      return;
    }

    // Hitung tinggi yang dibutuhkan untuk judul + header + minimal 1 baris data
    const titleHeight = 20; // tinggi untuk judul + spacing
    const headerMaxHeight = Math.max(...headers.map((h, i) => getTextHeight(doc, h, { width: colWidths[i] - 6 })));
    const headerRowHeight = headerMaxHeight + 10;
    
    // Hitung tinggi minimum untuk baris data pertama
    const firstRowData = [
      '1',
      combinedRows[0].name || '-',
      formatQty(combinedRows[0].qty ?? '-'),
      combinedRows[0].remark || '-'
    ];
    const firstRowMaxHeight = Math.max(...firstRowData.map((d, i) => getTextHeight(doc, d, { width: colWidths[i] - 6 })));
    const firstRowHeight = firstRowMaxHeight + 10;

    // Hitung tinggi untuk total row
    const totalLabel = 'TOTAL';
    const totalLabelHeight = getTextHeight(doc, totalLabel, { width: colWidths[0] + colWidths[1] - 6 });
    const totalRowHeight = totalLabelHeight + 10;

    // Cek apakah judul + header + minimal 1 baris data + total row muat di halaman saat ini
    const requiredHeight = titleHeight + headerRowHeight + firstRowHeight + totalRowHeight;
    if (y + requiredHeight > doc.page.height - doc.page.margins.bottom - MINIMUM_BOTTOM_MARGIN) {
      doc.addPage(); 
      y = 40;
    }

    // Render judul
    doc.fontSize(13)
       .font('Helvetica-Bold')
       .text('II. Alat Kerja Diluar Daftar SO ', startX, y, { align: 'left' });

    y += 20;
    doc.fontSize(10).font('Helvetica-Bold');

    // Render header
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

    for (let i = 0; i < combinedRows.length; i++) {
      const row = combinedRows[i];
      const isLastRow = i === combinedRows.length - 1;
      
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

      // Untuk baris terakhir, pastikan ada cukup ruang untuk baris data + total row
      const spaceNeeded = isLastRow ? rowHeight + totalRowHeight + 20 : rowHeight;
      
      // Cek apakah baris data muat di halaman saat ini dengan margin yang cukup
      if (y + spaceNeeded > doc.page.height - doc.page.margins.bottom - MINIMUM_BOTTOM_MARGIN) {
        doc.addPage(); 
        y = 40;
        
        // Jika pindah halaman, render ulang header
        doc.fontSize(10).font('Helvetica-Bold');
        x = startX;
        for (let j = 0; j < headers.length; j++) {
          doc.rect(x, y, colWidths[j], headerRowHeight).stroke();
          const textY = y + (headerRowHeight - getTextHeight(doc, headers[j], { width: colWidths[j] - 6 })) / 2;
          doc.text(headers[j], x + 3, textY, {
            width: colWidths[j] - 6,
            align: 'center'
          });
          x += colWidths[j];
        }
        y += headerRowHeight;
        doc.font('Helvetica').fontSize(10);
      }

      x = startX;
      for (let j = 0; j < data.length; j++) {
        doc.rect(x, y, colWidths[j], rowHeight).stroke();
        const align = j === 0 || j === 2 ? 'center' : 'left';
        doc.text(data[j], x + 3, y + 5, {
          width: colWidths[j] - 6,
          align
        });
        x += colWidths[j];
      }

      y += rowHeight;
      nomor++;
    }

    // Tambahkan Total PCS - sudah dipastikan ada ruang yang cukup
    const totalQtyFormatted = formatQty(totalQty);

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