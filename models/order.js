const pool = require('../db');
const fs = require('fs');
const path = require('path');

class Order {
    // ایجاد سفارش جدید
    static async create(userId, title, description, { tags = [], department = null, attachments = [], priority = 'normal', eta = null } = {}) {
        const result = await pool.query(
            `INSERT INTO orders 
            (user_id, title, description, status, paid, department, priority, eta, is_active, created_at, updated_at) 
            VALUES ($1, $2, $3, 'pending', FALSE, $4, $5, $6, TRUE, NOW(), NOW()) RETURNING *`,
            [userId, title, description, department, priority, eta]
        );
        const order = result.rows[0];

        if (tags.length > 0) {
            await Promise.all(tags.map(tag =>
                pool.query(`INSERT INTO order_tags (order_id, tag) VALUES ($1, $2)`, [order.id, tag])
            ));
        }

        if (attachments.length > 0) {
            await Promise.all(attachments.map(file =>
                pool.query(`INSERT INTO order_attachments (order_id, file_name, file_path) VALUES ($1, $2, $3)`, [order.id, file.name, file.path])
            ));
        }

        await pool.query(`INSERT INTO order_history (order_id, action, changed_at) VALUES ($1, 'created', NOW())`, [order.id]);

        return order;
    }

    // عمومی: گرفتن سفارش‌ها با فیلتر
    static async findAll({ limit = 50, offset = 0, status = null, paid = null, department = null, tag = null, priority = null } = {}) {
        let query = `
            SELECT o.*, u.name AS user_name, COALESCE(AVG(r.rating),0)::numeric(10,2) AS avg_rating
            FROM orders o
            LEFT JOIN users u ON o.user_id = u.id
            LEFT JOIN reviews r ON o.id = r.order_id
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

        query += ` GROUP BY o.id, u.name ORDER BY o.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
        params.push(limit, offset);

        const result = await pool.query(query, params);
        return result.rows;
    }

    // findById (یک نسخه واحد، کامل، view-friendly)
    static async findById(id) {
        const orderResult = await pool.query(`
            SELECT o.*, u.name AS user_name, COALESCE(AVG(r.rating),0)::numeric(10,2) AS avg_rating
            FROM orders o
            LEFT JOIN users u ON o.user_id = u.id
            LEFT JOIN order_ratings r ON o.id = r.order_id AND r.is_active = TRUE
            WHERE o.id = $1 AND o.is_active = TRUE
            GROUP BY o.id, u.name
        `, [id]);

        const order = orderResult.rows[0];
        if (!order) return null;

        const [attachmentsRes, historyRes, commentsRes, ratingsRes] = await Promise.all([
            pool.query(`SELECT id, file_name AS filename, file_path AS filepath FROM order_attachments WHERE order_id = $1 AND is_active = TRUE`, [id]),
            pool.query(`SELECT action AS status, changed_at AS date FROM order_history WHERE order_id = $1 ORDER BY changed_at DESC`, [id]),
            pool.query(`
                SELECT c.id, c.user_id, u.name AS user_name, c.comment, c.created_at 
                FROM order_comments c 
                LEFT JOIN users u ON c.user_id = u.id
                WHERE c.order_id = $1 ORDER BY c.created_at DESC`, [id]),
            pool.query(`SELECT r.user_id, r.rating, r.comment, u.name AS username FROM order_ratings r LEFT JOIN users u ON r.user_id = u.id WHERE r.order_id = $1`, [id])
        ]);

        order.attachments = attachmentsRes.rows.map(f => ({
            id: f.id,
            filename: f.filename,
            filepath: f.filepath,
            originalname: f.filename
        }));

        order.history = historyRes.rows.map(h => ({ status: h.status, date: h.date }));
        order.comments = commentsRes.rows;
        order.reviews = ratingsRes.rows.map(r => ({ username: r.username || `کاربر ${r.user_id}`, rating: r.rating, comment: r.comment }));

        return order;
    }

    // getReport (ساده و ایمن)
    static async getReport() {
        const result = await pool.query(`
            SELECT
                COUNT(*)::int AS total_orders,
                COUNT(*) FILTER (WHERE paid = TRUE)::int AS paid_orders,
                COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_orders,
                COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_orders,
                COUNT(*) FILTER (WHERE status = 'canceled')::int AS canceled_orders
            FROM orders o
            WHERE o.is_active = TRUE
        `);
        const row = result.rows[0];
        return {
            total_orders: parseInt(row.total_orders || 0, 10),
            paid_orders: parseInt(row.paid_orders || 0, 10),
            pending_orders: parseInt(row.pending_orders || 0, 10),
            completed_orders: parseInt(row.completed_orders || 0, 10),
            total_paid_amount: 0
        };
    }

    // pay
    static async pay(id, { amount = 0, method = 'online' } = {}) {
        const result = await pool.query(`
            UPDATE orders SET paid = TRUE, updated_at = NOW() WHERE id = $1 AND is_active = TRUE RETURNING *
        `, [id]);

        await pool.query(`INSERT INTO order_payment_history (order_id, amount, method, paid_at) VALUES ($1, $2, $3, NOW())`, [id, amount, method]);
        await pool.query(`INSERT INTO order_history (order_id, action, changed_at) VALUES ($1, 'paid', NOW())`, [id]);

        return result.rows[0];
    }

    // update
    static async update(id, { title, description, tags = [], department = null, attachments = [], priority = null, eta = null, status = null } = {}) {
        const result = await pool.query(`
            UPDATE orders
            SET title = $1, description = $2, department = COALESCE($3, department),
                priority = COALESCE($4, priority), eta = COALESCE($5, eta),
                status = COALESCE($6, status), updated_at = NOW()
            WHERE id = $7 AND is_active = TRUE
            RETURNING *
        `, [title, description, department, priority, eta, status, id]);
        const order = result.rows[0];

        // tags
        await pool.query(`DELETE FROM order_tags WHERE order_id = $1`, [id]);
        if (tags.length > 0) {
            await Promise.all(tags.map(tag => pool.query(`INSERT INTO order_tags (order_id, tag) VALUES ($1, $2)`, [id, tag])));
        }

        // attachments: حذف قدیمی و اضافه فایل‌های جدید
        const existingFiles = await pool.query(`SELECT * FROM order_attachments WHERE order_id = $1`, [id]);
        for (const file of existingFiles.rows) {
            const fullPath = path.join(__dirname, '..', file.file_path || file.filepath || '');
            if (fullPath && fs.existsSync(fullPath)) {
                try { fs.unlinkSync(fullPath); } catch (e) { /* ignore */ }
            }
        }
        await pool.query(`DELETE FROM order_attachments WHERE order_id = $1`, [id]);
        if (attachments.length > 0) {
            await Promise.all(attachments.map(file => pool.query(`INSERT INTO order_attachments (order_id, file_name, file_path) VALUES ($1, $2, $3)`, [id, file.name, file.path])));
        }

        await pool.query(`INSERT INTO order_history (order_id, action, changed_at) VALUES ($1, 'updated', NOW())`, [id]);

        return order;
    }

    // comment
    static async addComment(orderId, userId, comment) {
        const result = await pool.query(`INSERT INTO order_comments (order_id, user_id, comment, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *`, [orderId, userId, comment]);
        return result.rows[0];
    }

    // rate
    static async rateOrder(orderId, userId, rating, comment = null) {
        const existing = await pool.query(`SELECT * FROM order_ratings WHERE order_id = $1 AND user_id = $2`, [orderId, userId]);
        if (existing.rows.length > 0) {
            const result = await pool.query(`UPDATE order_ratings SET rating = $1, comment = $2, updated_at = NOW() WHERE order_id = $3 AND user_id = $4 RETURNING *`, [rating, comment, orderId, userId]);
            return result.rows[0];
        } else {
            const result = await pool.query(`INSERT INTO order_ratings (order_id, user_id, rating, comment, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *`, [orderId, userId, rating, comment]);
            return result.rows[0];
        }
    }

    // softDelete
    static async softDelete(id) {
        await pool.query(`UPDATE orders SET is_active = FALSE, updated_at = NOW() WHERE id = $1`, [id]);
        await pool.query(`INSERT INTO order_history (order_id, action, changed_at) VALUES ($1, 'soft_deleted', NOW())`, [id]);
    }

    // hardDelete
    static async hardDelete(id) {
        const files = await pool.query(`SELECT * FROM order_attachments WHERE order_id = $1`, [id]);
        for (const file of files.rows) {
            const fullPath = path.join(__dirname, '..', file.file_path || '');
            if (fullPath && fs.existsSync(fullPath)) {
                try { fs.unlinkSync(fullPath); } catch (e) { /* ignore */ }
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

    // getReportDetailed
    static async getReportDetailed() {
        const result = await pool.query(`
            SELECT COUNT(*) AS total_orders, COUNT(*) FILTER (WHERE paid = TRUE) AS paid_orders,
                   COUNT(*) FILTER (WHERE status = 'pending') AS pending_orders,
                   COUNT(*) FILTER (WHERE status = 'completed') AS completed_orders,
                   COALESCE(SUM(p.amount),0) AS total_paid_amount
            FROM orders o
            LEFT JOIN order_payment_history p ON o.id = p.order_id
            WHERE o.is_active = TRUE
        `);
        return result.rows[0];
    }

    // utility count
    static async count() {
        const result = await pool.query(`SELECT COUNT(*) FROM orders WHERE is_active = TRUE`);
        return parseInt(result.rows[0].count, 10);
    }

    // ============================
    // 🚨 متدهای اضافه برای داشبورد
    // ============================

    static async countByStatus(status) {
        const result = await pool.query(
            `SELECT COUNT(*)::int AS total FROM orders WHERE status = $1 AND is_active = TRUE`,
            [status]
        );
        return result.rows[0].total;
    }

    static async countByPaymentStatus(status) {
        if (status === 'paid') {
            const result = await pool.query(
                `SELECT COUNT(*)::int AS total FROM orders WHERE paid = TRUE AND is_active = TRUE`
            );
            return result.rows[0].total;
        } else {
            const result = await pool.query(
                `SELECT COUNT(*)::int AS total FROM orders WHERE paid = FALSE AND is_active = TRUE`
            );
            return result.rows[0].total;
        }
    }

    static async findRecent({ officerId = null, limit = 5 } = {}) {
        let query = `SELECT id, title, status, created_at FROM orders WHERE is_active = TRUE`;
        const params = [];
        if (officerId) {
            query += ` AND officer_id = $1`;
            params.push(officerId);
        }
        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
        params.push(limit);

        const result = await pool.query(query, params);
        return result.rows;
    }

    // ============================
    // بقیه متدها بدون تغییر
    // ============================

    static async findRecent(limit = 5) {
        const result = await pool.query(`SELECT id, title, status, created_at FROM orders WHERE is_active = TRUE ORDER BY created_at DESC LIMIT $1`, [limit]);
        return result.rows;
    }

    static async findByUserPaginated(userId, page = 1, search = '', limit = 10) {
        try {
            const offset = (Math.max(1, parseInt(page, 10)) - 1) * limit;

            let countQuery = `SELECT COUNT(*) AS total FROM orders WHERE user_id = $1 AND is_active = TRUE`;
            const countParams = [userId];

            if (search && search.trim() !== '') {
                countQuery = `SELECT COUNT(*) AS total FROM orders WHERE user_id = $1 AND is_active = TRUE AND (title ILIKE $2 OR description ILIKE $2)`;
                countParams.push(`%${search}%`);
            }

            const countRes = await pool.query(countQuery, countParams);
            const total = parseInt(countRes.rows[0].total || 0, 10);
            const totalPages = Math.max(1, Math.ceil(total / limit));

            let dataQuery = `
                SELECT o.*, u.name AS user_name
                FROM orders o
                LEFT JOIN users u ON o.user_id = u.id
                WHERE o.user_id = $1 AND o.is_active = TRUE
            `;
            const dataParams = [userId];

            if (search && search.trim() !== '') {
                dataQuery += ` AND (o.title ILIKE $2 OR o.description ILIKE $2)`;
                dataParams.push(`%${search}%`);
            }

            dataQuery += ` ORDER BY o.created_at DESC LIMIT $${dataParams.length + 1} OFFSET $${dataParams.length + 2}`;
            dataParams.push(limit, offset);

            const dataRes = await pool.query(dataQuery, dataParams);
            const orders = dataRes.rows;

            return { orders, totalPages, page: Math.max(1, parseInt(page, 10)), total };
        } catch (err) {
            console.error('findByUserPaginated error:', err);
            throw err;
        }
    }

    static async findPaidByUser(userId) {
        const res = await pool.query(`SELECT * FROM orders WHERE user_id = $1 AND paid = TRUE AND is_active = TRUE ORDER BY created_at DESC`, [userId]);
        return res.rows;
    }

    static async countAllWithFilter(status, search) {
        let query = `SELECT COUNT(*)::int AS total FROM orders WHERE is_active = TRUE`;
        const params = [];
        let idx = 1;
        if (status && status !== 'all') { query += ` AND status = $${idx++}`; params.push(status); }
        if (search && search.trim() !== '') { query += ` AND (title ILIKE $${idx} OR description ILIKE $${idx})`; params.push(`%${search}%`); }
        const r = await pool.query(query, params);
        return parseInt(r.rows[0].total || 0, 10);
    }

    static async countByUser(userId, status = null, search = '') {
        let query = `SELECT COUNT(*)::int AS total FROM orders WHERE user_id = $1 AND is_active = TRUE`;
        const params = [userId];
        let idx = 2;
        if (status && status !== 'all') { query += ` AND status = $${idx++}`; params.push(status); }
        if (search && search.trim() !== '') { query += ` AND (title ILIKE $${idx} OR description ILIKE $${idx})`; params.push(`%${search}%`); }
        const r = await pool.query(query, params);
        return parseInt(r.rows[0].total || 0, 10);
    }

    static async findAllAdvanced(limit = 50, offset = 0, { status = null, search = '', sort = 'latest' } = {}) {
        const opts = { limit, offset, status: status === 'all' ? null : status };
        return await Order.findAll(opts);
    }

    static async findByUserAdvanced(userId, limit = 10, offset = 0, { status = null, search = '', sort = 'latest' } = {}) {
        if (typeof Order.findByUserPaginated === 'function') {
            const page = Math.floor(offset / limit) + 1;
            return await Order.findByUserPaginated(userId, page, search, limit);
        }
        const res = await pool.query(`SELECT o.*, u.name AS user_name FROM orders o LEFT JOIN users u ON o.user_id = u.id WHERE o.user_id = $1 AND is_active = TRUE ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`, [userId, limit, offset]);
        return { orders: res.rows, total: res.rows.length };
    }
}

// alias for compatibility
Order.markAsPaid = Order.pay;

module.exports = Order;
