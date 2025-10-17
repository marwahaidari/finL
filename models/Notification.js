const pool = require('../db');

class Notification {
    // ===============================
    // ایجاد نوتیفیکیشن جدید با زمان‌بندی
    // ===============================
    static async create(userId, message, { type = 'info', priority = 'medium', isActive = true, scheduledAt = null, isImportant = false } = {}) {
        if (!userId || typeof userId !== 'number') throw new Error('Invalid userId');
        if (!message || typeof message !== 'string') throw new Error('Message is required');

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const result = await client.query(
                `INSERT INTO notifications 
                 (user_id, message, type, priority, read, is_active, created_at, updated_at, scheduled_at, is_important)
                 VALUES ($1, $2, $3, $4, FALSE, $5, NOW(), NOW(), $6, $7) RETURNING *`,
                [userId, message, type, priority, isActive, scheduledAt, isImportant]
            );
            const notification = result.rows[0];

            await client.query(
                `INSERT INTO notification_history (notification_id, action, changed_at) VALUES ($1, 'created', NOW())`,
                [notification.id]
            );

            await client.query('COMMIT');
            return notification;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    // ===============================
    // ارسال گروهی نوتیفیکیشن
    // ===============================
    static async createBulk(userIds, message, options = {}) {
        if (!Array.isArray(userIds) || userIds.length === 0) throw new Error('userIds must be a non-empty array');
        const notifications = await Promise.all(userIds.map(userId =>
            this.create(userId, message, options)
        ));
        return notifications;
    }

    // ===============================
    // گرفتن نوتیفیکیشن‌ها با فیلتر پیشرفته
    // ===============================
    static async findByUser(userId, { limit = 50, offset = 0, activeOnly = true, type = null, priority = null, includeArchived = false, includeDeleted = false, onlyImportant = false } = {}) {
        if (!userId || typeof userId !== 'number') throw new Error('Invalid userId');

        let query = 'SELECT * FROM notifications WHERE user_id = $1';
        const params = [userId];
        let idx = 2;

        if (activeOnly) query += ' AND is_active = TRUE';
        if (!includeArchived) query += ' AND is_archived = FALSE';
        if (!includeDeleted) query += ' AND is_active = TRUE';
        if (type) { query += ` AND type = $${idx++}`; params.push(type); }
        if (priority) { query += ` AND priority = $${idx++}`; params.push(priority); }
        if (onlyImportant) query += ' AND is_important = TRUE';

        query += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
        params.push(limit, offset);

        const result = await pool.query(query, params);
        return result.rows;
    }

    // ===============================
    // گرفتن نوتیفیکیشن‌های خوانده نشده
    // ===============================
    static async findUnreadByUser(userId) {
        const result = await pool.query(
            `SELECT * FROM notifications
             WHERE user_id = $1 AND read = FALSE AND is_active = TRUE AND is_archived = FALSE
             ORDER BY created_at DESC`,
            [userId]
        );
        return result.rows;
    }

    // ===============================
    // مارک خوانده شده (تک نوتیفیکیشن)
    // ===============================
    static async markAsRead(id, userId) {
        if (!id || !userId) throw new Error('id and userId are required');

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const result = await client.query(
                `UPDATE notifications
                 SET read = TRUE, updated_at = NOW()
                 WHERE id = $1 AND user_id = $2 AND is_active = TRUE
                 RETURNING *`,
                [id, userId]
            );

            await client.query(
                `INSERT INTO notification_history (notification_id, action, changed_at) VALUES ($1, 'marked_as_read', NOW())`,
                [id]
            );

            await client.query('COMMIT');
            return result.rows[0];
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    // ===============================
    // مارک همه به عنوان خوانده شده
    // ===============================
    static async markAllAsRead(userId, { type = null, priority = null } = {}) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            let query = 'UPDATE notifications SET read = TRUE, updated_at = NOW() WHERE user_id = $1 AND is_active = TRUE';
            const params = [userId];
            if (type) { query += ' AND type = $2'; params.push(type); }
            if (priority) { query += params.length === 2 ? ' AND priority = $3' : ' AND priority = $2'; params.push(priority); }

            await client.query(query, params);

            await client.query(
                `INSERT INTO notification_history (notification_id, action, changed_at)
                 SELECT id, 'marked_all_as_read', NOW() FROM notifications WHERE user_id = $1`,
                [userId]
            );

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    // ===============================
    // آرشیو نوتیفیکیشن
    // ===============================
    static async archive(id, userId) {
        const result = await pool.query(
            `UPDATE notifications SET is_archived = TRUE, updated_at = NOW()
             WHERE id = $1 AND user_id = $2 AND is_active = TRUE
             RETURNING *`,
            [id, userId]
        );

        await pool.query(
            `INSERT INTO notification_history (notification_id, action, changed_at) VALUES ($1, 'archived', NOW())`,
            [id]
        );

        return result.rows[0];
    }

    // ===============================
    // بازیابی از آرشیو
    // ===============================
    static async restoreFromArchive(id, userId) {
        const result = await pool.query(
            `UPDATE notifications SET is_archived = FALSE, updated_at = NOW()
             WHERE id = $1 AND user_id = $2 AND is_active = TRUE
             RETURNING *`,
            [id, userId]
        );

        await pool.query(
            `INSERT INTO notification_history (notification_id, action, changed_at) VALUES ($1, 'restored_from_archive', NOW())`,
            [id]
        );

        return result.rows[0];
    }

    // ===============================
    // علامت‌گذاری نوتیفیکیشن به عنوان مهم
    // ===============================
    static async toggleImportant(id, userId, important = null) {
        const notification = await this.findById(id);
        if (!notification) throw new Error('Notification not found');
        if (notification.user_id !== userId) throw new Error('Access denied');

        const newImportant = important !== null ? important : !notification.is_important;
        const result = await pool.query(
            `UPDATE notifications SET is_important = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
            [newImportant, id]
        );

        await pool.query(
            `INSERT INTO notification_history (notification_id, action, changed_at) VALUES ($1, 'important_toggled', NOW())`,
            [id]
        );

        return result.rows[0];
    }

    // ===============================
    // حذف نرم (Soft Delete)
    // ===============================
    static async softDelete(id, userId) {
        const result = await pool.query(
            `UPDATE notifications
             SET is_active = FALSE, updated_at = NOW()
             WHERE id = $1 AND user_id = $2
             RETURNING *`,
            [id, userId]
        );

        await pool.query(
            `INSERT INTO notification_history (notification_id, action, changed_at) VALUES ($1, 'soft_deleted', NOW())`,
            [id]
        );

        return result.rows[0];
    }

    // ===============================
    // حذف کامل
    // ===============================
    static async delete(id) {
        await pool.query(`DELETE FROM notifications WHERE id = $1`, [id]);
        await pool.query(
            `INSERT INTO notification_history (notification_id, action, changed_at) VALUES ($1, 'deleted', NOW())`,
            [id]
        );
    }

    // ===============================
    // شمارش نوتیفیکیشن‌ها
    // ===============================
    static async count(userId, { activeOnly = true, type = null, priority = null, includeArchived = false, onlyImportant = false } = {}) {
        let query = 'SELECT COUNT(*) AS total FROM notifications WHERE user_id = $1';
        const params = [userId];
        let idx = 2;

        if (activeOnly) query += ' AND is_active = TRUE';
        if (!includeArchived) query += ' AND is_archived = FALSE';
        if (type) { query += ` AND type = $${idx++}`; params.push(type); }
        if (priority) { query += ` AND priority = $${idx++}`; params.push(priority); }
        if (onlyImportant) query += ' AND is_important = TRUE';

        const result = await pool.query(query, params);
        return parseInt(result.rows[0].total, 10);
    }

    // ===============================
    // شمارش نوتیفیکیشن‌های خوانده نشده
    // ===============================
    static async countUnread(userId, { type = null, priority = null, includeArchived = false } = {}) {
        let query = 'SELECT COUNT(*) AS total FROM notifications WHERE user_id = $1 AND read = FALSE AND is_active = TRUE';
        const params = [userId];
        let idx = 2;

        if (!includeArchived) query += ' AND is_archived = FALSE';
        if (type) { query += ` AND type = $${idx++}`; params.push(type); }
        if (priority) { query += ` AND priority = $${idx++}`; params.push(priority); }

        const result = await pool.query(query, params);
        return parseInt(result.rows[0].total, 10);
    }

    // ===============================
    // واکشی نوتیفیکیشن توسط id
    // ===============================
    static async findById(id) {
        const result = await pool.query('SELECT * FROM notifications WHERE id = $1', [id]);
        return result.rows[0];
    }

    // ===============================
    // واکشی نوتیفیکیشن‌ها آماده ارسال به realtime client
    // ===============================
    static async fetchReadyForPush() {
        const now = new Date().toISOString();
        const result = await pool.query(
            `SELECT * FROM notifications
             WHERE scheduled_at <= $1 AND is_active = TRUE AND is_archived = FALSE AND read = FALSE
             ORDER BY scheduled_at ASC`,
            [now]
        );
        return result.rows;
    }

    // ===============================
    // پاک‌سازی خودکار نوتیفیکیشن‌های قدیمی (مثلا 30 روز)
    // ===============================
    static async autoClean(daysOld = 30) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query(
                `DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '${daysOld} days' RETURNING id`
            );
            const deletedIds = result.rows.map(r => r.id);

            if (deletedIds.length > 0) {
                await client.query(
                    `INSERT INTO notification_history (notification_id, action, changed_at)
                     SELECT id, 'auto_cleaned', NOW() FROM UNNEST($1::int[]) AS id`,
                    [deletedIds]
                );
            }

            await client.query('COMMIT');
            return deletedIds.length;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    // ===============================
    // واکنش به نوتیفیکیشن (مثلا لایک یا غیره)
    // ===============================
    static async addReaction(notificationId, userId, reaction) {
        if (!notificationId || !userId || !reaction) throw new Error('notificationId, userId, and reaction are required');

        await pool.query(
            `INSERT INTO notification_reactions (notification_id, user_id, reaction, created_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (notification_id, user_id) DO UPDATE SET reaction = EXCLUDED.reaction, created_at = NOW()`,
            [notificationId, userId, reaction]
        );
    }

    static async getReactions(notificationId) {
        const result = await pool.query(
            `SELECT user_id, reaction FROM notification_reactions WHERE notification_id = $1`,
            [notificationId]
        );
        return result.rows;
    }
}

module.exports = Notification;
