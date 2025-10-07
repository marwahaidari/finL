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

// ===============================
// Helpers
// ===============================
function handleValidationErrors(req, res, redirectUrl) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        req.flash('error', errors.array().map(e => e.msg).join(', '));
        return res.redirect(redirectUrl);
    }
}

function ensureAuth(req, res, next) {
    if (!req.session.user) return res.redirect('/login');
    next();
}

// ===============================
// Home & Dashboard
// ===============================
router.get('/', async (req, res) => {
    try {
        const totalUsers = await User.count();
        const totalOrders = await Order.count();
        const totalRequests = typeof Order.countRequests === 'function' ? await Order.countRequests() : 0;
        const stats = { totalUsers, totalOrders, totalRequests };
        res.render('index', { title: 'پرتال دولت الکترونیک', user: req.session.user || null, stats });
    } catch (err) {
        console.error('❌ Error fetching stats:', err);
        res.render('index', { title: 'پرتال دولت الکترونیک', user: req.session.user || null, stats: { totalUsers: 0, totalOrders: 0, totalRequests: 0 } });
    }
});

router.get('/dashboard', ensureAuth, (req, res) => {
    res.render('dashboard', { title: 'داشبورد', user: req.session.user });
});

// ===============================
// Authentication & Profile
// ===============================
router.get('/profile', ensureAuth, async (req, res) => {
    const user = await User.findById(req.session.user.id);
    res.render('profile', { title: 'پروفایل', user });
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
// Orders
// ===============================

router.get('/orders', ensureAuth, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const search = req.query.search || '';
    const { orders, totalPages } = await Order.findByUserPaginated(req.session.user.id, page, search);

    // console.log('Order object:', Order);
    res.render('orders', { title: 'سفارش‌ها', orders, totalPages, page, search });
});

router.get('/orders/create', ensureAuth, (req, res) => {
    res.render('createOrder', { title: 'ایجاد سفارش' });
});

router.post('/orders/create',
    ensureAuth,
    body('title').notEmpty(),
    body('description').notEmpty(),
    body('serviceId').isInt(),
    async (req, res) => {
        if (handleValidationErrors(req, res, '/orders/create')) return;
        const { title, description, serviceId } = req.body;
        await Order.create(req.session.user.id, title, description, serviceId);
        await Audit.log(req.session.user.id, `Created order ${title}`);
        res.redirect('/orders');
    }
);

router.get('/orders/edit/:id', ensureAuth, async (req, res) => {
    const order = await Order.findById(req.params.id);
    if (!order || order.user_id !== req.session.user.id) return res.status(403).send('Unauthorized');
    res.render('editOrder', { title: 'ویرایش سفارش', order });
});

router.post('/orders/edit/:id',
    ensureAuth,
    body('title').notEmpty(),
    body('description').notEmpty(),
    async (req, res) => {
        if (handleValidationErrors(req, res, `/orders/edit/${req.params.id}`)) return;
        const { title, description } = req.body;
        await Order.update(req.params.id, title, description);
        await Audit.log(req.session.user.id, `Edited order ${req.params.id}`);
        res.redirect('/orders');
    }
);

router.post('/orders/delete/:id', ensureAuth, async (req, res) => {
    await Order.softDelete(req.params.id);
    await Audit.log(req.session.user.id, `Deleted order ${req.params.id}`);
    res.redirect('/orders');
});

router.post('/orders/pay/:id', ensureAuth, async (req, res) => {
    await Order.markAsPaid(req.params.id);
    await Notification.create(req.session.user.id, `Payment successful for order #${req.params.id}`);
    await Audit.log(req.session.user.id, `Paid for order ${req.params.id}`);
    res.redirect('/orders');
});

// ===============================
// Officer
// ===============================
router.get('/officer', checkRole('officer'), async (req, res) => {
    const orders = await Order.findByDepartment(req.session.user.departmentId);
    res.render('officerDashboard', { title: 'داشبورد کارشناس', orders, user: req.session.user });
});

router.post('/officer/orders/:id/approve', checkRole('officer'), async (req, res) => {
    await Order.updateStatus(req.params.id, 'Approved');
    await Audit.log(req.session.user.id, `Approved order ${req.params.id}`);
    res.redirect('/officer');
});

router.post('/officer/orders/:id/reject', checkRole('officer'), async (req, res) => {
    await Order.updateStatus(req.params.id, 'Rejected');
    await Audit.log(req.session.user.id, `Rejected order ${req.params.id}`);
    res.redirect('/officer');
});

// ===============================
// Messages
// ===============================
router.get('/orders/:orderId/messages', ensureAuth, async (req, res) => {
    const messages = await Message.findByOrder(req.params.orderId);
    res.render('messages', { title: 'پیام‌ها', messages, orderId: req.params.orderId });
});

router.post('/orders/:orderId/messages',
    ensureAuth,
    body('content').notEmpty(),
    async (req, res) => {
        if (handleValidationErrors(req, res, `/orders/${req.params.orderId}/messages`)) return;
        await Message.send(req.session.user.id, req.params.orderId, req.body.content);
        await Audit.log(req.session.user.id, `Sent message on order ${req.params.orderId}`);
        res.redirect(`/orders/${req.params.orderId}/messages`);
    }
);

router.post('/orders/:orderId/messages/:messageId/reply',
    ensureAuth,
    body('content').notEmpty(),
    async (req, res) => {
        if (handleValidationErrors(req, res, `/orders/${req.params.orderId}/messages`)) return;
        await Message.reply(req.params.messageId, req.session.user.id, req.body.content);
        await Audit.log(req.session.user.id, `Replied to message ${req.params.messageId}`);
        res.redirect(`/orders/${req.params.orderId}/messages`);
    }
);

router.post('/orders/:orderId/messages/:messageId/delete', ensureAuth, async (req, res) => {
    await Message.delete(req.params.messageId);
    await Audit.log(req.session.user.id, `Deleted message ${req.params.messageId}`);
    res.redirect(`/orders/${req.params.orderId}/messages`);
});

// ===============================
// Files
// ===============================
router.get('/orders/:orderId/files', ensureAuth, async (req, res) => {
    const files = await File.findByOrder(req.params.orderId);
    res.render('files', { title: 'فایل‌ها', files, orderId: req.params.orderId });
});

router.get('/orders/:orderId/files/:fileId/download', ensureAuth, async (req, res) => {
    const file = await File.findById(req.params.fileId);
    if (!file || !fs.existsSync(path.resolve(file.filepath))) return res.status(404).send('File not found');
    res.download(path.resolve(file.filepath), file.filename);
});

router.post('/orders/:orderId/files/:fileId/delete', ensureAuth, async (req, res) => {
    const file = await File.findById(req.params.fileId);
    if (!file) return res.status(404).send('File not found');
    await File.softDelete(req.params.fileId);
    await Audit.log(req.session.user.id, `Deleted file ${req.params.fileId}`);
    res.redirect(`/orders/${req.params.orderId}/files`);
});

// ===============================
// Notifications
// ===============================
router.get('/notifications', ensureAuth, async (req, res) => {
    const notifications = await Notification.findByUser(req.session.user.id);
    res.render('notifications', { title: 'اطلاعیه‌ها', notifications });
});

router.post('/notifications/:id/read', ensureAuth, async (req, res) => {
    await Notification.markAsRead(req.params.id, req.session.user.id);
    await Audit.log(req.session.user.id, `Marked notification ${req.params.id} as read`);
    res.redirect('/notifications');
});

router.post('/notifications/:id/delete', ensureAuth, async (req, res) => {
    await Notification.delete(req.params.id, req.session.user.id);
    await Audit.log(req.session.user.id, `Deleted notification ${req.params.id}`);
    res.redirect('/notifications');
});

router.post('/notifications/clear', ensureAuth, async (req, res) => {
    await Notification.deleteAll(req.session.user.id);
    await Audit.log(req.session.user.id, `Cleared all notifications`);
    res.redirect('/notifications');
});

// ===============================
// Reviews
// ===============================
router.get('/reviews', ensureAuth, async (req, res) => {
    const reviews = await Review.findAll();
    res.render('reviews', { title: 'نظرات', reviews });
});

router.post('/reviews/delete/:id', ensureAuth, async (req, res) => {
    await Review.delete(req.params.id);
    await Audit.log(req.session.user.id, `Deleted review ${req.params.id}`);
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
    const users = await User.findAll();
    res.render('adminUsers', { title: 'مدیریت کاربران', users });
});

// Services Management
router.get('/admin/services', checkRole('admin'), async (req, res) => {
    const services = await Service.findAll();
    res.render('adminServices', { title: 'مدیریت خدمات', services });
});

// Departments Management
router.get('/admin/departments', checkRole('admin'), async (req, res) => {
    const departments = await Department.findAll();
    res.render('adminDepartments', { title: 'مدیریت دپارتمان‌ها', departments });
});

// Payments Management
router.get('/admin/payments', checkRole('admin'), async (req, res) => {
    const payments = await Payment.findAll();
    res.render('adminPayments', { title: 'مدیریت پرداخت‌ها', payments });
});

// Settings Management
router.get('/admin/settings', checkRole('admin'), async (req, res) => {
    const settings = await Settings.getAll();
    res.render('adminSettings', { title: 'تنظیمات سیستم', settings });
});

// Backup
router.get('/admin/backup', checkRole('admin'), async (req, res) => {
    const backups = await Backup.list();
    res.render('adminBackup', { title: 'پشتیبان‌گیری', backups });
});

// AI
router.post('/admin/ai/analyze', checkRole('admin'), async (req, res) => {
    const result = await AI.analyze(req.body);
    res.json(result);
});

router.post('/admin/ai/chat', checkRole('admin'), async (req, res) => {
    const response = await AI.chat(req.body.message);
    res.json(response);
});

// Export Data
router.get('/admin/export/:type', checkRole('admin'), async (req, res) => {
    let data, fields, filename;
    switch (req.params.type) {
        case 'users':
            data = await User.findAll();
            fields = ['id', 'name', 'email', 'role'];
            filename = 'users.csv'; break;
        case 'orders':
            data = await Order.findAll();
            fields = ['id', 'title', 'status', 'user_id'];
            filename = 'orders.csv'; break;
        case 'services':
            data = await Service.findAll();
            fields = ['id', 'name', 'description'];
            filename = 'services.csv'; break;
        default: return res.status(400).send('Invalid export type');
    }
    const parser = new Parser({ fields });
    const csv = parser.parse(data);
    res.header('Content-Type', 'text/csv');
    res.attachment(filename);
    res.send(csv);
});

module.exports = router;
