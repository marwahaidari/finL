const { query } = require('./index');

// فرض بر اینه که io (socket.io) بیرون از این مدل مدیریت میشه و به اینجا پاس داده نمیشه، 
// اگر بخوای می‌تونی داخل متدهای مربوطه emit کنی.
const Notification = {
    // 📌 ایجاد نوتیفیکیشن جدید (برای یک کاربر یا عمومی)
    create: async (userId, message, {
        type = 'info',       // info, success, warning, error
        category = 'system', // system, user, alert, ...
        priority = 'normal', // low, normal, high
        expiresAt = null
    } = {}) => {
        const res = await query(
            `INSERT INTO notifications 
             (user_id, message, type, category, priority, read, delivered, archived, created_at, expires_at)
             VALUES ($1, $2, $3, $4, $5, false, false, false, NOW(), $6) 
             RETURNING *`,
            [userId, message, type, category, priority, expiresAt]
        );
        return res.rows[0];
    },

    // 📌 ایجاد نوتیفیکیشن برای چند کاربر به صورت bulk
    createBulk: async (userIds, message, options = {}) => {
        const results = [];
        for (const id of userIds) {
            const notification = await Notification.create(id, message, options);
            // مثال emit (اگر io داشته باشی)
            // io.to(id).emit('new_notification', notification);
            results.push(notification);
        }
        return results;
    },

    // 📌 پیدا کردن نوتیفیکیشن‌های یک کاربر با فیلترهای اختیاری
    findByUser: async (userId, {
        limit = 20,
        offset = 0,
        priority = null,   // low, normal, high
        type = null        // info, success, warning, error
    } = {}) => {
        let sql = `
          SELECT * FROM notifications
          WHERE (user_id = $1 OR user_id IS NULL)
          AND (expires_at IS NULL OR expires_at > NOW())
          AND archived = false
        `;
        const params = [userId];
        let idx = 2;

        if (priority) {
            sql += ` AND priority = $${idx++}`;
            params.push(priority);
        }
        if (type) {
            sql += ` AND type = $${idx++}`;
            params.push(type);
        }

        sql += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
        params.push(limit, offset);

        const res = await query(sql, params);
        return res.rows;
    },

    // 📌 دریافت نوتیف‌های خوانده‌نشده برای کاربر
    findUnreadByUser: async (userId) => {
        const res = await query(
            `SELECT * FROM notifications
             WHERE (user_id = $1 OR user_id IS NULL)
             AND read = false
             AND archived = false
             AND (expires_at IS NULL OR expires_at > NOW())
             ORDER BY created_at DESC`,
            [userId]
        );
        return res.rows;
    },

    // 📌 مارک کردن نوتیف به عنوان خوانده شده
    markAsRead: async (id, userId) => {
        const res = await query(
            `UPDATE notifications
             SET read = true, updated_at = NOW()
             WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)
             RETURNING *`,
            [id, userId]
        );
        return res.rows[0];
    },

    // 📌 مارک کردن همه نوتیف‌ها به عنوان خوانده شده برای یک کاربر
    markAllAsRead: async (userId) => {
        await query(
            `UPDATE notifications
             SET read = true, updated_at = NOW()
             WHERE (user_id = $1 OR user_id IS NULL) AND archived = false`,
            [userId]
        );
        return true;
    },

    // 📌 مارک کردن نوتیف به عنوان تحویل داده شده (برای real-time یا socket)
    markAsDelivered: async (id) => {
        const res = await query(
            `UPDATE notifications
             SET delivered = true, updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [id]
        );
        return res.rows[0];
    },

    // 📌 آرشیو کردن نوتیف (به جای حذف مستقیم)
    archive: async (id, userId) => {
        await query(
            `UPDATE notifications
             SET archived = true, updated_at = NOW()
             WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)`,
            [id, userId]
        );
        return true;
    },

    // 📌 جستجوی نوتیف‌ها با کلیدواژه و فیلترهای دیگر
    search: async (userId, keyword, {
        limit = 20,
        offset = 0,
        category = null,
        priority = null,
        type = null
    } = {}) => {
        let sql = `
          SELECT * FROM notifications
          WHERE (user_id = $1 OR user_id IS NULL)
          AND message ILIKE $2
          AND archived = false
        `;
        const params = [userId, `%${keyword}%`];
        let idx = 3;

        if (category) {
            sql += ` AND category = $${idx++}`;
            params.push(category);
        }
        if (priority) {
            sql += ` AND priority = $${idx++}`;
            params.push(priority);
        }
        if (type) {
            sql += ` AND type = $${idx++}`;
            params.push(type);
        }

        sql += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
        params.push(limit, offset);

        const res = await query(sql, params);
        return res.rows;
    },

    // 📌 شمارش نوتیف‌های خوانده نشده برای نمایش badge و ...
    countUnread: async (userId) => {
        const res = await query(
            `SELECT COUNT(*) FROM notifications
             WHERE (user_id = $1 OR user_id IS NULL)
             AND read = false
             AND archived = false
             AND (expires_at IS NULL OR expires_at > NOW())`,
            [userId]
        );
        return parseInt(res.rows[0].count, 10);
    },

    // 📌 حذف نوتیف‌های منقضی شده و آرشیو شده (برای پاکسازی)
    cleanupExpiredAndArchived: async () => {
        const res = await query(
            `DELETE FROM notifications
             WHERE archived = true
             OR (expires_at IS NOT NULL AND expires_at <= NOW())`
        );
        return res.rowCount;
    }
};

module.exports = Notification;
