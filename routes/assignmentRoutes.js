// routes/assignmentRoutes.js
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');

// Middleware بررسی نقش (اختیاری)
let checkRole;
try {
    checkRole = require('../middlewares/roleMiddleware');
} catch {
    checkRole = (roles) => (req, res, next) => next();
}

// Controller
const AssignmentController = require('../controllers/assignmentController');

// ===============================
// Helper: اعتبارسنجی خطاها
// ===============================
function handleValidationErrors(req, res, redirectUrl) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        req.flash('error', errors.array().map(e => e.msg).join(', '));
        return res.redirect(redirectUrl);
    }
}

// ===============================
// مسیرهای درخواست‌ها (هماهنگ با متدهای موجود در controller)
// ===============================

// گرفتن همه درخواست‌ها (فقط admin/officer)
router.get('/', checkRole(['admin', 'officer']), AssignmentController.getAllRequests);

// ایجاد درخواست جدید (کاربر citizen)
router.post('/create',
    body('service_id').notEmpty().withMessage('سرویس الزامی است'),
    body('description').notEmpty().withMessage('توضیحات الزامی است'),
    (req, res, next) => {
        if (handleValidationErrors(req, res, '/assignments/create')) return;
        next();
    },
    AssignmentController.createRequest
);

// گرفتن یک درخواست بر اساس ID
router.get('/:id', AssignmentController.getRequestById);

// بروزرسانی وضعیت درخواست (admin/officer)
router.post('/status/:id', checkRole(['admin', 'officer']), AssignmentController.updateRequestStatus);

// گرفتن درخواست‌های یک شهروند خاص
router.get('/citizen/:userId', AssignmentController.getCitizenRequests);

// حذف درخواست
router.post('/delete/:id', AssignmentController.deleteRequest);

module.exports = router;
