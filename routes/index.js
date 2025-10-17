// routes/index.js
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const checkRole = require('../middlewares/checkRole');
const { uploadProfile, uploadDocument, uploadMultipleImages } = require('../middlewares/upload');
const { Parser } = require('json2csv');
const fs = require('fs');
const path = require('path');

// Models
const User = require('../models/User');
const Order = require('../models/Order');
const Review = require('../models/Review');
const Message = require('../models/Message');
const File = require('../models/File');
const Notification = require('../models/Notification');
const Department = require('../models/Department');
const Payment = require('../models/Payment');
const Settings = require('../models/Settings');
const Service = require('../models/Service');

// Utils
const Backup = require('../utils/Backup');
const AI = require('../utils/AI');
const Audit = require('../utils/Audit');

// mount orders router (moved out of this file)
const ordersRouter = require('./orderRoutes');

// ===============================
// Helpers
// ===============================
function handleValidationErrors(req, res, redirectUrl) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        if (req.flash) req.flash('error', errors.array().map(e => e.msg).join(', '));
        return res.redirect(redirectUrl);
    }
}

function ensureAuth(req, res, next) {
    if (!req.session || !req.session.user) return res.redirect('/login');
    next();
}

// ===============================
// Home & Dashboard
// ===============================
router.get('/', async (req, res) => {
    try {
        const totalUsers = typeof User.count === 'function' ? await User.count() : 0;
        const totalOrders = typeof Order.count === 'function' ? await Order.count() : 0;
        const totalRequests = typeof Order.countRequests === 'function' ? await Order.countRequests() : 0;
        const stats = { totalUsers, totalOrders, totalRequests };
        res.render('index', { title: 'پرتال دولت الکترونیک', user: req.session ? req.session.user : null, stats });
    } catch (err) {
        console.error('❌ Error fetching stats:', err);
        res.render('index', { title: 'پرتال دولت الکترونیک', user: req.session ? req.session.user : null, stats: { totalUsers: 0, totalOrders: 0, totalRequests: 0 } });
    }
});

// داشبورد مدیریت
router.get('/dashboard', ensureAuth, async (req, res) => {
    try {
        const q = req.query.q || '';
        const status = req.query.status || '';
        const priority = req.query.priority || '';

        // گرفتن داده‌ها به صورت موازی برای سرعت
        const [
            rawStats,
            orders,
            recentOrders,
            users
        ] = await Promise.all([
            (typeof Order.getReport === 'function') ? Order.getReport() : Promise.resolve({
                total_orders: 0, paid_orders: 0, pending_orders: 0, completed_orders: 0
            }),
            (typeof Order.findAll === 'function') ? Order.findAll({ limit: 50, offset: 0, status: status || null, priority: priority || null }) : Promise.resolve([]),
            (typeof Order.findRecent === 'function') ? Order.findRecent(5) : Promise.resolve([]),
            (typeof User.findAll === 'function') ? User.findAll() : Promise.resolve([])
        ]);

        // اطمینان از اینکه stats عددی هستند
        const stats = {
            total_orders: parseInt(rawStats.total_orders || 0, 10),
            paid_orders: parseInt(rawStats.paid_orders || (rawStats.paid_orders_count || 0), 10),
            pending_orders: parseInt(rawStats.pending_orders || 0, 10),
            completed_orders: parseInt(rawStats.completed_orders || 0, 10)
        };

        res.render('dashboard', {
            title: 'داشبورد مدیریت',
            user: req.session.user,
            stats,
            orders,
            recentOrders,
            users,
            q,
            status,
            priority
        });
    } catch (err) {
        console.error('❌ Dashboard error:', err);

        // ارسال مقادیر پیش‌فرض به view تا EJS هنگام render خطا ندهد
        res.render('dashboard', {
            title: 'داشبورد مدیریت',
            user: req.session.user,
            stats: { total_orders: 0, paid_orders: 0, pending_orders: 0, completed_orders: 0 },
            orders: [],
            recentOrders: [],
            users: [],
            q: '',
            status: '',
            priority: ''
        });
    }
});

// ===============================
// Authentication & Profile
// ===============================
router.get('/profile', ensureAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;

        // 📌 دریافت اطلاعات کاربر
        const user = await User.findById(userId);

        // 📜 دریافت سوابق فعالیت (سفارش‌ها)
        const history = await Order.findAll({
            where: { user_id: userId },
            order: [['created_at', 'DESC']],
            limit: 10
        });

        // ⭐ دریافت بازخوردها / امتیازها
        const reviews = await Review.findAll({
            where: { user_id: userId },
            order: [['created_at', 'DESC']],
            limit: 5
        });

        // 🧭 ارسال داده‌ها به EJS
        res.render('profile', {
            title: 'پروفایل کاربر',
            user,
            history,
            reviews
        });

    } catch (err) {
        console.error('❌ profile load error:', err);
        req.flash && req.flash('error', 'خطا در بارگذاری پروفایل');

        res.render('profile', {
            title: 'پروفایل',
            user: req.session.user,
            history: [],
            reviews: []
        });
    }
});


router.post('/profile/edit',
    ensureAuth,
    body('name').notEmpty().withMessage('Name required'),
    body('email').isEmail().withMessage('Valid email required'),
    async (req, res) => {
        if (handleValidationErrors(req, res, '/profile')) return;
        const { name, email } = req.body;
        await User.updateProfile(req.session.user.id, name, email);
        await Audit.log(req.session.user.id, 'Updated profile');
        res.redirect('/profile');
    }
);

router.post('/profile/change-password',
    ensureAuth,
    body('currentPassword').notEmpty(),
    body('newPassword').isLength({ min: 6 }).withMessage('Min 6 chars'),
    async (req, res) => {
        if (handleValidationErrors(req, res, '/profile')) return;
        const { currentPassword, newPassword } = req.body;
        await User.changePassword(req.session.user.id, currentPassword, newPassword);
        await Audit.log(req.session.user.id, 'Changed password');
        res.redirect('/profile');
    }
);

router.get('/logout', ensureAuth, (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).send('Error logging out');
        res.redirect('/login');
    });
});

// ===============================
// Mount Orders Router
//  (تمام routeهای سفارش در routes/orders.js قرار دارند)
// ===============================
router.use('/orders', ordersRouter);

// ===============================
// Officer
// ===============================
router.get('/officer', checkRole('officer'), async (req, res) => {
    try {
        let orders = [];
        if (typeof Order.findByDepartment === 'function') {
            orders = await Order.findByDepartment(req.session.user.departmentId);
        } else {
            console.warn('Order.findByDepartment not implemented; returning empty list for /officer');
        }
        res.render('officerDashboard', { title: 'داشبورد کارشناس', orders, user: req.session.user });
    } catch (err) {
        console.error('officer route error:', err);
        req.flash && req.flash('error', 'Could not load officer dashboard');
        res.redirect('/dashboard');
    }
});

router.post('/officer/orders/:id/approve', checkRole('officer'), async (req, res) => {
    try {
        if (typeof Order.updateStatus === 'function') {
            await Order.updateStatus(req.params.id, 'Approved');
            await Audit.log(req.session.user.id, `Approved order ${req.params.id}`);
        } else {
            console.warn('Order.updateStatus not implemented; cannot approve');
        }
        res.redirect('/officer');
    } catch (err) {
        console.error('approve error:', err);
        res.redirect('/officer');
    }
});

router.post('/officer/orders/:id/reject', checkRole('officer'), async (req, res) => {
    try {
        if (typeof Order.updateStatus === 'function') {
            await Order.updateStatus(req.params.id, 'Rejected');
            await Audit.log(req.session.user.id, `Rejected order ${req.params.id}`);
        } else {
            console.warn('Order.updateStatus not implemented; cannot reject');
        }
        res.redirect('/officer');
    } catch (err) {
        console.error('reject error:', err);
        res.redirect('/officer');
    }
});

// ===============================
// Messages (kept minimal - detailed message routes are in orders router)
// ===============================
router.get('/orders/:orderId/messages', ensureAuth, async (req, res) => {
    try {
        const messages = (typeof Message.findByOrder === 'function') ? await Message.findByOrder(req.params.orderId) : [];
        res.render('messages', { title: 'پیام‌ها', messages, orderId: req.params.orderId });
    } catch (err) {
        console.error('messages load error:', err);
        req.flash && req.flash('error', 'Could not load messages');
        res.redirect('/orders');
    }
});

router.post('/orders/:orderId/messages',
    ensureAuth,
    body('content').notEmpty(),
    async (req, res) => {
        if (handleValidationErrors(req, res, `/orders/${req.params.orderId}/messages`)) return;
        if (typeof Message.send === 'function') {
            await Message.send(req.session.user.id, req.params.orderId, req.body.content);
            await Audit.log(req.session.user.id, `Sent message on order ${req.params.orderId}`);
        } else {
            console.warn('Message.send not implemented');
        }
        res.redirect(`/orders/${req.params.orderId}/messages`);
    }
);

// ===============================
// Files (kept minimal - file routes mostly in orders router)
// ===============================
router.get('/orders/:orderId/files', ensureAuth, async (req, res) => {
    try {
        const files = (typeof File.findByOrder === 'function') ? await File.findByOrder(req.params.orderId) : [];
        res.render('files', { title: 'فایل‌ها', files, orderId: req.params.orderId });
    } catch (err) {
        console.error('files load error:', err);
        req.flash && req.flash('error', 'Could not load files');
        res.redirect('/orders');
    }
});

router.get('/orders/:orderId/files/:fileId/download', ensureAuth, async (req, res) => {
    try {
        if (typeof File.findById !== 'function') return res.status(404).send('File not found');
        const file = await File.findById(req.params.fileId);
        if (!file || !fs.existsSync(path.resolve(file.filepath))) return res.status(404).send('File not found');
        res.download(path.resolve(file.filepath), file.filename);
    } catch (err) {
        console.error('file download error:', err);
        res.status(500).send('Error downloading file');
    }
});

router.post('/orders/:orderId/files/:fileId/delete', ensureAuth, async (req, res) => {
    try {
        if (typeof File.findById !== 'function') return res.status(404).send('File not found');
        const file = await File.findById(req.params.fileId);
        if (!file) return res.status(404).send('File not found');
        if (typeof File.softDelete === 'function') {
            await File.softDelete(req.params.fileId);
            await Audit.log(req.session.user.id, `Deleted file ${req.params.fileId}`);
        }
        res.redirect(`/orders/${req.params.orderId}/files`);
    } catch (err) {
        console.error('file delete error:', err);
        res.redirect(`/orders/${req.params.orderId}/files`);
    }
});

// ===============================
// Notifications
// ===============================
router.get('/notifications', ensureAuth, async (req, res) => {
    try {
        const notifications = (typeof Notification.findByUser === 'function') ? await Notification.findByUser(req.session.user.id) : [];
        res.render('notifications', { title: 'اطلاعیه‌ها', notifications });
    } catch (err) {
        console.error('notifications load error:', err);
        res.render('notifications', { title: 'اطلاعیه‌ها', notifications: [] });
    }
});

router.post('/notifications/:id/read', ensureAuth, async (req, res) => {
    if (typeof Notification.markAsRead === 'function') {
        await Notification.markAsRead(req.params.id, req.session.user.id);
        await Audit.log(req.session.user.id, `Marked notification ${req.params.id} as read`);
    }
    res.redirect('/notifications');
});

router.post('/notifications/:id/delete', ensureAuth, async (req, res) => {
    if (typeof Notification.delete === 'function') {
        await Notification.delete(req.params.id, req.session.user.id);
        await Audit.log(req.session.user.id, `Deleted notification ${req.params.id}`);
    }
    res.redirect('/notifications');
});

router.post('/notifications/clear', ensureAuth, async (req, res) => {
    if (typeof Notification.deleteAll === 'function') {
        await Notification.deleteAll(req.session.user.id);
        await Audit.log(req.session.user.id, `Cleared all notifications`);
    }
    res.redirect('/notifications');
});

// ===============================
// Reviews
// ===============================
router.get('/reviews', ensureAuth, async (req, res) => {
    try {
        const reviews = (typeof Review.findAll === 'function') ? await Review.findAll() : [];
        res.render('reviews', { title: 'نظرات', reviews });
    } catch (err) {
        console.error('reviews load error:', err);
        res.render('reviews', { title: 'نظرات', reviews: [] });
    }
});

router.post('/reviews/delete/:id', ensureAuth, async (req, res) => {
    if (typeof Review.delete === 'function') {
        await Review.delete(req.params.id);
        await Audit.log(req.session.user.id, `Deleted review ${req.params.id}`);
    }
    res.redirect('/reviews');
});

// ===============================
// Admin & Management
// ===============================
router.get('/admin', checkRole('admin'), (req, res) => {
    res.render('adminDashboard', { title: 'داشبورد مدیریت', user: req.session.user });
});

// Users Management
router.get('/admin/users', checkRole('admin'), async (req, res) => {
    const users = (typeof User.findAll === 'function') ? await User.findAll() : [];
    res.render('adminUsers', { title: 'مدیریت کاربران', users });
});

// Services Management
router.get('/admin/services', checkRole('admin'), async (req, res) => {
    const services = (typeof Service.findAll === 'function') ? await Service.findAll() : [];
    res.render('adminServices', { title: 'مدیریت خدمات', services });
});

// Departments Management
router.get('/admin/departments', checkRole('admin'), async (req, res) => {
    const departments = (typeof Department.findAll === 'function') ? await Department.findAll() : [];
    res.render('adminDepartments', { title: 'مدیریت دپارتمان‌ها', departments });
});

// Payments Management
router.get('/admin/payments', checkRole('admin'), async (req, res) => {
    const payments = (typeof Payment.findAll === 'function') ? await Payment.findAll() : [];
    res.render('adminPayments', { title: 'مدیریت پرداخت‌ها', payments });
});

// Settings Management
router.get('/admin/settings', checkRole('admin'), async (req, res) => {
    const settings = (typeof Settings.getAll === 'function') ? await Settings.getAll() : {};
    res.render('adminSettings', { title: 'تنظیمات سیستم', settings });
});

// Backup
router.get('/admin/backup', checkRole('admin'), async (req, res) => {
    const backups = (typeof Backup.list === 'function') ? await Backup.list() : [];
    res.render('adminBackup', { title: 'پشتیبان‌گیری', backups });
});

// AI
router.post('/admin/ai/analyze', checkRole('admin'), async (req, res) => {
    const result = (typeof AI.analyze === 'function') ? await AI.analyze(req.body) : { error: 'AI utility not available' };
    res.json(result);
});

router.post('/admin/ai/chat', checkRole('admin'), async (req, res) => {
    const response = (typeof AI.chat === 'function') ? await AI.chat(req.body.message) : { error: 'AI utility not available' };
    res.json(response);
});

// Export Data
router.get('/admin/export/:type', checkRole('admin'), async (req, res) => {
    try {
        let data = [];
        let fields = [];
        let filename = 'export.csv';

        switch (req.params.type) {
            case 'users':
                data = (typeof User.findAll === 'function') ? await User.findAll() : [];
                fields = ['id', 'name', 'email', 'role'];
                filename = 'users.csv'; break;
            case 'orders':
                data = (typeof Order.findAll === 'function') ? await Order.findAll() : [];
                fields = ['id', 'title', 'status', 'user_id'];
                filename = 'orders.csv'; break;
            case 'services':
                data = (typeof Service.findAll === 'function') ? await Service.findAll() : [];
                fields = ['id', 'name', 'description'];
                filename = 'services.csv'; break;
            default: return res.status(400).send('Invalid export type');
        }

        const parser = new Parser({ fields });
        const csv = parser.parse(data);
        res.header('Content-Type', 'text/csv');
        res.attachment(filename);
        res.send(csv);
    } catch (err) {
        console.error('export error:', err);
        res.status(500).send('Export failed');
    }
});

module.exports = router;
