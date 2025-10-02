const pool = require('../db');

class Message {
    // ایجاد پیام جدید (Citizen ↔ Officer ↔ Admin)
    static async create({ serviceRequestId, senderId, subject, message, messageType = 'general', replyTo = null, priority = 'normal', attachments = [] }) {
        const result = await pool.query(
            `INSERT INTO messages
            (service_request_id, sender_id, subject, message, message_type, reply_to, priority, is_pinned, is_read, is_important, is_active, is_archived, created_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE,FALSE,FALSE,TRUE,FALSE,NOW(),NOW())
            RETURNING *`,
            [serviceRequestId, senderId, subject, message, messageType, replyTo, priority]
        );

        const msg = result.rows[0];

        if (attachments.length > 0) {
            await Promise.all(attachments.map(file =>
                pool.query(
                    `INSERT INTO message_attachments (message_id, file_url, created_at) VALUES ($1,$2,NOW())`,
                    [msg.id, file]
                )
            ));
        }

        await pool.query(
            `INSERT INTO notifications (user_id, message, type, read, is_active, created_at, updated_at)
            SELECT assigned_to, 'پیام جدید برای درخواست شما', 'message', FALSE, TRUE, NOW(), NOW()
            FROM service_requests WHERE id = $1`,
            [serviceRequestId]
        );

        return msg;
    }

    // گرفتن پیام‌ها همراه با Replies و Attachments
    static async findByServiceRequest(serviceRequestId, { limit = 50, offset = 0, includeReplies = true, includeArchived = false } = {}) {
        let query = `
        SELECT m.*, u.full_name AS sender_name,
          (SELECT json_agg(r.*) FROM messages r WHERE r.reply_to = m.id AND r.is_active=TRUE AND (r.is_archived = $4)) AS replies,
          (SELECT json_agg(ma.file_url) FROM message_attachments ma WHERE ma.message_id = m.id) AS attachments
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.service_request_id = $1 AND m.is_active=TRUE AND (m.is_archived = $4)
        `;

        if (!includeReplies) query += ' AND m.reply_to IS NULL';
        query += ` ORDER BY m.created_at ASC LIMIT $2 OFFSET $3`;

        const result = await pool.query(query, [serviceRequestId, limit, offset, includeArchived]);
        return result.rows;
    }

    // گرفتن پیام‌های پین شده برای یک درخواست خدمات
    static async findPinned(serviceRequestId) {
        const result = await pool.query(
            `SELECT m.*, u.full_name AS sender_name,
              (SELECT json_agg(ma.file_url) FROM message_attachments ma WHERE ma.message_id = m.id) AS attachments
             FROM messages m
             JOIN users u ON m.sender_id = u.id
             WHERE m.service_request_id = $1 AND m.is_active=TRUE AND m.is_pinned=TRUE AND m.is_archived=FALSE
             ORDER BY m.created_at DESC`,
            [serviceRequestId]
        );
        return result.rows;
    }

    // گرفتن پیام‌های آرشیو شده
    static async findArchived(serviceRequestId, { limit = 50, offset = 0 } = {}) {
        const result = await pool.query(
            `SELECT m.*, u.full_name AS sender_name,
              (SELECT json_agg(ma.file_url) FROM message_attachments ma WHERE ma.message_id = m.id) AS attachments
             FROM messages m
             JOIN users u ON m.sender_id = u.id
             WHERE m.service_request_id = $1 AND m.is_active=TRUE AND m.is_archived=TRUE
             ORDER BY m.updated_at DESC LIMIT $2 OFFSET $3`,
            [serviceRequestId, limit, offset]
        );
        return result.rows;
    }

    // گرفتن یک پیام با Attachments
    static async findById(id) {
        const result = await pool.query(
            `SELECT m.*, u.full_name AS sender_name,
              (SELECT json_agg(file_url) FROM message_attachments WHERE message_id = m.id) AS attachments
             FROM messages m
             JOIN users u ON m.sender_id = u.id
             WHERE m.id=$1 AND m.is_active=TRUE`,
            [id]
        );
        return result.rows[0];
    }

    // آپدیت پیام (ویرایش متن و ضمیمه‌ها)
    static async update(id, newMessage, attachments = []) {
        const result = await pool.query(
            `UPDATE messages SET message=$1, updated_at=NOW() WHERE id=$2 AND is_active=TRUE RETURNING *`,
            [newMessage, id]
        );

        if (attachments.length > 0) {
            await pool.query(`DELETE FROM message_attachments WHERE message_id=$1`, [id]);
            await Promise.all(attachments.map(file =>
                pool.query(`INSERT INTO message_attachments (message_id, file_url, created_at) VALUES ($1,$2,NOW())`, [id, file])
            ));
        }

        await pool.query(
            `INSERT INTO message_history (message_id, action, changed_at) VALUES ($1,'updated',NOW())`,
            [id]
        );

        return result.rows[0];
    }

    // پین / آنپین پیام
    static async togglePin(id, pin = null) {
        const message = await this.findById(id);
        if (!message) throw new Error('Message not found');

        const newPin = pin !== null ? pin : !message.is_pinned;
        const result = await pool.query(
            `UPDATE messages SET is_pinned=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
            [newPin, id]
        );

        await pool.query(
            `INSERT INTO message_history (message_id, action, changed_at) VALUES ($1,'pin_toggled',NOW())`,
            [id]
        );

        return result.rows[0];
    }

    // علامت‌گذاری پیام به عنوان مهم/غیرمهم
    static async toggleImportant(id, important = null) {
        const message = await this.findById(id);
        if (!message) throw new Error('Message not found');

        const newImportant = important !== null ? important : !message.is_important;
        const result = await pool.query(
            `UPDATE messages SET is_important=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
            [newImportant, id]
        );

        await pool.query(
            `INSERT INTO message_history (message_id, action, changed_at) VALUES ($1,'important_toggled',NOW())`,
            [id]
        );

        return result.rows[0];
    }

    // مارک خوانده شده (تکی و گروهی)
    static async markAsRead(id, userId) {
        const result = await pool.query(
            `UPDATE messages SET is_read=TRUE, updated_at=NOW() WHERE id=$1 AND sender_id!=$2 AND is_active=TRUE RETURNING *`,
            [id, userId]
        );
        await pool.query(
            `INSERT INTO message_history (message_id, action, changed_at) VALUES ($1,'read',NOW())`,
            [id]
        );
        return result.rows[0];
    }

    static async markAllAsRead(serviceRequestId, userId) {
        await pool.query(
            `UPDATE messages SET is_read=TRUE, updated_at=NOW() WHERE service_request_id=$1 AND sender_id!=$2 AND is_active=TRUE`,
            [serviceRequestId, userId]
        );
    }

    // گرفتن تعداد پیام‌های خوانده نشده برای یک درخواست
    static async countUnread(serviceRequestId, userId) {
        const result = await pool.query(
            `SELECT COUNT(*) AS total FROM messages WHERE service_request_id=$1 AND sender_id!=$2 AND is_read=FALSE AND is_active=TRUE AND is_archived=FALSE`,
            [serviceRequestId, userId]
        );
        return parseInt(result.rows[0].total, 10);
    }

    // آرشیو / بازیابی پیام
    static async toggleArchive(id, archive = null) {
        const message = await this.findById(id);
        if (!message) throw new Error('Message not found');

        const newArchive = archive !== null ? archive : !message.is_archived;
        const result = await pool.query(
            `UPDATE messages SET is_archived=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
            [newArchive, id]
        );

        await pool.query(
            `INSERT INTO message_history (message_id, action, changed_at) VALUES ($1,'archive_toggled',NOW())`,
            [id]
        );

        return result.rows[0];
    }

    // حذف نرم (Soft Delete)
    static async softDelete(id) {
        const result = await pool.query(
            `UPDATE messages SET is_active=FALSE, updated_at=NOW() WHERE id=$1 RETURNING *`,
            [id]
        );
        await pool.query(
            `INSERT INTO message_history (message_id, action, changed_at) VALUES ($1,'soft_deleted',NOW())`,
            [id]
        );
        return result.rows[0];
    }

    // حذف کامل (Hard Delete)
    static async delete(id) {
        await pool.query(`DELETE FROM messages WHERE id=$1`, [id]);
        await pool.query(
            `INSERT INTO message_history (message_id, action, changed_at) VALUES ($1,'deleted',NOW())`,
            [id]
        );
    }

    // شمارش پیام‌ها
    static async countByServiceRequest(serviceRequestId) {
        const result = await pool.query(
            `SELECT COUNT(*) AS total FROM messages WHERE service_request_id=$1 AND is_active=TRUE`,
            [serviceRequestId]
        );
        return parseInt(result.rows[0].total, 10);
    }

    // جستجوی پیشرفته پیام‌ها
    static async search(serviceRequestId, keyword) {
        const result = await pool.query(
            `SELECT m.*, u.full_name AS sender_name
             FROM messages m
             JOIN users u ON m.sender_id=u.id
             WHERE m.service_request_id=$1 AND m.message ILIKE $2 AND m.is_active=TRUE
             ORDER BY m.created_at ASC`,
            [serviceRequestId, `%${keyword}%`]
        );
        return result.rows;
    }
}

module.exports = Message;
