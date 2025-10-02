const Settings = require('../models/Settings');

const settingsController = {
    // 📌 ایجاد تنظیمات جدید
    createSetting: async (req, res) => {
        try {
            const { key, value, description, category, type, isActive } = req.body;
            if (!key || value === undefined) {
                return res.status(400).json({ error: "key و value الزامی هستند" });
            }

            const setting = await Settings.create({ key, value, description, category, type, isActive });
            return res.status(201).json(setting);
        } catch (err) {
            console.error("❌ Error creating setting:", err);
            return res.status(500).json({ error: "خطا در ایجاد تنظیمات" });
        }
    },

    // 📌 گرفتن همه تنظیمات با فیلتر و pagination
    getSettings: async (req, res) => {
        try {
            const { limit, offset, activeOnly, category, type } = req.query;
            const settings = await Settings.findAll({
                limit: parseInt(limit) || 50,
                offset: parseInt(offset) || 0,
                where: {
                    ...(activeOnly !== 'false' ? { isActive: true } : {}),
                    ...(category ? { category } : {}),
                    ...(type ? { type } : {})
                }
            });
            return res.json(settings);
        } catch (err) {
            console.error("❌ Error fetching settings:", err);
            return res.status(500).json({ error: "خطا در دریافت تنظیمات" });
        }
    },

    // 📌 گرفتن تنظیمات بر اساس ID
    getSettingById: async (req, res) => {
        try {
            const { id } = req.params;
            const setting = await Settings.findByPk(id);
            if (!setting) return res.status(404).json({ error: "تنظیمات پیدا نشد" });

            return res.json(setting);
        } catch (err) {
            console.error("❌ Error fetching setting:", err);
            return res.status(500).json({ error: "خطا در دریافت تنظیمات" });
        }
    },

    // 📌 بروزرسانی تنظیمات
    updateSetting: async (req, res) => {
        try {
            const { id } = req.params;
            const { value, description, category, type, isActive } = req.body;

            const [updated] = await Settings.update(
                { value, description, category, type, isActive },
                { where: { id } }
            );

            if (!updated) return res.status(404).json({ error: "تنظیمات پیدا نشد" });
            return res.json({ message: "تنظیمات بروزرسانی شد" });
        } catch (err) {
            console.error("❌ Error updating setting:", err);
            return res.status(500).json({ error: "خطا در بروزرسانی تنظیمات" });
        }
    },

    // 📌 حذف نرم (Soft Delete)
    softDeleteSetting: async (req, res) => {
        try {
            const { id } = req.params;
            const [deleted] = await Settings.update({ isActive: false }, { where: { id } });

            if (!deleted) return res.status(404).json({ error: "تنظیمات پیدا نشد" });
            return res.json({ message: "تنظیمات غیر فعال شد" });
        } catch (err) {
            console.error("❌ Error soft deleting setting:", err);
            return res.status(500).json({ error: "خطا در غیر فعال کردن تنظیمات" });
        }
    },

    // 📌 حذف کامل
    deleteSetting: async (req, res) => {
        try {
            const { id } = req.params;
            const deleted = await Settings.destroy({ where: { id } });

            if (!deleted) return res.status(404).json({ error: "تنظیمات پیدا نشد" });
            return res.json({ message: "تنظیمات حذف شد" });
        } catch (err) {
            console.error("❌ Error deleting setting:", err);
            return res.status(500).json({ error: "خطا در حذف تنظیمات" });
        }
    },

    // 📌 شمارش تنظیمات
    countSettings: async (req, res) => {
        try {
            const { activeOnly, category, type } = req.query;
            const count = await Settings.count({
                where: {
                    ...(activeOnly !== 'false' ? { isActive: true } : {}),
                    ...(category ? { category } : {}),
                    ...(type ? { type } : {})
                }
            });
            return res.json({ total: count });
        } catch (err) {
            console.error("❌ Error counting settings:", err);
            return res.status(500).json({ error: "خطا در شمارش تنظیمات" });
        }
    },

    // 📌 آرشیو کردن تنظیمات
    archiveSetting: async (req, res) => {
        try {
            const { id } = req.params;
            const [archived] = await Settings.update(
                { isArchived: true },
                { where: { id } }
            );
            if (!archived) return res.status(404).json({ error: "تنظیمات پیدا نشد" });
            return res.json({ message: "تنظیمات آرشیو شد" });
        } catch (err) {
            console.error("❌ Error archiving setting:", err);
            return res.status(500).json({ error: "خطا در آرشیو کردن تنظیمات" });
        }
    },

    // 📌 بازگردانی از آرشیو
    restoreSetting: async (req, res) => {
        try {
            const { id } = req.params;
            const [restored] = await Settings.update(
                { isArchived: false },
                { where: { id } }
            );
            if (!restored) return res.status(404).json({ error: "تنظیمات پیدا نشد" });
            return res.json({ message: "تنظیمات از آرشیو بازگردانی شد" });
        } catch (err) {
            console.error("❌ Error restoring setting:", err);
            return res.status(500).json({ error: "خطا در بازگردانی تنظیمات" });
        }
    }
};

module.exports = settingsController;
