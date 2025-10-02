const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');

// Controller
const OrderController = require('../controllers/orderController');

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
router.post('/create',
    body('title').notEmpty().withMessage('Title is required'),
    body('description').notEmpty().withMessage('Description is required'),
    (req, res, next) => {
        if (handleValidationErrors(req, res, '/orders/create')) return;
        next();
    },
    OrderController.createOrder
);

router.get('/edit/:id', OrderController.editForm);
router.post('/edit/:id',
    body('title').notEmpty().withMessage('Title is required'),
    body('description').notEmpty().withMessage('Description is required'),
    (req, res, next) => {
        if (handleValidationErrors(req, res, `/orders/edit/${req.params.id}`)) return;
        next();
    },
    OrderController.updateOrder
);

router.post('/delete/:id', OrderController.deleteOrder);
router.post('/pay/:id', OrderController.payOrder);

// ===============================
// Payment history
router.get('/paid', OrderController.getPaidOrders);

// ===============================
// Admin Reports
router.get('/admin/reports', OrderController.getAdminReports);

// ===============================
// API JSON (Optional)
router.get('/api', OrderController.apiGetOrders);

// ===============================
// Files / Documents
router.get('/:orderId/files', async (req, res) => {
    const files = await require('../models/File').findByOrder(req.params.orderId);
    res.render('files', { files, orderId: req.params.orderId });
});

router.get('/:orderId/files/:fileId/download', async (req, res) => {
    const file = await require('../models/File').findById(req.params.fileId);
    res.download(file.filepath, file.filename);
});

router.post('/:orderId/files/:fileId/delete', async (req, res) => {
    await require('../models/File').softDelete(req.params.fileId);
    res.redirect(`/orders/${req.params.orderId}/files`);
});

// ===============================
// Messages
const Message = require('../models/Message');

router.get('/:orderId/messages', async (req, res) => {
    const messages = await Message.findByOrder(req.params.orderId);
    res.render('messages', { messages, orderId: req.params.orderId });
});

router.post('/:orderId/messages',
    body('content').notEmpty().withMessage('Message content required'),
    async (req, res, next) => {
        if (handleValidationErrors(req, res, `/orders/${req.params.orderId}/messages`)) return;
        await Message.send(req.session.user.id, req.params.orderId, req.body.content);
        res.redirect(`/orders/${req.params.orderId}/messages`);
    }
);

router.post('/:orderId/messages/:messageId/reply',
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
