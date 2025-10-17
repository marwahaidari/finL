const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// ================================
// صفحه مدیریت پرداخت‌ها (EJS)
// ================================
// این مسیر قبل از /:id قرار گرفته تا conflict پیش نیاید
router.get('/dashboard', (req, res) => {
    res.render('payments'); // مطمئن شو فایل payment.ejs در فولدر view هست
});

// ================================
// ایجاد پرداخت جدید
// ================================
router.post('/', paymentController.createPayment);

// ================================
// دریافت همه پرداخت‌های یک کاربر
// ================================
router.get('/user/:userId', paymentController.getUserPayments);

// ================================
// شمارش پرداخت‌های یک کاربر
// ================================
router.get('/user/:userId/count', paymentController.countUserPayments);

// ================================
// دریافت تاریخچه تغییرات یک پرداخت
// ================================
router.get('/:id/history', paymentController.getPaymentHistory);

// ================================
// دریافت اطلاعات یک پرداخت
// ================================
router.get('/:id', paymentController.getPaymentById);

// ================================
// بروزرسانی وضعیت پرداخت
// ================================
router.put('/:id/status', paymentController.updatePaymentStatus);

// ================================
// علامت‌گذاری پرداخت به عنوان پرداخت شده
// ================================
router.put('/:id/mark-paid', paymentController.markAsPaid);

// ================================
// حذف نرم (غیرفعال کردن پرداخت)
// ================================
router.delete('/:id/soft', paymentController.softDeletePayment);

// ================================
// حذف کامل پرداخت
// ================================
router.delete('/:id', paymentController.deletePayment);

module.exports = router;
