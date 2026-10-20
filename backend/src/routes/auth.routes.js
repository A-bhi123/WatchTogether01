const express = require('express');
const router = express.Router();
const { otpStatus } = require('../controllers/otpStatus.controller');

const { forgotPassword, resetPassword } = require('../controllers/auth.controller');
const { register, verifyRegisterOtp, resendRegisterOtp } = require('../controllers/registration.controller');
const { login, verifyLoginOtp, resendLoginOtp, logout, me } = require('../controllers/session.controller');
const { requireAuth, getSession } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiters');

router.post('/register', authLimiter, register);
router.post('/verify-register-otp', authLimiter, verifyRegisterOtp);
router.post('/resend-register-otp', authLimiter, resendRegisterOtp);
router.post('/login', authLimiter, login);
router.post('/verify-otp', authLimiter, verifyLoginOtp);
router.post('/resend-otp', authLimiter, resendLoginOtp);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);
router.post('/logout', logout);
router.get('/otp-status', authLimiter, otpStatus);
router.get('/session', getSession);
router.get('/me', requireAuth, me);

module.exports = router;