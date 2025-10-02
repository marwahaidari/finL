// controllers/backupController.js
const Backup = require('../utils/Backup');

const backupController = {
    // ===============================
    // بکاپ دیتابیس با آپشن‌ها
    // ===============================
    createDatabaseBackup: async (req, res) => {
        try {
            const options = req.body.options || {};
            const result = await Backup.backupDatabase(options.filename, options);
            res.json({ message: "✅ بکاپ دیتابیس با موفقیت گرفته شد", file: result.file });
        } catch (err) {
            console.error("❌ Database Backup Error:", err);
            res.status(500).json({ error: "خطا در بکاپ دیتابیس" });
        }
    },

    // ===============================
    // بکاپ فایل‌ها با آرایه فولدرها
    // ===============================
    createFilesBackup: async (req, res) => {
        try {
            const folders = req.body.folders || ['uploads', 'documents'];
            const options = req.body.options || {};
            const result = await Backup.backupFiles(folders, options.filename);
            res.json({ message: "✅ بکاپ فایل‌ها با موفقیت گرفته شد", file: result.file });
        } catch (err) {
            console.error("❌ Files Backup Error:", err);
            res.status(500).json({ error: "خطا در بکاپ فایل‌ها" });
        }
    },

    // ===============================
    // ریستور دیتابیس
    // ===============================
    restoreDatabase: async (req, res) => {
        try {
            const { filePath } = req.body;
            if (!filePath) return res.status(400).json({ error: "مسیر فایل الزامی است" });

            await Backup.restoreDatabase(filePath);
            res.json({ message: "✅ ریستور دیتابیس موفقیت‌آمیز بود", file: filePath });
        } catch (err) {
            console.error("❌ Restore Error:", err);
            res.status(500).json({ error: "خطا در ریستور دیتابیس" });
        }
    },

    // ===============================
    // اجرای بکاپ زمان‌بندی‌شده
    // ===============================
    runScheduledBackup: async (req, res) => {
        try {
            await Backup.scheduledBackup();
            res.json({ message: "✅ بکاپ زمان‌بندی‌شده اجرا شد" });
        } catch (err) {
            console.error("❌ Scheduled Backup Error:", err);
            res.status(500).json({ error: "خطا در اجرای بکاپ زمان‌بندی‌شده" });
        }
    },

    // ===============================
    // نمایش تاریخچه بکاپ‌ها
    // ===============================
    getBackupHistory: async (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 50;
            const offset = parseInt(req.query.offset) || 0;
            const history = await Backup.getHistory(limit, offset);
            res.json(history);
        } catch (err) {
            console.error("❌ Fetch History Error:", err);
            res.status(500).json({ error: "خطا در دریافت تاریخچه بکاپ‌ها" });
        }
    }
};

module.exports = backupController;
