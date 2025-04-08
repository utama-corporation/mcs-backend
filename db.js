require('dotenv').config();
const mysql = require('mysql2/promise');

const dbConfig = {
    host: process.env.DB_HOST,        // IP server MySQL
    user: process.env.DB_USER,        // Username MySQL (root)
    password: process.env.DB_PASSWORD, // Kosong jika tidak ada password
    database: process.env.DB_NAME,    // Nama database (mcs)
    port: parseInt(process.env.DB_PORT) || 3306,  // Port (default 3306)
    waitForConnections: true,
    connectionLimit: 10,
  };
  

const pool = mysql.createPool(dbConfig);

const connectDb = async () => {
  try {
    const conn = await pool.getConnection();
    console.log('✅ Terhubung ke MySQL server:', dbConfig.host);
    conn.release();
    return pool;
  } catch (err) {
    console.error('❌ Gagal terhubung ke MySQL:', {
      code: err.code,
      message: err.message,
      host: dbConfig.host,
      port: dbConfig.port
    });
    throw err;
  }
};

module.exports = { connectDb, pool };