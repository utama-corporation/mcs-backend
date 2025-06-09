const express = require('express');
const moment = require('moment');
const PDFDocument = require('pdfkit');
const { pool, connectDb } = require('../../db');
const router = express.Router();

router.get('/report/:noso/pdf', async (req, res) => {
  try {
    await connectDb();

    const noSO = req.params.noso;

    const tanggal = req.query.tanggal;
    const lockedDate = req.query.lockeddate || "-";
    const perusahaan = req.query.perusahaan;
    
    if (!noSO) {
      return res.status(400).json({ message: 'Parameter NoSO tidak boleh kosong' });
    }

    // Query data sama seperti yang sudah kamu buat
    const [notFoundRows] = await pool.query(`
    SELECT 
      a.LocationAsset AS LocationCode,
      a.LocationAsset AS LocationName,
      d.AssetCode,
      a.AssetName
    FROM tb_stockopname_d d
    LEFT JOIN asset a ON a.AssetCode = d.AssetCode
    LEFT JOIN tb_location_asset loc ON loc.location_code = a.LocationAsset
    WHERE d.NoSO = ?
      AND d.HasNotBeenPrinted != 1
      AND NOT EXISTS (
        SELECT 1
        FROM tb_stockopname_d_hasil h
        WHERE h.NoSO = d.NoSO AND h.AssetCode = d.AssetCode
      )
    ORDER BY a.LocationAsset, d.AssetCode
    `, [noSO]);
    

    const [noQrRows] = await pool.query(`
SELECT 
  a.LocationAsset AS LocationCode,
  a.LocationAsset AS LocationName,
  d.AssetCode,
  a.AssetName,
  s.status
FROM tb_stockopname_d d
JOIN asset a ON d.AssetCode = a.AssetCode
JOIN tb_so_status s ON d.id_status = s.id_status
LEFT JOIN tb_location_asset loc ON loc.location_code = a.LocationAsset
WHERE d.HasNotBeenPrinted = 1
  AND d.NoSO = ?
ORDER BY a.LocationAsset, d.AssetCode
    `, [noSO]);
    

    const [nonAssetRows] = await pool.query(`
      SELECT 
        loc.location_name AS location_code,
        loc.location_name AS LocationName,  
        na.non_asset_name,
        na.remark
      FROM tb_stockopname_non_assets na
      LEFT JOIN tb_location_asset loc 
        ON loc.location_code = na.location_code
      WHERE na.NoSO = ?
      ORDER BY na.location_code, na.non_asset_name
    `, [noSO]);


    const [bomRows] = await pool.query(`
SELECT 
  a.LocationAsset AS LocationCode,
  a.LocationAsset AS LocationName,
  h.NoSO,
  h.AssetCode,
  CONCAT(a.AssetName, ' (', h.AssetCode, ')') AS AssetLabel,
  p.part AS PartName,
  h.IsExist
FROM tb_stockopname_hasil_bom h
LEFT JOIN asset a ON a.AssetCode = h.AssetCode
LEFT JOIN tb_location_asset loc ON loc.location_code = a.LocationAsset
LEFT JOIN tb_parts_bom p ON h.IdBOM = p.id
WHERE h.NoSO = ? AND h.IsExist = 0
ORDER BY a.LocationAsset, h.AssetCode
    `, [noSO]);    
    

    // Grouping fungsi sama seperti sebelumnya

    const groupNotFoundByLocation = (rows) => {
      const result = {};
      rows.forEach(row => {
        const loc = row.LocationCode;
        if (!result[loc]) {
          result[loc] = {
            locationName: row.LocationName || loc,
            assetList: []
          };
        }
        result[loc].assetList.push({ AssetCode: row.AssetCode, AssetName: row.AssetName });
      });
    
      return Object.entries(result).map(([locationCode, data]) => ({
        locationCode,
        locationName: data.locationName,
        assetList: data.assetList
      }));
    };
    
    
    const groupWithoutQRByLocation = (rows) => {
      const result = {};
      rows.forEach(row => {
        const loc = row.LocationCode;
        if (!result[loc]) {
          result[loc] = {
            locationName: row.LocationName || loc,
            assetList: []
          };
        }
        result[loc].assetList.push({ AssetCode: row.AssetCode, AssetName: row.AssetName, Status: row.status });
      });
    
      return Object.entries(result).map(([locationCode, data]) => ({
        locationCode,
        locationName: data.locationName,
        assetList: data.assetList
      }));
    };
    

    const groupNonAssetByLocation = (rows) => {
      const result = {};
      rows.forEach(row => {
        const loc = row.location_code;
        if (!result[loc]) {
          result[loc] = {
            locationName: row.LocationName || loc,
            assetList: []
          };
        }
        result[loc].assetList.push({ AssetName: row.non_asset_name, Remark: row.remark });
      });
    
      return Object.entries(result).map(([locationCode, data]) => ({
        locationCode,
        locationName: data.locationName,
        assetList: data.assetList
      }));
    };


    const groupBOMByLocation = (rows) => {
      const result = {};
      rows.forEach(row => {
        const loc = row.LocationCode;
        if (!result[loc]) {
          result[loc] = {
            locationName: row.LocationName || loc,
            assetList: []
          };
        }
        result[loc].assetList.push({
          AssetCode: row.AssetLabel,
          PartName: row.PartName || '-',
          IsExist: row.IsExist
        });
      });
    
      return Object.entries(result).map(([locationCode, data]) => ({
        locationCode,
        locationName: data.locationName,
        assetList: data.assetList
      }));
    };
    
    
    const AssetTidakDitemukan = groupNotFoundByLocation(notFoundRows);
    const AssetDitemukanTanpaQR = groupWithoutQRByLocation(noQrRows);
    const AssetTidakTerdaftar = groupNonAssetByLocation(nonAssetRows);
    const hasilBomPerLocation = groupBOMByLocation(bomRows);


    // Buat PDF dengan pdfkit
    const doc = new PDFDocument({ margin: 40, size: 'A4' });

    // Set response header biar browser download/pdf viewer langsung terbuka
    res.setHeader('Content-Type', 'application/pdf');
    const safeNoSO = noSO.replace(/\./g, '_');  // ganti semua titik jadi underscore
    res.setHeader('Content-Disposition', `inline; filename=Laporan_${safeNoSO}.pdf`);
    
    doc.pipe(res);

    // Judul tengah atas
    doc.fontSize(16).font('Helvetica-Bold').text('BERITA ACARA STOCK OPNAME', { align: 'center' });
    doc.moveDown(1.5);

    doc.fontSize(12).font('Helvetica-Bold').text(`Tanggal : ${tanggal || '-'}`);
    doc.moveDown(0.5);

    doc.fontSize(12).font('Helvetica-Bold').text(`Perusahaan : ${perusahaan || '-'}`);
    doc.moveDown(1);

    doc.fontSize(12).font('Helvetica-Bold').text('I. Hasil Stock Opname');
    doc.moveDown(0.3);

    // Fungsi untuk print tabel aset: nomor, kode aset, nama aset (nama aset = kode aset)
    function printAssetTable(items) {
      const startX = doc.x;
      let y = doc.y;
      const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const colNoWidth = 40;
      const colKodeWidth = (tableWidth - colNoWidth) / 2;
      const colNamaWidth = (tableWidth - colNoWidth) / 2;
      const rowPadding = 5; // padding vertikal

      // Header
      const headerHeight = 20;
      doc.font('Helvetica-Bold').fontSize(10);
      doc.rect(startX, y, colNoWidth, headerHeight).stroke();
      doc.rect(startX + colNoWidth, y, colKodeWidth, headerHeight).stroke();
      doc.rect(startX + colNoWidth + colKodeWidth, y, colNamaWidth, headerHeight).stroke();

      doc.text('No', startX + 5, y + 5, { width: colNoWidth - 10, align: 'center' });
      doc.text('Kode Aset', startX + colNoWidth + 5, y + 5, { width: colKodeWidth - 10, align: 'center' });
      doc.text('Nama Aset', startX + colNoWidth + colKodeWidth + 5, y + 5, { width: colNamaWidth - 10, align: 'center' });
      
      y += headerHeight;

      // Data Rows
      doc.font('Helvetica').fontSize(9);
      items.forEach((item, idx) => {
        // Hitung tinggi teks tiap kolom
        const noText = (idx + 1).toString();
        const assetCodeText = item.AssetCode;
        const assetNameText = item.AssetName;

        const heightNo = doc.heightOfString(noText, { width: colNoWidth - 10 });
        const heightKode = doc.heightOfString(assetCodeText, { width: colKodeWidth - 10 });
        const heightNama = doc.heightOfString(assetNameText, { width: colNamaWidth - 10 });

        const rowHeight = Math.max(heightNo, heightKode, heightNama) + rowPadding * 1.5;

        // Tambah halaman jika posisi sudah mendekati bawah
        if (y + rowHeight > doc.page.height - 120) {
          doc.addPage();
          y = doc.y;
        }

        // Gambar border per kolom
        doc.rect(startX, y, colNoWidth, rowHeight).stroke();
        doc.rect(startX + colNoWidth, y, colKodeWidth, rowHeight).stroke();
        doc.rect(startX + colNoWidth + colKodeWidth, y, colNamaWidth, rowHeight).stroke();

        // Tulis teks dengan posisi vertikal di padding
        doc.text(noText, startX + 5, y + rowPadding, { width: colNoWidth - 10, align: 'center' });
        doc.text(assetCodeText, startX + colNoWidth + 5, y + rowPadding, { width: colKodeWidth - 10 });
        doc.text(assetNameText, startX + colNoWidth + colKodeWidth + 5, y + rowPadding, { width: colNamaWidth - 10 });

        y += rowHeight;
      });

      doc.moveDown(1);
      doc.y = y + 5;
    }


    // Fungsi print tabel asset tanpa QR
    function printAssetTableWithoutQR(items) {
      const startX = doc.x;
      let y = doc.y;
      const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

      const colNoWidth = 40;
      const colKodeWidth = (tableWidth - colNoWidth) / 3;
      const colNamaWidth = (tableWidth - colNoWidth) / 3;
      const colStatusWidth = (tableWidth - colNoWidth) / 3;

      const paddingTop = 3;
      const paddingBottom = 1;

      // Header
      const headerHeight = 20;
      doc.font('Helvetica-Bold').fontSize(10);

      doc.rect(startX, y, colNoWidth, headerHeight).stroke();
      doc.rect(startX + colNoWidth, y, colKodeWidth, headerHeight).stroke();
      doc.rect(startX + colNoWidth + colKodeWidth, y, colNamaWidth, headerHeight).stroke();
      doc.rect(startX + colNoWidth + colKodeWidth + colNamaWidth, y, colStatusWidth, headerHeight).stroke();

      doc.text('No', startX + 5, y + 5, { width: colNoWidth - 10, align: 'center' });
      doc.text('Kode Aset', startX + colNoWidth + 5, y + 5, { width: colKodeWidth - 10, align: 'center' });
      doc.text('Nama Aset', startX + colNoWidth + colKodeWidth + 5, y + 5, { width: colNamaWidth - 10, align: 'center' });
      doc.text('Status', startX + colNoWidth + colKodeWidth + colNamaWidth + 5, y + 5, { width: colStatusWidth - 10, align: 'center' });

      y += headerHeight;

      // Data Rows
      doc.font('Helvetica').fontSize(9);
      items.forEach((item, idx) => {
        const noText = (idx + 1).toString();
        const kodeText = item.AssetCode;
        const namaText = item.AssetName;    // masih sementara, sesuai kebutuhan bisa diganti
        const statusText = item.Status;  // masih sementara, sesuai kebutuhan bisa diganti

        // Hitung tinggi teks tiap kolom
        const heightNo = doc.heightOfString(noText, { width: colNoWidth - 10 });
        const heightKode = doc.heightOfString(kodeText, { width: colKodeWidth - 10 });
        const heightNama = doc.heightOfString(namaText, { width: colNamaWidth - 10 });
        const heightStatus = doc.heightOfString(statusText, { width: colStatusWidth - 10 });

        const rowHeight = Math.max(heightNo, heightKode, heightNama, heightStatus) + paddingTop + paddingBottom;

        // Tambah halaman jika terlalu bawah
        if (y + rowHeight > doc.page.height - 120) {
          doc.addPage();
          y = doc.y;
        }

        // Gambar border
        doc.rect(startX, y, colNoWidth, rowHeight).stroke();
        doc.rect(startX + colNoWidth, y, colKodeWidth, rowHeight).stroke();
        doc.rect(startX + colNoWidth + colKodeWidth, y, colNamaWidth, rowHeight).stroke();
        doc.rect(startX + colNoWidth + colKodeWidth + colNamaWidth, y, colStatusWidth, rowHeight).stroke();

        // Tulis teks
        doc.text(noText, startX + 5, y + paddingTop, { width: colNoWidth - 10, align: 'center' });
        doc.text(kodeText, startX + colNoWidth + 5, y + paddingTop, { width: colKodeWidth - 10 });
        doc.text(namaText, startX + colNoWidth + colKodeWidth + 5, y + paddingTop, { width: colNamaWidth - 10 });
        doc.text(statusText, startX + colNoWidth + colKodeWidth + colNamaWidth + 5, y + paddingTop, { width: colStatusWidth - 10 });

        y += rowHeight;
      });

      doc.moveDown(1);
      doc.y = y + 5;
    }
    

    // Fungsi print tabel non asset: nomor, kode aset (kode aset di sini adalah nonAssetName)
    function printNonAssetTable(items) {
      const startX = doc.x;
      let y = doc.y;
      const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    
      const colNoWidth = 40;
      const colNamaWidth = (tableWidth - colNoWidth) / 2;
      const colKeterangan = (tableWidth - colNoWidth) / 2;
    
      const paddingTop = 3;
      const paddingBottom = 1;
    
      // Header
      const headerHeight = 20;
      doc.font('Helvetica-Bold').fontSize(10);
    
      doc.rect(startX, y, colNoWidth, headerHeight).stroke();
      doc.rect(startX + colNoWidth, y, colNamaWidth, headerHeight).stroke();
      doc.rect(startX + colNoWidth + colNamaWidth, y, colKeterangan, headerHeight).stroke();
    
      doc.text('No', startX + 5, y + 5, { width: colNoWidth - 10, align: 'center' });
      doc.text('Aset', startX + colNoWidth + 5, y + 5, { width: colNamaWidth - 10, align: 'center' });
      doc.text('Keterangan', startX + colNoWidth + colNamaWidth + 5, y + 5, { width: colKeterangan - 10, align: 'center' });
    
      y += headerHeight;
    
      // Baris data
      doc.font('Helvetica').fontSize(9);
      items.forEach((item, idx) => {
        const noText = (idx + 1).toString();
        const namaText = item.AssetName;
        const ketText = item.Remark; 
    
        const heightNo = doc.heightOfString(noText, { width: colNoWidth - 10 });
        const heightNama = doc.heightOfString(namaText, { width: colNamaWidth - 10 });
        const heightKet = doc.heightOfString(ketText, { width: colKeterangan - 10 });
    
        const rowHeight = Math.max(heightNo, heightNama, heightKet) + paddingTop + paddingBottom;
    
        if (y + rowHeight > doc.page.height - 120) {
          doc.addPage();
          y = doc.y;
        }
    
        doc.rect(startX, y, colNoWidth, rowHeight).stroke();
        doc.rect(startX + colNoWidth, y, colNamaWidth, rowHeight).stroke();
        doc.rect(startX + colNoWidth + colNamaWidth, y, colKeterangan, rowHeight).stroke();
    
        doc.text(noText, startX + 5, y + paddingTop, { width: colNoWidth - 10, align: 'center' });
        doc.text(namaText, startX + colNoWidth + 5, y + paddingTop, { width: colNamaWidth - 10 });
        doc.text(ketText, startX + colNoWidth + colNamaWidth + 5, y + paddingTop, { width: colKeterangan - 10 });
    
        y += rowHeight;
      });
    
      doc.moveDown(1);
      doc.y = y + 5;
    } 
    

    function printAssetTableBOM(items) {
      const startX = doc.x;
      let y = doc.y;
      const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    
      const colNoWidth = 40;
      const colKodeWidth = (tableWidth - colNoWidth) / 2;
      const colPartWidth = (tableWidth - colNoWidth) / 2;
    
      const paddingTop = 3;
      const paddingBottom = 1;
    
      // Header
      const headerHeight = 20;
      doc.font('Helvetica-Bold').fontSize(10);
    
      doc.rect(startX, y, colNoWidth, headerHeight).stroke();
      doc.rect(startX + colNoWidth, y, colKodeWidth, headerHeight).stroke();
      doc.rect(startX + colNoWidth + colKodeWidth, y, colPartWidth, headerHeight).stroke();
    
      doc.text('No', startX + 5, y + 5, { width: colNoWidth - 10, align: 'center' });
      doc.text('Kode Aset', startX + colNoWidth + 5, y + 5, { width: colKodeWidth - 10, align: 'center' });
      doc.text('BOM', startX + colNoWidth + colKodeWidth + 5, y + 5, { width: colPartWidth - 10, align: 'center' });
    
      y += headerHeight;
    
      doc.font('Helvetica').fontSize(9);
    
      let rowNumber = 1;
      let i = 0;
    
      while (i < items.length) {
        const currentAsset = items[i].AssetCode;
    
        // Ambil semua item dengan AssetCode yang sama
        const group = [];
        while (i < items.length && items[i].AssetCode === currentAsset) {
          group.push(items[i]);
          i++;
        }
    
        // Hitung tinggi per baris
        let totalRowHeight = 0;
        const rowHeights = [];
    
        group.forEach((item) => {
          const partText = item.PartName || '-';
          const heightPart = doc.heightOfString(partText, { width: colPartWidth - 10 });
          const rowHeight = heightPart + paddingTop + paddingBottom;
          rowHeights.push(rowHeight);
          totalRowHeight += rowHeight;
        });
    
        // Tambahkan halaman baru jika tidak cukup ruang
        if (y + totalRowHeight > doc.page.height - 120) {
          doc.addPage();
          y = doc.y;
        }
    
        // Gambar sekali: kolom No dan Kode Aset
        doc.rect(startX, y, colNoWidth, totalRowHeight).stroke();
        doc.rect(startX + colNoWidth, y, colKodeWidth, totalRowHeight).stroke();
    
        const assetLabel = group[0].AssetLabel || currentAsset;
        doc.text(rowNumber.toString(), startX + 5, y + paddingTop, {
          width: colNoWidth - 10,
          align: 'center',
        });
    
        doc.text(assetLabel, startX + colNoWidth + 5, y + paddingTop, {
          width: colKodeWidth - 10,
        });
    
        // Gambar kolom Part
        let rowY = y;
        group.forEach((item, index) => {
          const partText = item.PartName || '-';
          const rowHeight = rowHeights[index];
    
          doc.rect(startX + colNoWidth + colKodeWidth, rowY, colPartWidth, rowHeight).stroke();
    
          doc.text(partText, startX + colNoWidth + colKodeWidth + 5, rowY + paddingTop, {
            width: colPartWidth - 10,
          });
    
          rowY += rowHeight;
        });
    
        y += totalRowHeight;
        rowNumber++;
      }
    
      doc.moveDown(1);
      doc.y = y + 5;
    }
    
    
    // Kita looping tiap lokasi dan tampilkan sesuai format
    const allLocations = new Set([
      ...AssetTidakDitemukan.map(g => g.locationName),
      ...AssetDitemukanTanpaQR.map(g => g.locationName),
      ...AssetTidakTerdaftar.map(g => g.locationName),
    ]);

    let locIndex = 1;
    let adaSelisih = false;

    for (const loc of allLocations) {
      const asetTidakDitemukan = AssetTidakDitemukan.find(g => g.locationName === loc);
      const asetDitemukanTanpaQR = AssetDitemukanTanpaQR.find(g => g.locationName === loc);
      const asetTidakTerdaftar = AssetTidakTerdaftar.find(g => g.locationName === loc);
    
      const adaAsetTidakDitemukan = asetTidakDitemukan && asetTidakDitemukan.assetList.length > 0;
      const adaAsetDitemukanTanpaQR = asetDitemukanTanpaQR && asetDitemukanTanpaQR.assetList.length > 0;
      const adaAsetTidakTerdaftar = asetTidakTerdaftar && asetTidakTerdaftar.assetList.length > 0;
    
      if (adaAsetTidakDitemukan || adaAsetDitemukanTanpaQR || adaAsetTidakTerdaftar) {
        adaSelisih = true;
    
        doc.font('Helvetica-Bold').fontSize(10).text(`${locIndex}. Lokasi ${loc}`, doc.page.margins.left + 10);
        doc.moveDown(0.3);
    
        if (adaAsetTidakDitemukan) {
          doc.font('Helvetica-Bold').fontSize(10).text('A. Aset Tidak Ditemukan', doc.page.margins.left + 20);
          printAssetTable(asetTidakDitemukan.assetList);
        }
    
        if (adaAsetDitemukanTanpaQR) {
          doc.moveDown(1);
          doc.font('Helvetica-Bold').fontSize(10).text('B. Aset Ditemukan Tanpa QR Code', doc.page.margins.left + 20);
          printAssetTableWithoutQR(asetDitemukanTanpaQR.assetList);
        }
    
        if (adaAsetTidakTerdaftar) {
          doc.moveDown(1);
          doc.font('Helvetica-Bold').fontSize(10).text('C. Aset Temuan', doc.page.margins.left + 20);
          printNonAssetTable(asetTidakTerdaftar.assetList);
        }
    
        doc.moveDown(1);
        locIndex++;
    
        if (doc.y > doc.page.height - 120) {
          doc.addPage();
        }
      }
    }
    
    // Jika tidak ada data sama sekali di semua lokasi
    if (!adaSelisih) {
      doc.font('Helvetica-Oblique').fontSize(11).text('Hasil Stock Opname tidak ada selisih.', {
        align: 'center',
        valign: 'bottom',
      });
    }
    

    // doc.addPage(); // Mulai halaman baru
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(12) .text('II. Ringkasan Stock Opname', doc.page.margins.left);
    doc.moveDown(0.2);

   // Ambil data total aset berdasarkan lokasi + location_name
    const [totalAssetRows] = await pool.query(`
SELECT 
  a.LocationAsset AS LocationCode,
  a.LocationAsset AS LocationName,
  COUNT(*) AS TotalAssets
FROM tb_stockopname_d d
LEFT JOIN asset a ON a.AssetCode = d.AssetCode
LEFT JOIN tb_location_asset l ON l.location_code = a.LocationAsset
WHERE d.NoSO = ?
GROUP BY a.LocationAsset, l.location_name
ORDER BY a.LocationAsset
    `, [noSO]);

    // Ambil data hasil scan berdasarkan lokasi + location_name
    const [totalScannedAssetRows] = await pool.query(`
SELECT 
  a.LocationAsset AS LocationCode,
  a.LocationAsset AS LocationName,
  COUNT(*) AS TotalAssets
FROM tb_stockopname_d_hasil d
LEFT JOIN asset a ON a.AssetCode = d.AssetCode
LEFT JOIN tb_location_asset l ON l.location_code = a.LocationAsset
WHERE d.NoSO = ?
GROUP BY a.LocationAsset, l.location_name
ORDER BY a.LocationAsset
    `, [noSO]);

    // Gabungkan semua lokasi unik dari ketiga kategori
    const lokasiSet = new Set();
    AssetTidakDitemukan.forEach(e => lokasiSet.add(e.locationCode));
    AssetDitemukanTanpaQR.forEach(e => lokasiSet.add(e.locationCode));
    AssetTidakTerdaftar.forEach(e => lokasiSet.add(e.locationCode));

    const lokasiList = Array.from(lokasiSet).sort();

    // Buat mapping dari locationCode ke locationName dengan menggabungkan semua sumber data
    const locationNameMap = {};

    // Tambahkan dari totalAssetRows
    totalAssetRows.forEach(row => {
      if (row.LocationCode && row.LocationName) {
        locationNameMap[row.LocationCode] = row.LocationName;
      }
    });

    // Tambahkan dari totalScannedAssetRows
    totalScannedAssetRows.forEach(row => {
      if (row.LocationCode && row.LocationName && !locationNameMap[row.LocationCode]) {
        locationNameMap[row.LocationCode] = row.LocationName;
      }
    });

    // Tambahkan dari data non-asset
    nonAssetRows.forEach(row => {
      if (row.location_code && row.LocationName && !locationNameMap[row.location_code]) {
        locationNameMap[row.location_code] = row.LocationName;
      }
    });

    // Tambahkan dari data aset tidak ditemukan
    notFoundRows.forEach(row => {
      if (row.LocationCode && row.LocationName && !locationNameMap[row.LocationCode]) {
        locationNameMap[row.LocationCode] = row.LocationName;
      }
    });

    // Tambahkan dari data aset tanpa QR
    noQrRows.forEach(row => {
      if (row.LocationCode && row.LocationName && !locationNameMap[row.LocationCode]) {
        locationNameMap[row.LocationCode] = row.LocationName;
      }
    });

    // Hitung total masing-masing kategori per lokasi
    const summaryData = lokasiList.map((lokasi, index) => {
      const totalAsset = totalAssetRows.find(row => row.LocationCode === lokasi);
      const totalScannedAsset = totalScannedAssetRows.find(row => row.LocationCode === lokasi);
      const notFound = AssetTidakDitemukan.find(l => l.locationCode === lokasi);
      const tanpaQR = AssetDitemukanTanpaQR.find(l => l.locationCode === lokasi);
      const tidakTerdaftar = AssetTidakTerdaftar.find(l => l.locationCode === lokasi);

      return {
        no: index + 1,
        lokasi,
        lokasiName: locationNameMap[lokasi] || '-',
        totalAssetTersedia: totalAsset ? totalAsset.TotalAssets : 0,
        totalScannedAsset: totalScannedAsset ? totalScannedAsset.TotalAssets : 0,
        totalNotFound: notFound ? notFound.assetList.length : 0,
        totalNoQR: tanpaQR ? tanpaQR.assetList.length : 0,
        totalNonAsset: tidakTerdaftar ? tidakTerdaftar.assetList.length : 0
      };
    });

    
 
     // Cetak tabel ringkasan
     function printRingkasanTable(items) {
      const startX = doc.x;
      let y = doc.y;
      const padding = 5;
    
      const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    
      const colNoWidth = 40;
      const colJumlahWidth = (tableWidth - colNoWidth) * 0.7 / 5;
      const colLokasiWidth = (tableWidth - colNoWidth) * 0.3;      
    
      const headers = [
        { text: 'No', width: colNoWidth },
        { text: 'Lokasi', width: colLokasiWidth },
        { text: 'Aset Di MCS', width: colJumlahWidth },
        { text: 'Hasil Scan', width: colJumlahWidth },
        { text: 'Aset Tidak Ditemukan', width: colJumlahWidth },
        { text: 'Aset Tanpa QR Code', width: colJumlahWidth },
        { text: 'Aset Temuan', width: colJumlahWidth }
      ];      
    
      doc.font('Helvetica-Bold').fontSize(10);
    
      // Hitung tinggi header secara dinamis
      const headerHeights = headers.map(header =>
        doc.heightOfString(header.text, {
          width: header.width - 2 * padding,
          align: 'center'
        })
      );
      const headerHeight = Math.max(...headerHeights) + 2 * padding;
    
      // Gambar header
      let currentX = startX;
      headers.forEach((header, i) => {
        doc.rect(currentX, y, header.width, headerHeight).stroke();
        doc.text(header.text, currentX + padding, y + padding, {
          width: header.width - 2 * padding,
          align: 'center'
        });
        currentX += header.width;
      });
    
      y += headerHeight;
    
      // Isi data baris
      doc.font('Helvetica').fontSize(9);
    
      items.forEach(item => {
        // Siapkan data isi baris
        const rowData = [
          { text: item.no.toString(), width: colNoWidth, align: 'center' },
          { text: item.lokasiName, width: colLokasiWidth, align: 'left' },
          { text: item.totalAssetTersedia.toString(), width: colJumlahWidth, align: 'center' },
          { text: item.totalScannedAsset.toString(), width: colJumlahWidth, align: 'center' },
          { text: item.totalNotFound.toString(), width: colJumlahWidth, align: 'center' },
          { text: item.totalNoQR.toString(), width: colJumlahWidth, align: 'center' },
          { text: item.totalNonAsset.toString(), width: colJumlahWidth, align: 'center' },
        ];
      
        // Hitung tinggi setiap cell dan ambil tinggi maksimum
        const cellHeights = rowData.map(cell =>
          doc.heightOfString(cell.text, {
            width: cell.width - 2 * padding,
            align: cell.align
          })
        );
        const rowHeight = Math.max(...cellHeights) + 2 * padding;
      
        // Pindah ke halaman baru jika melebihi batas halaman
        if (y + rowHeight > doc.page.height - 120) {
          doc.addPage();
          y = doc.y;
        }
      
        // Gambar border dan isi teks
        let currentX = startX;
        rowData.forEach((cell, i) => {
          doc.rect(currentX, y, cell.width, rowHeight).stroke();
          doc.text(cell.text, currentX + padding, y + padding, {
            width: cell.width - 2 * padding,
            align: cell.align
          });
          currentX += cell.width;
        });
      
        y += rowHeight;
      });
      
    
      // Baris TOTAL
      const totalAssetTersedia = items.reduce((sum, item) => sum + item.totalAssetTersedia, 0);
      const totalScannedAsset = items.reduce((sum, item) => sum + item.totalScannedAsset, 0);
      const totalNotFound = items.reduce((sum, item) => sum + item.totalNotFound, 0);
      const totalNoQR = items.reduce((sum, item) => sum + item.totalNoQR, 0);
      const totalNonAsset = items.reduce((sum, item) => sum + item.totalNonAsset, 0);
      
      const totalRowHeight = 20;
      if (y + totalRowHeight > doc.page.height - 120) {
        doc.addPage();
        y = doc.y;
      }
    
      doc.font('Helvetica-Bold');
    
      doc.rect(startX, y, colNoWidth + colLokasiWidth, totalRowHeight).stroke();
      doc.text('TOTAL', startX + padding, y + padding, {
        width: colNoWidth + colLokasiWidth - 2 * padding,
        align: 'center'
      });
    
      const totalData = [
        totalAssetTersedia,
        totalScannedAsset,
        totalNotFound,
        totalNoQR,
        totalNonAsset,
      ];      
    
      let totalX = startX + colNoWidth + colLokasiWidth;
      totalData.forEach(total => {
        doc.rect(totalX, y, colJumlahWidth, totalRowHeight).stroke();
        doc.text(total.toString(), totalX + padding, y + padding, {
          width: colJumlahWidth - 2 * padding,
          align: 'center'
        });
        totalX += colJumlahWidth;
      });
    
      doc.moveDown(2);
      doc.y = y + totalRowHeight + 5;
    }
 
    if (summaryData && summaryData.length > 0) {
      printRingkasanTable(summaryData);
    } else {
      const centerX = doc.page.width / 2;
      const bottomY = doc.page.height - 100;
    
      doc.font('Helvetica-Oblique').fontSize(11).text('Hasil Stock Opname tidak ada selisih.', {
        align: 'center',
        valign: 'bottom',
      });
    }

     doc.moveDown(0.5);

    //  let rowNumber = 1;
    //  hasilBomPerLocation.forEach(loc => {
    //   doc.font('Helvetica-Bold').fontSize(12).text(`III. BOM Asset Yang Tidak Lengkap`, doc.page.margins.left);
    //   doc.moveDown(0.5);
    //   doc.font('Helvetica-Bold').fontSize(12).text(`${rowNumber++}. Lokasi ${loc.locationName}`, doc.page.margins.left + 10);
    //   doc.moveDown(0.2);
    //   printAssetTableBOM(loc.assetList);
    // });



    function printKomentarBox() {
      const startX = doc.page.margins.left;
      const boxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const boxHeight = 100; // tinggi kotak komentar, bisa disesuaikan
    
      const y = doc.y + 20; // beri jarak 20pt dari posisi y terakhir
    
      // Judul kolom komentar
      doc.font('Helvetica-Bold').fontSize(12).text('III. Tanggapan PIC Terkait Selisih', startX, y);
    
      // Kotak kosong untuk tulis tangan
      doc.rect(startX, y + 20, boxWidth, boxHeight).stroke();
    
      // Geser posisi y agar setelah kotak ini konten tidak overlap
      doc.y = y + 20 + boxHeight + 10;
    }

    printKomentarBox(); // panggil fungsi buat kotak komentar


    doc.moveDown(1);


    function printJadwalRealisasiTable() {
      const startX = doc.page.margins.left;
      let y = doc.y + 20;

      doc.font('Helvetica-Bold').fontSize(12).text('IV. Jadwal VS Realisasi SO');

      const padding = 5;
      const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    
      const col1Width = tableWidth * 0.4; // Kolom kosong
      const col2Width = tableWidth * 0.3; // Jadwal
      const col3Width = tableWidth * 0.3; // Realisasi
      const headerHeight = 20;
      const rowHeight = 20;
    
      // Header
      doc.font('Helvetica-Bold').fontSize(10);
      const headers = [' ', 'Jadwal', 'Realisasi'];
      let currentX = startX;
      [col1Width, col2Width, col3Width].forEach((width, index) => {
        doc.rect(currentX, y, width, headerHeight).stroke();
        doc.text(headers[index], currentX + padding, y + padding, {
          width: width - 2 * padding,
          align: 'center',
        });
        currentX += width;
      });
    
      y += headerHeight;
    
      // Isi baris
      doc.font('Helvetica').fontSize(10);
      currentX = startX;
      const rowData = ['Stock Opname', tanggal, lockedDate];
      [col1Width, col2Width, col3Width].forEach((width, index) => {
        doc.rect(currentX, y, width, rowHeight).stroke();
        doc.text(rowData[index], currentX + padding, y + padding, {
          width: width - 2 * padding,
          align: 'center',
        });
        currentX += width;
      });
    
      doc.y = y + rowHeight + 10; // Update posisi y selanjutnya
    }

    printJadwalRealisasiTable();


    function printTandaTanganBox() {
      const startX = doc.page.margins.left;
      const boxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const boxHeight = 80;
      const headerHeight = 20;
      const padding = 5;
      const y = doc.y + 20; // jarak aman dari elemen sebelumnya
    
      // Cek apakah cukup di 1 halaman, kalau tidak, tambah halaman
      const requiredHeight = headerHeight + boxHeight + 30;
      if (y + requiredHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
      }
    
      // // Judul bagian
      // doc.font('Helvetica-Bold').fontSize(12).text('IV. Tanda Tangan', startX, doc.y);
    
      const updatedY = doc.y + 10; // pindahkan sedikit ke bawah
      const labels = ['Divisi Yang di SO', 'Pelaksana SO', 'Pendamping SO', 'Diketahui Oleh'];
      const columnCount = labels.length;
      const columnWidth = boxWidth / columnCount;
    
      // Loop untuk menggambar kotak tanda tangan sejajar
      for (let i = 0; i < columnCount; i++) {
        const currentX = startX + i * columnWidth;
    
        // Kotak label (header)
        doc.font('Helvetica-Bold').fontSize(10);
        doc.rect(currentX, updatedY, columnWidth, headerHeight).stroke();
        doc.text(labels[i], currentX + padding, updatedY + padding, {
          width: columnWidth - 2 * padding,
          align: 'center'
        });
    
        // Kotak tanda tangan
        doc.rect(currentX, updatedY + headerHeight, columnWidth, boxHeight).stroke();
      }
    
      // Update posisi y agar tidak tabrakan dengan elemen setelahnya
      doc.y = updatedY + headerHeight + boxHeight + 10;
    }
    
    
    printTandaTanganBox();


    doc.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

module.exports = router;
