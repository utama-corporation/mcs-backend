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
  

  module.exports = router;
