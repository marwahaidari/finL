// middlewares/validationMiddleware.js
const { body, param, query, validationResult } = require("express-validator");

// ============================
// 📌 User Validations
// ============================
const registerUserValidation = [
    body("name").trim().notEmpty().withMessage("نام الزامی است"),
    body("email").isEmail().withMessage("ایمیل معتبر وارد کنید"),
    body("password")
        .isLength({ min: 6 })
        .withMessage("رمز عبور باید حداقل ۶ کاراکتر باشد"),
    body("role")
        .optional()
        .isIn(["user", "admin", "officer"])
        .withMessage("نقش نامعتبر است"),
    body("phone")
        .optional()
        .isMobilePhone("fa-IR")
        .withMessage("شماره موبایل نامعتبر است"),
];

const updateUserValidation = [
    param("id").isInt().withMessage("شناسه کاربر معتبر نیست"),
    body("name").optional().trim().notEmpty().withMessage("نام نمی‌تواند خالی باشد"),
    body("email").optional().isEmail().withMessage("ایمیل معتبر وارد کنید"),
    body("role")
        .optional()
        .isIn(["user", "admin", "officer"])
        .withMessage("نقش نامعتبر است"),
    body("phone")
        .optional()
        .isMobilePhone("fa-IR")
        .withMessage("شماره موبایل نامعتبر است"),
];

// ============================
// 📌 Service Request (Order) Validations
// ============================
const createServiceRequestValidation = [
    body("title").trim().notEmpty().withMessage("عنوان الزامی است"),
    body("description").optional().trim(),
    body("priority")
        .optional()
        .isIn(["low", "normal", "high", "urgent"])
        .withMessage("اولویت نامعتبر است"),
    body("attachments")
        .optional()
        .isArray()
        .withMessage("attachments باید آرایه باشد"),
];

const updateServiceRequestValidation = [
    param("id").isInt().withMessage("شناسه درخواست معتبر نیست"),
    body("title").optional().trim().notEmpty().withMessage("عنوان نمی‌تواند خالی باشد"),
    body("description").optional().trim(),
    body("priority")
        .optional()
        .isIn(["low", "normal", "high", "urgent"])
        .withMessage("اولویت نامعتبر است"),
    body("status")
        .optional()
        .isIn(["pending", "in_progress", "completed", "rejected"])
        .withMessage("وضعیت نامعتبر است"),
    body("paid").optional().isBoolean().withMessage("paid باید بولین باشد"),
];

// ============================
// 📌 Feedback / Reviews
// ============================
const createFeedbackValidation = [
    body("order_id").isInt().withMessage("شناسه درخواست معتبر نیست"),
    body("user_id").isInt().withMessage("شناسه کاربر معتبر نیست"),
    body("rating")
        .isInt({ min: 1, max: 5 })
        .withMessage("امتیاز باید بین ۱ تا ۵ باشد"),
    body("comment").optional().trim(),
];

// ============================
// 📌 Messages
// ============================
const createMessageValidation = [
    body("order_id").isInt().withMessage("شناسه درخواست معتبر نیست"),
    body("sender_id").isInt().withMessage("شناسه فرستنده معتبر نیست"),
    body("receiver_id").isInt().withMessage("شناسه گیرنده معتبر نیست"),
    body("content").trim().notEmpty().withMessage("متن پیام نمی‌تواند خالی باشد"),
    body("attachment").optional().isString().withMessage("attachment نامعتبر است"),
    body("reply_to").optional().isInt().withMessage("reply_to باید عدد باشد"),
];

// ============================
// 📌 File Uploads
// ============================
const uploadFileValidation = [
    body("order_id").isInt().withMessage("شناسه درخواست معتبر نیست"),
    body("user_id").isInt().withMessage("شناسه کاربر معتبر نیست"),
    body("filename").trim().notEmpty().withMessage("نام فایل الزامی است"),
    body("filepath").trim().notEmpty().withMessage("مسیر فایل الزامی است"),
    body("mimetype").optional().isString(),
    body("size").optional().isInt().withMessage("اندازه فایل باید عدد باشد"),
];

// ============================
// 📌 Settings & Reactions
// ============================
const createSettingValidation = [
    body("key").trim().notEmpty().withMessage("کلید الزامی است"),
    body("value").trim().notEmpty().withMessage("مقدار الزامی است"),
    body("description").optional().trim(),
    body("category").optional().trim(),
    body("type")
        .optional()
        .isIn(["string", "number", "boolean", "json"])
        .withMessage("نوع تنظیمات نامعتبر است"),
    body("is_active").optional().isBoolean().withMessage("is_active باید بولین باشد"),
];

const createReactionValidation = [
    body("setting_id").isInt().withMessage("شناسه تنظیمات معتبر نیست"),
    body("user_id").isInt().withMessage("شناسه کاربر معتبر نیست"),
    body("reaction").trim().notEmpty().withMessage("reaction الزامی است"),
];

// ============================
// 📌 Result Middleware
// ============================
function validateResult(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
}

// ============================
// 📌 Export
// ============================
module.exports = {
    registerUserValidation,
    updateUserValidation,
    createServiceRequestValidation,
    updateServiceRequestValidation,
    createFeedbackValidation,
    createMessageValidation,
    uploadFileValidation,
    createSettingValidation,
    createReactionValidation,
    validateResult,
};
