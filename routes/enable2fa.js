// routes/enable2fa.js
const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middlewares/authMiddleware');
const authController = require('../controllers/authController');

// ⚠️ دقت کن require2FA: false باشه چون این صفحه خودش برای فعال‌سازی 2FA است
router.get('/2fa/setup', ensureAuthenticated([], { require2FA: false }), authController.enable2FA);
router.post('/2fa/verify', ensureAuthenticated([], { require2FA: false }), authController.verify2FA);

module.exports = router;
