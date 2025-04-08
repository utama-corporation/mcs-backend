const express = require('express');
const verifyToken = require('../middleware/verifyToken'); // Middleware to verify JWT token
const moment = require('moment');
const { pool, connectDb } = require('../db');  // Import MySQL connection pool
const router = express.Router();
const axios = require("axios");
const cheerio = require("cheerio");

// Helper function to format dates using Moment.js
const formatDate = (date) => {
  return moment(date).format('DD MMM YYYY');
};

// Route to get Stock Opname Number
router.get('/no-stock-opname', verifyToken, async (req, res) => {
  try {
    await connectDb();  // Ensure MySQL connection is established
    
    // Query the database to get Stock Opname numbers and dates
    const [rows] = await pool.query('SELECT NoSO, Tanggal FROM tb_stockopname_h');
    
    // If no records are found, return 404 error
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Tidak ada Jadwal Stock Opname saat ini' });
    }

    // Format the result set
    const formattedData = rows.map(item => ({
      NoSO: item.NoSO,
      Tanggal: formatDate(item.Tanggal)
    }));

    // Return the formatted data as JSON response
    res.json(formattedData);
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});


// Route to get Asset data based on NoSO
router.get('/no-stock-opname/:noso', verifyToken, async (req, res) => {
  try {
    await connectDb(); // Koneksi DB

    const { noso } = req.params;
    const limit = 50;
    const offset = parseInt(req.query.offset) || 0; // default 0

    // Query data asset dengan pagination
    const [rows] = await pool.query(
      'SELECT AssetCode, Username FROM tb_stockopname_d_hasil WHERE NoSO = ? ORDER BY DateTimeScan DESC LIMIT ? OFFSET ?',
      [noso, limit, offset]
    );

    // Query total count dari data yang cocok dengan NoSO
    const [countResult] = await pool.query(
      'SELECT COUNT(*) as total FROM tb_stockopname_d_hasil WHERE NoSO = ?',
      [noso]
    );
    const total = countResult[0]?.total || 0;

    if (rows.length === 0) {
      return res.status(404).json({ message: `Tidak ada data asset untuk NoSO: ${noso}` });
    }

    res.json({
      data: rows,
      total,                // Jumlah total data
      nextOffset: offset + limit,
      hasMore: offset + limit < total // True jika masih ada data selanjutnya
    });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});



router.post("/no-stock-opname/:noso", verifyToken, async (req, res) => {
  try {
    const pool = await connectDb(); // Ambil connection pool
    console.log("✅ Terhubung ke MySQL server:", pool.config?.host || "Unknown");

    const { noso } = req.params;
    let { AssetCode } = req.body;
    const Username = req.user?.username ? req.user.username.toUpperCase() : null;

    console.log("Username dari JWT:", Username);
    console.log("AssetCode sebelum diproses:", AssetCode);

    if (!AssetCode || !Username) {
      return res.status(400).json({ message: "AssetCode dan Username wajib diisi" });
    }

    // Cek apakah AssetCode berbentuk URL
    const isUrl = AssetCode.startsWith("http://") || AssetCode.startsWith("https://");

    if (isUrl) {
      console.log("🔍 AssetCode adalah URL, mengambil data dari halaman...");
      const extractedAssetCode = await fetchAssetCodeFromPage(AssetCode);

      if (!extractedAssetCode) {
        return res.status(400).json({ message: "Gagal mengambil AssetCode dari halaman web." });
      }

      AssetCode = extractedAssetCode; // Ganti dengan hasil scraping
    } else {
      return res.status(404).json({ message: "AssetCode tidak terdaftar!" });
    }

    console.log("Final AssetCode yang akan disimpan:", AssetCode);

    const checkDuplicateSql = `
    SELECT COUNT(*) AS count 
    FROM tb_stockopname_d_hasil 
    WHERE NoSO = ? AND AssetCode = ?
  `;
  
    const [duplicateResult] = await pool.query(checkDuplicateSql, [noso, AssetCode]);
    const isDuplicate = duplicateResult[0].count > 0;

    if (isDuplicate) {
      console.log(`AssetCode ${AssetCode} sudah ada untuk NoSO ${noso}`);
      return res.status(409).json({ 
        message: `Asset ${AssetCode} telah discan sebelumnya!`,
      });
    }

    const sql = `
      INSERT INTO tb_stockopname_d_hasil (NoSO, AssetCode, Username, DateTimeScan) 
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `;

    const [result] = await pool.query(sql, [noso, AssetCode, Username]);

    res.status(201).json({ message: `Asset ${AssetCode} berhasil ditambahkan!` });

  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});


async function fetchAssetCodeFromPage(url) {
  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    // Ambil teks dari elemen yang mengandung AssetCode (ubah selector sesuai dengan struktur HTML)
    const assetCode = $("#AssetCodeTable").text().trim() || $("span.asset-code").text().trim();

    if (!assetCode) {
      throw new Error("AssetCode tidak ditemukan dalam halaman web.");
    }

    return assetCode;
  } catch (error) {
    console.error("❌ Error mengambil AssetCode dari halaman:", error.message);
    return null;
  }
}


module.exports = router;
