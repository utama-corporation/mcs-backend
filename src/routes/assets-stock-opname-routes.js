const express = require("express");
const verifyToken = require("../middleware/verifyToken"); // Middleware to verify JWT token
const moment = require("moment");
const { pool, connectDb } = require("../../db"); // Import MySQL connection pool
const router = express.Router();
const axios = require("axios");
const cheerio = require("cheerio");
const { broadcast } = require("../../websocket"); // Import dari root
const path = require("path"); // Pastikan path diimpor
const fs = require("fs");
require("moment/locale/id");
moment.locale("id"); // Set ke bahasa Indonesia

// Fetch data asset before
router.get("/no-stock-opname-current/:noso", verifyToken, async (req, res) => {
  try {
    await connectDb();

    const { noso } = req.params;
    const limit = 50;
    const offset = parseInt(req.query.offset) || 0;
    const companyQuery = req.query.company;
    const categoryQuery = req.query.category;
    const locationQuery = req.query.location;

    // Base condition - NoSO wajib dan belum discan
    let filterConditions = "d.NoSO = ? AND h.AssetCode IS NULL";
    const queryParams = [noso];

    // ✅ Filter Company (based on asset.CompanyName)
    if (companyQuery) {
      const companyList = companyQuery.split(",").map((c) => c.trim());
      const companyConditions = companyList
        .map(() => `a.CompanyName = ?`)
        .join(" OR ");
      filterConditions += ` AND (${companyConditions})`;
      queryParams.push(...companyList);
    }

    // ✅ Filter Category (based on asset.CategoryAsset)
    if (categoryQuery) {
      const categoryList = categoryQuery.split(",").map((c) => c.trim());
      const categoryConditions = categoryList
        .map(() => `a.CategoryAsset = ?`)
        .join(" OR ");
      filterConditions += ` AND (${categoryConditions})`;
      queryParams.push(...categoryList);
    }

    // ✅ Filter Location (based on asset.LocationAsset)
    if (locationQuery) {
      const locationList = locationQuery.split(",").map((l) => l.trim());
      const locationConditions = locationList
        .map(() => `a.LocationAsset = ?`)
        .join(" OR ");
      filterConditions += ` AND (${locationConditions})`;
      queryParams.push(...locationList);
    }

    // Query data dengan LEFT JOIN ke tabel hasil dan asset
    const dataQuery = `
      SELECT 
        d.AssetCode, 
        a.AssetName, 
        d.HasNotBeenPrinted, 
        d.Image, 
        s.status, 
        u.username,
        a.CompanyName,
        a.CategoryAsset,
        a.LocationAsset,
        att.filename
      FROM tb_stockopname_d d
      LEFT JOIN tb_stockopname_d_hasil h ON d.AssetCode = h.AssetCode AND d.NoSO = h.NoSO
      LEFT JOIN asset a ON d.AssetCode = a.AssetCode
      LEFT JOIN tb_so_status s ON d.id_status = s.id_status
      LEFT JOIN tb_user u ON d.id_user = u.id_user
      LEFT JOIN (
        SELECT AssetCode, filename FROM (
          SELECT 
            AssetCode, 
            filename,
            ROW_NUMBER() OVER (
              PARTITION BY AssetCode 
              ORDER BY id ASC
            ) AS rn
          FROM tb_attachment_asset
          WHERE filename <> '' AND filename REGEXP '\\.(jpg|jpeg|png|gif|bmp|webp)$'
        ) t
        WHERE rn = 1
      ) att ON d.AssetCode = att.AssetCode
      WHERE ${filterConditions}
      ORDER BY d.AssetCode DESC
      LIMIT ? OFFSET ?
    `;

    const dataParams = [...queryParams, limit, offset];

    // Query total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM tb_stockopname_d d
      LEFT JOIN tb_stockopname_d_hasil h ON d.AssetCode = h.AssetCode AND d.NoSO = h.NoSO
      LEFT JOIN asset a ON d.AssetCode = a.AssetCode
      WHERE ${filterConditions}
    `;

    const [rows] = await pool.query(dataQuery, dataParams);
    const [countResult] = await pool.query(countQuery, queryParams);
    const total = countResult[0]?.total || 0;

    if (rows.length === 0) {
      return res.status(404).json({
        message: `Tidak ada data asset yang belum discan untuk NoSO: ${noso}`,
      });
    }

    res.json({
      data: rows,
      total,
      nextOffset: offset + limit,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({
      message: "Internal Server Error",
      error: error.message,
    });
  }
});

// Route to get Asset data based on NoSO
router.get("/no-stock-opname/:noso", verifyToken, async (req, res) => {
  try {
    await connectDb();

    const { noso } = req.params;
    const limit = 50;
    const offset = parseInt(req.query.offset) || 0;
    const companyQuery = req.query.company;
    const categoryQuery = req.query.category;
    const locationQuery = req.query.location;

    let filterConditions = "h.NoSO = ?";
    const queryParams = [noso];

    // ✅ Filter berdasarkan Company (langsung dari a.CompanyName)
    if (companyQuery) {
      const companyList = companyQuery.split(",").map((c) => c.trim());
      const companyConditions = companyList
        .map(() => `a.CompanyName = ?`)
        .join(" OR ");
      filterConditions += ` AND (${companyConditions})`;
      queryParams.push(...companyList);
    }

    // ✅ Filter berdasarkan Category (langsung dari a.CategoryAsset)
    if (categoryQuery) {
      const categoryList = categoryQuery.split(",").map((c) => c.trim());
      const categoryConditions = categoryList
        .map(() => `a.CategoryAsset = ?`)
        .join(" OR ");
      filterConditions += ` AND (${categoryConditions})`;
      queryParams.push(...categoryList);
    }

    // ✅ Filter berdasarkan Location (langsung dari a.LocationAsset)
    if (locationQuery) {
      const locationList = locationQuery.split(",").map((l) => l.trim());
      const locationConditions = locationList
        .map(() => `a.LocationAsset = ?`)
        .join(" OR ");
      filterConditions += ` AND (${locationConditions})`;
      queryParams.push(...locationList);
    }

    // Query data hasil scan
    const dataQuery = `
        SELECT 
          h.AssetCode, 
          u.Username, 
          a.AssetName,
          a.CompanyName,
          a.CategoryAsset,
          a.LocationAsset
        FROM tb_stockopname_d_hasil h
        LEFT JOIN asset a ON h.AssetCode = a.AssetCode
        LEFT JOIN tb_user u ON h.id_user = u.id_user
        WHERE ${filterConditions}
        ORDER BY h.DateTimeScan DESC
        LIMIT ? OFFSET ?
      `;
    queryParams.push(limit, offset);

    const [rows] = await pool.query(dataQuery, queryParams);

    // Query total count
    const countQuery = `
        SELECT COUNT(*) as total 
        FROM tb_stockopname_d_hasil h
        LEFT JOIN asset a ON h.AssetCode = a.AssetCode
        WHERE ${filterConditions}
      `;
    const [countResult] = await pool.query(
      countQuery,
      queryParams.slice(0, -2),
    );

    const total = countResult[0]?.total || 0;

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ message: `Tidak ada data asset untuk NoSO: ${noso}` });
    }

    res.json({
      data: rows,
      total,
      nextOffset: offset + limit,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

//UPDATE ASSET DETAIL PADA STOCKOPNAME_D
router.put("/update-stock-opname", verifyToken, async (req, res) => {
  try {
    await connectDb();

    const { noSO, assetCode, image, idStatus, isUpdateValid } = req.body;

    const idUser = req.user.id_user;

    console.log("🟡 ID User dari JWT:", idUser);

    // Validasi input
    if (!noSO || !assetCode) {
      return res
        .status(400)
        .json({ message: "NoSO dan AssetCode wajib diisi" });
    }

    let query = "";
    let values = [];

    if (isUpdateValid) {
      // Update data seperti biasa
      query = `
          UPDATE tb_stockopname_d 
          SET 
            HasNotBeenPrinted = 1, 
            Image = ?, 
            id_status = ?, 
            id_user = ? 
          WHERE NoSO = ? AND AssetCode = ?
        `;
      values = [image ?? null, idStatus ?? null, idUser, noSO, assetCode];
    } else {
      // Hapus gambar dari file system jika ada
      const imagePath = path.join(
        __dirname,
        "..",
        "..",
        "storage",
        "uploads",
        image,
      );

      try {
        // Cek apakah file gambar ada, lalu hapus
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath); // Hapus file
          console.log(`✅ File gambar ${image} berhasil dihapus`);
        } else {
          console.log(`⚠️ File gambar ${image} tidak ditemukan`);
        }
      } catch (err) {
        console.error(`❌ Gagal menghapus file gambar: ${err.message}`);
        // Lanjutkan proses meskipun gagal menghapus file
      }

      // Reset data
      query = `
          UPDATE tb_stockopname_d 
          SET 
            HasNotBeenPrinted = 0, 
            Image = NULL, 
            id_status = NULL, 
            id_user = NULL 
          WHERE NoSO = ? AND AssetCode = ?
        `;
      values = [noSO, assetCode];
    }

    const [result] = await pool.query(query, values);

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ message: "Data tidak ditemukan atau tidak berubah" });
    }

    res.json({ message: "Data berhasil diupdate" });
  } catch (error) {
    console.error("Update error:", error.message);
    res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  }
});

module.exports = router;
