const express = require('express');
const crypto = require('crypto');  // Import crypto for MD5 hashing
const jwt = require('jsonwebtoken');
const router = express.Router();
const { pool, connectDb } = require('../db');  // Import database connection

// Function to hash the password using MD5
function hashPassword(password) {
  return crypto.createHash('md5').update(password).digest('hex'); // Use MD5 and return the hexadecimal hash
}

// Middleware untuk parsing JSON
router.use(express.json());

// POST /login route
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    await connectDb();  

    // Hash the password with MD5 to compare with the database
    const hashedPassword = hashPassword(password);
    console.log('Hashed password:', hashedPassword);

    // Query the database for the user with the hashed password
    const [rows] = await pool.query(
      'SELECT username, password FROM tb_user WHERE username = ? AND password = ?',
      [username, hashedPassword]
    );

    if (rows.length > 0) {
      const user = rows[0];
      console.log('User found:', user);

            // Membuat JWT token
            const payload = { username };  // Payload hanya berisi username
            const secretKey = process.env.SECRET_KEY;  
      
            // Membuat token yang berlaku selama 1 jam
            const token = jwt.sign(payload, secretKey, { expiresIn: '12h' });

      res.status(200).json({
        success: true,
        message: 'Login berhasil',
        token: token
      });
    } else {
      console.log('Invalid credentials');
      res.status(400).json({ success: false, message: 'Username atau password salah' });
    }
  } catch (err) {
    console.error('Error during login:', err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan di server' });
  }
});

module.exports = router;
