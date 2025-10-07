// routes/notificationRoutes.js
const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');

// Simple auth placeholder — replace with your real auth middleware
function ensureAuth(req, res, next) {
  // if you use sessions or passport, adapt accordingly:
  if (req.user || req.session?.userId) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// Validate that controller handlers are functions (fails fast)
function assertHandler(fn, name) {
  if (typeof fn !== 'function') {
    throw new Error(`Notification handler "${name}" is not a function. Value: ${fn}`);
  }
}

// CRUD
assertHandler(notificationController.createNotification, 'createNotification');
router.post('/', ensureAuth, notificationController.createNotification);

assertHandler(notificationController.createBulkNotifications, 'createBulkNotifications');
router.post('/bulk', ensureAuth, notificationController.createBulkNotifications);

assertHandler(notificationController.listNotifications, 'listNotifications');
router.get('/', ensureAuth, notificationController.listNotifications);

assertHandler(notificationController.getUserNotifications, 'getUserNotifications');
router.get('/user/:userId', ensureAuth, notificationController.getUserNotifications);

assertHandler(notificationController.getNotificationById, 'getNotificationById');
router.get('/:id', ensureAuth, notificationController.getNotificationById);

assertHandler(notificationController.deleteNotification, 'deleteNotification');
router.delete('/:id', ensureAuth, notificationController.deleteNotification);

// Status updates
assertHandler(notificationController.markNotificationAsRead, 'markNotificationAsRead');
router.post('/:id/read', ensureAuth, notificationController.markNotificationAsRead);

assertHandler(notificationController.markAllAsRead, 'markAllAsRead');
router.post('/read-all', ensureAuth, notificationController.markAllAsRead);

assertHandler(notificationController.markAsDelivered, 'markAsDelivered');
router.post('/:id/delivered', ensureAuth, notificationController.markAsDelivered);

assertHandler(notificationController.archiveNotification, 'archiveNotification');
router.post('/:id/archive', ensureAuth, notificationController.archiveNotification);

// Advanced
assertHandler(notificationController.searchNotifications, 'searchNotifications');
router.get('/search', ensureAuth, notificationController.searchNotifications);

assertHandler(notificationController.countUnreadNotifications, 'countUnreadNotifications');
router.get('/count/unread', ensureAuth, notificationController.countUnreadNotifications);

assertHandler(notificationController.getUnreadNotifications, 'getUnreadNotifications');
router.get('/unread', ensureAuth, notificationController.getUnreadNotifications);

// Realtime hook (future)
assertHandler(notificationController.sendRealtimeNotification, 'sendRealtimeNotification');
router.post('/send-realtime', ensureAuth, notificationController.sendRealtimeNotification);

module.exports = router;
