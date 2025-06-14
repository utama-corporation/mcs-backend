require('dotenv').config();  // Memuat file .env
const express = require('express');
const cors = require('cors');  // Menggunakan CORS untuk menangani permintaan lintas asal
const bodyParser = require('body-parser');
const { connectDb } = require('./db');  // Menghubungkan ke database
const http = require('http');  // Untuk membuat server HTTP
const { wss } = require('./websocket'); // Import dari root

const authRoutes = require('./src/routes/auth-routes');
const validateAssetStockOpnameRoutes = require('./src/routes/validate-asset-stock-opname-routes');
const masterRoutes = require('./src/routes/master-routes');
const uploadAssetImgRoutes = require('./src/routes/upload-asset-image-routes');
const laporanStockOpnameRoutes = require('./src/routes/laporan-stock-opname-asset-routes');
const headerStockOpnameRoutes = require('./src/routes/header-stock-opname-routes');
const assetsStockOpnameRoutes = require('./src/routes/assets-stock-opname-routes');
const assetsBOMStockOpnameRoutes = require('./src/routes/assets-bom-stock-opname-routes');
const nonAssetsStockOpnameRoutes = require('./src/routes/non-assets-stock-opname-routes');
const laporanStockOpnameBOMRoutes = require('./src/routes/laporan-stock-opname-bom-routes');
const nonPartsStockOpnameRoutes = require('./src/routes/non-parts-stock-opname-routes');

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

app.use('/api', assetsBOMStockOpnameRoutes);

app.use('/api', nonAssetsStockOpnameRoutes);

app.use('/api', laporanStockOpnameBOMRoutes);

app.use('/api', nonPartsStockOpnameRoutes);


// Panggil connectDb sebelum server.listen
connectDb().then(() => {
    server.listen(port, () => {
      console.log(`Server berjalan di http://localhost:${port}`);
    });
  }).catch(err => {
    console.error('Gagal memulai server:', err);
  });
