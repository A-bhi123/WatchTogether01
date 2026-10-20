const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const initSockets = require('./sockets');
const { allowedOrigin } = require('./middleware/security');

// Express + Socket.IO ko jodne ka kaam yahan hai. server.js (asli app) aur tests dono yahi use karte hain,
// isliye test bilkul usi server ko jaanchte hain jo asli mein chalta hai.
function createServer() {
  const server = http.createServer(app);

  // Badi video upload ke liye lamba timeout (Node ka default 5 minute hai)
  server.requestTimeout = 30 * 60 * 1000;

  const io = new Server(server, {
    cors: { origin: allowedOrigin(), credentials: true },
    // WebSocket par CORS nahi lagta, isliye Origin yahan khud jaanchte hain.
    // Warna koi bhi doosri site hamare socket ko tumhari cookie ke saath khol sakti hai.
    allowRequest: (req, callback) => callback(null, req.headers.origin === allowedOrigin()),
    maxHttpBufferSize: 1e6, // ek socket message 1 MB se bada nahi
  });

  // Controllers req.app.get('io') se socket server tak pahunch sakte hain
  app.set('io', io);
  initSockets(io);

  return { app, server, io };
}

module.exports = { createServer };