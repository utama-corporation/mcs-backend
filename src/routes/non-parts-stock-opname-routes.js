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


//ITEM NO ASSET
router.post("/non-part-stock-opname/create", verifyToken, async (req, res) => {
    try {
      const pool = await connectDb();
      console.log("✅ Terhubung ke MySQL server:", pool.config?.host || "Unknown");
  
      const { NoSO, image, non_part_name, qty, remark } = req.body;
  
      // Validasi input wajib
      if (!NoSO || !image) {
        return res.status(400).json({
          message: "NoSO dan image tidak boleh kosong!"
        });
      }
  
      // Siapkan SQL Insert
      const insertSql = `
        INSERT INTO tb_stockopname_non_parts (NoSO, image, non_part_name, qty, remark)
        VALUES (?, ?, ?, ?, ?)
      `;
  
      // Eksekusi query
      const [result] = await pool.query(insertSql, [
        NoSO,
        image,
        non_part_name || null,
        qty ?? 1, // default qty = 1 jika tidak dikirim
        remark || null
      ]);
  
      // Kirim response
      res.status(201).json({
        message: "Data berhasil disimpan ke tb_stockopname_non_parts!",
        data: {
          non_part_id: result.insertId,
          NoSO,
          image,
          non_part_name: non_part_name || null,
          qty: qty ?? 1,
          remark: remark || null
        }
      });
  
    } catch (error) {
      console.error("❌ Error saat menyimpan ke tb_stockopname_non_parts:", error);
      res.status(500).json({
        message: "Internal Server Error",
        error: error.message
      });
    }
  });
  

  //GET NON ASSETS
  router.get("/non-part-stock-opname/:noso", async (req, res) => {
    try {
      const { noso } = req.params;
  
      const pool = await connectDb();
      const [rows] = await pool.query(
        `SELECT non_part_id, NoSO, image, non_part_name, qty, remark 
         FROM tb_stockopname_non_parts 
         WHERE NoSO = ?`,
        [noso]
      );
  
      res.status(200).json({
        message: `Data dengan NoSO ${noso} berhasil diambil.`,
        data: rows
      });
  
    } catch (error) {
      console.error("❌ Error:", error);
      res.status(500).json({
        message: "Internal Server Error",
        error: error.message
      });
    }
  });
  



  //DELETE ITEM NO ASSET
  router.post("/non-part-stock-opname/delete", verifyToken, async (req, res) => {
    try {
      const pool = await connectDb();
      const { idParts } = req.body;
  
      if (!Array.isArray(idParts) || idParts.length === 0) {
        return res.status(400).json({
          message: "idParts harus berupa array dan tidak boleh kosong!"
        });
      }
  
      // Ambil gambar-gambar yang terkait dengan ID tersebut
      const getImagesSql = `
        SELECT image FROM tb_stockopname_non_parts WHERE non_part_id IN (?)
      `;
      const [images] = await pool.query(getImagesSql, [idParts]);
  
      // Hapus file gambar dari filesystem (jika ada)
      images.forEach(image => {
        if (image?.image) {
          const imagePath = path.join(__dirname, '..', '..', 'storage', 'uploads', image.image);
          if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
          }
        }
      });
  
      // Hapus data dari tabel
      const deleteSql = `
        DELETE FROM tb_stockopname_non_parts
        WHERE non_part_id IN (?)
      `;
      const [result] = await pool.query(deleteSql, [idParts]);
  
      res.status(200).json({
        message: `${result.affectedRows} data berhasil dihapus dari tb_stockopname_non_parts.`,
        deletedCount: result.affectedRows
      });
  
    } catch (error) {
      console.error("❌ Gagal menghapus data:", error);
      res.status(500).json({
        message: "Gagal menghapus data",
        error: error.message
      });
    }
  });
  


// UPDATE Non ASSET 
router.put("/non-part-stock-opname/update/:non_part_id", verifyToken, async (req, res) => {
    try {
      const pool = await connectDb();
      const { non_part_id } = req.params;
      const { image, non_part_name, qty, remark } = req.body;
  
      if (!non_part_id) {
        return res.status(400).json({
          message: "ID non part harus disertakan!"
        });
      }
  
      if (image === undefined && non_part_name === undefined && qty === undefined && remark === undefined) {
        return res.status(400).json({
          message: "Minimal salah satu dari image, nama part, qty, atau remark harus diisi untuk update!"
        });
      }
  
      // Cek apakah ID-nya ada di database
      const [existing] = await pool.query(
        `SELECT non_part_id FROM tb_stockopname_non_parts WHERE non_part_id = ?`,
        [non_part_id]
      );
  
      if (existing.length === 0) {
        return res.status(404).json({
          message: `Data dengan ID ${non_part_id} tidak ditemukan!`
        });
      }
  
      const updateSql = `
        UPDATE tb_stockopname_non_parts 
        SET 
          image = IFNULL(?, image),
          non_part_name = IFNULL(?, non_part_name),
          qty = IFNULL(?, qty),
          remark = IFNULL(?, remark)
        WHERE non_part_id = ?
      `;
  
      await pool.query(updateSql, [
        image || null,
        non_part_name || null,
        qty || null,
        remark || null,
        non_part_id
      ]);
  
      const [updatedData] = await pool.query(
        `SELECT non_part_id, NoSO, image, non_part_name, qty, remark
         FROM tb_stockopname_non_parts
         WHERE non_part_id = ?`,
        [non_part_id]
      );
  
      res.status(200).json({
        message: "Data berhasil diupdate!",
        data: updatedData[0]
      });
  
    } catch (error) {
      console.error("❌ Gagal update data:", error);
      res.status(500).json({
        message: "Internal Server Error",
        error: error.message
      });
    }
  });
  


  module.exports = router;