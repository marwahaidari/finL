/**
 * checkRole.js
 * Flexible role middleware
 */

const AuditLog = require('../utils/Audit');

function checkRole(roles, options = {}) {
    return async (req, res, next) => {
        try {
            if (!req.session.user) {
                req.flash('error_msg', options.message || '⚠️ You must be logged in');
                return res.redirect(options.redirect || '/login');
            }

            const userRole = req.session.user.role;
            const allowed = Array.isArray(roles) ? roles.includes(userRole) : userRole === roles;

            if (!allowed) {
                if (options.audit !== false) {
                    await AuditLog.create(
                        req.session.user.id,
                        `⚠️ Unauthorized access attempt to ${req.originalUrl} with role ${userRole}`
                    );
                }

                req.flash('error_msg', options.message || '❌ Access denied');
                return res.status(options.status || 403).redirect(options.redirect || '/dashboard');
            }

            next();
        } catch (err) {
            console.error('checkRole error:', err);
            res.status(500).send('Error checking user access');
        }
    };
}

module.exports = checkRole;
