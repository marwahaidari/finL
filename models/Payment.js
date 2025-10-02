const pool = require('../db');

class Payment {
    // ===============================
    // ایجاد پرداخت جدید
    // ===============================
    static async create(userId, { amount, method, status = 'pending', reference = null, description = null } = {}) {
        const result = await pool.query(
            `INSERT INTO payments (user_id, amount, method, status, reference, description, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
             RETURNING *`,
            [userId, amount, method, status, reference, description]
        );
        const payment = result.rows[0];

        // ذخیره تاریخچه
        await pool.query(
            `INSERT INTO payment_history (payment_id, action, changed_at, details)
             VALUES ($1, 'created', NOW(), $2)`,
            [payment.id, JSON.stringify(payment)]
        );

        return payment;
    }

    // ===============================
    // گرفتن پرداخت با id
    // ===============================
    static async findById(id) {
        const result = await pool.query(`SELECT * FROM payments WHERE id = $1`, [id]);
        return result.rows[0];
    }

    // ===============================
    // گرفتن پرداخت‌های یک کاربر
    // ===============================
    static async findByUser(userId, { limit = 20, offset = 0, status = null, method = null } = {}) {
        let query = `SELECT * FROM payments WHERE user_id = $1`;
        const params = [userId];
        let idx = 2;

        if (status) { query += ` AND status = $${idx++}`; params.push(status); }
        if (method) { query += ` AND method = $${idx++}`; params.push(method); }

        query += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
        params.push(limit, offset);

        const result = await pool.query(query, params);
        return result.rows;
    }

    // ===============================
    // آپدیت وضعیت پرداخت
    // ===============================
    static async updateStatus(id, status, details = {}) {
        const result = await pool.query(
            `UPDATE payments SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
            [status, id]
        );
        const payment = result.rows[0];

        await pool.query(
            `INSERT INTO payment_history (payment_id, action, changed_at, details)
             VALUES ($1, 'status_update', NOW(), $2)`,
            [id, JSON.stringify({ status, ...details })]
        );

        return payment;
    }

    // ===============================
    // حذف نرم (غیر فعال کردن پرداخت)
    // ===============================
    static async softDelete(id) {
        const result = await pool.query(
            `UPDATE payments SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *`,
            [id]
        );

        await pool.query(
            `INSERT INTO payment_history (payment_id, action, changed_at)
             VALUES ($1, 'soft_deleted', NOW())`,
            [id]
        );

        return result.rows[0];
    }

    // ===============================
    // حذف کامل
    // ===============================
    static async delete(id) {
        await pool.query(`DELETE FROM payments WHERE id = $1`, [id]);
        await pool.query(
            `INSERT INTO payment_history (payment_id, action, changed_at)
             VALUES ($1, 'deleted', NOW())`,
            [id]
        );
    }

    // ===============================
    // شمارش پرداخت‌ها
    // ===============================
    static async count(userId, { status = null, method = null } = {}) {
        let query = 'SELECT COUNT(*) AS total FROM payments WHERE user_id = $1 AND is_active = TRUE';
        const params = [userId];
        let idx = 2;

        if (status) { query += ` AND status = $${idx++}`; params.push(status); }
        if (method) { query += ` AND method = $${idx++}`; params.push(method); }

        const result = await pool.query(query, params);
        return parseInt(result.rows[0].total, 10);
    }

    // ===============================
    // تاریخچه تغییرات پرداخت
    // ===============================
    static async getHistory(paymentId) {
        const result = await pool.query(
            `SELECT * FROM payment_history WHERE payment_id = $1 ORDER BY changed_at DESC`,
            [paymentId]
        );
        return result.rows;
    }
}

module.exports = Payment;
