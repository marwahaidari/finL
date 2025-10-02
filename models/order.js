const pool = require('../db');
const fs = require('fs');
const path = require('path');

class Order {
    // ===============================
    // ایجاد سفارش جدید با برچسب، دسته‌بندی، اولویت، ETA و فایل‌ها
    // ===============================
    static async create(userId, title, description, { tags = [], department = null, attachments = [], priority = 'normal', eta = null } = {}) {
        const result = await pool.query(
            `INSERT INTO orders 
             (user_id, title, description, status, paid, department, priority, eta, is_active, created_at, updated_at) 
             VALUES ($1, $2, $3, 'pending', FALSE, $4, $5, $6, TRUE, NOW(), NOW()) RETURNING *`,
            [userId, title, description, department, priority, eta]
        );
        const order = result.rows[0];

        // ذخیره برچسب‌ها
        if (tags.length > 0) {
            await Promise.all(tags.map(tag =>
                pool.query(`INSERT INTO order_tags (order_id, tag) VALUES ($1, $2)`, [order.id, tag])
            ));
        }

        // ذخیره فایل‌ها
        if (attachments.length > 0) {
            await Promise.all(attachments.map(file =>
                pool.query(`INSERT INTO order_attachments (order_id, file_name, file_path) VALUES ($1, $2, $3)`,
                    [order.id, file.name, file.path])
            ));
        }

        // تاریخچه ایجاد سفارش
        await pool.query(`INSERT INTO order_history (order_id, action, changed_at) VALUES ($1, 'created', NOW())`, [order.id]);

        return order;
    }

    // ===============================
    // گرفتن سفارش‌ها با فیلتر پیشرفته، اولویت و Pagination
    // ===============================
    static async findAll({ limit = 50, offset = 0, status = null, paid = null, department = null, tag = null, priority = null } = {}) {
        let query = `
            SELECT o.*, u.name AS user_name, COALESCE(AVG(r.rating),0)::numeric(10,2) AS avg_rating
            FROM orders o
            LEFT JOIN users u ON o.user_id = u.id
            LEFT JOIN reviews r ON o.id = r.order_id AND r.is_active = TRUE
            LEFT JOIN order_tags t ON o.id = t.order_id
            WHERE o.is_active = TRUE
        `;
        const params = [];
        let idx = 1;

        if (status) { query += ` AND o.status = $${idx++}`; params.push(status); }
        if (paid !== null) { query += ` AND o.paid = $${idx++}`; params.push(paid); }
        if (department) { query += ` AND o.department = $${idx++}`; params.push(department); }
        if (tag) { query += ` AND t.tag = $${idx++}`; params.push(tag); }
        if (priority) { query += ` AND o.priority = $${idx++}`; params.push(priority); }

        query += `
            GROUP BY o.id, u.name
            ORDER BY o.created_at DESC
            LIMIT $${idx++} OFFSET $${idx++}
        `;
        params.push(limit, offset);

        const result = await pool.query(query, params);
        return result.rows;
    }

    // ===============================
    // گرفتن سفارش توسط ID همراه با فایل‌ها، تاریخچه، کامنت‌ها و امتیازها
    // ===============================
    static async findById(id) {
        const orderResult = await pool.query(`
            SELECT o.*, u.name AS user_name, COALESCE(AVG(r.rating),0)::numeric(10,2) AS avg_rating
            FROM orders o
            LEFT JOIN users u ON o.user_id = u.id
            LEFT JOIN reviews r ON o.id = r.order_id AND r.is_active = TRUE
            WHERE o.id = $1 AND o.is_active = TRUE
            GROUP BY o.id, u.name
        `, [id]);

        const order = orderResult.rows[0];
        if (!order) return null;

        const [attachments, history, comments, ratings] = await Promise.all([
            pool.query(`SELECT file_name, file_path FROM order_attachments WHERE order_id = $1`, [id]),
            pool.query(`SELECT * FROM order_history WHERE order_id = $1 ORDER BY changed_at DESC`, [id]),
            pool.query(`
                SELECT c.id, c.user_id, u.name AS user_name, c.comment, c.created_at 
                FROM order_comments c 
                LEFT JOIN users u ON c.user_id = u.id
                WHERE c.order_id = $1 ORDER BY c.created_at DESC`, [id]),
            pool.query(`SELECT user_id, rating, comment FROM order_ratings WHERE order_id = $1`, [id]),
        ]);

        order.attachments = attachments.rows;
        order.history = history.rows;
        order.comments = comments.rows;
        order.ratings = ratings.rows;

        return order;
    }

    // ===============================
    // آپدیت سفارش با برچسب، فایل‌ها، اولویت و ETA
    // ===============================
    static async update(id, { title, description, tags = [], department = null, attachments = [], priority = null, eta = null } = {}) {
        const result = await pool.query(`
            UPDATE orders
            SET title = $1, description = $2, department = COALESCE($3, department),
                priority = COALESCE($4, priority), eta = COALESCE($5, eta),
                updated_at = NOW()
            WHERE id = $6 AND is_active = TRUE
            RETURNING *`,
            [title, description, department, priority, eta, id]
        );
        const order = result.rows[0];

        // بروزرسانی برچسب‌ها
        await pool.query(`DELETE FROM order_tags WHERE order_id = $1`, [id]);
        if (tags.length > 0) {
            await Promise.all(tags.map(tag =>
                pool.query(`INSERT INTO order_tags (order_id, tag) VALUES ($1, $2)`, [id, tag])
            ));
        }

        // بروزرسانی فایل‌ها (حذف فایل‌های قدیمی و ذخیره فایل‌های جدید)
        const existingFiles = await pool.query(`SELECT * FROM order_attachments WHERE order_id = $1`, [id]);
        for (const file of existingFiles.rows) {
            const fullPath = path.join(__dirname, '..', file.file_path);
            if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
            }
        }
        await pool.query(`DELETE FROM order_attachments WHERE order_id = $1`, [id]);
        if (attachments.length > 0) {
            await Promise.all(attachments.map(file =>
                pool.query(`INSERT INTO order_attachments (order_id, file_name, file_path) VALUES ($1, $2, $3)`,
                    [id, file.name, file.path])
            ));
        }

        await pool.query(`INSERT INTO order_history (order_id, action, changed_at) VALUES ($1, 'updated', NOW())`, [id]);

        return order;
    }

    // ===============================
    // تغییر وضعیت با تاریخچه و نوتیفیکیشن به چند کاربر (مثلا کاربر + تیم پشتیبانی)
    // ===============================
    static async updateStatus(id, status, notify = true) {
        const result = await pool.query(`
            UPDATE orders
            SET status = $1, updated_at = NOW()
            WHERE id = $2 AND is_active = TRUE
            RETURNING *`,
            [status, id]
        );

        await pool.query(`INSERT INTO order_status_history (order_id, status, changed_at) VALUES ($1, $2, NOW())`, [id, status]);
        await pool.query(`INSERT INTO order_history (order_id, action, changed_at) VALUES ($1, 'status:${status}', NOW())`, [id]);

        if (notify) {
            // ارسال نوتیفیکیشن به کاربر سفارش و تیم پشتیبانی (مثلا user_id های تیم پشتیبانی داخل یک جدول team_members)
            // فرض: team_members جدول با user_id های اعضای تیم پشتیبانی
            const orderUser = await pool.query(`SELECT user_id FROM orders WHERE id = $1`, [id]);
            const userId = orderUser.rows[0].user_id;

            // ارسال به کاربر سفارش
            await pool.query(`
                INSERT INTO notifications (user_id, message, type, is_active, created_at, updated_at)
                VALUES ($1, $2, 'info', TRUE, NOW(), NOW())
            `, [userId, `Your order status changed to ${status}`]);

            // ارسال به تیم پشتیبانی
            const supportTeam = await pool.query(`SELECT user_id FROM team_members WHERE team_name = 'support'`);
            if (supportTeam.rows.length > 0) {
                await Promise.all(supportTeam.rows.map(member =>
                    pool.query(`
                        INSERT INTO notifications (user_id, message, type, is_active, created_at, updated_at)
                        VALUES ($1, $2, 'info', TRUE, NOW(), NOW())
                    `, [member.user_id, `Order #${id} status changed to ${status}`])
                ));
            }
        }

        return result.rows[0];
    }

    // ===============================
    // پرداخت پیشرفته با تاریخچه
    // ===============================
    static async pay(id, { amount = 0, method = 'online' } = {}) {
        const result = await pool.query(`
            UPDATE orders
            SET paid = TRUE, updated_at = NOW()
            WHERE id = $1 AND is_active = TRUE
            RETURNING *`,
            [id]
        );

        await pool.query(`INSERT INTO order_payment_history (order_id, amount, method, paid_at) VALUES ($1, $2, $3, NOW())`,
            [id, amount, method]
        );

        await pool.query(`INSERT INTO order_history (order_id, action, changed_at) VALUES ($1, 'paid', NOW())`, [id]);

        return result.rows[0];
    }

    // ===============================
    // اضافه کردن کامنت جدید به سفارش
    // ===============================
    static async addComment(orderId, userId, comment) {
        const result = await pool.query(`
            INSERT INTO order_comments (order_id, user_id, comment, created_at)
            VALUES ($1, $2, $3, NOW()) RETURNING *`,
            [orderId, userId, comment]
        );
        return result.rows[0];
    }

    // ===============================
    // ثبت امتیاز به سفارش
    // ===============================
    static async rateOrder(orderId, userId, rating, comment = null) {
        // در صورت وجود امتیاز قبلی، آپدیت کن
        const existing = await pool.query(`SELECT * FROM order_ratings WHERE order_id = $1 AND user_id = $2`, [orderId, userId]);
        if (existing.rows.length > 0) {
            const result = await pool.query(`
                UPDATE order_ratings
                SET rating = $1, comment = $2, updated_at = NOW()
                WHERE order_id = $3 AND user_id = $4
                RETURNING *`,
                [rating, comment, orderId, userId]
            );
            return result.rows[0];
        } else {
            const result = await pool.query(`
                INSERT INTO order_ratings (order_id, user_id, rating, comment, created_at)
                VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
                [orderId, userId, rating, comment]
            );
            return result.rows[0];
        }
    }

    // ===============================
    // حذف نرم (غیرفعال سازی)
    // ===============================
    static async softDelete(id) {
        await pool.query(`UPDATE orders SET is_active = FALSE, updated_at = NOW() WHERE id = $1`, [id]);
        await pool.query(`INSERT INTO order_history (order_id, action, changed_at) VALUES ($1, 'soft_deleted', NOW())`, [id]);
    }

    // ===============================
    // حذف کامل همراه با حذف فایل‌ها و تاریخچه
    // ===============================
    static async hardDelete(id) {
        // حذف فایل‌ها از سرور
        const files = await pool.query(`SELECT * FROM order_attachments WHERE order_id = $1`, [id]);
        for (const file of files.rows) {
            const fullPath = path.join(__dirname, '..', file.file_path);
            if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
            }
        }

        await pool.query(`DELETE FROM order_attachments WHERE order_id = $1`, [id]);
        await pool.query(`DELETE FROM order_tags WHERE order_id = $1`, [id]);
        await pool.query(`DELETE FROM order_history WHERE order_id = $1`, [id]);
        await pool.query(`DELETE FROM order_status_history WHERE order_id = $1`, [id]);
        await pool.query(`DELETE FROM order_comments WHERE order_id = $1`, [id]);
        await pool.query(`DELETE FROM order_ratings WHERE order_id = $1`, [id]);
        await pool.query(`DELETE FROM order_payment_history WHERE order_id = $1`, [id]);
        await pool.query(`DELETE FROM orders WHERE id = $1`, [id]);
    }

    // ===============================
    // گزارش کلی (آمار و مجموع پرداخت)
    // ===============================
    static async getReport() {
        const result = await pool.query(`
            SELECT
                COUNT(*) AS total_orders,
                COUNT(*) FILTER (WHERE paid = TRUE) AS paid_orders,
                COUNT(*) FILTER (WHERE status = 'pending') AS pending_orders,
                COUNT(*) FILTER (WHERE status = 'completed') AS completed_orders,
                COUNT(*) FILTER (WHERE status = 'canceled') AS canceled_orders,
                COALESCE(SUM(p.amount), 0) AS total_paid_amount
            FROM orders o
            LEFT JOIN order_payment_history p ON o.id = p.order_id
            WHERE o.is_active = TRUE
        `);
        return result.rows[0];
    }
    // ===============================
    // شمارش کل سفارش‌ها
    // ===============================
    static async count() {
        const result = await pool.query(`SELECT COUNT(*) FROM orders WHERE is_active = TRUE`);
        return parseInt(result.rows[0].count, 10);
    }

    // ===============================
    // شمارش بر اساس وضعیت
    // ===============================
    static async countByStatus(status) {
        const result = await pool.query(`SELECT COUNT(*) FROM orders WHERE status = $1 AND is_active = TRUE`, [status]);
        return parseInt(result.rows[0].count, 10);
    }

    // ===============================
    // آخرین سفارش‌ها برای داشبورد
    // ===============================
    static async findRecent(limit = 5) {
        const result = await pool.query(`
            SELECT id, title, status, created_at 
            FROM orders 
            WHERE is_active = TRUE 
            ORDER BY created_at DESC 
            LIMIT $1
        `, [limit]);
        return result.rows;
    }

}

module.exports = Order;
