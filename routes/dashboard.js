const express = require('express');
const router = express.Router();

const { ensureAuthenticated } = require('../middlewares/authMiddleware');
const { dashboardPage } = require('../controllers/dashboardController');

// =============================
// 🧭 مسیر عمومی داشبورد (بر اساس نقش داخل controller رندر می‌شود)
// =============================
router.get('/dashboard', ensureAuthenticated(), dashboardPage);

// =============================
// 🧭 مسیر مخصوص افسرها
// =============================
router.get('/dashboard/officer', ensureAuthenticated(['officer']), dashboardPage);

// =============================
// 🧭 مسیر مخصوص ادمین‌ها
// =============================
router.get('/dashboard/admin', ensureAuthenticated(['admin']), dashboardPage);

module.exports = router;
