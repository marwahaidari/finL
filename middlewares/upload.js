const multer = require('multer');
const path = require('path');

// مسیر ذخیره فایل‌ها
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); // مطمئن شوید پوشه uploads وجود دارد
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

// فیلتر فایل‌ها
const fileFilter = (req, file, cb) => {
    cb(null, true); // یا فیلتر نوع فایل
};

const upload = multer({ storage, fileFilter });

// Middleware های جداگانه
const uploadProfile = upload.single('profile');        // فقط یک فایل
const uploadDocument = upload.single('document');      // فقط یک فایل
const uploadMultipleImages = upload.array('images', 10); // چند فایل، حداکثر 10

module.exports = {
    uploadProfile,
    uploadDocument,
    uploadMultipleImages
};
