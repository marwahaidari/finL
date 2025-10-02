const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingController');

// ================================
// 📌 ایجاد تنظیمات جدید
router.post('/', settingsController.createSetting);

// 📌 گرفتن همه تنظیمات با فیلتر و Pagination
router.get('/', settingsController.getSettings);

// 📌 گرفتن تنظیمات با ID
router.get('/:id', settingsController.getSettingById);

// 📌 بروزرسانی تنظیمات
router.put('/:id', settingsController.updateSetting);

// 📌 حذف نرم (Soft Delete)
router.patch('/:id/soft-delete', settingsController.softDeleteSetting);

// 📌 حذف کامل
router.delete('/:id', settingsController.deleteSetting);

// 📌 آرشیو / بازیابی آرشیو
router.patch('/:id/archive', settingsController.archiveSetting);
router.patch('/:id/restore', settingsController.restoreSetting);

// 📌 شمارش تنظیمات (برای آمار)
router.get('/count/all', settingsController.countSettings);

module.exports = router;
