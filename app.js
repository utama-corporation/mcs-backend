require('dotenv').config();  // Memuat file .env
const express = require('express');
const cors = require('cors');  // Menggunakan CORS untuk menangani permintaan lintas asal
const bodyParser = require('body-parser');
const { connectDb } = require('./db');  // Menghubungkan ke database
const http = require('http');  // Untuk membuat server HTTP
const { wss } = require('./websocket'); // Import dari root

const authRoutes = require('./src/routes/authRoutes');
const validateAssetStockOpnameRoutes = require('./src/routes/validateAssetStockOpnameRoutes');
const masterRoutes = require('./src/routes/masterRoutes');
const uploadAssetImgRoutes = require('./src/routes/uploadAssetImgRoutes');
const laporanStockOpnameRoutes = require('./src/routes/laporanStockOpnameRoutes');
const headerStockOpnameRoutes = require('./src/routes/headerStockOpnameRoutes');
const assetsStockOpnameRoutes = require('./src/routes/assetsStockOpnameRoutes');
const nonAssetsStockOpnameRoutes = require('./src/routes/nonAssetsStockOpnameRoutes');

const app = express();
const server = http.createServer(app);  // Membuat server HTTP menggunakan express

// WebSocket upgrade handler
server.on('upgrade', (request, socket, head) => {
  // Anda bisa menambahkan auth disini
  const { url } = request;
  const noso = new URL(url, 'http://dummy.com').searchParams.get('noso');
  
  if (!noso) {
    return socket.destroy();
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

const port = process.env.PORT || 6000;  // Menggunakan port dari .env atau default 5000

// Middleware untuk parsing JSON dari body request
app.use(express.json());

// Middleware untuk menangani CORS
app.use(cors());

// Middleware untuk parsing JSON
app.use(bodyParser.json());

// Menggunakan rute autentikasi dan stock opname
app.use('/api', authRoutes);  

app.use('/api', validateAssetStockOpnameRoutes);  

app.use('/api', masterRoutes);  

app.use('/api', uploadAssetImgRoutes);

app.use('/api', laporanStockOpnameRoutes);

app.use('/api', headerStockOpnameRoutes);

app.use('/api', assetsStockOpnameRoutes);

app.use('/api', nonAssetsStockOpnameRoutes)


// Panggil connectDb sebelum server.listen
connectDb().then(() => {
    server.listen(port, () => {
      console.log(`Server berjalan di http://localhost:${port}`);
    });
  }).catch(err => {
    console.error('Gagal memulai server:', err);
  });
