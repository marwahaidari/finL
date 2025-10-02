const express = require('express');
const router = express.Router();
const checkRole = require('../middlewares/checkRole');
const adminController = require('../controllers/adminController');

// تمام مسیرها زیر /admin می‌آیند
// محافظت با checkRole => فقط admin/superadmin

// =============================
// Citizens & Employees Management
// =============================
router.get('/users', checkRole('admin'), adminController.getUsers); // لیست همه شهروندان/کارمندان
router.get('/users/:id', checkRole('admin'), adminController.getUserById);
router.post('/users/create', checkRole('admin'), adminController.createUser);
router.post('/users/update/:id', checkRole('admin'), adminController.updateUser);
router.post('/users/deactivate/:id', checkRole('admin'), adminController.deactivateUser);
router.post('/users/activate/:id', checkRole('admin'), adminController.activateUser);
router.post('/users/reset-password/:id', checkRole('admin'), adminController.resetPassword);
router.post('/users/suspend/:id', checkRole('admin'), adminController.suspendUser);
router.post('/users/role/:id', checkRole('admin'), adminController.assignRoleToUser); // نقش = citizen/employee/admin
router.post('/users/toggle-2fa/:id', checkRole('admin'), adminController.toggle2FA);
router.post('/users/bulk', checkRole('admin'), adminController.bulkUsers); // ثبت دسته‌ای
router.get('/users/export', checkRole('admin'), adminController.exportUsers);
router.post('/users/impersonate/:id', checkRole('admin'), adminController.impersonate);
router.post('/users/stop-impersonate', checkRole('admin'), adminController.stopImpersonate);

// =============================
// Service Requests (Applications)
// =============================
router.get('/requests', checkRole('admin'), adminController.getRequests);
router.get('/requests/:id', checkRole('admin'), adminController.getRequestById);
router.post('/requests/create', checkRole('admin'), adminController.createRequest);
router.post('/requests/update/:id', checkRole('admin'), adminController.updateRequest);
router.post('/requests/delete/:id', checkRole('admin'), adminController.deleteRequest);
router.get('/requests/export', checkRole('admin'), adminController.exportRequests);

// =============================
// Feedback (Citizen Reviews)
// =============================
router.get('/reviews', checkRole('admin'), adminController.getReviews);
router.post('/reviews/delete/:id', checkRole('admin'), adminController.deleteReview);

// =============================
// Notifications
// =============================
router.get('/notifications', checkRole('admin'), adminController.getNotifications);
router.post('/notifications/create', checkRole('admin'), adminController.createNotification);
router.post('/notifications/broadcast', checkRole('admin'), adminController.broadcastNotification);
router.post('/notifications/delete/:id', checkRole('admin'), adminController.deleteNotification);
router.post('/notifications/clear', checkRole('admin'), adminController.clearNotifications);

// =============================
// Payments (Service Fees)
// =============================
router.get('/payments', checkRole('admin'), adminController.getPayments);
router.post('/payments/refund/:id', checkRole('admin'), adminController.refundPayment);

// =============================
// Documents (Uploaded Files)
// =============================
router.get('/files', checkRole('admin'), adminController.getFiles);
router.post('/files/delete/:id', checkRole('admin'), adminController.deleteFile);

// =============================
// Reports & Analytics
// =============================
router.get('/reports', checkRole('admin'), adminController.getReports);
router.post('/reports/generate', checkRole('admin'), adminController.generateReport);
router.get('/reports/export', checkRole('admin'), adminController.exportReports);

// =============================
// System Settings
// =============================
router.get('/settings', checkRole('admin'), adminController.getSettings);
router.post('/settings/update', checkRole('admin'), adminController.updateSettings);

// =============================
// Backup & Restore
// =============================
router.get('/backup', checkRole('admin'), adminController.getBackups);
router.post('/backup/create', checkRole('admin'), adminController.createBackup);
router.post('/backup/restore/:id', checkRole('admin'), adminController.restoreBackup);

// =============================
// AI (Insights / Chatbot for citizens)
// =============================
router.post('/ai/analyze', checkRole('admin'), adminController.aiAnalyzeData);
router.post('/ai/chat', checkRole('admin'), adminController.aiChat);

module.exports = router;
