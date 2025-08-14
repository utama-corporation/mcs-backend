const { pool } = require('../../../../db');

function getTextHeight(doc, text, options) {
  return doc.heightOfString(String(text ?? '-'), options);
}

function formatQty(value) {
  const number = parseFloat(value);
  return Number.isInteger(number) ? number.toString() : number.toFixed(2).replace(/\.?0+$/, '');
}

async function renderHasilStockOpnameTable(doc, noSO) {
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
    ORDER BY so_bom.AssetCode ASC, bom.part ASC
  `, [noSO]);

  if (!rows.length) {
    doc.text('Tidak ada data hasil stock opname.');
    doc.moveDown();
    return;
  }

  const leftMargin = doc.page.margins.left;
  doc.fontSize(13)
    .font('Helvetica-Bold')
    .text('I. Hasil Stock Opname', leftMargin, doc.y, { align: 'left' });

  doc.moveDown(0.8);

  const grouped = {};
  rows.forEach(row => {
    if (!grouped[row.AssetCode]) grouped[row.AssetCode] = [];
    grouped[row.AssetCode].push(row);
  });

  const colX = [40, 70, 250, 310, 370, 430];
  const colWidths = [30, 180, 60, 60, 60, 125];
  let y = doc.y;
  let groupIndex = 1;

  for (const [assetCode, parts] of Object.entries(grouped)) {
    if (y > 700) {
      doc.addPage();
      y = doc.y;
    }

    doc.fontSize(11).font('Helvetica').text(`${groupIndex}. ${assetCode}`, colX[0] + 5, y);
    y += 15;

    const headers = ['No', 'Nama Alat Kerja', 'Jumlah di Sistem', 'Jumlah Fisik', 'Selisih', 'Keterangan'];
    doc.fontSize(10).font('Helvetica-Bold');

    let headerMaxHeight = 0;
    for (let i = 0; i < headers.length; i++) {
      const height = getTextHeight(doc, headers[i], { width: colWidths[i] - 6 });
      if (height > headerMaxHeight) headerMaxHeight = height;
    }
    const headerRowHeight = headerMaxHeight + 10;

    for (let i = 0; i < headers.length; i++) {
      doc.rect(colX[i], y, colWidths[i], headerRowHeight).stroke();
      const textY = y + (headerRowHeight - getTextHeight(doc, headers[i], { width: colWidths[i] - 6 })) / 2;
      doc.text(headers[i], colX[i] + 3, textY, {
        width: colWidths[i] - 6,
        align: 'center'
      });
    }
    y += headerRowHeight;

    doc.font('Helvetica').fontSize(10);
    let nomor = 1;
    let totalSistem = 0;
    let totalFisik = 0;
    let totalSelisih = 0;

    for (const row of parts) {
      const sistem = parseFloat(row.qty_on_hand) || 0;
      const fisik = parseFloat(row.QtyFound) || 0;
      const selisihValue = fisik - sistem;

      totalSistem += sistem;
      totalFisik += fisik;
      totalSelisih += selisihValue; // Perhitungan total selisih normal

      // Tampilan selisih dengan tanda + dan -
      let selisihDisplay = '0';
      if (selisihValue > 0) {
        selisihDisplay = `+${formatQty(selisihValue)}`;
      } else if (selisihValue < 0) {
        selisihDisplay = `-${formatQty(Math.abs(selisihValue))}`;
      }

      const remark = selisihValue === 0 ? 'Sesuai' : (row.Remark || '-');

      const data = [
        nomor,
        row.part_name || '-',
        formatQty(sistem),
        formatQty(fisik),
        selisihDisplay,
        remark
      ];

      let maxHeight = 0;
      for (let i = 0; i < data.length; i++) {
        const height = getTextHeight(doc, data[i], { width: colWidths[i] - 6 });
        if (height > maxHeight) maxHeight = height;
      }

      const rowHeight = maxHeight + 10;
      if (y + rowHeight > 780) {
        doc.addPage();
        y = 40;
      }

      for (let i = 0; i < data.length; i++) {
        doc.rect(colX[i], y, colWidths[i], rowHeight).stroke();
        const centerAlignedCols = [0, 2, 3, 4];
        doc.text(data[i], colX[i] + 3, y + 5, {
          width: colWidths[i] - 6,
          align: centerAlignedCols.includes(i) ? 'center' : 'left'
        });
      }

      y += rowHeight;
      nomor++;
    }

   // Baris TOTAL
   const totalLabel = 'TOTAL';
   
   // Tampilan total selisih dengan tanda + dan -
   let totalSelisihDisplay = '0';
   if (totalSelisih > 0) {
     totalSelisihDisplay = `+${formatQty(totalSelisih)}`;
   } else if (totalSelisih < 0) {
     totalSelisihDisplay = `-${formatQty(Math.abs(totalSelisih))}`;
   }
   
   const totalData = [
     formatQty(totalSistem),
     formatQty(totalFisik),
     totalSelisihDisplay,
     ''
   ];

   let totalRowHeight = Math.max(
     getTextHeight(doc, totalLabel, { width: colWidths[0] + colWidths[1] - 6 }),
     ...totalData.map((d, i) => getTextHeight(doc, d, { width: colWidths[i + 2] - 6 }))
   ) + 10;

   if (y + totalRowHeight > 780) {
     doc.addPage();
     y = 40;
   }

  // Gabung kolom No + Nama Alat Kerja
  const mergedX = colX[0];
  const mergedWidth = colWidths[0] + colWidths[1];
  doc.rect(mergedX, y, mergedWidth, totalRowHeight).stroke();
  doc.font('Helvetica-Bold').text(totalLabel, mergedX + 3, y + 5, {
    width: mergedWidth - 6,
    align: 'center'
  });

  // Kolom: Jumlah di Sistem, Jumlah Fisik, Selisih, Keterangan
  for (let i = 0; i < totalData.length; i++) {
    const colIndex = i + 2; // karena index 0 & 1 digabung
    doc.rect(colX[colIndex], y, colWidths[colIndex], totalRowHeight).stroke();
    doc.text(totalData[i], colX[colIndex] + 3, y + 5, {
      width: colWidths[colIndex] - 6,
      align: [2, 3, 4].includes(colIndex) ? 'center' : 'left'
    });
  }

  y += totalRowHeight + 20;
    groupIndex++;
  }
}

module.exports = { renderHasilStockOpnameTable };