const { pool } = require('../../../../db');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ASSET_DOCS_PATH = '\\\\192.168.10.100\\WebServer\\xampp\\htdocs\\mcs\\assets\\docs\\masterAsset';
const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.webp', '.png'];

function getTextHeight(doc, text, options) {
  return doc.heightOfString(String(text ?? '-'), options);
}

function formatQty(value) {
  const number = parseFloat(value);
  return Number.isInteger(number) ? number.toString() : number.toFixed(2).replace(/\.?0+$/, '');
}

// Fungsi untuk debug dan fix encoding issues
function debugAndFixEncoding(text) {
  // Hapus fungsi ini karena tidak digunakan lagi
  return text;
}

// Fungsi untuk preserve spacing dan karakter whitespace dari database
function preserveOriginalSpacing(text) {
  if (!text) return '-';
  
  // Preserve semua whitespace characters (space, tab, non-breaking space, dll)
  let cleanText = text;
  
  // Convert berbagai jenis whitespace ke regular space untuk konsistensi PDF
  cleanText = cleanText
    .replace(/\t/g, '    ')      // Tab ke 4 spaces
    .replace(/\u00A0/g, ' ')     // Non-breaking space ke regular space
    .replace(/\u2009/g, ' ')     // Thin space
    .replace(/\u2007/g, ' ')     // Figure space
    .replace(/\u2002/g, ' ')     // En space
    .replace(/\u2003/g, ' ')     // Em space
    .replace(/\u2000/g, ' ')     // En quad
    .replace(/\u2001/g, ' ')     // Em quad
    .replace(/\u2004/g, ' ')     // Three-per-em space
    .replace(/\u2005/g, ' ')     // Four-per-em space
    .replace(/\u2006/g, ' ')     // Six-per-em space
    .replace(/\u2008/g, ' ')     // Punctuation space
    .replace(/\u200A/g, ' ')     // Hair space
    .replace(/\u205F/g, ' ');    // Medium mathematical space
  
  return cleanText;
}

async function renderHasilStockOpnameTable(doc, noSO, withImages = false) {
  // Query sederhana tanpa CONVERT - ambil data asli
  const [rows] = await pool.query(`
    SELECT
      CONCAT(asset.AssetName, ' (', asset.AssetCode, ')') AS AssetCode,
      bom.part AS part_name,
      bom.id AS bom_id,
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

  // Batch query semua attachment sekaligus (hanya jika withImages)
  let attachmentMap = {};
  if (withImages) {
    const bomIds = [...new Set(rows.map(r => r.bom_id).filter(Boolean))];
    if (bomIds.length) {
      const placeholders = bomIds.map(() => '?').join(',');
      const [attachRows] = await pool.query(
        `SELECT part_id, filename FROM tb_attachment_asset WHERE part_id IN (${placeholders})`,
        bomIds
      );
      for (const att of attachRows) {
        if (!attachmentMap[att.part_id]) attachmentMap[att.part_id] = [];
        attachmentMap[att.part_id].push(att.filename);
      }
    }
  }

  if (!rows.length) {
    doc.text('Tidak ada data hasil stock opname.');
    doc.moveDown();
    return;
  }

  const leftMargin = doc.page.margins.left;
  doc.fontSize(13)
    .font('Helvetica-Bold')
    .text('III. Hasil Stock Opname', leftMargin, doc.y, { align: 'left' });

  doc.moveDown(0.8);

  const grouped = {};
  rows.forEach(row => {
    // Preserve spacing asli dari database
    const originalAssetCode = preserveOriginalSpacing(row.AssetCode);
    // console.log('Processing AssetCode:', originalAssetCode);
    
    if (!grouped[originalAssetCode]) grouped[originalAssetCode] = [];
    grouped[originalAssetCode].push({
      ...row,
      AssetCode: originalAssetCode,
      part_name: preserveOriginalSpacing(row.part_name),
      Remark: preserveOriginalSpacing(row.Remark),
      bom_id: row.bom_id
    });
  });

  // Layout kolom: dengan gambar sisipkan kolom "Gambar" antara No dan Nama Alat Kerja
  // Total usable width = 515 (A4 595 - margin 40 kiri - 40 kanan)
  const IMG_CELL_W = 100;
  const IMG_CELL_H = 80; // tinggi minimum cell saat ada gambar

  // Total usable width = 515 (A4 595 - margin 40 kiri - 40 kanan)
  // withImages:  25 + 100 + 135 + 55 + 55 + 55 + 90 = 515
  const colX      = withImages ? [40,  65, 165, 300, 355, 410, 465] : [40,  70, 250, 310, 370, 430];
  const colWidths = withImages ? [25, 100, 135,  55,  55,  55,  90] : [30, 180,  60,  60,  60, 125];
  const headers   = withImages
    ? ['No', 'Gambar', 'Nama Alat Kerja', 'Jumlah di Sistem', 'Jumlah Fisik', 'Selisih', 'Keterangan']
    : ['No', 'Nama Alat Kerja', 'Jumlah di Sistem', 'Jumlah Fisik', 'Selisih', 'Keterangan'];

  // Indeks kolom logis (tidak berubah tergantung mode)
  const COL_NO      = 0;
  const COL_IMG     = withImages ? 1 : -1;
  const COL_PART    = withImages ? 2 : 1;
  const COL_SISTEM  = withImages ? 3 : 2;
  const COL_FISIK   = withImages ? 4 : 3;
  const COL_SELISIH = withImages ? 5 : 4;
  const COL_REMARK  = withImages ? 6 : 5;

  let y = doc.y;
  let groupIndex = 1;

  for (const [assetCode, parts] of Object.entries(grouped)) {
    if (y > 700) {
      doc.addPage();
      y = doc.y;
    }

    doc.fontSize(11).font('Helvetica').text(`${groupIndex}. ${assetCode}`, colX[0] + 5, y);
    y += 15;

    // Header row
    doc.fontSize(10).font('Helvetica-Bold');
    let headerMaxHeight = 0;
    for (let i = 0; i < headers.length; i++) {
      const h = getTextHeight(doc, headers[i], { width: colWidths[i] - 6 });
      if (h > headerMaxHeight) headerMaxHeight = h;
    }
    const headerRowHeight = headerMaxHeight + 10;
    for (let i = 0; i < headers.length; i++) {
      doc.rect(colX[i], y, colWidths[i], headerRowHeight).stroke();
      const textY = y + (headerRowHeight - getTextHeight(doc, headers[i], { width: colWidths[i] - 6 })) / 2;
      doc.text(headers[i], colX[i] + 3, textY, { width: colWidths[i] - 6, align: 'center' });
    }
    y += headerRowHeight;

    doc.font('Helvetica').fontSize(10);
    let nomor = 1;
    let totalSistem = 0;
    let totalFisik = 0;
    let totalSelisih = 0;

    for (const row of parts) {
      const sistem = parseFloat(row.qty_on_hand) || 0;
      const fisik  = parseFloat(row.QtyFound)    || 0;
      const selisihValue = fisik - sistem;
      totalSistem  += sistem;
      totalFisik   += fisik;
      totalSelisih += selisihValue;

      let selisihDisplay = '0';
      if (selisihValue > 0)      selisihDisplay = `+${formatQty(selisihValue)}`;
      else if (selisihValue < 0) selisihDisplay = `-${formatQty(Math.abs(selisihValue))}`;

      const remark = selisihValue === 0
        ? (row.Remark && row.Remark.trim() !== '-' ? row.Remark : 'Sesuai')
        : (row.Remark || '-');

      // Cari gambar pertama untuk part ini (hanya jika withImages)
      let imgPath = null;
      if (withImages && row.bom_id) {
        const filenames = attachmentMap[row.bom_id] || [];
        for (const filename of filenames) {
          const ext = path.extname(filename).toLowerCase();
          if (!SUPPORTED_EXTENSIONS.includes(ext)) continue;
          const fp = path.join(ASSET_DOCS_PATH, filename);
          if (fs.existsSync(fp)) { imgPath = fp; break; }
        }
      }

      // Hitung tinggi teks per kolom (skip kolom Gambar)
      const textCols = withImages
        ? [nomor, '', row.part_name || '-', formatQty(sistem), formatQty(fisik), selisihDisplay, remark]
        : [nomor, row.part_name || '-', formatQty(sistem), formatQty(fisik), selisihDisplay, remark];

      let maxTextHeight = 0;
      for (let i = 0; i < textCols.length; i++) {
        if (withImages && i === COL_IMG) continue; // kolom gambar, skip hitung teks
        const h = getTextHeight(doc, textCols[i], { width: colWidths[i] - 6 });
        if (h > maxTextHeight) maxTextHeight = h;
      }

      // Jika ada gambar, tinggi baris minimal IMG_CELL_H
      const rowHeight = Math.max(maxTextHeight + 10, withImages && imgPath ? IMG_CELL_H + 8 : 0);

      if (y + rowHeight > 780) {
        doc.addPage();
        y = 40;
      }

      // Gambar border & isi semua kolom
      for (let i = 0; i < textCols.length; i++) {
        doc.rect(colX[i], y, colWidths[i], rowHeight).stroke();

        if (withImages && i === COL_IMG) {
          // Render gambar di dalam cell
          if (imgPath) {
            const pad = 3;
            const maxW = colWidths[i] - pad * 2;
            const maxH = rowHeight - pad * 2;
            try {
              // Convert ke JPEG agar PDFKit bisa render semua format (webp, png, jpg, dll)
              const jpegBuffer = await sharp(imgPath).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
              doc.image(jpegBuffer, colX[i] + pad, y + pad, { fit: [maxW, maxH] });
            } catch (e) {
              console.error('[IMG] render error:', imgPath, e.message);
              doc.fontSize(6).text('?', colX[i] + 3, y + rowHeight / 2 - 4, { width: colWidths[i] - 6, align: 'center' });
            }
          }
          continue;
        }

        const centerAlignedCols = [COL_NO, COL_SISTEM, COL_FISIK, COL_SELISIH];
        const safeText = String(textCols[i] || '');
        doc.fontSize(10).font('Helvetica')
          .text(safeText, colX[i] + 3, y + 5, {
            width: colWidths[i] - 6,
            align: centerAlignedCols.includes(i) ? 'center' : 'left'
          });
      }

      y += rowHeight;
      nomor++;
    }

    // Baris TOTAL
    let totalSelisihDisplay = '0';
    if (totalSelisih > 0)      totalSelisihDisplay = `+${formatQty(totalSelisih)}`;
    else if (totalSelisih < 0) totalSelisihDisplay = `-${formatQty(Math.abs(totalSelisih))}`;

    const totalData = [formatQty(totalSistem), formatQty(totalFisik), totalSelisihDisplay, ''];

    // Merged cell = kolom No + (Gambar jika ada) + Nama Alat Kerja
    const mergedWidth = colX[COL_PART] + colWidths[COL_PART] - colX[COL_NO];

    let totalRowHeight = Math.max(
      getTextHeight(doc, 'TOTAL', { width: mergedWidth - 6 }),
      ...totalData.map((d, i) => getTextHeight(doc, d, { width: colWidths[COL_SISTEM + i] - 6 }))
    ) + 10;

    if (y + totalRowHeight > 780) {
      doc.addPage();
      y = 40;
    }

    doc.rect(colX[COL_NO], y, mergedWidth, totalRowHeight).stroke();
    doc.font('Helvetica-Bold').text('TOTAL', colX[COL_NO] + 3, y + 5, { width: mergedWidth - 6, align: 'center' });

    for (let i = 0; i < totalData.length; i++) {
      const ci = COL_SISTEM + i;
      doc.rect(colX[ci], y, colWidths[ci], totalRowHeight).stroke();
      doc.text(String(totalData[i]), colX[ci] + 3, y + 5, {
        width: colWidths[ci] - 6,
        align: i < 3 ? 'center' : 'left'
      });
    }

    y += totalRowHeight + 20;
    groupIndex++;
  }
}

module.exports = { renderHasilStockOpnameTable };