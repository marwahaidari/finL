const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fileController = require('../controllers/fileController');
const { ensureAuthenticated, checkRole } = require('../middlewares/authMiddleware');

// تنظیم multer برای آپلود
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '..', 'tmp')); // فایل موقت تا اعتبارسنجی
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + file.originalname;
        cb(null, uniqueName);
    }
});
const upload = multer({ storage });

// =============================
// آپلود فایل
// =============================
router.post('/:orderId/upload', ensureAuthenticated(), upload.single('file'), fileController.uploadFile);

// =============================
// لیست فایل‌ها
// =============================
router.get('/:orderId/files', ensureAuthenticated(), fileController.listFiles);

// =============================
// دانلود فایل
// =============================
router.get('/download/:id', ensureAuthenticated(), fileController.downloadFile);

// =============================
// پیش‌نمایش فایل
// =============================
router.get('/preview/:id', ensureAuthenticated(), fileController.previewFile);

// =============================
// جایگزینی فایل
// =============================
router.post('/update/:id', ensureAuthenticated(), upload.single('file'), fileController.updateFile);

// =============================
// آرشیو فایل
// =============================
router.post('/archive/:id', ensureAuthenticated(), fileController.archiveFile);

// =============================
// حذف فایل
// =============================
router.post('/delete/:id', ensureAuthenticated(), fileController.deleteFile);

module.exports = router;
