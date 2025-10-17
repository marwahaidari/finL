// routes/orders.js
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Controllers & Models
const OrderController = require('../controllers/orderController');
const File = require('../models/File');
const Message = require('../models/Message');

// -------------------- Middleware: Auth Check --------------------
function ensureAuth(req, res, next) {
    if (!req.session || !req.session.user) {
        req.flash && req.flash('error_msg', 'ابتدا وارد حساب کاربری شوید');
        return res.redirect('/login');
    }
    next();
}

// -------------------- Multer Config (Upload) --------------------
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = path.join(__dirname, '..', 'uploads', 'orders');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, unique + '-' + file.originalname.replace(/\s+/g, '_'));
    }
});
const upload = multer({ storage });

// -------------------- Validation Helper --------------------
function handleValidationErrors(req, res, redirectUrl) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const msg = errors.array().map(e => e.msg).join(', ');
        req.flash && req.flash('error_msg', msg);
        return res.redirect(redirectUrl);
    }
}

// ==========================================================
//                     Citizen Orders
// ==========================================================

// لیست همه سفارش‌ها
router.get('/', ensureAuth, OrderController.getOrders);

// فرم ایجاد سفارش
router.get('/create', ensureAuth, (req, res) => {
    res.render('createOrder', { title: 'ایجاد سفارش', user: req.session.user });
});

// ثبت سفارش جدید
router.post(
    '/create',
    ensureAuth,
    upload.array('attachments'),
    body('title').notEmpty().withMessage('عنوان سفارش الزامی است'),
    body('description').notEmpty().withMessage('توضیحات سفارش الزامی است'),
    (req, res, next) => {
        if (handleValidationErrors(req, res, '/orders/create')) return;
        next();
    },
    OrderController.createOrder
);

// فرم ویرایش سفارش
router.get('/edit/:id', ensureAuth, OrderController.editForm);

// ذخیره ویرایش سفارش
router.post(
    '/edit/:id',
    ensureAuth,
    upload.array('attachments'),
    body('title').notEmpty().withMessage('عنوان الزامی است'),
    body('description').notEmpty().withMessage('توضیحات الزامی است'),
    (req, res, next) => {
        if (handleValidationErrors(req, res, `/orders/edit/${req.params.id}`)) return;
        next();
    },
    OrderController.updateOrder
);

// صفحه تأیید حذف
router.get('/delete/:id', ensureAuth, async (req, res) => {
    try {
        const order = await OrderController.getOrderById(req.params.id);
        if (!order) {
            req.flash && req.flash('error_msg', 'سفارش یافت نشد');
            return res.redirect('/orders');
        }
        res.render('deleteConfirmation', { title: 'حذف سفارش', order, user: req.session.user });
    } catch (err) {
        console.error('delete page error:', err);
        req.flash && req.flash('error_msg', 'خطا در بارگذاری صفحه حذف');
        res.redirect('/orders');
    }
});

// حذف نهایی سفارش
router.post('/delete/:id', ensureAuth, OrderController.deleteOrder);

// پرداخت سفارش
router.post('/pay/:id', ensureAuth, OrderController.payOrder);

// مشاهده سفارش‌های پرداخت‌شده
router.get('/paid', ensureAuth, OrderController.getPaidOrders);

// گزارش‌های ادمین
router.get('/admin/reports', ensureAuth, OrderController.getAdminReports);

// API برای سفارش‌ها
router.get('/api', ensureAuth, OrderController.apiGetOrders);

// جزئیات هر سفارش
router.get('/:id', ensureAuth, async (req, res) => {
    try {
        const order = await OrderController.getOrderById(req.params.id);
        if (!order) {
            req.flash && req.flash('error_msg', 'سفارش یافت نشد');
            return res.redirect('/orders');
        }

        // محاسبه درصد پیشرفت
        let progressWidth = '0%';
        if (order.status === 'pending') progressWidth = '50%';
        else if (order.status === 'completed') progressWidth = '100%';

        // فایل‌ها و پیام‌ها (در صورت وجود مدل)
        const files = File.findByOrder ? await File.findByOrder(order.id) : [];
        const messages = Message.findByOrder ? await Message.findByOrder(order.id) : [];

        res.render('orderDetail', {
            title: `جزئیات سفارش #${order.id}`,
            order,
            progressWidth,
            files,
            messages,
            user: req.session.user
        });
    } catch (err) {
        console.error('order detail route error:', err);
        req.flash && req.flash('error_msg', 'خطا در بارگذاری جزئیات سفارش');
        res.redirect('/orders');
    }
});

// ==========================================================
//                         Files
// ==========================================================
router.get('/:orderId/files', ensureAuth, async (req, res) => {
    const files = File.findByOrder ? await File.findByOrder(req.params.orderId) : [];
    res.render('files', {
        title: 'فایل‌های سفارش',
        files,
        orderId: req.params.orderId,
        user: req.session.user,
        message: null  // این خط اضافه شد تا ارور undefined برطرف بشه
    });
});

router.get('/:orderId/files/:fileId/download', ensureAuth, async (req, res) => {
    const file = await File.findById(req.params.fileId);
    if (!file) return res.status(404).send('فایل یافت نشد');
    res.download(path.resolve(file.filepath), file.filename);
});

router.post('/:orderId/files/:fileId/delete', ensureAuth, async (req, res) => {
    await File.softDelete(req.params.fileId);
    res.redirect(`/orders/${req.params.orderId}/files`);
});

// ==========================================================
//                       Messages
// ==========================================================
router.get('/:orderId/messages', ensureAuth, async (req, res) => {
    const messages = await Message.findByOrder ? await Message.findByOrder(req.params.orderId) : [];
    res.render('messages', { title: 'پیام‌ها', messages, orderId: req.params.orderId, user: req.session.user });
});

router.post(
    '/:orderId/messages',
    ensureAuth,
    body('content').notEmpty().withMessage('متن پیام الزامی است'),
    async (req, res) => {
        if (handleValidationErrors(req, res, `/orders/${req.params.orderId}/messages`)) return;
        await Message.send(req.session.user.id, req.params.orderId, req.body.content);
        res.redirect(`/orders/${req.params.orderId}/messages`);
    }
);

router.post(
    '/:orderId/messages/:messageId/reply',
    ensureAuth,
    body('content').notEmpty().withMessage('متن پاسخ الزامی است'),
    async (req, res) => {
        if (handleValidationErrors(req, res, `/orders/${req.params.orderId}/messages`)) return;
        await Message.reply(req.params.messageId, req.session.user.id, req.body.content);
        res.redirect(`/orders/${req.params.orderId}/messages`);
    }
);

router.post('/:orderId/messages/:messageId/delete', ensureAuth, async (req, res) => {
    await Message.delete(req.params.messageId);
    res.redirect(`/orders/${req.params.orderId}/messages`);
});

module.exports = router;
