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

//ITEM NO ASSET
router.post("/no-asset-stock-opname/create", verifyToken, async (req, res) => {
  try {
    const pool = await connectDb();
    console.log(
      "✅ Terhubung ke MySQL server:",
      pool.config?.host || "Unknown",
    );

    const { NoSO, image, location_code, non_asset_name, remark } = req.body;

    // Validasi input
    if (!NoSO || !image) {
      return res.status(400).json({
        message: "NoSO dan image tidak boleh kosong!",
      });
    }

    const insertSql = `
        INSERT INTO tb_stockopname_non_assets (NoSO, image, location_code, non_asset_name, remark)
        VALUES (?, ?, ?, ?, ?)
      `;

    const [result] = await pool.query(insertSql, [
      NoSO,
      image,
      location_code,
      non_asset_name,
      remark || null,
    ]);

    res.status(201).json({
      message: "Data berhasil disimpan ke tb_stockopname_non_assets!",
      data: {
        non_asset_id: result.insertId,
        NoSO,
        image,
        location_code,
        non_asset_name: non_asset_name || null,
        remark: remark || null,
      },
    });
  } catch (error) {
    console.error(
      "❌ Error saat menyimpan ke tb_stockopname_non_assets:",
      error,
    );
    res.status(500).json({
      message: "Internal Server Error",
      error: error.message,
    });
  }
});

//GET NON ASSETS
router.get("/no-asset-stock-opname/:noso", async (req, res) => {
  try {
    const { noso } = req.params;

    const pool = await connectDb();
    const [rows] = await pool.query(
      "SELECT * FROM tb_stockopname_non_assets WHERE NoSO = ?",
      [noso],
    );

    res.status(200).json({
      message: `Data dengan noso ${noso} berhasil diambil.`,
      data: rows,
    });
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({
      message: "Internal Server Error",
      error: error.message,
    });
  }
});

//DELETE ITEM NO ASSET
router.post("/no-asset-stock-opname/delete", verifyToken, async (req, res) => {
  try {
    const pool = await connectDb();
    const { idAssets } = req.body;

    if (!Array.isArray(idAssets) || idAssets.length === 0) {
      return res.status(400).json({
        message: "idAssets harus berupa array dan tidak boleh kosong!",
      });
    }

    // Query untuk mengambil gambar berdasarkan idAssets
    const getImagesSql = `
        SELECT image FROM tb_stockopname_non_assets WHERE non_asset_id IN (?)
      `;
    const [images] = await pool.query(getImagesSql, [idAssets]);

    // Hapus gambar-gambar dari file system
    images.forEach((image) => {
      if (image && image.image) {
        const imagePath = path.join(
          __dirname,
          "..",
          "..",
          "storage",
          "uploads",
          image.image,
        );
        // Cek apakah file gambar ada, lalu hapus
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath); // Hapus file
        }
      }
    });

    // Hapus data dari tabel setelah file gambar berhasil dihapus
    const deleteSql = `
        DELETE FROM tb_stockopname_non_assets
        WHERE non_asset_id IN (?)
      `;
    const [result] = await pool.query(deleteSql, [idAssets]);

    res.status(200).json({
      message: `${result.affectedRows} item berhasil dihapus.`,
      deletedCount: result.affectedRows,
    });
  } catch (error) {
    console.error("❌ Error saat menghapus data:", error);
    res.status(500).json({
      message: "Gagal menghapus data",
      error: error.message,
    });
  }
});

// UPDATE Non ASSET
router.put(
  "/no-asset-stock-opname/update/:non_asset_id",
  verifyToken,
  async (req, res) => {
    try {
      const pool = await connectDb();
      const { non_asset_id } = req.params;
      const { image, location_code, non_asset_name, remark } = req.body;

      // Validasi ID harus ada
      if (!non_asset_id) {
        return res.status(400).json({
          message: "ID non asset harus disertakan!",
        });
      }

      // Validasi minimal image atau remark harus ada
      if (
        image === undefined &&
        location_code === undefined &&
        non_asset_name === undefined &&
        remark === undefined
      ) {
        return res.status(400).json({
          message:
            "Minimal image atau non asset name atau remark harus diisi untuk update!",
        });
      }

      // Cek apakah data exist
      const [rows] = await pool.query(
        `SELECT non_asset_id FROM tb_stockopname_non_assets WHERE non_asset_id = ?`,
        [non_asset_id],
      );

      if (rows.length === 0) {
        return res.status(404).json({
          message: `Data dengan ID ${non_asset_id} tidak ditemukan!`,
        });
      }

      // Update hanya image dan remark
      const updateSql = `
        UPDATE tb_stockopname_non_assets 
        SET 
          image = IFNULL(?, image),
          location_code = ?,
          non_asset_name = ?,
          remark = ?
        WHERE non_asset_id = ?
      `;

      await pool.query(updateSql, [
        image || null, // Jika image tidak diisi, gunakan nilai yang ada
        location_code || null,
        non_asset_name || null,
        remark || null, // Jika remark tidak diisi, set ke null
        non_asset_id,
      ]);

      // Ambil data terupdate untuk response
      const [updatedData] = await pool.query(
        `SELECT non_asset_id, NoSO, image, non_asset_name, remark 
         FROM tb_stockopname_non_assets 
         WHERE non_asset_id = ?`,
        [non_asset_id],
      );

      res.status(200).json({
        message: "Image dan remark berhasil diupdate!",
        data: updatedData[0],
      });
    } catch (error) {
      console.error("Error updating data:", error);
      res.status(500).json({
        message: "Internal Server Error",
        error: error.message,
      });
    }
  },
);

module.exports = router;
