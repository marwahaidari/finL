const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// ایجاد پرداخت جدید
router.post('/', paymentController.createPayment);

// دریافت اطلاعات یک پرداخت
router.get('/:id', paymentController.getPaymentById);

// دریافت همه پرداخت‌های یک کاربر
router.get('/user/:userId', paymentController.getUserPayments);

// بروزرسانی وضعیت پرداخت
router.put('/:id/status', paymentController.updatePaymentStatus);

// شمارش پرداخت‌های یک کاربر
router.get('/user/:userId/count', paymentController.countUserPayments);

// دریافت تاریخچه تغییرات یک پرداخت
router.get('/:id/history', paymentController.getPaymentHistory);

// حذف نرم (غیرفعال کردن پرداخت)
router.delete('/:id/soft', paymentController.softDeletePayment);

// حذف کامل پرداخت
router.delete('/:id', paymentController.deletePayment);

module.exports = router;
