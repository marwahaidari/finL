/**
 * middlewares/errorHandler.js
 * Full-featured error handler middleware for E-Government applications
 */

const fs = require('fs');
const path = require('path');
const logFile = path.join(__dirname, '../logs/error.log');

/**
 * Write error to file
 * @param {Error|string} err
 */
async function logError(err) {
    const entry = `[${new Date().toISOString()}] ${err.stack || err}\n`;
    fs.appendFile(logFile, entry, (error) => {
        if (error) console.error('Failed to write error log:', error);
    });
}

/**
 * Global Error Handler Middleware
 */
module.exports = async (err, req, res, next) => {
    try {
        // 1. Log to console
        console.error('❌ Error:', err.stack || err);

        // 2. Write to file
        await logError(err);

        // 3. Optional: global hook for external monitoring/alerts
        if (typeof global?.onErrorHook === 'function') {
            await global.onErrorHook(err, req);
        }

        // 4. Skip if headers already sent
        if (res.headersSent) return next(err);

        const isApi = req.originalUrl.startsWith('/api');
        const statusCode = err.status || 500;

        // 5. API response
        if (isApi) {
            return res.status(statusCode).json({
                error: err.message || 'Internal Server Error',
                stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
            });
        }

        // 6. Web response
        req.flash('error_msg', err.userMessage || 'Something went wrong. Please try again later.');
        res.status(statusCode).redirect(err.redirect || 'back');
    } catch (handlerErr) {
        console.error('❌ Error in errorHandler middleware:', handlerErr);
        next(handlerErr);
    }
};
