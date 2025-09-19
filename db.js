require('dotenv').config();
const mysql = require('mysql2/promise');

// 🔹 Konfigurasi Pool MySQL
const dbConfig = {
  host: process.env.DB_HOST,         // IP / Host MySQL
  user: process.env.DB_USER,         // Username MySQL
  password: process.env.DB_PASSWORD, // Password MySQL
  database: process.env.DB_NAME,     // Nama database
  port: parseInt(process.env.DB_PORT, 10) || 3306, // Default 3306
  waitForConnections: true,
  connectionLimit: 10,  // jumlah koneksi maksimal
  queueLimit: 0         // unlimited antrian
};

// 🔹 Buat pool sekali saja
const pool = mysql.createPool(dbConfig);

// 🔹 Fungsi cek koneksi (hybrid → return pool)
const connectDb = async () => {
  try {
    const conn = await pool.getConnection();
    console.log(`✅ Terhubung ke MySQL server: ${dbConfig.host}`);
    conn.release();
    return pool; // 🔹 return supaya endpoint lama tetap jalan
  } catch (err) {
    console.error('❌ Gagal terhubung ke MySQL:', {
      code: err.code,
      message: err.message,
      host: dbConfig.host,
      port: dbConfig.port,
    });
    throw err;
  }
};

// 🔹 Tutup pool saat server dimatikan
process.on('SIGINT', async () => {
  try {
    await pool.end();
    console.log('🔻 MySQL pool closed.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error saat menutup pool:', err.message);
    process.exit(1);
  }
});

module.exports = { pool, connectDb };
