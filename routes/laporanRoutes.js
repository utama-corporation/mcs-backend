const express = require('express');
const moment = require('moment');
const PDFDocument = require('pdfkit');
const { pool, connectDb } = require('../db');
const router = express.Router();

router.get('/report/:noso/pdf', async (req, res) => {
  try {
    await connectDb();

    const noSO = req.params.noso;
    if (!noSO) {
      return res.status(400).json({ message: 'Parameter NoSO tidak boleh kosong' });
    }

    // Query data sama seperti yang sudah kamu buat
    const [notFoundRows] = await pool.query(`
      SELECT 
        SUBSTRING_INDEX(SUBSTRING_INDEX(d.AssetCode, '/', 2), '-', -1) AS LocationCode,
        d.AssetCode,
        a.AssetName
      FROM tb_stockopname_d d
      LEFT JOIN asset a ON a.AssetCode = d.AssetCode
      WHERE d.NoSO = ?
        AND d.HasNotBeenPrinted != 1
        AND NOT EXISTS (
          SELECT 1
          FROM tb_stockopname_d_hasil h
          WHERE h.NoSO = d.NoSO AND h.AssetCode = d.AssetCode
        )
      ORDER BY LocationCode, d.AssetCode
    `, [noSO]);

    const [noQrRows] = await pool.query(`
      SELECT 
        SUBSTRING_INDEX(SUBSTRING_INDEX(d.AssetCode, '/', 2), '-', -1) AS LocationCode,
        d.AssetCode,
        a.AssetName,
        s.status
      FROM tb_stockopname_d d
      JOIN asset a ON d.AssetCode = a.AssetCode
      JOIN tb_so_status s ON d.id_status = s.id_status
      WHERE d.HasNotBeenPrinted = 1
        AND d.NoSO = ?
      ORDER BY LocationCode, d.AssetCode
    `, [noSO]);    

    const [nonAssetRows] = await pool.query(`
      SELECT location_code, non_asset_name, remark
      FROM tb_stockopname_non_assets
      WHERE NoSO = ?
      ORDER BY location_code, non_asset_name
    `, [noSO]);

    // Grouping fungsi sama seperti sebelumnya

    const groupNotFoundByLocation = (rows) => {
      const result = {};
      rows.forEach(row => {
        const loc = row.LocationCode;
        if (!result[loc]) result[loc] = [];
        result[loc].push({ AssetCode: row.AssetCode, AssetName: row.AssetName });
      });
      return Object.entries(result).map(([locationCode, assets]) => ({
        locationCode,
        assetList: assets
      }));
    };
    

    const groupWithoutQRByLocation = (rows) => {
      const result = {};
      rows.forEach(row => {
        const loc = row.LocationCode;
        if (!result[loc]) result[loc] = [];
        result[loc].push({ AssetCode: row.AssetCode, AssetName: row.AssetName, Status: row.status });
      });
      return Object.entries(result).map(([locationCode, assets]) => ({
        locationCode,
        assetList: assets
      }));
    };

    const groupNonAssetByLocation = (rows) => {
      const result = {};
      rows.forEach(row => {
        const loc = row.location_code;
        if (!result[loc]) result[loc] = [];
        result[loc].push({ AssetName: row.non_asset_name, Remark: row.remark });
      });
      return Object.entries(result).map(([locationCode, assets]) => ({
        locationCode,
        assetList: assets
      }));
    };

    const AssetTidakDitemukan = groupNotFoundByLocation(notFoundRows);
    const AssetDitemukanTanpaQR = groupWithoutQRByLocation(noQrRows);
    const AssetTidakTerdaftar = groupNonAssetByLocation(nonAssetRows);

    // Buat PDF dengan pdfkit
    const doc = new PDFDocument({ margin: 40, size: 'A4' });

    // Set response header biar browser download/pdf viewer langsung terbuka
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=Laporan_${noSO}.pdf`);

    doc.pipe(res);

    // Judul tengah atas
    doc.fontSize(16).font('Helvetica-Bold').text('LAPORAN HASIL STOCK OPNAME ASET', { align: 'center' });
    doc.moveDown(1.5);

    doc.fontSize(14).font('Helvetica-Bold').text('Tanggal :');
    doc.moveDown(0.5);

    doc.fontSize(14).font('Helvetica-Bold').text('Perusahaan :');
    doc.moveDown(2);

    doc.fontSize(14).font('Helvetica-Bold').text('I. Hasil Stock Opname');
    doc.moveDown(1);

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
      doc.font('Helvetica-Bold').fontSize(12);
      doc.rect(startX, y, colNoWidth, headerHeight).stroke();
      doc.rect(startX + colNoWidth, y, colKodeWidth, headerHeight).stroke();
      doc.rect(startX + colNoWidth + colKodeWidth, y, colNamaWidth, headerHeight).stroke();

      doc.text('No', startX + 5, y + 5, { width: colNoWidth - 10, align: 'center' });
      doc.text('Kode Aset', startX + colNoWidth + 5, y + 5, { width: colKodeWidth - 10, align: 'center' });
      doc.text('Nama Aset', startX + colNoWidth + colKodeWidth + 5, y + 5, { width: colNamaWidth - 10, align: 'center' });
      
      y += headerHeight;

      // Data Rows
      doc.font('Helvetica').fontSize(11);
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
        if (y + rowHeight > doc.page.height - 60) {
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
      doc.font('Helvetica-Bold').fontSize(12);

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
      doc.font('Helvetica').fontSize(11);
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
        if (y + rowHeight > doc.page.height - 60) {
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
      doc.font('Helvetica-Bold').fontSize(12);
    
      doc.rect(startX, y, colNoWidth, headerHeight).stroke();
      doc.rect(startX + colNoWidth, y, colNamaWidth, headerHeight).stroke();
      doc.rect(startX + colNoWidth + colNamaWidth, y, colKeterangan, headerHeight).stroke();
    
      doc.text('No', startX + 5, y + 5, { width: colNoWidth - 10, align: 'center' });
      doc.text('Nama Aset', startX + colNoWidth + 5, y + 5, { width: colNamaWidth - 10, align: 'center' });
      doc.text('Keterangan', startX + colNoWidth + colNamaWidth + 5, y + 5, { width: colKeterangan - 10, align: 'center' });
    
      y += headerHeight;
    
      // Baris data
      doc.font('Helvetica').fontSize(11);
      items.forEach((item, idx) => {
        const noText = (idx + 1).toString();
        const namaText = item.AssetName;
        const ketText = item.Remark; 
    
        const heightNo = doc.heightOfString(noText, { width: colNoWidth - 10 });
        const heightNama = doc.heightOfString(namaText, { width: colNamaWidth - 10 });
        const heightKet = doc.heightOfString(ketText, { width: colKeterangan - 10 });
    
        const rowHeight = Math.max(heightNo, heightNama, heightKet) + paddingTop + paddingBottom;
    
        if (y + rowHeight > doc.page.height - 60) {
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
    

    // Kita looping tiap lokasi dan tampilkan sesuai format
    const allLocations = new Set([
      ...AssetTidakDitemukan.map(g => g.locationCode),
      ...AssetDitemukanTanpaQR.map(g => g.locationCode),
      ...AssetTidakTerdaftar.map(g => g.locationCode),
    ]);

    let locIndex = 1;
    for (const loc of allLocations) {
      doc.font('Helvetica-Bold').fontSize(13).text(`${locIndex}. Lokasi ${loc}`, doc.page.margins.left + 10);
      doc.moveDown(0.5);

      // A. Aset Tidak Ditemukan
      const asetTidakDitemukan = AssetTidakDitemukan.find(g => g.locationCode === loc);
      if (asetTidakDitemukan && asetTidakDitemukan.assetList.length > 0) {
        doc.font('Helvetica-Bold').fontSize(12)  .text('A. Aset tidak ditemukan', doc.page.margins.left + 20);
        printAssetTable(asetTidakDitemukan.assetList);
      }

      // B. Aset Ditemukan tanpa QR
      const asetDitemukanTanpaQR = AssetDitemukanTanpaQR.find(g => g.locationCode === loc);
      if (asetDitemukanTanpaQR && asetDitemukanTanpaQR.assetList.length > 0) {
        doc.moveDown(1); // Ini memastikan spasi antar bagian konsisten
        doc.font('Helvetica-Bold').fontSize(12).text('B. Aset ditemukan tanpa QR', doc.page.margins.left + 20);
        printAssetTableWithoutQR(asetDitemukanTanpaQR.assetList);
      }

      // C. Aset Tidak Terdaftar
      const asetTidakTerdaftar = AssetTidakTerdaftar.find(g => g.locationCode === loc);
      if (asetTidakTerdaftar && asetTidakTerdaftar.assetList.length > 0) {
        doc.moveDown(1); // Ini memastikan spasi antar bagian konsisten
        doc.font('Helvetica-Bold').fontSize(12) .text('C. Aset tidak terdaftar', doc.page.margins.left + 20);
        printNonAssetTable(asetTidakTerdaftar.assetList);
      }

      doc.moveDown(3);
      locIndex++;

      // Tambah halaman jika posisi sudah mendekati bawah
      if (doc.y > doc.page.height - 100) {
        doc.addPage();
      }
    }

    doc.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

module.exports = router;
