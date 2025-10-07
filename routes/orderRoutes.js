const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');

// Controller
const OrderController = require('../controllers/orderController');
const File = require('../models/File');
const Message = require('../models/Message');

// ===============================
// Helper: Validation Error Handler
// ===============================
function handleValidationErrors(req, res, redirectUrl) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        req.flash('error_msg', errors.array().map(e => e.msg).join(', '));
        return res.redirect(redirectUrl);
    }
}

// ===============================
// Citizen Orders
// ===============================
router.get('/', OrderController.getOrders);

router.get('/create', (req, res) => res.render('createOrder'));

router.post(
    '/create',
    body('title').notEmpty().withMessage('Title is required'),
    body('description').notEmpty().withMessage('Description is required'),
    (req, res, next) => {
        if (handleValidationErrors(req, res, '/orders/create')) return;
        next();
    },
    OrderController.createOrder
);

router.get('/edit/:id', OrderController.editForm);

router.post(
    '/edit/:id',
    body('title').notEmpty().withMessage('Title is required'),
    body('description').notEmpty().withMessage('Description is required'),
    (req, res, next) => {
        if (handleValidationErrors(req, res, `/orders/edit/${req.params.id}`)) return;
        next();
    },
    OrderController.updateOrder
);

// ===============================
// Delete Confirmation Page (NEW)
// ===============================
router.get('/delete/:id', async (req, res) => {
    try {
        const order = await OrderController.getOrderById(req.params.id);
        if (!order) {
            req.flash('error_msg', 'Order not found');
            return res.redirect('/orders');
        }
        res.render('deleteOrder', { order });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Could not load delete confirmation page');
        res.redirect('/orders');
    }
});

// ===============================
// Delete Order
// ===============================
router.post('/delete/:id', OrderController.deleteOrder);

// ===============================
// Pay Order
// ===============================
router.post('/pay/:id', OrderController.payOrder);

// ===============================
// Payment history
// ===============================
router.get('/paid', OrderController.getPaidOrders);

// ===============================
// Admin Reports
// ===============================
router.get('/admin/reports', OrderController.getAdminReports);

// ===============================
// API JSON (Optional)
// ===============================
router.get('/api', OrderController.apiGetOrders);

// ===============================
// Order Detail
// ===============================
router.get('/:id', async (req, res) => {
    try {
        const order = await OrderController.getOrderById(req.params.id);
        if (!order) {
            req.flash('error_msg', 'Order not found');
            return res.redirect('/orders');
        }

        // محاسبه progressWidth بر اساس وضعیت سفارش
        let progressWidth = '0%';
        if (order.status === 'pending') progressWidth = '50%';
        else if (order.status === 'completed') progressWidth = '100%';

        // گرفتن فایل‌ها و پیام‌ها
        const files = await File.findByOrder(order.id);
        const messages = await Message.findByOrder(order.id);

        res.render('orderDetail', { order, progressWidth, files, messages });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Could not load order details');
        res.redirect('/orders');
    }
});

// ===============================
// Files / Documents
// ===============================
router.get('/:orderId/files', async (req, res) => {
    const files = await File.findByOrder(req.params.orderId);
    res.render('files', { files, orderId: req.params.orderId });
});

router.get('/:orderId/files/:fileId/download', async (req, res) => {
    const file = await File.findById(req.params.fileId);
    res.download(file.filepath, file.filename);
});

router.post('/:orderId/files/:fileId/delete', async (req, res) => {
    await File.softDelete(req.params.fileId);
    res.redirect(`/orders/${req.params.orderId}/files`);
});

// ===============================
// Messages
// ===============================
router.get('/:orderId/messages', async (req, res) => {
    const messages = await Message.findByOrder(req.params.orderId);
    res.render('messages', { messages, orderId: req.params.orderId });
});

router.post(
    '/:orderId/messages',
    body('content').notEmpty().withMessage('Message content required'),
    async (req, res, next) => {
        if (handleValidationErrors(req, res, `/orders/${req.params.orderId}/messages`)) return;
        await Message.send(req.session.user.id, req.params.orderId, req.body.content);
        res.redirect(`/orders/${req.params.orderId}/messages`);
    }
);

router.post(
    '/:orderId/messages/:messageId/reply',
    body('content').notEmpty().withMessage('Reply content required'),
    async (req, res, next) => {
        if (handleValidationErrors(req, res, `/orders/${req.params.orderId}/messages`)) return;
        await Message.reply(req.params.messageId, req.session.user.id, req.body.content);
        res.redirect(`/orders/${req.params.orderId}/messages`);
    }
);

router.post('/:orderId/messages/:messageId/delete', async (req, res) => {
    await Message.delete(req.params.messageId);
    res.redirect(`/orders/${req.params.orderId}/messages`);
});

module.exports = router;
