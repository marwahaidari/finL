// db/files.js
const { query } = require('./index');
const path = require('path');
const fs = require('fs');

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.pdf', '.docx', '.xlsx', '.zip'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const File = {
    // 📌 ایجاد رکورد فایل
    async create({ orderId = null, userId = null, filename, filepath, mimetype, size }) {
        const ext = path.extname(filename).toLowerCase();

        if (!ALLOWED_EXTENSIONS.includes(ext)) {
            if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
            throw new Error('Invalid file type');
        }

        if (size > MAX_FILE_SIZE) {
            if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
            throw new Error('File too large');
        }

        const res = await query(
            `INSERT INTO files (order_id, user_id, filename, filepath, mimetype, size, uploaded_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             RETURNING *`,
            [orderId, userId, filename, filepath, mimetype, size]
        );
        return res.rows[0];
    },

    // 📌 گرفتن فایل با id
    async findById(id) {
        const res = await query('SELECT * FROM files WHERE id=$1', [id]);
        return res.rows[0];
    },

    // 📌 فایل‌های یک سفارش
    async findByOrder(orderId, limit = 20, offset = 0) {
        const res = await query(
            'SELECT * FROM files WHERE order_id=$1 ORDER BY uploaded_at DESC LIMIT $2 OFFSET $3',
            [orderId, limit, offset]
        );
        return res.rows;
    },

    // 📌 فایل‌های یک کاربر
    async findByUser(userId, limit = 20, offset = 0) {
        const res = await query(
            'SELECT * FROM files WHERE user_id=$1 ORDER BY uploaded_at DESC LIMIT $2 OFFSET $3',
            [userId, limit, offset]
        );
        return res.rows;
    },

    // 📌 بروزرسانی متادیتا (تغییر نام فایل)
    async updateMeta(id, newName) {
        const res = await query(
            `UPDATE files SET filename=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
            [newName, id]
        );
        return res.rows[0];
    },

    // 📌 حذف فایل
    async delete(id) {
        const file = await File.findById(id);
        if (!file) throw new Error('File not found');

        try {
            if (fs.existsSync(file.filepath)) {
                fs.unlinkSync(file.filepath);
            }
        } catch (err) {
            console.error('File delete error:', err.message);
        }

        await query('DELETE FROM files WHERE id=$1', [id]);
        return true;
    },

    // 📌 لیست همه فایل‌ها (برای ادمین)
    async findAll(limit = 50, offset = 0) {
        const res = await query(
            `SELECT * FROM files ORDER BY uploaded_at DESC LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
        return res.rows;
    },

    // 📌 شمارش کل فایل‌ها
    async countAll() {
        const res = await query('SELECT COUNT(*) FROM files');
        return parseInt(res.rows[0].count);
    },

    // 📌 جستجو در فایل‌ها
    async search(keyword, limit = 20, offset = 0) {
        const res = await query(
            `SELECT * FROM files 
             WHERE filename ILIKE $1 OR mimetype ILIKE $1
             ORDER BY uploaded_at DESC
             LIMIT $2 OFFSET $3`,
            [`%${keyword}%`, limit, offset]
        );
        return res.rows;
    },

    // 📌 آمار فایل‌ها براساس نوع
    async statsByType() {
        const res = await query(
            `SELECT mimetype, COUNT(*) as count, SUM(size) as total_size
             FROM files
             GROUP BY mimetype
             ORDER BY count DESC`
        );
        return res.rows;
    }
};

module.exports = File;
