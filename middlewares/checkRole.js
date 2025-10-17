/**
 * checkRole.js
 * Flexible role middleware
 */

const Audit = require('../utils/Audit'); // ✅ نام درست ماژول

function checkRole(roles, options = {}) {
    return async (req, res, next) => {
        try {
            if (!req.session.user) {
                req.flash('error_msg', options.message || '⚠️ You must be logged in');
                return res.redirect(options.redirect || '/login');
            }

            const userRole = req.session.user.role;
            const allowed = Array.isArray(roles)
                ? roles.includes(userRole)
                : userRole === roles;

            if (!allowed) {
                // ✅ از Audit.log استفاده می‌کنیم، نه Audit.create
                if (options.audit !== false) {
                    await Audit.log({
                        userId: req.session.user.id,
                        eventType: 'UNAUTHORIZED_ROLE_ACCESS',
                        message: `Unauthorized access to ${req.originalUrl} with role ${userRole}`,
                        ip: req.ip,
                        url: req.originalUrl,
                    });
                }

                req.flash('error_msg', options.message || '❌ Access denied');
                return res
                    .status(options.status || 403)
                    .redirect(options.redirect || '/dashboard');
            }

            // ✅ اگر مجاز بود، ادامه بده
            next();
        } catch (err) {
            console.error('checkRole error:', err);
            res.status(500).send('Error checking user access');
        }
    };
}

module.exports = checkRole;
