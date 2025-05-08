const WebSocket = require('ws');
const wss = new WebSocket.Server({ noServer: true });
const clients = new Set();

wss.on('connection', (ws) => {
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true; // Klien merespon ping
  });

  clients.add(ws);

  ws.on('close', () => {
    clients.delete(ws); // Hapus klien dari set saat koneksi ditutup
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err); // Log error
  });
});

// Periksa klien yang tidak responsif
const interval = setInterval(() => {
  clients.forEach((client) => {
    if (!client.isAlive) {
      clients.delete(client); // Hapus klien zombie
      return client.terminate(); // Tutup koneksi
    }

    client.isAlive = false; // Tandai sebagai tidak responsif
    client.ping(); // Kirim ping
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval); // Hentikan interval saat server ditutup
});

// Fungsi broadcast
function broadcast(data) {
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(data));
      } catch (err) {
        console.error('Error broadcasting to client:', err);
      }
    }
  });
}

module.exports = { wss, broadcast };