const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { createRoomLimiter, joinLimiter } = require('../middleware/rateLimiters');
const { getMyRooms, createRoom, getRoomByCode, joinRoom, deleteRoom } = require('../controllers/room.controller');

router.get('/my-rooms', requireAuth, getMyRooms);
router.post('/', requireAuth, createRoomLimiter, createRoom);
router.post('/:code/join', requireAuth, joinLimiter, joinRoom);
router.get('/:code', requireAuth, getRoomByCode);
router.delete('/:code', requireAuth, deleteRoom);

module.exports = router;