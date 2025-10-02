// controllers/notificationController.js
const Notification = require('../db/notifications'); // یا مسیر درست فایل notifications.js تو
const { validationResult } = require('express-validator');

/**
 * Notification Controller
 * همه فانکشن‌ها برای مدیریت نوتیفیکیشن‌ها
 */

// ==================== CRUD & Basic ====================

// ایجاد یک نوتیف
exports.createNotification = async (req, res) => {
    try {
        const { userId, message, type, priority, scheduledAt, isImportant } = req.body;
        const notification = await Notification.create(userId, message, { type, priority, scheduledAt, isImportant });
        res.status(201).json(notification);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// ایجاد نوتیف گروهی
exports.createBulkNotifications = async (req, res) => {
    try {
        const { userIds, message, type, priority, scheduledAt, isImportant } = req.body;
        const notifications = await Notification.createBulk(userIds, message, { type, priority, scheduledAt, isImportant });
        res.status(201).json(notifications);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// گرفتن همه نوتیف‌ها با pagination و فیلتر
exports.listNotifications = async (req, res) => {
    try {
        const { limit = 50, offset = 0, activeOnly, type, priority, includeArchived, onlyImportant } = req.query;
        const notifications = await Notification.findByUser(req.user.id, {
            limit: parseInt(limit),
            offset: parseInt(offset),
            activeOnly: activeOnly !== 'false',
            type,
            priority,
            includeArchived: includeArchived === 'true',
            onlyImportant: onlyImportant === 'true'
        });
        res.json(notifications);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// گرفتن نوتیف‌های یک کاربر خاص
exports.getUserNotifications = async (req, res) => {
    try {
        const userId = req.params.userId;
        const notifications = await Notification.findByUser(userId);
        res.json(notifications);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// گرفتن نوتیف بر اساس ID
exports.getNotificationById = async (req, res) => {
    try {
        const notification = await Notification.findById(req.params.id);
        if (!notification) return res.status(404).json({ error: 'Notification not found' });
        res.json(notification);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// حذف نوتیف
exports.deleteNotification = async (req, res) => {
    try {
        await Notification.delete(req.params.id);
        res.json({ message: 'Notification deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// ==================== Status Updates ====================

// مارک یک نوتیف به عنوان خوانده شده
exports.markNotificationAsRead = async (req, res) => {
    try {
        const notification = await Notification.markAsRead(req.params.id, req.user.id);
        res.json(notification);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// مارک همه نوتیف‌های کاربر به عنوان خوانده شده
exports.markAllAsRead = async (req, res) => {
    try {
        await Notification.markAllAsRead(req.user.id);
        res.json({ message: 'All notifications marked as read' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// مارک یک نوتیف به عنوان تحویل داده شده
exports.markAsDelivered = async (req, res) => {
    try {
        const notification = await Notification.update(req.params.id, { delivered: true });
        res.json(notification);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// آرشیو کردن نوتیف
exports.archiveNotification = async (req, res) => {
    try {
        const notification = await Notification.archive(req.params.id, req.user.id);
        res.json(notification);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// ==================== Advanced Features ====================

// جستجو در نوتیف‌ها
exports.searchNotifications = async (req, res) => {
    try {
        const { query, type, role, startDate, endDate } = req.query;
        const notifications = await Notification.search({ query, type, role, startDate, endDate });
        res.json(notifications);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// شمارش نوتیف‌های خوانده نشده
exports.countUnreadNotifications = async (req, res) => {
    try {
        const count = await Notification.countUnread(req.user.id);
        res.json({ unreadCount: count });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// گرفتن فقط نوتیف‌های خوانده نشده
exports.getUnreadNotifications = async (req, res) => {
    try {
        const notifications = await Notification.findUnreadByUser(req.user.id);
        res.json(notifications);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// ==================== Future Hooks ====================

// ارسال real-time نوتیف (Socket / FCM / Email / SMS)
exports.sendRealtimeNotification = async (req, res) => {
    try {
        // این بخش باید بعدا با Socket یا FCM پیاده سازی شود
        res.json({ message: 'Realtime notification hook (future)' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};
