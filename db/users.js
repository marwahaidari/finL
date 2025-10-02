// db/models/users.js
const { query } = require('../index');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SALT_ROUNDS = 12;
const ALLOWED_AVATAR_EXTENSIONS = ['.png', '.jpg', '.jpeg'];
const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2MB

const User = {
    // ================================
    // 📌 پیدا کردن کاربر با id
    findById: async (id) => {
        const res = await query('SELECT * FROM users WHERE id=$1', [id]);
        return res.rows[0];
    },

    // ================================
    // 📌 پیدا کردن کاربر با ایمیل
    findByEmail: async (email) => {
        const res = await query('SELECT * FROM users WHERE email=$1', [email]);
        return res.rows[0];
    },

    // ================================
    // 📌 ایجاد کاربر جدید (با اطلاعات کامل شهروندی)
    create: async ({
        name, email, password, role = 'citizen',
        nationalId = null, phone = null, address = null, dob = null
    }) => {
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        const res = await query(
            `INSERT INTO users (name, email, password, role, national_id, phone, address, dob, is_verified, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, true)
             RETURNING *`,
            [name, email, hashedPassword, role, nationalId, phone, address, dob]
        );
        return res.rows[0];
    },

    // ================================
    // 📌 بررسی رمز عبور
    checkPassword: async (user, password) => {
        if (!user) return false;
        return await bcrypt.compare(password, user.password);
    },

    // ================================
    // 📌 بروزرسانی پروفایل (با فیلدهای جدید)
    updateProfile: async (id, data) => {
        const { name, email, newPassword, nationalId, phone, address, dob } = data;
        let hashedPassword = null;

        if (newPassword) {
            hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
        }

        const res = await query(
            `UPDATE users SET 
                name=$1, email=$2, 
                password=COALESCE($3, password),
                national_id=$4, phone=$5, address=$6, dob=$7,
                updated_at=NOW()
             WHERE id=$8 RETURNING *`,
            [name, email, hashedPassword, nationalId, phone, address, dob, id]
        );
        return res.rows[0];
    },

    // ================================
    // 📌 تغییر ایمیل (نیاز به تأیید ایمیل جدید)
    requestEmailChange: async (id, newEmail) => {
        const token = crypto.randomBytes(32).toString('hex');
        await query(
            `INSERT INTO email_verifications (user_id, new_email, token, created_at)
             VALUES ($1, $2, $3, NOW())`,
            [id, newEmail, token]
        );
        return token; // میره برای ارسال ایمیل
    },

    confirmEmailChange: async (token) => {
        const res = await query(
            `SELECT * FROM email_verifications WHERE token=$1`, [token]
        );
        const record = res.rows[0];
        if (!record) throw new Error("Invalid token");

        await query(`UPDATE users SET email=$1, updated_at=NOW() WHERE id=$2`, [record.new_email, record.user_id]);
        await query(`DELETE FROM email_verifications WHERE id=$1`, [record.id]);

        return true;
    },

    // ================================
    // 📌 حذف کاربر (همراه حذف فایل آواتار)
    delete: async (id) => {
        const user = await User.findById(id);
        if (!user) throw new Error('User not found');

        if (user.avatar_url && fs.existsSync(user.avatar_url)) {
            fs.unlinkSync(user.avatar_url);
        }

        await query('DELETE FROM users WHERE id=$1', [id]);
        return true;
    },

    // ================================
    // 📌 تنظیم آواتار
    setAvatar: async (id, filepath) => {
        const ext = path.extname(filepath).toLowerCase();
        if (!ALLOWED_AVATAR_EXTENSIONS.includes(ext)) {
            fs.unlinkSync(filepath);
            throw new Error('Invalid avatar file type');
        }

        const stats = fs.statSync(filepath);
        if (stats.size > MAX_AVATAR_SIZE) {
            fs.unlinkSync(filepath);
            throw new Error('Avatar file too large');
        }

        const res = await query(
            `UPDATE users SET avatar_url=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
            [filepath, id]
        );
        return res.rows[0];
    },

    // ================================
    // 📌 جستجوی کاربران (برای admin یا officer)
    search: async (keyword, limit = 20, offset = 0) => {
        const res = await query(
            `SELECT * FROM users
             WHERE name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 OR national_id ILIKE $1
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3`,
            [`%${keyword}%`, limit, offset]
        );
        return res.rows;
    },

    // ================================
    // 📌 بازیابی رمز عبور (درخواست ریست)
    requestPasswordReset: async (email) => {
        const user = await User.findByEmail(email);
        if (!user) throw new Error("User not found");

        const token = crypto.randomBytes(32).toString('hex');
        await query(
            `INSERT INTO password_resets (user_id, token, created_at)
             VALUES ($1, $2, NOW())`,
            [user.id, token]
        );
        return token; // اینو می‌فرستیم برای ایمیل یا پیامک
    },

    resetPassword: async (token, newPassword) => {
        const res = await query(`SELECT * FROM password_resets WHERE token=$1`, [token]);
        const record = res.rows[0];
        if (!record) throw new Error("Invalid token");

        const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
        await query(`UPDATE users SET password=$1 WHERE id=$2`, [hashedPassword, record.user_id]);
        await query(`DELETE FROM password_resets WHERE id=$1`, [record.id]);
        return true;
    },

    // ================================
    // 📌 تأیید ایمیل و شماره تلفن
    verifyUser: async (id) => {
        const res = await query(`UPDATE users SET is_verified=true, updated_at=NOW() WHERE id=$1 RETURNING *`, [id]);
        return res.rows[0];
    },

    // ================================
    // 📌 تاریخچه ورود
    logLogin: async (id, ip, userAgent) => {
        await query(
            `INSERT INTO user_logins (user_id, ip, user_agent, created_at)
             VALUES ($1, $2, $3, NOW())`,
            [id, ip, userAgent]
        );
    },

    getLoginHistory: async (id, limit = 10) => {
        const res = await query(
            `SELECT * FROM user_logins WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`,
            [id, limit]
        );
        return res.rows;
    },

    // ================================
    // 📌 نقش و وضعیت
    toggleActive: async (id, isActive) => {
        const res = await query(
            'UPDATE users SET is_active=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
            [isActive, id]
        );
        return res.rows[0];
    },

    changeRole: async (id, role) => {
        const validRoles = ['admin', 'citizen', 'officer'];
        if (!validRoles.includes(role)) throw new Error('Invalid role');
        const res = await query(
            'UPDATE users SET role=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
            [role, id]
        );
        return res.rows[0];
    }
};

module.exports = User;
