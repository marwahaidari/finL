// utils/Audit.js
const fs = require('fs');
const path = require('path');
const db = require('../db');

// مسیر فایل لاگ‌ها
const logDir = path.join(__dirname, '../logs');
const logFile = path.join(logDir, 'audit.log');

// اطمینان از وجود پوشه logs
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

class Audit {
    // 📌 انواع رویدادها (ثابت‌ها)
    static EVENTS = {
        LOGIN: 'LOGIN',
        LOGOUT: 'LOGOUT',
        FAILED_LOGIN: 'FAILED_LOGIN',
        AUTHORIZED_ACCESS: 'AUTHORIZED_ACCESS',
        UNAUTHORIZED_ACCESS: 'UNAUTHORIZED_ACCESS',
        SESSION_EXPIRED: 'SESSION_EXPIRED',
        FORBIDDEN_ROLE: 'FORBIDDEN_ROLE',
        DATA_CREATE: 'DATA_CREATE',
        DATA_UPDATE: 'DATA_UPDATE',
        DATA_DELETE: 'DATA_DELETE',
        SYSTEM_ERROR: 'SYSTEM_ERROR',
        AUTH_ERROR: 'AUTH_ERROR'
    };

    /**
     * ثبت لاگ در دیتابیس، فایل و کنسول
     * @param {Object} options
     * @param {string|null} options.userId - آیدی کاربر (در صورت لاگین بودن)
     * @param {string} options.eventType - نوع رویداد (از Audit.EVENTS)
     * @param {string} options.message - توضیحات لاگ
     * @param {string} [options.ip] - آی‌پی کاربر
     * @param {string} [options.url] - آدرس ریکوئست
     */
    static async log({ userId = null, eventType, message, ip = null, url = null }) {
        const timestamp = new Date();
        const logEntry = `[${timestamp.toISOString()}] | User: ${userId || 'Guest'} | Event: ${eventType} | URL: ${url || '-'} | IP: ${ip || '-'} | ${message}`;

        // چاپ در کنسول
        console.log('[AUDIT]', logEntry);

        // ذخیره در فایل
        try {
            fs.appendFileSync(logFile, logEntry + '\n', 'utf8');
        } catch (fileErr) {
            console.error('Error writing audit log file:', fileErr.message);
        }

        // ذخیره در دیتابیس
        try {
            await db.query(
                `INSERT INTO audit_logs (user_id, event_type, message, ip_address, url, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [userId, eventType, message, ip, url, timestamp]
            );
        } catch (dbErr) {
            console.error('Error saving audit log to database:', dbErr.message);
        }
    }
}

module.exports = Audit;
