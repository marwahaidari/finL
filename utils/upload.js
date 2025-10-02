const multer = require("multer");
const path = require("path");
const fs = require("fs");

// پوشه آپلودها رو بررسی و ایجاد می‌کنیم
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// تنظیمات ذخیره‌سازی دیسک
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    },
});

// فیلتر کردن فایل‌ها بر اساس نوع
const fileFilter = (allowedTypes) => (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error("فرمت فایل مجاز نیست: " + ext));
    }
};

// آپلود پروفایل (تصویر فقط)
const uploadProfile = multer({
    storage,
    fileFilter: fileFilter([".jpg", ".jpeg", ".png"]),
    limits: { fileSize: 5 * 1024 * 1024 }, // حداکثر 5MB
}).single("profile");

// آپلود داکیومنت (PDF یا Word)
const uploadDocument = multer({
    storage,
    fileFilter: fileFilter([".pdf", ".doc", ".docx"]),
    limits: { fileSize: 10 * 1024 * 1024 }, // حداکثر 10MB
}).single("document");

// آپلود چند تصویر
const uploadMultipleImages = multer({
    storage,
    fileFilter: fileFilter([".jpg", ".jpeg", ".png"]),
    limits: { fileSize: 5 * 1024 * 1024 }, // حداکثر 5MB
}).array("images", 10); // حداکثر 10 تصویر

module.exports = {
    uploadProfile,
    uploadDocument,
    uploadMultipleImages,
};
