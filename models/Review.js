const pool = require('../db');
const fs = require('fs');
const path = require('path');

class Review {
    // ایجاد ریویو جدید با فایل و نوتیفیکیشن
    static async create(orderId, userId, rating, comment, { attachments = [], isActive = true } = {}) {
        const result = await pool.query(
            `INSERT INTO reviews 
             (order_id, user_id, rating, comment, is_active, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING *`,
            [orderId, userId, rating, comment, isActive]
        );
        const review = result.rows[0];

        // ذخیره فایل‌ها
        if (attachments.length > 0) {
            await Promise.all(attachments.map(file =>
                pool.query(`INSERT INTO review_attachments (review_id, file_name, file_path) VALUES ($1, $2, $3)`,
                    [review.id, file.name, file.path])
            ));
        }

        // تاریخچه ایجاد ریویو
        await pool.query(
            `INSERT INTO review_history (review_id, action, changed_at) VALUES ($1, 'created', NOW())`,
            [review.id]
        );

        // نوتیفیکیشن به ادمین یا صاحب سفارش
        await pool.query(
            `INSERT INTO notifications (user_id, message, type, priority, read, is_active, created_at, updated_at)
             VALUES ((SELECT user_id FROM orders WHERE id=$1), $2, 'info', 'medium', FALSE, TRUE, NOW(), NOW())`,
            [orderId, `New review added for order #${orderId}`]
        );

        return review;
    }

    // گرفتن ریویوها با فیلترهای پیشرفته، Pagination و Sort
    static async findByOrder(orderId, {
        limit = 50,
        offset = 0,
        activeOnly = true,
        minRating = null,
        keyword = null,
        startDate = null,
        endDate = null,
        sortBy = 'created_at',    // فیلد مرتب‌سازی: created_at, rating و ...
        sortOrder = 'DESC'        // ASC یا DESC
    } = {}) {
        let query = `
            SELECT r.*, u.name AS user_name
            FROM reviews r
            JOIN users u ON r.user_id = u.id
            WHERE r.order_id = $1
        `;
        const params = [orderId];
        let idx = 2;

        if (activeOnly) {
            query += ` AND r.is_active = TRUE`;
        }
        if (minRating !== null) {
            query += ` AND r.rating >= $${idx++}`;
            params.push(minRating);
        }
        if (keyword) {
            query += ` AND r.comment ILIKE '%' || $${idx++} || '%'`;
            params.push(keyword);
        }
        if (startDate) {
            query += ` AND r.created_at >= $${idx++}`;
            params.push(startDate);
        }
        if (endDate) {
            query += ` AND r.created_at <= $${idx++}`;
            params.push(endDate);
        }

        // جلوگیری از SQL Injection در sortBy و sortOrder با whitelist ساده
        const allowedSortBy = ['created_at', 'rating'];
        const allowedSortOrder = ['ASC', 'DESC'];
        if (!allowedSortBy.includes(sortBy)) sortBy = 'created_at';
        if (!allowedSortOrder.includes(sortOrder.toUpperCase())) sortOrder = 'DESC';

        query += ` ORDER BY r.${sortBy} ${sortOrder} LIMIT $${idx++} OFFSET $${idx++}`;
        params.push(limit, offset);

        const result = await pool.query(query, params);
        return result.rows;
    }

    // همانند findByOrder ولی برای ریویوهای کاربر
    static async findByUser(userId, options = {}) {
        let query = `
            SELECT r.*, o.title AS order_title
            FROM reviews r
            JOIN orders o ON r.order_id = o.id
            WHERE r.user_id = $1
        `;
        const params = [userId];
        let idx = 2;

        if (options.activeOnly) {
            query += ` AND r.is_active = TRUE`;
        }
        if (options.minRating !== undefined && options.minRating !== null) {
            query += ` AND r.rating >= $${idx++}`;
            params.push(options.minRating);
        }
        if (options.keyword) {
            query += ` AND r.comment ILIKE '%' || $${idx++} || '%'`;
            params.push(options.keyword);
        }
        if (options.startDate) {
            query += ` AND r.created_at >= $${idx++}`;
            params.push(options.startDate);
        }
        if (options.endDate) {
            query += ` AND r.created_at <= $${idx++}`;
            params.push(options.endDate);
        }

        const allowedSortBy = ['created_at', 'rating'];
        const allowedSortOrder = ['ASC', 'DESC'];
        let sortBy = options.sortBy && allowedSortBy.includes(options.sortBy) ? options.sortBy : 'created_at';
        let sortOrder = options.sortOrder && allowedSortOrder.includes(options.sortOrder.toUpperCase()) ? options.sortOrder : 'DESC';

        query += ` ORDER BY r.${sortBy} ${sortOrder} LIMIT $${idx++} OFFSET $${idx++}`;
        params.push(options.limit || 50, options.offset || 0);

        const result = await pool.query(query, params);
        return result.rows;
    }

    // همان findById با اطلاعات کامل (ضمیمه‌ها و تاریخچه)
    static async findById(id, activeOnly = true) {
        const reviewResult = await pool.query(`
            SELECT r.*, u.name AS user_name, o.title AS order_title
            FROM reviews r
            JOIN users u ON r.user_id = u.id
            JOIN orders o ON r.order_id = o.id
            WHERE r.id = $1 ${activeOnly ? 'AND r.is_active = TRUE' : ''}
        `, [id]);
        const review = reviewResult.rows[0];
        if (!review) return null;

        const attachments = await pool.query(`SELECT file_name, file_path FROM review_attachments WHERE review_id = $1`, [id]);
        const history = await pool.query(`SELECT * FROM review_history WHERE review_id = $1 ORDER BY changed_at DESC`, [id]);

        review.attachments = attachments.rows;
        review.history = history.rows;

        return review;
    }

    // آپدیت ریویو با تاریخچه و مدیریت فایل‌ها
    static async update(id, userId, rating, comment, attachments = []) {
        const review = await this.findById(id);
        if (!review || review.user_id !== userId) throw new Error('Unauthorized or review not found');

        const result = await pool.query(
            `UPDATE reviews SET rating = $1, comment = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
            [rating, comment, id]
        );

        // بروزرسانی فایل‌ها
        const existingFiles = await pool.query(`SELECT * FROM review_attachments WHERE review_id = $1`, [id]);
        for (const file of existingFiles.rows) {
            const fullPath = path.join(__dirname, '..', file.file_path);
            if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
            }
        }
        await pool.query(`DELETE FROM review_attachments WHERE review_id = $1`, [id]);

        if (attachments.length > 0) {
            await Promise.all(attachments.map(file =>
                pool.query(`INSERT INTO review_attachments (review_id, file_name, file_path) VALUES ($1, $2, $3)`,
                    [id, file.name, file.path])
            ));
        }

        await pool.query(`INSERT INTO review_history (review_id, action, changed_at) VALUES ($1, 'updated', NOW())`, [id]);

        return result.rows[0];
    }

    // حذف نرم
    static async softDelete(id, userId) {
        const review = await this.findById(id);
        if (!review || review.user_id !== userId) throw new Error('Unauthorized or review not found');

        const result = await pool.query(
            `UPDATE reviews SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *`,
            [id]
        );
        await pool.query(`INSERT INTO review_history (review_id, action, changed_at) VALUES ($1, 'softDeleted', NOW())`, [id]);

        return result.rows[0];
    }
    // گرفتن همه ریویوها با فیلتر اختیاری
    static async findAll({
        userId = null,
        orderId = null,
        activeOnly = true,
        minRating = null,
        limit = 50,
        offset = 0,
        sortBy = 'created_at',
        sortOrder = 'DESC'
    } = {}) {
        try {
            let query = `
            SELECT r.*, u.name AS user_name, o.title AS order_title
            FROM reviews r
            JOIN users u ON r.user_id = u.id
            JOIN orders o ON r.order_id = o.id
            WHERE 1=1
        `;
            const params = [];
            let idx = 1;

            if (userId) {
                query += ` AND r.user_id = $${idx++}`;
                params.push(userId);
            }
            if (orderId) {
                query += ` AND r.order_id = $${idx++}`;
                params.push(orderId);
            }
            if (activeOnly) {
                query += ` AND r.is_active = TRUE`;
            }
            if (minRating) {
                query += ` AND r.rating >= $${idx++}`;
                params.push(minRating);
            }

            const allowedSortBy = ['created_at', 'rating'];
            const allowedSortOrder = ['ASC', 'DESC'];
            if (!allowedSortBy.includes(sortBy)) sortBy = 'created_at';
            if (!allowedSortOrder.includes(sortOrder.toUpperCase())) sortOrder = 'DESC';

            query += ` ORDER BY r.${sortBy} ${sortOrder} LIMIT $${idx++} OFFSET $${idx++}`;
            params.push(limit, offset);

            const result = await pool.query(query, params);
            return result.rows;
        } catch (err) {
            console.error('❌ Review.findAll error:', err);
            return [];
        }
    }

    // حذف کامل
    static async delete(id) {
        const attachments = await pool.query(`SELECT * FROM review_attachments WHERE review_id = $1`, [id]);
        for (const file of attachments.rows) {
            const fullPath = path.join(__dirname, '..', file.file_path);
            if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
            }
        }

        await pool.query(`DELETE FROM review_attachments WHERE review_id = $1`, [id]);
        await pool.query(`DELETE FROM reviews WHERE id = $1`, [id]);
        await pool.query(`INSERT INTO review_history (review_id, action, changed_at) VALUES ($1, 'deleted', NOW())`, [id]);
    }

    // میانگین امتیاز
    static async getAverageRating(orderId) {
        const result = await pool.query(`
            SELECT COALESCE(AVG(rating),0)::numeric(10,2) AS avg_rating 
            FROM reviews 
            WHERE order_id = $1 AND is_active = TRUE
        `, [orderId]);
        return parseFloat(result.rows[0].avg_rating);
    }

    static async getGlobalAverage(activeOnly = true) {
        const result = await pool.query(`
            SELECT COALESCE(AVG(rating),0)::numeric(10,2) AS avg_rating
            FROM reviews
            ${activeOnly ? 'WHERE is_active = TRUE' : ''}
        `);
        return parseFloat(result.rows[0].avg_rating);
    }

    // آمار پیشرفته
    static async stats(activeOnly = true) {
        const totalResult = await pool.query(`SELECT COUNT(*) AS total FROM reviews ${activeOnly ? 'WHERE is_active = TRUE' : ''}`);
        const avgResult = await pool.query(`SELECT COALESCE(AVG(rating),0)::numeric(10,2) AS avg_rating FROM reviews ${activeOnly ? 'WHERE is_active = TRUE' : ''}`);
        return {
            total: parseInt(totalResult.rows[0].total, 10),
            avgRating: parseFloat(avgResult.rows[0].avg_rating),
        };
    }

    // تعداد ریویوها
    static async count(activeOnly = true) {
        const query = `SELECT COUNT(*) AS total FROM reviews ${activeOnly ? 'WHERE is_active = TRUE' : ''}`;
        const result = await pool.query(query);
        return parseInt(result.rows[0].total, 10);
    }
}

module.exports = Review;
