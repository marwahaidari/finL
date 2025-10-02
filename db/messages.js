// db/messages.js
const { query } = require('./index');

const Message = {
    // 📩 ارسال پیام جدید
    create: async ({ senderId, receiverId, content, attachment = null, replyTo = null }) => {
        const res = await query(
            `INSERT INTO messages (sender_id, receiver_id, content, attachment, reply_to, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             RETURNING *`,
            [senderId, receiverId, content, attachment, replyTo]
        );
        return res.rows[0];
    },

    // 📥 گرفتن پیام‌های دریافتی کاربر
    inbox: async (userId, limit = 20, offset = 0) => {
        const res = await query(
            `SELECT m.*, u.name AS sender_name
             FROM messages m
             JOIN users u ON m.sender_id = u.id
             WHERE m.receiver_id = $1 AND m.is_deleted_receiver = FALSE
             ORDER BY m.created_at DESC
             LIMIT $2 OFFSET $3`,
            [userId, limit, offset]
        );
        return res.rows;
    },

    // 📤 پیام‌های ارسالی کاربر
    sent: async (userId, limit = 20, offset = 0) => {
        const res = await query(
            `SELECT m.*, u.name AS receiver_name
             FROM messages m
             JOIN users u ON m.receiver_id = u.id
             WHERE m.sender_id = $1 AND m.is_deleted_sender = FALSE
             ORDER BY m.created_at DESC
             LIMIT $2 OFFSET $3`,
            [userId, limit, offset]
        );
        return res.rows;
    },

    // 📌 گرفتن پیام تکی
    findById: async (id, userId) => {
        const res = await query(
            `SELECT * FROM messages
             WHERE id=$1 AND (sender_id=$2 OR receiver_id=$2)
             LIMIT 1`,
            [id, userId]
        );
        return res.rows[0];
    },

    // 🔎 جستجو در پیام‌ها
    search: async (userId, keyword, limit = 20, offset = 0) => {
        const res = await query(
            `SELECT m.*, u.name AS other_user
             FROM messages m
             JOIN users u ON (u.id = CASE
                 WHEN m.sender_id = $1 THEN m.receiver_id
                 ELSE m.sender_id END)
             WHERE (m.receiver_id = $1 OR m.sender_id = $1)
             AND (m.content ILIKE $2)
             ORDER BY m.created_at DESC
             LIMIT $3 OFFSET $4`,
            [userId, `%${keyword}%`, limit, offset]
        );
        return res.rows;
    },

    // 📍 پین‌کردن پیام
    pin: async (messageId, userId, isPinned = true) => {
        const res = await query(
            `UPDATE messages
             SET is_pinned = $1, updated_at = NOW()
             WHERE id = $2 AND (receiver_id = $3 OR sender_id = $3)
             RETURNING *`,
            [isPinned, messageId, userId]
        );
        return res.rows[0];
    },

    // ✅ خواندن پیام
    markAsRead: async (messageId, userId) => {
        const res = await query(
            `UPDATE messages
             SET is_read = TRUE, read_at = NOW()
             WHERE id = $1 AND receiver_id = $2
             RETURNING *`,
            [messageId, userId]
        );
        return res.rows[0];
    },

    // 📚 خواندن همه پیام‌های دریافتی
    markAllAsRead: async (userId) => {
        await query(
            `UPDATE messages
             SET is_read = TRUE, read_at = NOW()
             WHERE receiver_id = $1 AND is_read = FALSE`,
            [userId]
        );
        return true;
    },

    // ❌ حذف پیام (Soft Delete)
    delete: async (messageId, userId) => {
        const msg = await query('SELECT * FROM messages WHERE id=$1', [messageId]);
        if (!msg.rows[0]) return null;

        if (msg.rows[0].sender_id === userId) {
            await query(`UPDATE messages SET is_deleted_sender = TRUE WHERE id=$1`, [messageId]);
        } else if (msg.rows[0].receiver_id === userId) {
            await query(`UPDATE messages SET is_deleted_receiver = TRUE WHERE id=$1`, [messageId]);
        }
        return true;
    },

    // 🗑 پاک‌کردن واقعی پیام‌های حذف‌شده (فقط ادمین)
    purgeDeleted: async () => {
        await query(
            `DELETE FROM messages
             WHERE is_deleted_sender = TRUE AND is_deleted_receiver = TRUE`
        );
        return true;
    },

    // 📂 گرفتن پیام بر اساس reply chain
    thread: async (messageId) => {
        const res = await query(
            `WITH RECURSIVE thread AS (
                SELECT * FROM messages WHERE id = $1
                UNION ALL
                SELECT m.* FROM messages m
                INNER JOIN thread t ON m.reply_to = t.id
            )
            SELECT * FROM thread ORDER BY created_at ASC`,
            [messageId]
        );
        return res.rows;
    },

    // 📊 شمارش پیام‌های خوانده نشده
    countUnread: async (userId) => {
        const res = await query(
            `SELECT COUNT(*) FROM messages
             WHERE receiver_id = $1 AND is_read = FALSE AND is_deleted_receiver = FALSE`,
            [userId]
        );
        return parseInt(res.rows[0].count);
    },

    // 📈 آمار پیام‌های یک کاربر
    statsByUser: async (userId) => {
        const res = await query(
            `SELECT
                (SELECT COUNT(*) FROM messages WHERE sender_id=$1 AND is_deleted_sender=FALSE) AS sent,
                (SELECT COUNT(*) FROM messages WHERE receiver_id=$1 AND is_deleted_receiver=FALSE) AS received,
                (SELECT COUNT(*) FROM messages WHERE receiver_id=$1 AND is_read=FALSE AND is_deleted_receiver=FALSE) AS unread`
            ,
            [userId]
        );
        return res.rows[0];
    }
};

module.exports = Message;
