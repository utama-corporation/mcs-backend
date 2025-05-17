const express = require('express');
const verifyToken = require('../middleware/verifyToken'); // Middleware to verify JWT token
const moment = require('moment');
const { pool, connectDb } = require('../db');  // Import MySQL connection pool
const router = express.Router();


router.get('/master-company', async (req, res) => {
    try {
      await connectDb(); // Koneksi DB
  
      // Ambil daftar perusahaan
      const [companyRows] = await pool.query('SELECT id_company, company_name FROM tb_company');
  
      // Ambil daftar kategori asset
      const [categoryRows] = await pool.query('SELECT category_code, category_name FROM tb_category_asset');

      // Ambil daftar lokasi
      const [locationRows] = await pool.query('SELECT location_code, location_name FROM tb_location_asset');

      if (companyRows.length === 0 && categoryRows.length === 0 && locationRows.length === 0) {
        return res.status(404).json({ message: 'Tidak ada data company atau kategori atau lokasi ditemukan' });
      }
  
      // Format data company
      const companies = companyRows.map(item => ({
        companyId: item.id_company,
        companyName: item.company_name
      }));
  
      // Format data kategori
      const categories = categoryRows.map(item => ({
        categoryCode: item.category_code,
        categoryName: item.category_name
      }));

                  // Format data kategori
                  const locations = locationRows.map(item => ({
                    locationCode: item.location_code,
                    locationName: item.location_name
                  }));


      // Gabungkan dan kirim response
      res.json({
        companies,
        categories,
        locations
      });
  
    } catch (error) {
      console.error('❌ Error:', error.message);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  });

  // Route untuk menambahkan status baru ke tb_so_status
router.post('/status', verifyToken, async (req, res) => {
  try {
    const { status } = req.body;

    if (!status || status.trim() === '') {
      return res.status(400).json({ message: 'Status tidak boleh kosong' });
    }

    const [result] = await pool.query(
      'INSERT INTO tb_so_status (status) VALUES (?)',
      [status]
    );

    res.status(201).json({
      message: 'Status berhasil ditambahkan',
      id_status: result.insertId,
      status,
    });
  } catch (error) {
    console.error('Gagal menambahkan status:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat menambahkan status' });
  }
});


// Route untuk mengambil semua status dari tb_so_status
router.get('/status', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM tb_so_status WHERE is_active = 1');
    
    res.status(200).json({
      message: 'Data status berhasil diambil',
      data: rows,
    });
  } catch (error) {
    console.error('Gagal mengambil data status:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat mengambil data status' });
  }
});


// Route untuk "menghapus" status (soft delete dengan is_active = 0)
router.delete('/status/:id', verifyToken, async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.query(
      'UPDATE tb_so_status SET is_active = 0 WHERE id_status = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Status tidak ditemukan atau sudah tidak aktif.' });
    }

    res.status(200).json({ message: 'Status berhasil dinonaktifkan.' });
  } catch (error) {
    console.error('Gagal menghapus status:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat menghapus status.' });
  }
});


//EDIT STATUS SO
router.put('/status/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;  // status baru dikirim lewat body

  if (!status || status.trim() === '') {
    return res.status(400).json({ message: 'Field status harus diisi.' });
  }

  try {
    const [result] = await pool.query(
      'UPDATE tb_so_status SET status = ? WHERE id_status = ? AND is_active = 1',
      [status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Status tidak ditemukan atau sudah tidak aktif.' });
    }

    res.status(200).json({ message: 'Status berhasil diupdate.' });
  } catch (error) {
    console.error('Gagal mengupdate status:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat mengupdate status.' });
  }
});


  

  module.exports = router;
