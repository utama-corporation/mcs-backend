const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const verifyToken = require('../middleware/verifyToken'); 
const router = express.Router();
const uploadDir = path.join(__dirname, '..', '..', 'storage', 'uploads');

// Pastikan folder upload ada
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Konfigurasi multer untuk upload file
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir); // Lokasi folder penyimpanan
  },
  filename: (req, file, cb) => {
    const rawNoSO = req.body.noSO || 'asset';
    const safeNoSO = rawNoSO.replace(/\./g, '_');
    const uniqueName = `${safeNoSO}_${Date.now()}${path.extname(file.originalname)}`;
    
    cb(null, uniqueName); // Nama file unik berdasarkan timestamp
  },
});

const upload = multer({ storage });

// Endpoint untuk upload gambar
router.post('/upload-image', upload.single('image'), verifyToken, (req, res) => {
    try {
      if (!req.file) {
        console.log('No file received');
        return res.status(400).json({ message: 'No file uploaded' });
      }
  
      console.log('File saved successfully:', req.file.path);
      res.status(200).json({
        message: 'Image uploaded successfully',
        fileName: req.file.filename,
      });
    } catch (error) {
      console.error('Upload error:', error.message);
      res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
  });


  
  // Endpoint untuk edit (replace) gambar
  router.post('/edit-image', upload.single('image'), (req, res) => {
    try {
      const oldImageName = req.body.oldImageName;
      const noSO = req.body.noSO;
  
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }
      if (!oldImageName) {
        return res.status(400).json({ message: 'Old image name is required' });
      }
      if (!noSO) {
        return res.status(400).json({ message: 'NoSO is required' });
      }
  
      // Hapus file lama jika ada
      const oldFilePath = path.join(uploadDir, oldImageName);
      if (fs.existsSync(oldFilePath)) {
        fs.unlinkSync(oldFilePath);
        console.log('Old image deleted:', oldImageName);
      } else {
        console.log('Old image not found, skipping delete');
      }
  
      // File baru sudah diupload dengan nama unik berdasarkan noSO
      console.log('New file saved successfully:', req.file.path);
  
      res.status(200).json({
        message: 'Image replaced successfully',
        fileName: req.file.filename,
      });
    } catch (error) {
      console.error('Edit image error:', error.message);
      res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
  });
  
  


// Endpoint untuk serve file image
router.get('/upload/:filename', (req, res) => {
    const filePath = path.join(uploadDir, req.params.filename);
    console.log('[Server] Request for:', req.params.filename);
    console.log('[Server] Full path:', filePath);

    if (fs.existsSync(filePath)) {
      console.log('[Server] File ditemukan, mengirim...');
      res.sendFile(filePath);
    } else {
      console.log('[Server] File tidak ditemukan.');
      res.status(404).json({ message: 'File not found' });
    }
});

  

module.exports = router;