const { pool } = require('../../../../db');

// Fungsi untuk mengelompokkan semua data berdasarkan lokasi
async function fetchGroupedByLocation(noSO) {
  // Helper untuk normalisasi string
  const cleanText = (text) => {
    if (!text) return '';
    return text
      .toString()
      .normalize("NFKC")         // normalisasi unicode
      .replace(/\s+/g, " ")      // rapikan spasi ganda
      .trim();                   // buang spasi depan/belakang
  };

  // Query untuk asset tidak ditemukan
  const [notFoundRows] = await pool.query(
    `SELECT 
      a.LocationAsset AS LocationCode,
      COALESCE(loc.location_name, a.LocationAsset) AS LocationName,
      d.AssetCode,
      a.AssetName
    FROM tb_stockopname_d d
    LEFT JOIN asset a ON a.AssetCode = d.AssetCode
    LEFT JOIN tb_location_asset loc ON loc.location_code = a.LocationAsset
    WHERE d.NoSO = ?
      AND d.HasNotBeenPrinted != 1
      AND NOT EXISTS (
        SELECT 1 FROM tb_stockopname_d_hasil h
        WHERE h.NoSO = d.NoSO AND h.AssetCode = d.AssetCode
      )
    ORDER BY a.LocationAsset, d.AssetCode`,
    [noSO]
  );

  // Query untuk asset ditemukan tanpa QR
  const [noQrRows] = await pool.query(
    `SELECT 
      a.LocationAsset AS LocationCode,
      COALESCE(loc.location_name, a.LocationAsset) AS LocationName,
      d.AssetCode,
      a.AssetName,
      s.status
    FROM tb_stockopname_d d
    JOIN asset a ON d.AssetCode = a.AssetCode
    JOIN tb_so_status s ON d.id_status = s.id_status
    LEFT JOIN tb_location_asset loc ON loc.location_code = a.LocationAsset
    WHERE d.HasNotBeenPrinted = 1
      AND d.NoSO = ?
    ORDER BY a.LocationAsset, d.AssetCode`,
    [noSO]
  );

  // Query untuk asset tidak terdaftar
  const [nonAssetRows] = await pool.query(
    `SELECT 
      na.location_code AS LocationCode,
      COALESCE(loc.location_name, na.location_code) AS LocationName,
      na.non_asset_name,
      na.remark
    FROM tb_stockopname_non_assets na
    LEFT JOIN tb_location_asset loc 
      ON loc.location_code = na.location_code
    WHERE na.NoSO = ?
    ORDER BY na.location_code, na.non_asset_name`,
    [noSO]
  );

  // Kumpulkan semua lokasi unik berdasarkan nama lokasi, bukan kode
  const locationMap = new Map();
  
  // Kumpulkan semua data dan grup berdasarkan nama lokasi
  notFoundRows.forEach(row => {
    const locationName = cleanText(row.LocationName || row.LocationCode);
    if (!locationMap.has(locationName)) {
      locationMap.set(locationName, {
        locationCode: cleanText(row.LocationCode),
        locationName,
        assetNotFound: [],
        assetWithoutQR: [],
        nonAssets: []
      });
    }
    locationMap.get(locationName).assetNotFound.push({
      AssetCode: cleanText(row.AssetCode),
      AssetName: cleanText(row.AssetName)
    });
  });

  noQrRows.forEach(row => {
    const locationName = cleanText(row.LocationName || row.LocationCode);
    if (!locationMap.has(locationName)) {
      locationMap.set(locationName, {
        locationCode: cleanText(row.LocationCode),
        locationName,
        assetNotFound: [],
        assetWithoutQR: [],
        nonAssets: []
      });
    }
    locationMap.get(locationName).assetWithoutQR.push({
      AssetCode: cleanText(row.AssetCode),
      AssetName: cleanText(row.AssetName),
      Status: cleanText(row.status)
    });
  });

  nonAssetRows.forEach(row => {
    const locationName = cleanText(row.LocationName || row.LocationCode);
    if (!locationMap.has(locationName)) {
      locationMap.set(locationName, {
        locationCode: cleanText(row.LocationCode),
        locationName,
        assetNotFound: [],
        assetWithoutQR: [],
        nonAssets: []
      });
    }
    locationMap.get(locationName).nonAssets.push({
      AssetName: cleanText(row.non_asset_name),
      Remark: cleanText(row.remark)
    });
  });

  // Convert map to array dan sort berdasarkan nama lokasi
  const groupedByLocation = Array.from(locationMap.values())
    .filter(location => 
      location.assetNotFound.length > 0 || 
      location.assetWithoutQR.length > 0 || 
      location.nonAssets.length > 0
    )
    .sort((a, b) => a.locationName.localeCompare(b.locationName));

  return groupedByLocation;
}

// Fungsi helper untuk menggambar header tabel dan mengembalikan posisi Y setelah header
function drawTableHeader(doc, startX, y, columns, headerHeight = 20) {
  doc.font('Helvetica-Bold').fontSize(10);
  
  let currentX = startX;
  columns.forEach(col => {
    doc.rect(currentX, y, col.width, headerHeight).stroke();
    doc.text(col.title, currentX + 5, y + 5, { 
      width: col.width - 10, 
      align: 'center' 
    });
    currentX += col.width;
  });
  
  return y + headerHeight;
}

// Fungsi helper yang lebih fleksibel untuk mengecek apakah perlu halaman baru
function checkPageSpace(doc, requiredHeight) {
  const currentY = doc.y;
  const bottomMargin = doc.page.margins.bottom;
  const safetyMargin = 20; // Margin keamanan tambahan agar tidak terlalu dekat dengan batas bawah
  const availableHeight = doc.page.height - bottomMargin - safetyMargin;
  const remainingSpace = availableHeight - currentY;
  
  return {
    needNewPage: remainingSpace < requiredHeight,
    remainingSpace: remainingSpace,
    currentY: currentY,
    availableHeight: availableHeight
  };
}

// Fungsi helper untuk pindah ke halaman baru jika diperlukan (TANPA header)
function addNewPageIfNeeded(doc, requiredHeight) {
  const spaceCheck = checkPageSpace(doc, requiredHeight);
  
  if (spaceCheck.needNewPage) {
    doc.addPage();
    doc.x = doc.page.margins.left;
    doc.y = doc.page.margins.top;
  }
  
  return doc.y;
}

// Fungsi untuk mencetak tabel asset tidak ditemukan
function printAssetNotFoundTable(doc, items) {
  if (items.length === 0) return;

  const startX = doc.page.margins.left;
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colNoWidth = 40;
  const colKodeWidth = (tableWidth - colNoWidth) / 2;
  const colNamaWidth = (tableWidth - colNoWidth) / 2;
  const rowPadding = 5;
  const headerHeight = 20;

  const columns = [
    { title: 'No', width: colNoWidth },
    { title: 'Kode Aset', width: colKodeWidth },
    { title: 'Nama Aset', width: colNamaWidth }
  ];

  // Fungsi untuk menggambar header
  const drawHeader = (doc, yPos) => {
    return drawTableHeader(doc, startX, yPos, columns, headerHeight);
  };

  // Estimasi tinggi minimal untuk tabel (header + 1 baris)
  const minTableHeight = headerHeight + 30; // Tambah margin keamanan
  
  // Cek apakah perlu halaman baru untuk memulai tabel
  let y = addNewPageIfNeeded(doc, minTableHeight);
  
  // Gambar header hanya sekali di awal tabel
  y = drawHeader(doc, y);
  
  doc.font('Helvetica').fontSize(9);

  items.forEach((item, idx) => {
    const noText = (idx + 1).toString();
    const assetCodeText = item.AssetCode || '';
    const assetNameText = item.AssetName || '';

    // Hitung tinggi yang diperlukan untuk baris ini
    const heightNo = doc.heightOfString(noText, { width: colNoWidth - 10 });
    const heightKode = doc.heightOfString(assetCodeText, { width: colKodeWidth - 10 });
    const heightNama = doc.heightOfString(assetNameText, { width: colNamaWidth - 10 });
    const rowHeight = Math.max(heightNo, heightKode, heightNama) + rowPadding * 1.5;

    // Cek apakah baris ini muat di halaman saat ini dengan margin keamanan
    const spaceCheck = checkPageSpace(doc, rowHeight + 10); // Tambah margin keamanan
    if (spaceCheck.needNewPage) {
      doc.addPage();
      doc.x = doc.page.margins.left;
      doc.y = doc.page.margins.top;
      y = doc.y; // Lanjutkan tanpa header
    }

    // Pastikan y tidak melewati batas bawah yang aman
    const maxY = doc.page.height - doc.page.margins.bottom - 30;
    if (y + rowHeight > maxY) {
      doc.addPage();
      doc.x = doc.page.margins.left;
      doc.y = doc.page.margins.top;
      y = doc.y;
    }

    // Gambar baris
    doc.rect(startX, y, colNoWidth, rowHeight).stroke();
    doc.rect(startX + colNoWidth, y, colKodeWidth, rowHeight).stroke();
    doc.rect(startX + colNoWidth + colKodeWidth, y, colNamaWidth, rowHeight).stroke();

    doc.text(noText, startX + 5, y + rowPadding, { width: colNoWidth - 10, align: 'center' });
    doc.text(assetCodeText, startX + colNoWidth + 5, y + rowPadding, { width: colKodeWidth - 10 });
    doc.text(assetNameText, startX + colNoWidth + colKodeWidth + 5, y + rowPadding, { width: colNamaWidth - 10 });

    y += rowHeight;
  });

  doc.y = y + 5;
}

// Fungsi untuk mencetak tabel asset tanpa QR
function printAssetWithoutQRTable(doc, items) {
  if (items.length === 0) return;

  const startX = doc.page.margins.left;
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colNoWidth = 40;
  const colKodeWidth = (tableWidth - colNoWidth) / 3;
  const colNamaWidth = (tableWidth - colNoWidth) / 3;
  const colStatusWidth = (tableWidth - colNoWidth) / 3;
  const paddingTop = 3, paddingBottom = 1;
  const headerHeight = 20;

  const columns = [
    { title: 'No', width: colNoWidth },
    { title: 'Kode Aset', width: colKodeWidth },
    { title: 'Nama Aset', width: colNamaWidth },
    { title: 'Status', width: colStatusWidth }
  ];

  // Fungsi untuk menggambar header
  const drawHeader = (doc, yPos) => {
    return drawTableHeader(doc, startX, yPos, columns, headerHeight);
  };

  // Estimasi tinggi minimal untuk tabel (header + 1 baris)
  const minTableHeight = headerHeight + 30; // Tambah margin keamanan
  
  // Cek apakah perlu halaman baru untuk memulai tabel
  let y = addNewPageIfNeeded(doc, minTableHeight);
  
  // Gambar header hanya sekali di awal tabel
  y = drawHeader(doc, y);
  
  doc.font('Helvetica').fontSize(9);

  items.forEach((item, idx) => {
    const noText = (idx + 1).toString();
    const kodeText = item.AssetCode || '';
    const namaText = item.AssetName || '';
    const statusText = item.Status || '';

    // Hitung tinggi yang diperlukan untuk baris ini
    const heightNo = doc.heightOfString(noText, { width: colNoWidth - 10 });
    const heightKode = doc.heightOfString(kodeText, { width: colKodeWidth - 10 });
    const heightNama = doc.heightOfString(namaText, { width: colNamaWidth - 10 });
    const heightStatus = doc.heightOfString(statusText, { width: colStatusWidth - 10 });
    const rowHeight = Math.max(heightNo, heightKode, heightNama, heightStatus) + paddingTop + paddingBottom;

    // Cek apakah baris ini muat di halaman saat ini dengan margin keamanan
    const spaceCheck = checkPageSpace(doc, rowHeight + 10); // Tambah margin keamanan
    if (spaceCheck.needNewPage) {
      doc.addPage();
      doc.x = doc.page.margins.left;
      doc.y = doc.page.margins.top;
      y = doc.y; // Lanjutkan tanpa header
    }

    // Pastikan y tidak melewati batas bawah yang aman
    const maxY = doc.page.height - doc.page.margins.bottom - 30;
    if (y + rowHeight > maxY) {
      doc.addPage();
      doc.x = doc.page.margins.left;
      doc.y = doc.page.margins.top;
      y = doc.y;
    }

    // Gambar baris
    doc.rect(startX, y, colNoWidth, rowHeight).stroke();
    doc.rect(startX + colNoWidth, y, colKodeWidth, rowHeight).stroke();
    doc.rect(startX + colNoWidth + colKodeWidth, y, colNamaWidth, rowHeight).stroke();
    doc.rect(startX + colNoWidth + colKodeWidth + colNamaWidth, y, colStatusWidth, rowHeight).stroke();

    doc.text(noText, startX + 5, y + paddingTop, { width: colNoWidth - 10, align: 'center' });
    doc.text(kodeText, startX + colNoWidth + 5, y + paddingTop, { width: colKodeWidth - 10 });
    doc.text(namaText, startX + colNoWidth + colKodeWidth + 5, y + paddingTop, { width: colNamaWidth - 10 });
    doc.text(statusText, startX + colNoWidth + colKodeWidth + colNamaWidth + 5, y + paddingTop, { width: colStatusWidth - 10 });

    y += rowHeight;
  });

  doc.y = y + 5;
}

// Fungsi untuk mencetak tabel non-asset
function printNonAssetTable(doc, items) {
  if (items.length === 0) return;

  const startX = doc.page.margins.left;
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colNoWidth = 40;
  const colNamaWidth = (tableWidth - colNoWidth) / 2;
  const colKeterangan = (tableWidth - colNoWidth) / 2;
  const paddingTop = 3, paddingBottom = 1;
  const headerHeight = 20;

  const columns = [
    { title: 'No', width: colNoWidth },
    { title: 'Aset', width: colNamaWidth },
    { title: 'Keterangan', width: colKeterangan }
  ];

  // Fungsi untuk menggambar header
  const drawHeader = (doc, yPos) => {
    return drawTableHeader(doc, startX, yPos, columns, headerHeight);
  };

  // Estimasi tinggi minimal untuk tabel (header + 1 baris)
  const minTableHeight = headerHeight + 30; // Tambah margin keamanan
  
  // Cek apakah perlu halaman baru untuk memulai tabel
  let y = addNewPageIfNeeded(doc, minTableHeight);
  
  // Gambar header hanya sekali di awal tabel
  y = drawHeader(doc, y);
  
  doc.font('Helvetica').fontSize(9);

  items.forEach((item, idx) => {
    const noText = (idx + 1).toString();
    const namaText = item.AssetName || '';
    const ketText = item.Remark || '';

    // Hitung tinggi yang diperlukan untuk baris ini
    const heightNo = doc.heightOfString(noText, { width: colNoWidth - 10 });
    const heightNama = doc.heightOfString(namaText, { width: colNamaWidth - 10 });
    const heightKet = doc.heightOfString(ketText, { width: colKeterangan - 10 });
    const rowHeight = Math.max(heightNo, heightNama, heightKet) + paddingTop + paddingBottom;

    // Cek apakah baris ini muat di halaman saat ini dengan margin keamanan
    const spaceCheck = checkPageSpace(doc, rowHeight + 10); // Tambah margin keamanan
    if (spaceCheck.needNewPage) {
      doc.addPage();
      doc.x = doc.page.margins.left;
      doc.y = doc.page.margins.top;
      y = doc.y; // Lanjutkan tanpa header
    }

    // Pastikan y tidak melewati batas bawah yang aman
    const maxY = doc.page.height - doc.page.margins.bottom - 30;
    if (y + rowHeight > maxY) {
      doc.addPage();
      doc.x = doc.page.margins.left;
      doc.y = doc.page.margins.top;
      y = doc.y;
    }

    // Gambar baris
    doc.rect(startX, y, colNoWidth, rowHeight).stroke();
    doc.rect(startX + colNoWidth, y, colNamaWidth, rowHeight).stroke();
    doc.rect(startX + colNoWidth + colNamaWidth, y, colKeterangan, rowHeight).stroke();

    doc.text(noText, startX + 5, y + paddingTop, { width: colNoWidth - 10, align: 'center' });
    doc.text(namaText, startX + colNoWidth + 5, y + paddingTop, { width: colNamaWidth - 10 });
    doc.text(ketText, startX + colNoWidth + colNamaWidth + 5, y + paddingTop, { width: colKeterangan - 10 });

    y += rowHeight;
  });

  doc.y = y + 5;
}

// Fungsi utama untuk mencetak semua data berdasarkan lokasi
async function printAllGroupedByLocation(doc, noSO) {
  try {
    const groupedData = await fetchGroupedByLocation(noSO);
    
    if (groupedData.length === 0) {
      doc.font('Helvetica-Bold').fontSize(12).text('Tidak ada data untuk ditampilkan');
      return;
    }

    // TIDAK menambah halaman baru otomatis - melanjutkan dari posisi saat ini
    doc.moveDown(1);

    doc.x = doc.page.margins.left;

    doc
    .font('Helvetica-Bold')
    .fontSize(14)
    .text('I. Hasil Stock Opname', { align: 'left' });

      doc.moveDown(0.5);

    groupedData.forEach((location, locationIdx) => {
      // Reset posisi X ke margin kiri sebelum setiap section
      doc.x = doc.page.margins.left;
      
      // Estimasi tinggi untuk header lokasi + minimal 1 sub-header + minimal 1 baris tabel
      // Header lokasi (12pt + margin) + Sub-header (11pt + margin) + Header tabel (20px) + 1 baris minimal (25px)
      const locationHeaderHeight = 20; // Header lokasi
      const subHeaderHeight = 18; // Sub-header pertama yang ada
      const tableHeaderHeight = 20; // Header tabel
      const minRowHeight = 25; // Minimal 1 baris data
      const totalMinHeight = locationHeaderHeight + subHeaderHeight + tableHeaderHeight + minRowHeight;
      
      // Cek apakah seluruh section minimal (header + tabel dengan minimal 1 baris) muat di halaman saat ini
      const spaceCheck = checkPageSpace(doc, totalMinHeight);
      if (spaceCheck.needNewPage) {
        doc.addPage();
        doc.x = doc.page.margins.left;
        doc.y = doc.page.margins.top;
      }
      
      // Header lokasi
      doc.font('Helvetica-Bold').fontSize(12)
         .text(`${locationIdx + 1}. ${location.locationName}`);
      doc.moveDown(0.3);

      // a. Aset Tidak Ditemukan
      if (location.assetNotFound.length > 0) {
        // Cek apakah sub-header + tabel (minimal header + 1 baris) muat
        const subTableMinHeight = subHeaderHeight + tableHeaderHeight + minRowHeight;
        const subSpaceCheck = checkPageSpace(doc, subTableMinHeight);
        if (subSpaceCheck.needNewPage) {
          doc.addPage();
          doc.x = doc.page.margins.left;
          doc.y = doc.page.margins.top;
        }
        
        doc.x = doc.page.margins.left;
        doc.font('Helvetica-Bold').fontSize(11)
           .text(`   a. Aset Tidak Ditemukan (${location.assetNotFound.length} item)`);
        doc.moveDown(0.2);
        printAssetNotFoundTable(doc, location.assetNotFound);
        doc.moveDown(0.3);
      }

      // b. Aset Ditemukan Tanpa QR
      if (location.assetWithoutQR.length > 0) {
        // Cek apakah sub-header + tabel (minimal header + 1 baris) muat
        const subTableMinHeight = subHeaderHeight + tableHeaderHeight + minRowHeight;
        const subSpaceCheck = checkPageSpace(doc, subTableMinHeight);
        if (subSpaceCheck.needNewPage) {
          doc.addPage();
          doc.x = doc.page.margins.left;
          doc.y = doc.page.margins.top;
        }
        
        doc.x = doc.page.margins.left;
        doc.font('Helvetica-Bold').fontSize(11)
           .text(`   b. Aset Ditemukan Tanpa QR`);
        doc.moveDown(0.2);
        printAssetWithoutQRTable(doc, location.assetWithoutQR);
        doc.moveDown(0.3);
      }

      // c. Aset Tidak Terdaftar
      if (location.nonAssets.length > 0) {
        // Cek apakah sub-header + tabel (minimal header + 1 baris) muat
        const subTableMinHeight = subHeaderHeight + tableHeaderHeight + minRowHeight;
        const subSpaceCheck = checkPageSpace(doc, subTableMinHeight);
        if (subSpaceCheck.needNewPage) {
          doc.addPage();
          doc.x = doc.page.margins.left;
          doc.y = doc.page.margins.top;
        }
        
        doc.x = doc.page.margins.left;
        doc.font('Helvetica-Bold').fontSize(11)
           .text(`   c. Aset Tidak Terdaftar (${location.nonAssets.length} item)`);
        doc.moveDown(0.2);
        printNonAssetTable(doc, location.nonAssets);
        doc.moveDown(0.3);
      }

      // Jarak antar lokasi (hanya jika bukan lokasi terakhir)
      if (locationIdx < groupedData.length - 1) {
        doc.moveDown(0.5);
      }
    });
  } catch (error) {
    console.error('Error in printAllGroupedByLocation:', error);
    throw error;
  }
}

// Export fungsi yang dibutuhkan
module.exports = {
  printAllGroupedByLocation,
  fetchGroupedByLocation
};