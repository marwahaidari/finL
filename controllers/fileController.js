const fs = require('fs');
const path = require('path');
const FileType = require('file-type'); // اضافه شده
const File = require('../models/file');

const ALLOWED_MIME_TYPES = [
    'image/png', 'image/jpg', 'image/jpeg',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'video/mp4',
    'application/zip'
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const fileController = {
    // 📌 آپلود فایل با اعتبارسنجی دقیق‌تر
    uploadFile: async (req, res) => {
        try {
            const { orderId } = req.params;
            const file = req.file;

            if (!file) {
                req.flash('error_msg', 'No file uploaded');
                return res.redirect(`/orders/${orderId}/files`);
            }

            if (file.size > MAX_FILE_SIZE) {
                fs.unlinkSync(file.path);
                req.flash('error_msg', 'File is too large (max 10MB)');
                return res.redirect(`/orders/${orderId}/files`);
            }

            // بررسی نوع فایل بر اساس محتوا نه فقط پسوند
            const buffer = fs.readFileSync(file.path);
            const fileType = await FileType.fromBuffer(buffer);
            if (!fileType || !ALLOWED_MIME_TYPES.includes(fileType.mime)) {
                fs.unlinkSync(file.path);
                req.flash('error_msg', 'Invalid file type');
                return res.redirect(`/orders/${orderId}/files`);
            }

            // دسته‌بندی فایل بر اساس MIME type به جای پسوند
            let category = 'other';
            if (fileType.mime.startsWith('image/')) category = 'image';
            else if (
                [
                    'application/pdf',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'text/plain'
                ].includes(fileType.mime)
            )
                category = 'document';
            else if (fileType.mime.startsWith('video/')) category = 'video';
            else if (fileType.mime === 'application/zip') category = 'archive';

            // سازمان‌دهی مسیر ذخیره فایل بر اساس تاریخ
            const uploadDir = path.join(__dirname, '..', 'uploads', 'files', new Date().toISOString().slice(0, 10));
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

            const newFilePath = path.join(uploadDir, file.filename);
            fs.renameSync(file.path, newFilePath);

            await File.create({
                orderId,
                userId: req.session.user.id,
                filename: file.originalname,
                filepath: newFilePath,
                mimetype: fileType.mime,
                size: file.size,
                category
            });

            req.flash('success_msg', 'File uploaded successfully');
            res.redirect(`/orders/${orderId}/files`);
        } catch (err) {
            console.error(err);
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            req.flash('error_msg', 'Error uploading file');
            res.redirect(`/orders/${req.params.orderId}/files`);
        }
    },

    // 📌 لیست فایل‌ها با Pagination و فیلتر برای کاربران غیر ادمین
    listFiles: async (req, res) => {
        try {
            const { orderId } = req.params;
            const page = parseInt(req.query.page) || 1;
            const search = req.query.search || '';
            const limit = 5;
            const offset = (page - 1) * limit;

            let files = await File.findByOrder(orderId, limit, offset, search);
            const totalFiles = await File.countByOrder(orderId, search);
            const totalPages = Math.ceil(totalFiles / limit);

            // فقط نمایش فایل‌های خود کاربر برای غیر ادمین
            if (req.session.user.role !== 'admin') {
                files = files.filter(f => f.user_id === req.session.user.id);
            }

            res.render('files', { orderId, files, page, totalPages, search });
        } catch (err) {
            console.error(err);
            res.status(500).send('Error fetching files');
        }
    },

    // 📌 دانلود فایل با بررسی دسترسی
    downloadFile: async (req, res) => {
        try {
            const file = await File.findById(req.params.id);
            if (!file) {
                req.flash('error_msg', 'File not found');
                return res.redirect('back');
            }
            if (req.session.user.role !== 'admin' && file.user_id !== req.session.user.id) {
                req.flash('error_msg', 'Unauthorized access');
                return res.redirect('back');
            }
            res.download(file.filepath, file.filename);
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error downloading file');
            res.redirect('back');
        }
    },

    // 📌 پیش‌نمایش فایل فقط برای PDF و تصاویر
    previewFile: async (req, res) => {
        try {
            const file = await File.findById(req.params.id);
            if (!file) {
                req.flash('error_msg', 'File not found');
                return res.redirect('back');
            }
            if (req.session.user.role !== 'admin' && file.user_id !== req.session.user.id) {
                req.flash('error_msg', 'Unauthorized access');
                return res.redirect('back');
            }
            if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
                res.setHeader('Content-Type', file.mimetype);
                fs.createReadStream(file.filepath).pipe(res);
            } else {
                req.flash('error_msg', 'Preview not supported for this file type');
                res.redirect('back');
            }
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error previewing file');
            res.redirect('back');
        }
    },

    // 📌 جایگزینی فایل با اعتبارسنجی کامل
    updateFile: async (req, res) => {
        try {
            const oldFile = await File.findById(req.params.id);
            if (!oldFile) {
                req.flash('error_msg', 'File not found');
                return res.redirect('back');
            }
            if (req.session.user.role !== 'admin' && oldFile.user_id !== req.session.user.id) {
                req.flash('error_msg', 'Unauthorized');
                return res.redirect('back');
            }

            const newFile = req.file;
            if (!newFile) {
                req.flash('error_msg', 'No new file uploaded');
                return res.redirect('back');
            }
            if (newFile.size > MAX_FILE_SIZE) {
                fs.unlinkSync(newFile.path);
                req.flash('error_msg', 'File too large');
                return res.redirect('back');
            }

            // اعتبارسنجی با file-type
            const buffer = fs.readFileSync(newFile.path);
            const fileType = await FileType.fromBuffer(buffer);
            if (!fileType || !ALLOWED_MIME_TYPES.includes(fileType.mime)) {
                fs.unlinkSync(newFile.path);
                req.flash('error_msg', 'Invalid file type');
                return res.redirect('back');
            }

            // حذف فایل قدیمی
            if (fs.existsSync(oldFile.filepath)) fs.unlinkSync(oldFile.filepath);

            // ذخیره فایل جدید در مسیر مرتب
            const uploadDir = path.join(__dirname, '..', 'uploads', 'files', new Date().toISOString().slice(0, 10));
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

            const newFilePath = path.join(uploadDir, newFile.filename);
            fs.renameSync(newFile.path, newFilePath);

            await File.update(req.params.id, {
                filename: newFile.originalname,
                filepath: newFilePath,
                mimetype: fileType.mime,
                size: newFile.size
            });

            req.flash('success_msg', 'File replaced successfully');
            res.redirect(`/orders/${oldFile.order_id}/files`);
        } catch (err) {
            console.error(err);
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            req.flash('error_msg', 'Error updating file');
            res.redirect('back');
        }
    },

    // 📌 آرشیو فایل
    archiveFile: async (req, res) => {
        try {
            const file = await File.findById(req.params.id);
            if (!file) {
                req.flash('error_msg', 'File not found');
                return res.redirect('back');
            }
            if (req.session.user.role !== 'admin' && file.user_id !== req.session.user.id) {
                req.flash('error_msg', 'Unauthorized');
                return res.redirect('back');
            }
            await File.archive(req.params.id);
            req.flash('success_msg', 'File archived');
            res.redirect('back');
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error archiving file');
            res.redirect('back');
        }
    },

    // 📌 حذف فایل به همراه حذف از فایل سیستم
    deleteFile: async (req, res) => {
        try {
            const file = await File.findById(req.params.id);
            if (!file) {
                req.flash('error_msg', 'File not found');
                return res.redirect('back');
            }
            if (req.session.user.role !== 'admin' && file.user_id !== req.session.user.id) {
                req.flash('error_msg', 'Unauthorized');
                return res.redirect('back');
            }
            if (fs.existsSync(file.filepath)) fs.unlinkSync(file.filepath);

            await File.delete(req.params.id);
            req.flash('success_msg', 'File deleted');
            res.redirect('back');
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error deleting file');
            res.redirect('back');
        }
    }
};

module.exports = fileController;
