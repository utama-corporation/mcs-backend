const { pool } = require('../../../../db');

// Fungsi untuk mengambil data ringkasan stock opname berdasarkan lokasi
async function fetchStockOpnameSummary(noSO) {
  try {
    const [totalAssetRows] = await pool.query(`
      SELECT 
        a.LocationAsset AS LocationCode,
        COALESCE(l.location_name, a.LocationAsset) AS LocationName,
        COUNT(*) AS TotalAssets
      FROM tb_stockopname_d d
      LEFT JOIN asset a ON a.AssetCode = d.AssetCode
      LEFT JOIN tb_location_asset l ON l.location_code = a.LocationAsset
      WHERE d.NoSO = ?
      GROUP BY a.LocationAsset, l.location_name
      ORDER BY a.LocationAsset
    `, [noSO]);

    const [totalScannedAssetRows] = await pool.query(`
      SELECT 
        a.LocationAsset AS LocationCode,
        COALESCE(l.location_name, a.LocationAsset) AS LocationName,
        COUNT(*) AS TotalAssets
      FROM tb_stockopname_d_hasil d
      LEFT JOIN asset a ON a.AssetCode = d.AssetCode
      LEFT JOIN tb_location_asset l ON l.location_code = a.LocationAsset
      WHERE d.NoSO = ?
      GROUP BY a.LocationAsset, l.location_name
      ORDER BY a.LocationAsset
    `, [noSO]);

    const [assetNotFoundRows] = await pool.query(`
      SELECT 
        a.LocationAsset AS LocationCode,
        COALESCE(l.location_name, a.LocationAsset) AS LocationName,
        COUNT(*) AS TotalAssets
      FROM tb_stockopname_d d
      LEFT JOIN asset a ON a.AssetCode = d.AssetCode
      LEFT JOIN tb_location_asset l ON l.location_code = a.LocationAsset
      WHERE d.NoSO = ?
        AND d.HasNotBeenPrinted != 1
        AND NOT EXISTS (
          SELECT 1 FROM tb_stockopname_d_hasil h
          WHERE h.NoSO = d.NoSO AND h.AssetCode = d.AssetCode
        )
      GROUP BY a.LocationAsset, l.location_name
      ORDER BY a.LocationAsset
    `, [noSO]);

    const [assetWithoutQRRows] = await pool.query(`
      SELECT 
        a.LocationAsset AS LocationCode,
        COALESCE(l.location_name, a.LocationAsset) AS LocationName,
        COUNT(*) AS TotalAssets
      FROM tb_stockopname_d d
      LEFT JOIN asset a ON a.AssetCode = d.AssetCode
      LEFT JOIN tb_location_asset l ON l.location_code = a.LocationAsset
      WHERE d.HasNotBeenPrinted = 1
        AND d.NoSO = ?
      GROUP BY a.LocationAsset, l.location_name
      ORDER BY a.LocationAsset
    `, [noSO]);

    const [nonAssetRows] = await pool.query(`
      SELECT 
        na.location_code AS LocationCode,
        COALESCE(l.location_name, na.location_code) AS LocationName,
        COUNT(*) AS TotalAssets
      FROM tb_stockopname_non_assets na
      LEFT JOIN tb_location_asset l ON l.location_code = na.location_code
      WHERE na.NoSO = ?
      GROUP BY na.location_code, l.location_name
      ORDER BY na.location_code
    `, [noSO]);

    const locationSummaryMap = new Map();

    totalAssetRows.forEach(row => {
      const locationName = row.LocationName || row.LocationCode;
      if (!locationSummaryMap.has(locationName)) {
        locationSummaryMap.set(locationName, {
          locationCode: row.LocationCode,
          locationName: locationName,
          totalAssets: 0,
          scannedAssets: 0,
          notFoundAssets: 0,
          withoutQRAssets: 0,
          foundAssets: 0
        });
      }
      locationSummaryMap.get(locationName).totalAssets = row.TotalAssets;
    });

    totalScannedAssetRows.forEach(row => {
      const locationName = row.LocationName || row.LocationCode;
      if (!locationSummaryMap.has(locationName)) {
        locationSummaryMap.set(locationName, {
          locationCode: row.LocationCode,
          locationName: locationName,
          totalAssets: 0,
          scannedAssets: 0,
          notFoundAssets: 0,
          withoutQRAssets: 0,
          foundAssets: 0
        });
      }
      locationSummaryMap.get(locationName).scannedAssets = row.TotalAssets;
    });

    assetNotFoundRows.forEach(row => {
      const locationName = row.LocationName || row.LocationCode;
      if (!locationSummaryMap.has(locationName)) {
        locationSummaryMap.set(locationName, {
          locationCode: row.LocationCode,
          locationName: locationName,
          totalAssets: 0,
          scannedAssets: 0,
          notFoundAssets: 0,
          withoutQRAssets: 0,
          foundAssets: 0
        });
      }
      locationSummaryMap.get(locationName).notFoundAssets = row.TotalAssets;
    });

    assetWithoutQRRows.forEach(row => {
      const locationName = row.LocationName || row.LocationCode;
      if (!locationSummaryMap.has(locationName)) {
        locationSummaryMap.set(locationName, {
          locationCode: row.LocationCode,
          locationName: locationName,
          totalAssets: 0,
          scannedAssets: 0,
          notFoundAssets: 0,
          withoutQRAssets: 0,
          foundAssets: 0
        });
      }
      locationSummaryMap.get(locationName).withoutQRAssets = row.TotalAssets;
    });

    nonAssetRows.forEach(row => {
      const locationName = row.LocationName || row.LocationCode;
      if (!locationSummaryMap.has(locationName)) {
        locationSummaryMap.set(locationName, {
          locationCode: row.LocationCode,
          locationName: locationName,
          totalAssets: 0,
          scannedAssets: 0,
          notFoundAssets: 0,
          withoutQRAssets: 0,
          foundAssets: 0
        });
      }
      locationSummaryMap.get(locationName).foundAssets = row.TotalAssets;
    });

    const summaryData = Array.from(locationSummaryMap.values())
      .sort((a,b) => a.locationName.localeCompare(b.locationName));

    return summaryData;

  } catch (error) {
    console.error('Error in fetchStockOpnameSummary:', error);
    throw error;
  }
}

function drawSummaryTableHeader(doc, startX, y, columns, headerHeight=25) {
  doc.font('Helvetica-Bold').fontSize(9);
  
  let currentX = startX;
  columns.forEach(col => {
    doc.rect(currentX, y, col.width, headerHeight).stroke();
    doc.text(col.text, currentX+3, y+3, {width: col.width - 6, align: 'center', lineGap: 1});
    currentX += col.width;
  });
  return y + headerHeight;
}

function checkPageSpace(doc, requiredHeight) {
  const currentY = doc.y;
  const bottomMargin = doc.page.margins.bottom;
  const safetyMargin = 20;
  const availableHeight = doc.page.height - bottomMargin - safetyMargin;
  const remainingSpace = availableHeight - currentY;
  
  return {
    needNewPage: remainingSpace < requiredHeight,
    remainingSpace: remainingSpace,
    currentY: currentY,
    availableHeight: availableHeight
  };
}

function addNewPageIfNeeded(doc, requiredHeight) {
  const spaceCheck = checkPageSpace(doc, requiredHeight);
  if (spaceCheck.needNewPage) {
    doc.addPage();
    doc.x = doc.page.margins.left;
    doc.y = doc.page.margins.top;
  }
  return doc.y;
}

function printStockOpnameSummaryTable(doc, summaryData) {
  if(summaryData.length === 0) return;

  const startX = doc.page.margins.left;
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const colNoWidth = 30;
  const colLokasiWidth = 120;
  const colJumlahWidth = (tableWidth - colNoWidth - colLokasiWidth) / 5;

  const headerHeight = 25;
  const rowPadding = 3;

  const headers = [
    { text: 'No', width: colNoWidth },
    { text: 'Lokasi', width: colLokasiWidth },
    { text: 'Aset Di MCS', width: colJumlahWidth },
    { text: 'Hasil Scan', width: colJumlahWidth },
    { text: 'Aset Tidak Ditemukan', width: colJumlahWidth },
    { text: 'Aset Tanpa QR Code', width: colJumlahWidth },
    { text: 'Aset Temuan', width: colJumlahWidth }
  ];

  const drawHeader = (doc, yPos) => drawSummaryTableHeader(doc, startX, yPos, headers, headerHeight);

  let y = addNewPageIfNeeded(doc, headerHeight + 40);
  y = drawHeader(doc, y);

  doc.font('Helvetica').fontSize(8);

  let grandTotal = {
    totalAssets: 0,
    scannedAssets: 0,
    notFoundAssets: 0,
    withoutQRAssets: 0,
    foundAssets: 0
  };

  summaryData.forEach((item, idx) => {
    grandTotal.totalAssets += item.totalAssets;
    grandTotal.scannedAssets += item.scannedAssets;
    grandTotal.notFoundAssets += item.notFoundAssets;
    grandTotal.withoutQRAssets += item.withoutQRAssets;
    grandTotal.foundAssets += item.foundAssets;

    const noText = (idx + 1).toString();
    const lokasiText = item.locationName || '';
    const totalAssetsText = item.totalAssets.toString();
    const scannedAssetsText = item.scannedAssets.toString();
    const notFoundAssetsText = item.notFoundAssets.toString();
    const withoutQRAssetsText = item.withoutQRAssets.toString();
    const foundAssetsText = item.foundAssets.toString();

    const heightNo = doc.heightOfString(noText, { width: colNoWidth - 6 });
    const heightLokasi = doc.heightOfString(lokasiText, { width: colLokasiWidth - 6 });
    const heightTotalAssets = doc.heightOfString(totalAssetsText, { width: colJumlahWidth - 6 });
    const heightScannedAssets = doc.heightOfString(scannedAssetsText, { width: colJumlahWidth - 6 });
    const heightNotFoundAssets = doc.heightOfString(notFoundAssetsText, { width: colJumlahWidth - 6 });
    const heightWithoutQRAssets = doc.heightOfString(withoutQRAssetsText, { width: colJumlahWidth - 6 });
    const heightFoundAssets = doc.heightOfString(foundAssetsText, { width: colJumlahWidth - 6 });

    const rowHeight = Math.max(heightNo, heightLokasi, heightTotalAssets, heightScannedAssets, heightNotFoundAssets, heightWithoutQRAssets, heightFoundAssets) + rowPadding*2;

    const spaceCheck = checkPageSpace(doc, rowHeight + 10);
    if(spaceCheck.needNewPage) {
      doc.addPage();
      doc.x = doc.page.margins.left;
      doc.y = doc.page.margins.top;
      y = doc.y;
    }

    const maxY = doc.page.height - doc.page.margins.bottom - 30;
    if(y + rowHeight > maxY) {
      doc.addPage();
      doc.x = doc.page.margins.left;
      doc.y = doc.page.margins.top;
      y = doc.y;
    }

    let currentX = startX;
    // Draw each cell's rectangle for the row
    headers.forEach(header => {
      doc.rect(currentX, y, header.width, rowHeight).stroke();
      currentX += header.width;
    });

    // Fill text values per cell
    doc.text(noText, startX + 3, y + rowPadding, { width: colNoWidth - 6, align: 'center' });
    doc.text(lokasiText, startX + colNoWidth + 3, y + rowPadding, { width: colLokasiWidth - 6 });
    doc.text(totalAssetsText, startX + colNoWidth + colLokasiWidth + 3, y + rowPadding, { width: colJumlahWidth - 6, align: 'center' });
    doc.text(scannedAssetsText, startX + colNoWidth + colLokasiWidth + colJumlahWidth + 3, y + rowPadding, { width: colJumlahWidth - 6, align: 'center' });
    doc.text(notFoundAssetsText, startX + colNoWidth + colLokasiWidth + (colJumlahWidth*2) + 3, y + rowPadding, { width: colJumlahWidth - 6, align: 'center' });
    doc.text(withoutQRAssetsText, startX + colNoWidth + colLokasiWidth + (colJumlahWidth*3) + 3, y + rowPadding, { width: colJumlahWidth - 6, align: 'center' });
    doc.text(foundAssetsText, startX + colNoWidth + colLokasiWidth + (colJumlahWidth*4) + 3, y + rowPadding, { width: colJumlahWidth - 6, align: 'center' });

    y += rowHeight;
  });

  // Total row height and new page check
  const totalRowHeight = 15;
  const spaceCheckTotal = checkPageSpace(doc, totalRowHeight + 10);
  if(spaceCheckTotal.needNewPage) {
    doc.addPage();
    doc.x = doc.page.margins.left;
    doc.y = doc.page.margins.top;
    y = doc.y;
  }

  // Draw merged cell for No + Lokasi columns
  doc.rect(startX, y, colNoWidth + colLokasiWidth, totalRowHeight).stroke();

  // Draw other columns separately
  let currentX = startX + colNoWidth + colLokasiWidth;
  for(let i = 0; i < 5; i++) {
    doc.rect(currentX, y, colJumlahWidth, totalRowHeight).stroke();
    currentX += colJumlahWidth;
  }

  // Fill total row text with bold font
  doc.font('Helvetica-Bold').fontSize(9);

  // "TOTAL" spans No + Lokasi columns
  doc.text('TOTAL', startX + 3, y + rowPadding, { width: colNoWidth + colLokasiWidth - 6, align: 'center' });

  // Fill totals in remaining columns
  doc.text(grandTotal.totalAssets.toString(), startX + colNoWidth + colLokasiWidth + 3, y + rowPadding, { width: colJumlahWidth - 6, align:'center' });
  doc.text(grandTotal.scannedAssets.toString(), startX + colNoWidth + colLokasiWidth + colJumlahWidth + 3, y + rowPadding, { width: colJumlahWidth - 6, align:'center' });
  doc.text(grandTotal.notFoundAssets.toString(), startX + colNoWidth + colLokasiWidth + (colJumlahWidth*2) +3, y + rowPadding, { width: colJumlahWidth - 6, align:'center' });
  doc.text(grandTotal.withoutQRAssets.toString(), startX + colNoWidth + colLokasiWidth + (colJumlahWidth*3) +3, y + rowPadding, { width: colJumlahWidth - 6, align:'center' });
  doc.text(grandTotal.foundAssets.toString(), startX + colNoWidth + colLokasiWidth + (colJumlahWidth*4) +3, y + rowPadding, { width: colJumlahWidth - 6, align:'center' });

  y += totalRowHeight;
  doc.y = y + 10;
}

// Fungsi utama untuk mencetak ringkasan stock opname
async function printStockOpnameSummary(doc, noSO) {
    try {
      const summaryData = await fetchStockOpnameSummary(noSO);
  
      if (summaryData.length === 0) {
        doc.font('Helvetica-Bold').fontSize(12).text('Tidak ada data ringkasan untuk ditampilkan');
        return;
      }
  
      // Calculate the height needed for the title and the table
      const titleHeight = 20; // Adjust this value based on your title font size and padding
      const tableMinHeight = 40; // Minimum height for the table (header + at least one row)
  
      // Check if there is enough space for the title and the table
      const spaceCheck = checkPageSpace(doc, titleHeight + tableMinHeight);
      if (spaceCheck.needNewPage) {
        doc.addPage();
        doc.x = doc.page.margins.left;
        doc.y = doc.page.margins.top;
      }
  
      // Move down for the title
      doc.moveDown(1);
      doc.x = doc.page.margins.left;
  
      // Print the title
      doc.font('Helvetica-Bold').fontSize(14)
        .text('III. Ringkasan Hasil SO', { align: 'left' });
  
      doc.moveDown(0.5);
  
      // Print the summary table
      printStockOpnameSummaryTable(doc, summaryData);
  
    } catch (error) {
      console.error('Error in printStockOpnameSummary:', error);
      throw error;
    }
  }
  

module.exports = {
  printStockOpnameSummary,
  fetchStockOpnameSummary
};

