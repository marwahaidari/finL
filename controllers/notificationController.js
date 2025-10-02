// controllers/notificationController.js
const Notification = require('../models/Notification');
const { validationResult, body } = require('express-validator');

const lastNotificationTime = new Map();
const ALLOWED_PRIORITIES = ['low', 'medium', 'high'];
const ALLOWED_CATEGORIES = ['system', 'order', 'user', 'general'];
const ALLOWED_TYPES = ['info', 'success', 'warning', 'error'];

const notificationController = {
    // ================================
    // 📌 ایجاد نوتیفیکیشن جدید (تک کاربر)
    createNotification: [
        body('message').notEmpty().withMessage('پیام نوتیف الزامی است'),
        body('priority').optional().isIn(ALLOWED_PRIORITIES).withMessage('اولویت نامعتبر است'),
        body('category').optional().isIn(ALLOWED_CATEGORIES).withMessage('دسته‌بندی نامعتبر است'),
        body('type').optional().isIn(ALLOWED_TYPES).withMessage('نوع نوتیف نامعتبر است'),
        async (req, res) => {
            try {
                const errors = validationResult(req);
                if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

                const senderId = req.session.user?.id;
                if (!senderId) return res.status(401).json({ error: 'کاربر وارد نشده' });

                const now = Date.now();
                if (lastNotificationTime.has(senderId) && now - lastNotificationTime.get(senderId) < 2000) {
                    return res.status(429).json({ error: 'لطفاً قبل از ارسال نوتیف بعدی صبر کنید' });
                }

                const { userId, message, type, category, priority, scheduledAt, isImportant } = req.body;
                const notification = await Notification.create(userId || null, message, { type, priority, category, scheduledAt, isImportant });

                lastNotificationTime.set(senderId, now);

                const io = req.app.get('io');
                if (io) io.emit('newNotification', { notification });

                return res.status(201).json(notification);
            } catch (err) {
                console.error(err);
                return res.status(500).json({ error: 'خطا در ایجاد نوتیفیکیشن' });
            }
        }
    ],

    // ================================
    // 📌 ایجاد نوتیفیکیشن گروهی (Bulk)
    createBulkNotifications: [
        body('message').notEmpty().withMessage('پیام نوتیف الزامی است'),
        body('userIds').isArray({ min: 1 }).withMessage('لیست کاربران لازم است'),
        async (req, res) => {
            try {
                const errors = validationResult(req);
                if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

                const senderId = req.session.user?.id;
                if (!senderId) return res.status(401).json({ error: 'کاربر وارد نشده' });

                const { userIds, message, type, category, priority, scheduledAt, isImportant } = req.body;
                const notifications = await Notification.createBulk(userIds, message, { type, priority, category, scheduledAt, isImportant });

                const io = req.app.get('io');
                if (io) io.emit('newBulkNotification', { notifications });

                return res.status(201).json({ count: notifications.length, notifications });
            } catch (err) {
                console.error(err);
                return res.status(500).json({ error: 'خطا در ایجاد نوتیف گروهی' });
            }
        }
    ],

    // ================================
    // 📌 گرفتن همه نوتیف‌ها با فیلتر و صفحه‌بندی
    listNotifications: async (req, res) => {
        try {
            const { limit = 20, offset = 0, type, priority, onlyImportant, includeArchived, activeOnly } = req.query;
            const userId = req.session.user?.id;
            if (!userId) return res.status(401).json({ error: 'کاربر وارد نشده' });

            const notifications = await Notification.findByUser(userId, { limit, offset, type, priority, onlyImportant, includeArchived, activeOnly });
            return res.json(notifications);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'خطا در دریافت لیست نوتیف‌ها' });
        }
    },

    // ================================
    // 📌 گرفتن نوتیف بر اساس ID
    getNotificationById: async (req, res) => {
        try {
            const { id } = req.params;
            const notification = await Notification.findById(id);
            if (!notification) return res.status(404).json({ error: 'نوتیف پیدا نشد' });
            return res.json(notification);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'خطا در دریافت نوتیف' });
        }
    },

    // ================================
    // 📌 نوتیف‌های یک کاربر
    getUserNotifications: async (req, res) => {
        try {
            const sessionUserId = req.session.user?.id;
            if (!sessionUserId) return res.status(401).json({ error: 'کاربر وارد نشده' });

            const userId = parseInt(req.params.userId);
            if (sessionUserId !== userId) return res.status(403).json({ error: 'دسترسی غیرمجاز' });

            const { limit = 20, offset = 0, priority, type, onlyImportant } = req.query;
            const notifications = await Notification.findByUser(userId, { limit, offset, priority, type, onlyImportant });
            return res.json(notifications);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'خطا در دریافت نوتیف‌ها' });
        }
    },

    // ================================
    // 📌 نوتیف‌های خوانده‌نشده
    getUnreadNotifications: async (req, res) => {
        try {
            const userId = req.session.user?.id;
            if (!userId) return res.status(401).json({ error: 'کاربر وارد نشده' });

            const notifications = await Notification.findUnreadByUser(userId);
            return res.json(notifications);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'خطا در دریافت نوتیف‌های خوانده‌نشده' });
        }
    },

    // ================================
    // 📌 شمارش نوتیف‌های خوانده‌نشده
    countUnreadNotifications: async (req, res) => {
        try {
            const userId = req.session.user?.id;
            if (!userId) return res.status(401).json({ error: 'کاربر وارد نشده' });

            const count = await Notification.countUnreadByUser(userId);
            return res.json({ unreadCount: count });
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'خطا در شمارش نوتیف‌های خوانده‌نشده' });
        }
    },

    // ================================
    // 📌 مارک به عنوان خوانده‌شده
    markNotificationAsRead: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.session.user?.id;
            if (!userId) return res.status(401).json({ error: 'کاربر وارد نشده' });

            const updated = await Notification.markAsRead(id, userId);
            if (!updated) return res.status(404).json({ error: 'نوتیف پیدا نشد' });

            const io = req.app.get('io');
            if (io) io.emit('notificationRead', { id, userId });

            return res.json(updated);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'خطا در بروزرسانی نوتیف' });
        }
    },

    // ================================
    // 📌 مارک همه به عنوان خوانده‌شده
    markAllAsRead: async (req, res) => {
        try {
            const userId = req.session.user?.id;
            if (!userId) return res.status(401).json({ error: 'کاربر وارد نشده' });

            await Notification.markAllAsRead(userId);

            const io = req.app.get('io');
            if (io) io.emit('allNotificationsRead', { userId });

            return res.json({ message: 'تمام نوتیف‌ها خوانده شدند' });
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'خطا در بروزرسانی نوتیف‌ها' });
        }
    },

    // ================================
    // 📌 آرشیو و بازیابی
    archiveNotification: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.session.user?.id;
            if (!userId) return res.status(401).json({ error: 'کاربر وارد نشده' });

            const notification = await Notification.archive(id, userId);
            const io = req.app.get('io');
            if (io) io.emit('notificationArchived', { id, userId });

            return res.json(notification);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'خطا در آرشیو نوتیف' });
        }
    },

    restoreNotification: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.session.user?.id;
            if (!userId) return res.status(401).json({ error: 'کاربر وارد نشده' });

            const notification = await Notification.restoreFromArchive(id, userId);
            const io = req.app.get('io');
            if (io) io.emit('notificationRestored', { id, userId });

            return res.json(notification);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'خطا در بازیابی نوتیف' });
        }
    },

    // ================================
    // 📌 حذف نرم و کامل
    softDeleteNotification: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.session.user?.id;
            if (!userId) return res.status(401).json({ error: 'کاربر وارد نشده' });

            const notification = await Notification.softDelete(id, userId);
            return res.json(notification);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'خطا در حذف نرم' });
        }
    },

    deleteNotification: async (req, res) => {
        try {
            const { id } = req.params;
            await Notification.delete(id);
            return res.json({ message: 'نوتیف حذف شد' });
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'خطا در حذف نوتیف' });
        }
    },

    // ================================
    // 📌 واکنش‌ها
    addReaction: async (req, res) => {
        try {
            const { id } = req.params;
            const { reaction } = req.body;
            const userId = req.session.user?.id;
            if (!userId) return res.status(401).json({ error: 'کاربر وارد نشده' });

            await Notification.addReaction(id, userId, reaction);

            const io = req.app.get('io');
            if (io) io.emit('notificationReaction', { id, userId, reaction });

            return res.json({ message: 'واکنش ثبت شد' });
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'خطا در افزودن واکنش' });
        }
    },

    getReactions: async (req, res) => {
        try {
            const { id } = req.params;
            const reactions = await Notification.getReactions(id);
            return res.json(reactions);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'خطا در دریافت واکنش‌ها' });
        }
    },

    // ================================
    // 📌 جستجو و پاکسازی
    searchNotifications: async (req, res) => {
        try {
            const { query, type, role, startDate, endDate } = req.query;
            const notifications = await Notification.search({ query, type, role, startDate, endDate });
            return res.json(notifications);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'خطا در جستجو' });
        }
    },

    autoCleanNotifications: async (req, res) => {
        try {
            await Notification.autoClean();
            return res.json({ message: 'پاکسازی خودکار انجام شد' });
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'خطا در پاکسازی نوتیف‌ها' });
        }
    }
};
exports.markAsDelivered = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        // عملیات تحویل نوتیفیکیشن
        res.json({ success: true });
    } catch (err) {
        console.error('Error in markAsDelivered:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

exports.archiveNotification = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        // عملیات آرشیو
        res.json({ success: true });
    } catch (err) {
        console.error('Error in archiveNotification:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = notificationController;
