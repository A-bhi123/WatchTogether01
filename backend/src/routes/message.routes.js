const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getMessages } = require('../controllers/message.controller');

router.get('/:code/messages', requireAuth, getMessages);

module.exports = router;