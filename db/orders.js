// db/models/orders.js
const { query, transaction } = require('../index');
const Notification = require('./notifications');
const fs = require('fs');

const Order = {
    // ================================
    // 📌 ایجاد درخواست/سفارش جدید
    create: async ({ userId, title, description, priority = 'normal', status = 'pending', attachments = [], dueDate = null }) => {
        const res = await query(
            `INSERT INTO orders (user_id, title, description, priority, status, attachments, due_date, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`,
            [userId, title, description, priority, status, JSON.stringify(attachments), dueDate]
        );

        const order = res.rows[0];

        // تاریخچه وضعیت
        await Order.addHistory(order.id, userId, `Order created with status: ${status}`);

        // نوتیف به ادمین‌ها
        await Notification.create(null, `New request submitted: ${title}`);

        return order;
    },

    // ================================
    // 📌 پیدا کردن درخواست با id
    findById: async (id) => {
        const res = await query('SELECT * FROM orders WHERE id=$1', [id]);
        return res.rows[0];
    },

    // ================================
    // 📌 پیدا کردن درخواست‌های یک کاربر
    findByUser: async (userId, limit = 10, offset = 0) => {
        const res = await query(
            `SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
            [userId, limit, offset]
        );
        return res.rows;
    },

    // ================================
    // 📌 تعداد درخواست‌های یک کاربر
    countByUser: async (userId) => {
        const res = await query('SELECT COUNT(*) FROM orders WHERE user_id=$1', [userId]);
        return parseInt(res.rows[0].count);
    },

    // ================================
    // 📌 تغییر وضعیت درخواست
    updateStatus: async (id, status, userId = null) => {
        const res = await query(
            'UPDATE orders SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
            [status, id]
        );

        const order = res.rows[0];
        if (order) {
            await Order.addHistory(id, userId, `Status updated to ${status}`);
            await Notification.create(order.user_id, `Your request "${order.title}" status updated to ${status}`);
        }

        return order;
    },

    // ================================
    // 📌 تغییر اولویت درخواست
    updatePriority: async (id, priority, userId = null) => {
        const res = await query(
            'UPDATE orders SET priority=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
            [priority, id]
        );
        const order = res.rows[0];
        if (order) await Order.addHistory(id, userId, `Priority updated to ${priority}`);
        return order;
    },

    // ================================
    // 📌 تعیین مهلت رسیدگی
    setDueDate: async (id, dueDate, userId = null) => {
        const res = await query(
            'UPDATE orders SET due_date=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
            [dueDate, id]
        );
        const order = res.rows[0];
        if (order) await Order.addHistory(id, userId, `Due date set to ${dueDate}`);
        return order;
    },

    // ================================
    // 📌 اختصاص کارشناس (officer)
    assignOfficer: async (id, officerId, userId = null) => {
        const res = await query(
            'UPDATE orders SET officer_id=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
            [officerId, id]
        );
        const order = res.rows[0];
        if (order) {
            await Order.addHistory(id, userId, `Assigned to officer ${officerId}`);
            await Notification.create(officerId, `A new order "${order.title}" has been assigned to you`);
        }
        return order;
    },

    // ================================
    // 📌 افزودن کامنت/یادداشت
    addComment: async (orderId, userId, message) => {
        const res = await query(
            `INSERT INTO order_comments (order_id, user_id, message, created_at)
             VALUES ($1, $2, $3, NOW()) RETURNING *`,
            [orderId, userId, message]
        );
        return res.rows[0];
    },

    // ================================
    // 📌 گرفتن کامنت‌های یک سفارش
    getComments: async (orderId) => {
        const res = await query(
            `SELECT oc.*, u.name as user_name
             FROM order_comments oc
             JOIN users u ON oc.user_id = u.id
             WHERE order_id=$1
             ORDER BY created_at ASC`,
            [orderId]
        );
        return res.rows;
    },

    // ================================
    // 📌 ذخیره تاریخچه تغییرات
    addHistory: async (orderId, userId, action) => {
        await query(
            `INSERT INTO order_history (order_id, user_id, action, created_at)
             VALUES ($1, $2, $3, NOW())`,
            [orderId, userId, action]
        );
    },

    // 📌 گرفتن تاریخچه تغییرات
    getHistory: async (orderId) => {
        const res = await query(
            `SELECT oh.*, u.name as user_name
             FROM order_history oh
             LEFT JOIN users u ON oh.user_id = u.id
             WHERE order_id=$1
             ORDER BY created_at ASC`,
            [orderId]
        );
        return res.rows;
    },

    // ================================
    // 📌 بروزرسانی اطلاعات سفارش
    update: async (id, { title, description, attachments }, userId = null) => {
        const res = await query(
            `UPDATE orders
             SET title=$1, description=$2, attachments=$3, updated_at=NOW()
             WHERE id=$4 RETURNING *`,
            [title, description, JSON.stringify(attachments || []), id]
        );
        const order = res.rows[0];
        if (order) await Order.addHistory(id, userId, 'Order updated');
        return order;
    },

    // ================================
    // 📌 بازگشایی سفارش بسته‌شده
    reopen: async (id, userId = null) => {
        const res = await query(
            `UPDATE orders SET status='reopened', updated_at=NOW() WHERE id=$1 RETURNING *`,
            [id]
        );
        const order = res.rows[0];
        if (order) await Order.addHistory(id, userId, 'Order reopened');
        return order;
    },

    // ================================
    // 📌 ارجاع به سطح بالاتر (escalate)
    escalate: async (id, adminId, reason) => {
        await Order.addHistory(id, adminId, `Order escalated: ${reason}`);
        return true;
    },

    // ================================
    // 📌 حذف سفارش
    delete: async (id) => {
        const order = await Order.findById(id);
        if (!order) throw new Error('Order not found');

        if (order.attachments?.length) {
            order.attachments.forEach(file => {
                if (file.filepath && fs.existsSync(file.filepath)) {
                    fs.unlinkSync(file.filepath);
                }
            });
        }

        await query('DELETE FROM orders WHERE id=$1', [id]);
        return true;
    },

    // ================================
    // 📌 لیست همه سفارش‌ها
    findAll: async (limit = 20, offset = 0, status = null, officerId = null) => {
        let sql = 'SELECT * FROM orders';
        const params = [];

        if (status) {
            sql += ' WHERE status=$1';
            params.push(status);
        }

        if (officerId) {
            sql += params.length ? ' AND' : ' WHERE';
            sql += ' officer_id=$' + (params.length + 1);
            params.push(officerId);
        }

        sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const res = await query(sql, params);
        return res.rows;
    },

    // ================================
    // 📌 شمارش کل سفارش‌ها
    countAll: async (status = null) => {
        let sql = 'SELECT COUNT(*) FROM orders';
        const params = [];

        if (status) {
            sql += ' WHERE status=$1';
            params.push(status);
        }

        const res = await query(sql, params);
        return parseInt(res.rows[0].count);
    },

    // ================================
    // 📌 جستجو در سفارش‌ها
    search: async (keyword, limit = 20, offset = 0) => {
        const res = await query(
            `SELECT * FROM orders
             WHERE title ILIKE $1 OR description ILIKE $1
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3`,
            [`%${keyword}%`, limit, offset]
        );
        return res.rows;
    },

    // ================================
    // 📌 گزارش‌ها
    getStats: async () => {
        const res = await query(
            `SELECT status, COUNT(*) as count
             FROM orders
             GROUP BY status`
        );
        return res.rows;
    },

    getReportByMonth: async (year, month) => {
        const res = await query(
            `SELECT DATE_TRUNC('day', created_at) as day, COUNT(*) as count
             FROM orders
             WHERE EXTRACT(YEAR FROM created_at)=$1 AND EXTRACT(MONTH FROM created_at)=$2
             GROUP BY day ORDER BY day ASC`,
            [year, month]
        );
        return res.rows;
    },

    getReportByOfficer: async (officerId) => {
        const res = await query(
            `SELECT status, COUNT(*) as count
             FROM orders
             WHERE officer_id=$1
             GROUP BY status`,
            [officerId]
        );
        return res.rows;
    }
};

module.exports = Order;
