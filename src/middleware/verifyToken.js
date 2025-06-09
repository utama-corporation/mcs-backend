require('dotenv').config();
const jwt = require('jsonwebtoken');
const secretKey = process.env.SECRET_KEY;  

// Middleware untuk memverifikasi token dan mengekstrak username
const verifyToken = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({ message: 'Access Denied, token required.' });
    }

    try {
        const decoded = jwt.verify(token, secretKey);  // Verifikasi dan decode token
        req.user = decoded;  // Simpan seluruh payload token ke req.user
        next();  // Lanjutkan ke route handler
    } catch (error) {
        return res.status(401).json({ message: 'Invalid or expired token.' });
    }
};

module.exports = verifyToken;
