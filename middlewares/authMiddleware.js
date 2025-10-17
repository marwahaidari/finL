const Audit = require('../utils/Audit');
const speakeasy = require('speakeasy');
const jwt = require('jsonwebtoken');

const DEFAULTS = {
    maxAttempts: 100,
    windowMs: 1 * 60 * 1000,
    lockTimeMs: 10 * 60 * 1000,
    maxInactivityMinutes: 30,
    forgotPasswordMaxAttempts: 5,
    forgotPasswordWindowMs: 15 * 60 * 1000,
};

const rateLimitStore = new Map();
const trustedDevices = new Map();

// helper: deviceKey از ip + user-agent می‌سازه
function makeDeviceKey(req) {
    const ua = req.headers['user-agent'] || 'unknown-ua';
    const ip = (req.ip || req.connection?.remoteAddress || 'unknown-ip').replace(/^::ffff:/, '');
    return `${ip}::${ua}`;
}

// helper: بررسی rate limit ساده
function rateLimitCheck(key, opts = {}) {
    const now = Date.now();
    const cfg = { maxAttempts: DEFAULTS.maxAttempts, windowMs: DEFAULTS.windowMs, lockTimeMs: DEFAULTS.lockTimeMs, ...opts };
    let rec = rateLimitStore.get(key);

    if (!rec) {
        rec = { count: 1, firstSeen: now, blockedUntil: 0 };
        rateLimitStore.set(key, rec);
        return { allowed: true, remaining: cfg.maxAttempts - 1 };
    }

    if (rec.blockedUntil && now < rec.blockedUntil) {
        return { allowed: false, blockedUntil: rec.blockedUntil };
    }

    if (now - rec.firstSeen > cfg.windowMs) {
        rec.count = 1;
        rec.firstSeen = now;
        rec.blockedUntil = 0;
        rateLimitStore.set(key, rec);
        return { allowed: true, remaining: cfg.maxAttempts - 1 };
    }

    rec.count++;
    rateLimitStore.set(key, rec);

    if (rec.count > cfg.maxAttempts) {
        rec.blockedUntil = now + cfg.lockTimeMs;
        rateLimitStore.set(key, rec);
        return { allowed: false, blockedUntil: rec.blockedUntil };
    }

    return { allowed: true, remaining: cfg.maxAttempts - rec.count };
}

/**
 * ensureAuthenticated
 * allowedRoles: [] یا ['admin','officer',...']
 * options:
 *   - require2FA: boolean
 *   - sessionTimeoutMinutes: number
 *   - rateLimit: { maxAttempts, windowMs, lockTimeMs } (اختیاری)
 *   - forgotPasswordProtection: boolean
 */
module.exports.ensureAuthenticated = (allowedRoles = [], options = {}) => {
    const cfg = {
        require2FA: false,
        sessionTimeoutMinutes: DEFAULTS.maxInactivityMinutes,
        rateLimit: null,
        forgotPasswordProtection: true,
        ...options,
    };

    return async (req, res, next) => {
        try {
            const now = Date.now();

            // -------------------------
            // 1) JWT Bearer (برای API)
            // -------------------------
            if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
                const token = req.headers.authorization.split(' ')[1];
                try {
                    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'jwt-secret-placeholder');
                    req.user = decoded;
                } catch (jwtErr) {
                    await Audit.log({
                        userId: null,
                        eventType: 'INVALID_JWT',
                        message: `Invalid JWT: ${jwtErr.message}`,
                        ip: req.ip,
                        url: req.originalUrl,
                    });
                    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
                        return res.status(401).json({ error: 'Invalid token' });
                    }
                    req.flash && req.flash('error_msg', 'توکن نامعتبر است');
                    return res.redirect('/login');
                }
            }

            // -------------------------
            // 2) بررسی session (وب)
            // -------------------------
            if (!req.user) {
                if (!req.session || !req.session.user || !req.session.user.id) {
                    await Audit.log({
                        userId: null,
                        eventType: 'UNAUTHORIZED_ACCESS',
                        message: `Unauthorized attempt to ${req.originalUrl}`,
                        ip: req.ip,
                        url: req.originalUrl,
                    });
                    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
                        return res.status(401).json({ error: 'Authentication required' });
                    }
                    req.flash && req.flash('error_msg', 'لطفا ابتدا وارد شوید');
                    return res.redirect('/login');
                }
                req.user = req.session.user;
            }

            const user = req.user;

            // -------------------------
            // 3) Rate-limit عمومی
            // -------------------------
            if (cfg.rateLimit) {
                const rlKey = user.id ? `uid:${user.id}` : `ip:${req.ip}`;
                const rlRes = rateLimitCheck(rlKey, cfg.rateLimit);
                if (!rlRes.allowed) {
                    await Audit.log({
                        userId: user.id || null,
                        eventType: 'RATE_LIMIT_BLOCK',
                        message: `Rate limit exceeded for ${rlKey}`,
                        ip: req.ip,
                        url: req.originalUrl,
                    });
                    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
                        return res.status(429).json({ error: 'Too many requests' });
                    }
                    return res.status(429).render('errors/429', { message: 'تعداد درخواست‌ها زیاد است، بعداً تلاش کنید' });
                }
                res.setHeader && res.setHeader('X-RateLimit-Remaining', String(rlRes.remaining || 0));
            }

            // -------------------------
            // 4) Rate-limit مسیر forgot/reset password
            // -------------------------
            if (cfg.forgotPasswordProtection &&
                (req.originalUrl.startsWith('/forgot-password') || req.originalUrl.startsWith('/reset/'))) {
                const fpKey = `fp:${req.ip}`;
                const fpRes = rateLimitCheck(fpKey, { maxAttempts: DEFAULTS.forgotPasswordMaxAttempts, windowMs: DEFAULTS.forgotPasswordWindowMs });
                if (!fpRes.allowed) {
                    await Audit.log({
                        userId: null,
                        eventType: 'FORGOT_PASSWORD_RATE_LIMIT',
                        message: `Forgot/Reset password rate limit exceeded for ${req.ip}`,
                        ip: req.ip,
                        url: req.originalUrl,
                    });
                    return res.status(429).render('errors/429', { message: 'تعداد تلاش‌های بازیابی رمز زیاد است، بعداً تلاش کنید' });
                }
            }

            // -------------------------
            // 5) چک کردن timeout سشن (activity)
            // -------------------------
            const lastActivity = req.session?.user?.lastActivity ? new Date(req.session.user.lastActivity) : null;
            const sessionTimeoutMin = options.sessionTimeoutMinutes || cfg.sessionTimeoutMinutes;
            if (lastActivity) {
                const diffMin = (now - lastActivity.getTime()) / (1000 * 60);
                if (diffMin > sessionTimeoutMin) {
                    await Audit.log({
                        userId: user.id || null,
                        eventType: 'SESSION_EXPIRED',
                        message: 'Session expired due to inactivity',
                        ip: req.ip,
                        url: req.originalUrl,
                    });
                    req.session && req.session.destroy && req.session.destroy(err => { if (err) console.error(err); });
                    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
                        return res.status(401).json({ error: 'Session expired' });
                    }
                    req.flash && req.flash('error_msg', 'سشن شما منقضی شده است، دوباره وارد شوید');
                    return res.redirect('/login');
                }
            }
            if (req.session && req.session.user) req.session.user.lastActivity = new Date(now);

            // -------------------------
            // 6) بررسی نقش‌ها
            // -------------------------
            if (Array.isArray(allowedRoles) && allowedRoles.length > 0) {
                const role = user.role;
                if (!allowedRoles.includes(role)) {
                    await Audit.log({
                        userId: user.id || null,
                        eventType: 'FORBIDDEN_ROLE',
                        message: `Role '${role}' not authorized for ${req.originalUrl}`,
                        ip: req.ip,
                        url: req.originalUrl,
                    });
                    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
                        return res.status(403).json({ error: 'Forbidden' });
                    }
                    return res.status(403).render('errors/403', { message: 'شما دسترسی به این بخش ندارید' });
                }
            }

            // -------------------------
            // 7) بررسی 2FA
            // -------------------------
            if (cfg.require2FA) {
                if (!user.twoFactorEnabled || !user.twoFactorSecret) {
                    req.flash && req.flash('error_msg', 'برای دسترسی به این بخش باید 2FA فعال باشد');
                    return res.redirect('/2fa/setup');
                }
                const token2fa = req.headers['x-2fa-token'] || req.body?.token || req.query?.token;
                if (!token2fa || !speakeasy.totp.verify({ secret: user.twoFactorSecret, encoding: 'base32', token: token2fa })) {
                    await Audit.log({
                        userId: user.id || null,
                        eventType: 'INVALID_2FA',
                        message: `Invalid 2FA attempt on ${req.originalUrl}`,
                        ip: req.ip,
                        url: req.originalUrl,
                    });
                    req.flash && req.flash('error_msg', 'کد 2FA نامعتبر است');
                    return res.redirect('/2fa/verify');
                }
            }

            // -------------------------
            // 8) ثبت دستگاه جدید
            // -------------------------
            if (user.id) {
                const devKey = makeDeviceKey(req);
                let set = trustedDevices.get(user.id);
                if (!set) {
                    set = new Set();
                    trustedDevices.set(user.id, set);
                }
                if (!set.has(devKey)) {
                    set.add(devKey);
                    await Audit.log({
                        userId: user.id,
                        eventType: 'NEW_DEVICE',
                        message: 'Access from new device/IP',
                        ip: req.ip,
                        url: req.originalUrl,
                        meta: { deviceKey: devKey },
                    });
                }
            }

            // -------------------------
            // 9) ست کردن req.user
            // -------------------------
            req.user = user;

            // -------------------------
            // 10) لاگ موفقیت
            // -------------------------
            await Audit.log({
                userId: user.id || null,
                eventType: 'AUTHORIZED_ACCESS',
                message: `User accessed ${req.originalUrl}`,
                ip: req.ip,
                url: req.originalUrl,
            });

            return next();

        } catch (err) {
            console.error('Auth Middleware Error:', err);
            await Audit.log({
                userId: req.session?.user?.id || null,
                eventType: 'AUTH_MIDDLEWARE_ERROR',
                message: `Auth middleware failed: ${err.message}`,
                ip: req.ip,
                url: req.originalUrl,
            });
            if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
                return res.status(500).json({ error: 'Authentication error' });
            }
            return res.status(500).render('errors/500', { message: 'خطا در سیستم احراز هویت' });
        }
    };
};
