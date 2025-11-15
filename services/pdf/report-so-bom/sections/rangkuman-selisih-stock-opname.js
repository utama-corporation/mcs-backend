const { pool } = require('../../../../db');

function formatQty(value) {
  const number = parseFloat(value);
  return Number.isInteger(number) ? number.toString() : number.toFixed(2).replace(/\.?0+$/, '');
}

function getTextHeight(doc, text, options) {
  return doc.heightOfString(String(text ?? '-'), options);
}

function preserveOriginalSpacing(text) {
  if (!text) return '-';
  return text
    .replace(/\t/g, '    ')
    .replace(/\u00A0|\u2009|\u2007|\u2002|\u2003|\u2000|\u2001|\u2004|\u2005|\u2006|\u2008|\u200A|\u205F/g, ' ');
}

async function renderRangkumanSelisihStockOpname(doc, noSO) {
  const [rows] = await pool.query(`
    SELECT 
      CONCAT(asset.AssetName, ' (', asset.AssetCode, ')') AS AssetCode,
      bom.part AS part_name,
      so_bom.Qty AS qty_on_hand,
      hasil.QtyFound,
      hasil.Remark,
      so_bom.uom
    FROM tb_stockopname_bom so_bom
    LEFT JOIN tb_parts_bom bom ON so_bom.IdBOM = bom.id AND bom.level != 'relationship'
    LEFT JOIN tb_stockopname_hasil_bom hasil ON so_bom.IdBOM = hasil.IdBOM AND hasil.NoSO = so_bom.NoSO
    LEFT JOIN asset ON so_bom.AssetCode = asset.AssetCode
    WHERE so_bom.NoSO = ? AND bom.level != 'relationship'
      AND hasil.QtyFound IS NOT NULL
      AND hasil.QtyFound != so_bom.Qty
    ORDER BY so_bom.AssetCode ASC, bom.part ASC
  `, [noSO]);

  const leftMargin = doc.page.margins.left;

    // ✅ Judul section
    doc.fontSize(13).font('Helvetica-Bold')
    .text('I. Rangkuman Selisih Stock Opname', leftMargin, doc.y, { align: 'left' });
  doc.moveDown(0.8);

  // ✅ Kalau tidak ada data selisih: tampilkan info
  if (!rows.length) {
    doc.fontSize(11).font('Helvetica')
      .text('Tidak ada selisih stock opname.', leftMargin, doc.y, { align: 'left' });
    doc.moveDown(1.5);
    return; // keluar supaya tidak render tabel
  }

  const colWidths = [25, 100, 120, 55, 55, 55, 100];
  const colX = [];
  let x = doc.page.margins.left;
  for (let width of colWidths) { colX.push(x); x += width; }

  const headers = ['No', 'Rak', 'Nama Alat Kerja', 'Jumlah di Sistem', 'Jumlah Fisik', 'Selisih', 'Keterangan'];
  doc.fontSize(10).font('Helvetica-Bold');

  let headerMaxHeight = 0;
  for (let i = 0; i < headers.length; i++) {
    const height = getTextHeight(doc, headers[i], { width: colWidths[i] - 6 });
    if (headerMaxHeight < height) headerMaxHeight = height;
  }
  const headerRowHeight = headerMaxHeight + 10;
  let y = doc.y;

  for (let i = 0; i < headers.length; i++) {
    doc.rect(colX[i], y, colWidths[i], headerRowHeight).stroke();
    const textY = y + (headerRowHeight - getTextHeight(doc, headers[i], { width: colWidths[i] - 6 })) / 2;
    doc.text(headers[i], colX[i] + 3, textY, { width: colWidths[i] - 6, align: 'center' });
  }

  y += headerRowHeight;
  doc.font('Helvetica').fontSize(10);

  let nomor = 1;

  // ✅ NEW: accumulators
  let totalSistem = 0;
  let totalFisik = 0;

  for (const row of rows) {
    const sistem = parseFloat(row.qty_on_hand) || 0;
    const fisik = parseFloat(row.QtyFound) || 0;
    const selisihValue = fisik - sistem;

    // accumulate
    totalSistem += sistem;
    totalFisik += fisik;

    const selisihDisplay = selisihValue > 0
      ? `+${formatQty(selisihValue)}`
      : selisihValue < 0
        ? `-${formatQty(Math.abs(selisihValue))}`
        : '0';

    const remark = selisihValue === 0
      ? (row.Remark && row.Remark.trim() !== '-' ? row.Remark : 'Sesuai')
      : (row.Remark || '-');

    const data = [
      nomor,
      preserveOriginalSpacing(row.AssetCode),
      preserveOriginalSpacing(row.part_name),
      formatQty(sistem),
      formatQty(fisik),
      selisihDisplay,
      preserveOriginalSpacing(remark)
    ];

    let maxHeight = 0;
    for (let i = 0; i < data.length; i++) {
      const height = getTextHeight(doc, data[i], { width: colWidths[i] - 6 });
      if (maxHeight < height) maxHeight = height;
    }

    const rowHeight = maxHeight + 10;

    if (y + rowHeight > 780) {
      doc.addPage();
      y = doc.page.margins.top;
    }

    for (let i = 0; i < data.length; i++) {
      doc.rect(colX[i], y, colWidths[i], rowHeight).stroke();
      const centerAlignedCols = [0, 3, 4, 5];
      doc.text(String(data[i]), colX[i] + 3, y + 5, {
        width: colWidths[i] - 6,
        align: centerAlignedCols.includes(i) ? 'center' : 'left'
      });
    }

    y += rowHeight;
    nomor++;
  }

  // ✅ NEW: TOTAL row
  const totalSelisih = totalFisik - totalSistem;
  const totalSelisihDisplay = totalSelisih > 0
    ? `+${formatQty(totalSelisih)}`
    : totalSelisih < 0
      ? `-${formatQty(Math.abs(totalSelisih))}`
      : '0';

  const totalRowHeight = 22;

  // page break if needed
  if (y + totalRowHeight > 780) {
    doc.addPage();
    y = doc.page.margins.top;
  }

  // draw merged cell for "TOTAL" across columns 0..2
  const mergedWidth = colWidths[0] + colWidths[1] + colWidths[2];
  doc.rect(colX[0], y, mergedWidth, totalRowHeight).stroke();

  // draw numeric total cells for columns 3,4,5
  for (let i of [3, 4, 5]) {
    doc.rect(colX[i], y, colWidths[i], totalRowHeight).stroke();
  }
  // column 6 (Keterangan) empty box
  doc.rect(colX[6], y, colWidths[6], totalRowHeight).stroke();

  // text: bold “TOTAL” and numbers centered
  doc.font('Helvetica-Bold');

  doc.text('TOTAL', colX[0] + 6, y + 5, {
    width: mergedWidth - 12,
    align: 'center'
  });

  doc.text(formatQty(totalSistem), colX[3] + 3, y + 5, { width: colWidths[3] - 6, align: 'center' });
  doc.text(formatQty(totalFisik),  colX[4] + 3, y + 5, { width: colWidths[4] - 6, align: 'center' });
  doc.text(totalSelisihDisplay,     colX[5] + 3, y + 5, { width: colWidths[5] - 6, align: 'center' });

  // restore normal font if needed
  doc.font('Helvetica').fontSize(10);

  y += totalRowHeight;

  doc.moveDown(1.5);
}

module.exports = { renderRangkumanSelisihStockOpname };
