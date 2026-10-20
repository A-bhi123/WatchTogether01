const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { requireRoomHost, requireRoomMember } = require('../middleware/roomAccess');
const { uploadLimiter } = require('../middleware/rateLimiters');
const { handleVideoUpload } = require('../config/upload');
const { uploadVideo, getRoomVideo, streamVideo } = require('../controllers/video.controller');

// Order zaroori hai: login, host check, upload limit, TAB file receive hogi
router.post('/rooms/:code/videos', requireAuth, requireRoomHost, uploadLimiter, handleVideoUpload, uploadVideo);
router.get('/rooms/:code/video', requireAuth, requireRoomMember, getRoomVideo);
router.get('/videos/:id/stream', requireAuth, streamVideo);

module.exports = router;