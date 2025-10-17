const pool = require('../db');
const path = require('path');
const fs = require('fs').promises;  // از ورژن promise دار استفاده میکنیم
const crypto = require('crypto');

class File {
    // مسیر آپلود پیشفرض (می‌تونی تو ENV هم قرار بدی)
    static uploadDir = process.env.FILE_UPLOAD_DIR || 'uploads/files';

    static allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png', 'text/plain'];
    static maxFileSize = 10 * 1024 * 1024; // 10MB

    // ===============================
    // ساخت پوشه آپلود در صورت نبود
    // ===============================
    static async ensureUploadDir() {
        try {
            await fs.mkdir(this.uploadDir, { recursive: true });
        } catch (err) {
            if (err.code !== 'EEXIST') {
                throw new Error('Failed to create upload directory.');
            }
        }
    }

    // ===============================
    // ساخت نام امن و یکتا برای فایل
    // ===============================
    static generateSafeFilename(originalName) {
        const ext = path.extname(originalName);
        const base = path.basename(originalName, ext).replace(/[^a-z0-9_\-]/gi, '_').toLowerCase();
        const uniqueSuffix = crypto.randomBytes(6).toString('hex');
        return `${base}_${uniqueSuffix}${ext}`;
    }

    // ===============================
    // ایجاد فایل جدید با اعتبارسنجی
    // filepath: مسیر نهایی فایل روی سیستم (بعد از ذخیره شدن)
    // ===============================
    static async create(orderId, originalFilename, filepath, mimeType, size, isActive = true) {
        if (!this.allowedMimeTypes.includes(mimeType)) {
            throw new Error('Invalid file type.');
        }
        if (size > this.maxFileSize) {
            throw new Error('File size exceeds maximum limit.');
        }

        const safeFilename = this.generateSafeFilename(originalFilename);
        await this.ensureUploadDir();

        // مطمئن شو که فایل در مسیر filepath ذخیره شده، در غیر اینصورت اینجا ذخیره‌سازی انجام نمیشه و خطا میده
        // فرض می‌کنیم ذخیره‌سازی فایل خارج از این کلاس انجام شده و فقط مسیر درست به اینجا پاس داده میشه

        const result = await pool.query(
            `INSERT INTO files 
             (order_id, filename, filepath, mime_type, size, is_active, uploaded_at, updated_at) 
             VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW()) 
             RETURNING *`,
            [orderId, safeFilename, filepath, mimeType, size, isActive]
        );

        const file = result.rows[0];

        await pool.query(
            `INSERT INTO file_history (file_id, action, changed_at) VALUES ($1, 'created', NOW())`,
            [file.id]
        );

        return file;
    }

    // ===============================
    // آپلود فایل از بافر (مثل فایل آپلود شده در Express)
    // fileBuffer: Buffer فایل، originalFilename: نام فایل اصلی
    // ===============================
    static async uploadFromBuffer(orderId, fileBuffer, originalFilename, mimeType, isActive = true) {
        if (!this.allowedMimeTypes.includes(mimeType)) {
            throw new Error('Invalid file type.');
        }
        if (fileBuffer.length > this.maxFileSize) {
            throw new Error('File size exceeds maximum limit.');
        }

        await this.ensureUploadDir();

        const safeFilename = this.generateSafeFilename(originalFilename);
        const filepath = path.join(this.uploadDir, safeFilename);

        // ذخیره فایل روی دیسک
        await fs.writeFile(filepath, fileBuffer);

        // ذخیره اطلاعات در دیتابیس
        const file = await this.create(orderId, originalFilename, filepath, mimeType, fileBuffer.length, isActive);

        return file;
    }

    // ===============================
    // گرفتن فایل‌های یک سفارش با pagination
    // ===============================
    static async findByOrder(orderId, { limit = 50, offset = 0, activeOnly = true } = {}) {
        let query = `SELECT id, filename, filepath, mimetype, size, uploaded_at FROM files WHERE order_id = $1`;
        const params = [orderId];
        if (activeOnly) query += ' AND is_active = TRUE';
        query += ' ORDER BY uploaded_at DESC LIMIT $2 OFFSET $3';
        params.push(limit, offset);
        const result = await pool.query(query, params);
        return result.rows;
    }

    // ===============================
    // گرفتن یک فایل بر اساس ID
    // ===============================
    static async findById(id, activeOnly = true) {
        let query = `SELECT * FROM files WHERE id = $1`;
        const params = [id];
        if (activeOnly) query += ' AND is_active = TRUE';
        const result = await pool.query(query, params);
        return result.rows[0];
    }

    // ===============================
    // دانلود فایل به صورت Buffer
    // ===============================
    static async downloadFile(id) {
        const file = await this.findById(id);
        if (!file) throw new Error('File not found.');

        try {
            const data = await fs.readFile(file.filepath);
            return { data, filename: file.filename, mimeType: file.mime_type };
        } catch (err) {
            throw new Error('Failed to read file from disk.');
        }
    }

    // ===============================
    // بروزرسانی نام یا مسیر فایل
    // ===============================
    static async update(id, newFilename, newFilepath) {
        const safeFilename = this.generateSafeFilename(newFilename);
        const result = await pool.query(
            `UPDATE files
             SET filename = $1, filepath = $2, updated_at = NOW()
             WHERE id = $3 AND is_active = TRUE
             RETURNING *`,
            [safeFilename, newFilepath, id]
        );

        if (result.rows.length === 0) {
            throw new Error('File not found or inactive.');
        }

        await pool.query(
            `INSERT INTO file_history (file_id, action, changed_at) VALUES ($1, 'updated', NOW())`,
            [id]
        );

        return result.rows[0];
    }

    // ===============================
    // حذف نرم (Soft delete)
    // ===============================
    static async softDelete(id) {
        const result = await pool.query(
            `UPDATE files
             SET is_active = FALSE, updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [id]
        );

        if (result.rows.length === 0) {
            throw new Error('File not found.');
        }

        await pool.query(
            `INSERT INTO file_history (file_id, action, changed_at) VALUES ($1, 'softDeleted', NOW())`,
            [id]
        );

        return result.rows[0];
    }

    // ===============================
    // حذف کامل فایل
    // ===============================
    static async delete(id) {
        const file = await this.findById(id, false);
        if (!file) throw new Error('File not found.');

        try {
            // حذف فایل از دیسک
            await fs.unlink(file.filepath);
        } catch (err) {
            // اگر فایل فیزیکی نبود، نادیده بگیر (شاید قبلاً حذف شده)
        }

        await pool.query('DELETE FROM files WHERE id = $1', [id]);
        await pool.query(
            `INSERT INTO file_history (file_id, action, changed_at) VALUES ($1, 'deleted', NOW())`,
            [id]
        );
    }

    // ===============================
    // تعداد فایل‌های یک سفارش
    // ===============================
    static async countByOrder(orderId, activeOnly = true) {
        let query = `SELECT COUNT(*) AS total FROM files WHERE order_id = $1`;
        const params = [orderId];
        if (activeOnly) query += ' AND is_active = TRUE';
        const result = await pool.query(query, params);
        return parseInt(result.rows[0].total, 10);
    }

    // ===============================
    // گرفتن آخرین فایل آپلود شده
    // ===============================
    static async findLastByOrder(orderId, activeOnly = true) {
        let query = `SELECT id, filename, filepath, mime_type, size, uploaded_at FROM files WHERE order_id = $1`;
        const params = [orderId];
        if (activeOnly) query += ' AND is_active = TRUE';
        query += ' ORDER BY uploaded_at DESC LIMIT 1';
        const result = await pool.query(query, params);
        return result.rows[0];
    }

    // ===============================
    // پاکسازی فایل‌های غیر فعال و قدیمی
    // (فایل‌هایی که به مدت مشخصی فعال نبوده‌اند)
    // ===============================
    static async cleanOldInactiveFiles(days = 30) {
        const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        // پیدا کردن فایل‌های غیر فعال قدیمی
        const result = await pool.query(
            `SELECT id, filepath FROM files WHERE is_active = FALSE AND updated_at < $1`,
            [cutoffDate]
        );

        for (const file of result.rows) {
            try {
                await fs.unlink(file.filepath);
            } catch (err) {
                // نادیده گرفتن خطاهای حذف فایل
            }
            await pool.query('DELETE FROM files WHERE id = $1', [file.id]);
            await pool.query(
                `INSERT INTO file_history (file_id, action, changed_at) VALUES ($1, 'deleted_by_cleanup', NOW())`,
                [file.id]
            );
        }
    }
}

module.exports = File;
