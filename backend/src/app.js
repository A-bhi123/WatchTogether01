require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const roomRoutes = require('./routes/room.routes');
const messageRoutes = require('./routes/message.routes');
const videoRoutes = require('./routes/video.routes');
const errorHandler = require('./middleware/errorHandler');
const { requireTrustedOrigin, allowedOrigin } = require('./middleware/security');
const { apiLimiter } = require('./middleware/rateLimiters');

const app = express();

// Security headers (X-Content-Type-Options, HSTS, wagairah). "same-site" isliye ki hamari frontend
// (localhost:5173) alag port se <video> mein movie load karti hai. Default "same-origin" use rok deta.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));

app.use(cors({ origin: allowedOrigin(), credentials: true }));
app.use(requireTrustedOrigin); // doosri site se aayi POST/DELETE ko pehle hi rok do
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use('/api', apiLimiter);

app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/rooms', messageRoutes);
app.use('/api', videoRoutes);

// Jo API route hai hi nahi uska saaf 404
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);

module.exports = app;