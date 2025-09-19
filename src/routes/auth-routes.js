const express = require('express');
const crypto = require('crypto');  // Import crypto for MD5 hashing
const jwt = require('jsonwebtoken');
const router = express.Router();
const { pool, connectDb } = require('../../db');  // Import database connection

// Function to hash the password using MD5
function hashPassword(password) {
  return crypto.createHash('md5').update(password).digest('hex'); // Use MD5 and return the hexadecimal hash
}

// Middleware untuk parsing JSON
router.use(express.json());

// POST /login route
// routes/auth.js
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    // Hash password
    const hashedPassword = hashPassword(password);

    // Query pakai pool
    const [rows] = await pool.query(
      'SELECT id_user, username FROM tb_user WHERE username = ? AND password = ?',
      [username, hashedPassword]
    );

    if (rows.length > 0) {
      const user = rows[0];

      // Buat token
      const payload = { id_user: user.id_user, username: user.username };
      const token = jwt.sign(payload, process.env.SECRET_KEY, { expiresIn: '12h' });

      res.json({
        success: true,
        message: 'Login berhasil',
        token,
        user
      });
    } else {
      res.status(400).json({ success: false, message: 'Username atau password salah' });
    }
  } catch (err) {
    console.error('Error during login:', err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan di server' });
  }
});

module.exports = router;
