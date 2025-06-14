const express = require('express');
const verifyToken = require('../middleware/verifyToken'); // Middleware to verify JWT token
const moment = require('moment');
const { pool, connectDb } = require('../../db');  // Import MySQL connection pool
const router = express.Router();
const axios = require("axios");
const cheerio = require("cheerio");
const { broadcast } = require('../../websocket'); // Import dari root
const path = require('path'); // Pastikan path diimpor
const fs = require('fs');
require('moment/locale/id');
moment.locale('id'); // Set ke bahasa Indonesia

// Helper function to format dates using Moment.js
const formatDate = (date) => {
  return moment(date).format('DD MMMM YYYY');
};


//SIMPAN HASIL SCAN KE DATABASE
router.post("/no-stock-opname/:noso/check", verifyToken, async (req, res) => {
  try {
    const pool = await connectDb();
    const { noso } = req.params;
    let { AssetCode } = req.body;
    const Username = req.user?.username?.toUpperCase() || null;

    if (!AssetCode || !Username) {
      return res.status(400).json({ message: "AssetCode dan Username wajib diisi" });
    }

    // Default response yang ringkas
    const responsePayload = {
      message: "",
      status: "OK",
      data: {
        assetCode: null,
        assetName: null,
        requiresChecklist: false,
        parts: [],
      }
    };

    // Handle jika AssetCode adalah URL
    const isUrl = AssetCode.startsWith("http://") || AssetCode.startsWith("https://");
    if (isUrl) {
      const extracted = await fetchAssetDataFromPage(AssetCode);
      if (!extracted) {
        return res.status(400).json({ message: "Gagal mengambil data Asset dari halaman web." });
      }
      AssetCode = extracted.assetCode;
      responsePayload.data.assetCode = extracted.assetCode;
      responsePayload.data.assetName = extracted.assetName;
    } else {
      return res.status(404).json({ message: "AssetCode tidak terdaftar!" });
    }

    // Parsing kode
    const companyCode = AssetCode.split('/')[0];
    const categoryCode = AssetCode.split('/')[1]?.split('-')[0];
    const locationCode = AssetCode.split('/')[1]?.split('-')[1];

    if (!companyCode || !categoryCode || !locationCode) {
      responsePayload.status = "FAILED";
      responsePayload.message = "Format AssetCode tidak valid";
      return res.status(400).json(responsePayload);
    }

    // Validasi referensi (tetap cek, tapi tidak kirim ke client)
    const validationQuery = `
      SELECT
        EXISTS (SELECT 1 FROM tb_stockopname_dcompany WHERE NoSO = ? AND IdCompany = ?) AS isValidCompany,
        EXISTS (SELECT 1 FROM tb_stockopname_dcategory WHERE NoSO = ? AND IdCategory = ?) AS isValidCategory,
        EXISTS (SELECT 1 FROM tb_stockopname_dlocation WHERE NoSO = ? AND IdLocation = ?) AS isValidLocation
    `;
    const [validationResult] = await pool.query(validationQuery, [
      noso, companyCode,
      noso, categoryCode,
      noso, locationCode
    ]);
    const validation = validationResult[0];

    if (!validation.isValidCompany || !validation.isValidCategory || !validation.isValidLocation) {
      responsePayload.status = "FAILED";
      responsePayload.message = "AssetCode tidak valid!";
      return res.status(400).json(responsePayload);
    }

    // Cek duplikat, jika duplikat kirim status DUPLICATE dengan pesan
    const [duplicateResult] = await pool.query(
      `SELECT COUNT(*) AS count FROM tb_stockopname_d_hasil WHERE NoSO = ? AND AssetCode = ?`,
      [noso, AssetCode]
    );
    if (duplicateResult[0].count > 0) {
      responsePayload.message = `Asset ${AssetCode} telah discan sebelumnya!`;
      responsePayload.status = "FAILED";
      return res.status(409).json(responsePayload);
    }

    //CHECK APAKAH ISBOM
    const [soHeaderResult] = await pool.query(
      `SELECT IsBOM FROM tb_stockopname_h WHERE NoSO = ? LIMIT 1`, [noso]
    );
    
    const isBOM = soHeaderResult[0]?.IsBOM === 1;

    // Cek parts jika kategori IV
    if (isBOM) {
      const [partsData] = await pool.query(
        `SELECT id, level, part FROM tb_parts_bom WHERE AssetCode = ?`, [AssetCode]
      );
      if (partsData.length > 0) {
        responsePayload.status = "PENDING";
        responsePayload.data.requiresChecklist = true;
        responsePayload.data.parts = partsData.map(p => ({
          id: p.id,
          level: p.level,
          part: p.part
        }));
        responsePayload.message = "Cek Kelengkapan BOM";
        return res.status(200).json(responsePayload);
      }
    }

        // Ambil created_at dari asset
        const [assetResult] = await pool.query(
          `SELECT created_at, AssetName FROM asset WHERE AssetCode = ?`, [AssetCode]
        );
    
        if (assetResult.length === 0) {
          responsePayload.status = "FAILED";
          responsePayload.message = "AssetCode tidak ditemukan di master data!";
          return res.status(404).json(responsePayload);
        }
    
        const createdAt = new Date(assetResult[0].created_at);
        responsePayload.data.assetName = assetResult[0].AssetName;
        responsePayload.data.assetCode = AssetCode;
    
        // Ambil tanggal SO dari header
        const [soResult] = await pool.query(
          `SELECT Tanggal FROM tb_stockopname_h WHERE NoSO = ?`, [noso]
        );
    
        if (soResult.length === 0) {
          responsePayload.status = "FAILED";
          responsePayload.message = "NoSO tidak ditemukan!";
          return res.status(404).json(responsePayload);
        }
    
        const soDate = new Date(soResult[0].Tanggal);
    
        if (createdAt >= soDate) {
          responsePayload.status = "FAILED";
          responsePayload.message = `Aset ini melewati batas tanggal stock opname!`;
          return res.status(400).json(responsePayload);
        }    


    if (!responsePayload.message) {
      responsePayload.message = "Validasi berhasil. Asset siap difinalisasi.";
    }

    return res.status(201).json(responsePayload);

  } catch (error) {
    console.error("❌ Error:", error);
    return res.status(500).json({ status: "ERROR", message: "Internal Server Error", error: error.message });
  }
});


router.post("/no-stock-opname/:noso/submit", verifyToken, async (req, res) => {
  try {
    const pool = await connectDb();
    const { noso } = req.params;
    const { AssetCode, AssetName, BOMList } = req.body;
    const Username = req.user?.username || null;
    const idUser = req.user?.id_user || null;

    if (!AssetCode || !AssetName) {
      return res.status(400).json({ message: "AssetCode dan AssetName wajib diisi" });
    }

    // Cek dan update master data seperti sebelumnya
    const checkMasterDataSql = `
      SELECT NoSO, AssetCode, HasNotBeenPrinted, Image, id_status, id_user 
      FROM tb_stockopname_d 
      WHERE NoSO = ? AND AssetCode = ?
    `;
    const [masterDataResult] = await pool.query(checkMasterDataSql, [noso, AssetCode]);

    if (masterDataResult.length > 0) {
      const masterData = masterDataResult[0];

      if (masterData.Image) {
        const imagePath = path.join(__dirname, '..', '..', 'storage', 'uploads', masterData.Image);
        try {
          if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
            console.log(`✅ File gambar ${masterData.Image} berhasil dihapus`);
          } else {
            console.log(`⚠️ File gambar ${masterData.Image} tidak ditemukan`);
          }
        } catch (err) {
          console.error(`❌ Gagal menghapus file gambar: ${err.message}`);
        }
      }

      const updateMasterDataSql = `
        UPDATE tb_stockopname_d 
        SET 
          HasNotBeenPrinted = 0,
          Image = NULL,
          id_status = NULL,
          id_user = ""
        WHERE NoSO = ? AND AssetCode = ?
      `;
      await pool.query(updateMasterDataSql, [noso, AssetCode]);
      console.log(`✅ Data master untuk AssetCode ${AssetCode} telah diupdate`);
    }

    // Insert hasil scan ke tb_stockopname_d_hasil
    const insertSql = `
      INSERT INTO tb_stockopname_d_hasil (NoSO, AssetCode, id_user, DateTimeScan) 
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `;
    await pool.query(insertSql, [noso, AssetCode, idUser]);

    // Jika BOMList ada dan tidak kosong, insert ke tb_stockopname_hasil_bom
    if (Array.isArray(BOMList) && BOMList.length > 0) {
      // Bisa insert multiple sekaligus dengan batch insert
      const bomValues = BOMList.map(bom => [noso, AssetCode, bom.IdBOM, bom.IsExist ? 1 : 0]);

      // Contoh query batch insert
      const insertBomSql = `
        INSERT INTO tb_stockopname_hasil_bom (NoSO, AssetCode, IdBOM, IsExist)
        VALUES ?
      `;
      await pool.query(insertBomSql, [bomValues]);
      console.log(`✅ Data BOM untuk AssetCode ${AssetCode} berhasil disimpan`);
    } else {
      console.log(`ℹ️ Tidak ada data BOM untuk disimpan`);
    }

    // Kirim response sukses
    res.status(201).json({ message: `Asset ${AssetCode} berhasil ditambahkan!` });

    // Broadcast ke client
    broadcast({
      type: 'NEW_ASSET',
      data: {
        NoSO: noso,
        AssetCode,
        AssetName,
        Username,
        DateTimeScan: new Date().toISOString(),
      }
    });

  } catch (error) {
    console.error("❌ Error saat submit asset:", error);
    res.status(500).json({ status: "ERROR", message: "Internal Server Error", error: error.message });
  }
});


//Fungsi untuk fetch AssetCode dan AssetName berdasarkan QR Code
async function fetchAssetDataFromPage(url) {
  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    // Ambil AssetCode dari elemen yang sesuai
    const assetCode = $("#AssetCodeTable").text().trim() || $("span.asset-code").text().trim();

    // Ambil AssetName dari elemen yang sesuai
    const assetName = $("#AssetNameTable").text().trim() || $("span.asset-name").text().trim();

    if (!assetCode || !assetName) {
      throw new Error("AssetCode atau AssetName tidak ditemukan dalam halaman web.");
    }

    return { assetCode, assetName };
  } catch (error) {
    console.error("❌ Error mengambil data Asset dari halaman:", error.message);
    return null;
  }
}


module.exports = router;
