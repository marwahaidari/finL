// middlewares/rateLimiter.js
const rateLimit = require('express-rate-limit');

// پیام‌های سفارشی
const customMessage = (req, res, type = 'general') => {
    return {
        status: 429,
        type,
        error: 'Too Many Requests 🚨',
        message:
            type === 'auth'
                ? 'You tried logging in too many times. Please wait before retrying.'
                : 'You have exceeded the allowed request limit. Please try again later.',
        retryAfter: res.getHeaders()['retry-after'] || 'few minutes',
        path: req.originalUrl,
        ip: req.ip,
    };
};

// فقط auth limiter فعال باشه
const authLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 دقیقه
    max: 5, // 5 تلاش لاگین
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next, options) => {
        res.status(options.statusCode).json(customMessage(req, res, 'auth'));
    },
});

// بقیه limiter ها عملاً غیرفعال میشن
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 999999, standardHeaders: true, legacyHeaders: false });
const uploadLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 999999, standardHeaders: true, legacyHeaders: false });
const adminLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 999999, standardHeaders: true, legacyHeaders: false });

module.exports = {
    apiLimiter,
    authLimiter,
    uploadLimiter,
    adminLimiter,
};
