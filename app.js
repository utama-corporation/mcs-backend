require('dotenv').config();  // Memuat file .env
const express = require('express');
const cors = require('cors');  // Menggunakan CORS untuk menangani permintaan lintas asal
const bodyParser = require('body-parser');
const { connectDb } = require('./db');  // Menghubungkan ke database
const http = require('http');  // Untuk membuat server HTTP
const { wss } = require('./websocket'); // Import dari root
const authRoutes = require('./routes/authRoutes');  // Rute untuk autentikasi
const stockOpnameRoutes = require('./routes/stockOpnameRoutes');  // Rute untuk autentikasi
const masterRoutes = require('./routes/masterRoutes');  // Rute untuk autentikasi
const uploadImgRoutes = require('./routes/uploadImgRoutes');
const laporanRoutes = require('./routes/laporanRoutes');



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
app.use('/api', authRoutes);  // Rute autentikasi

app.use('/api', stockOpnameRoutes);  // Rute autentikasi

app.use('/api', masterRoutes);  

app.use('/api', uploadImgRoutes);

app.use('/api', laporanRoutes);



// Panggil connectDb sebelum server.listen
connectDb().then(() => {
    server.listen(port, () => {
      console.log(`Server berjalan di http://localhost:${port}`);
    });
  }).catch(err => {
    console.error('Gagal memulai server:', err);
  });
