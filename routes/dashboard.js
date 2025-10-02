const express = require('express');
const router = express.Router();

const { ensureAuthenticated } = require('../middlewares/authMiddleware');
const { dashboardPage } = require('../controllers/dashboardController');

// Dashboard route
router.get('/dashboard', ensureAuthenticated, dashboardPage);

module.exports = router;
