// routes/requests.js
const express = require('express');
const router = express.Router();
const requestController = require('../controllers/requestController');
const { ensureAuthenticated } = require('../middlewares/authMiddleware'); // تابعی که خودت داری

// صفحه ایجاد درخواست
router.get('/create', ensureAuthenticated(), requestController.createPage);
router.post('/create', ensureAuthenticated(), requestController.create);

// لیست
router.get('/', ensureAuthenticated(), requestController.list);

// جزئیات
router.get('/:id', ensureAuthenticated(), requestController.detail);

// آپلود سند
router.post('/:id/upload', ensureAuthenticated(), requestController.uploadDocument);

// بررسی (approve / reject)
router.post('/:id/review', ensureAuthenticated(), requestController.review);

module.exports = router;
