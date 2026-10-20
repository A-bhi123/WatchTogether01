const express = require('express');
const router = express.Router();
const { getHealth, getDbCheck } = require('../controllers/health.controller');

router.get('/health', getHealth);
router.get('/db-check', getDbCheck);

module.exports = router;