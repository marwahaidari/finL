const pool = require('../db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

class User {
  // ===============================
  // ایجاد کاربر جدید
  // ===============================
  static async create({ nationalId = null, fullName, email, phone = null, password, role = 'citizen', departmentId = null }) {
    const hashedPassword = await bcrypt.hash(password, 12);
    const verificationToken = crypto.randomBytes(32).toString('hex');

    const result = await pool.query(
      `INSERT INTO users (
        national_id, full_name, email, phone, password,
        role, department_id, verification_token,
        is_verified, is_active, is_suspended,
        failed_login_attempts, two_factor_enabled,
        created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,
        false,true,false,
        0,false,
        NOW(),NOW()
      )
      RETURNING id, national_id, full_name, email, phone, role, is_active, is_verified`,
      [nationalId, fullName, email, phone, hashedPassword, role, departmentId, verificationToken]
    );

    return result.rows[0];
  }

  // ===============================
  // یافتن کاربران
  // ===============================
  static async findByEmail(email) {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0] || null;
  }

  static async findById(id) {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  static async findByPhone(phone) {
    const result = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    return result.rows[0] || null;
  }

  static async findByNationalId(nationalId) {
    const result = await pool.query('SELECT * FROM users WHERE national_id = $1', [nationalId]);
    return result.rows[0] || null;
  }

  static async verifyEmail(token) {
    const result = await pool.query(
      `UPDATE users SET is_verified = true, verification_token = NULL, updated_at = NOW()
       WHERE verification_token = $1 RETURNING id, email, is_verified`,
      [token]
    );
    return result.rows[0] || null;
  }

  // ===============================
  // مدیریت رمز عبور و OTP
  // ===============================
  static async setResetToken(email, expiresIn = 3600) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + expiresIn * 1000);
    const result = await pool.query(
      `UPDATE users SET reset_token = $1, reset_token_expires = $2, updated_at = NOW()
       WHERE email = $3 RETURNING id, email, reset_token`,
      [token, expiry, email]
    );
    return result.rows[0] || null;
  }

  static async updatePassword(id, newPassword) {
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const result = await pool.query(
      `UPDATE users SET password = $1, updated_at = NOW()
       WHERE id = $2 RETURNING id, email`,
      [hashedPassword, id]
    );
    return result.rows[0] || null;
  }

  static async setOTP(userId, otpCode) {
    const result = await pool.query(
      `UPDATE users SET otp_code = $1, otp_expires = NOW() + interval '5 minutes', updated_at = NOW()
       WHERE id = $2 RETURNING id, email`,
      [otpCode, userId]
    );
    return result.rows[0] || null;
  }

  static async verifyOTP(userId, otpCode) {
    const result = await pool.query(
      `SELECT * FROM users WHERE id = $1 AND otp_code = $2 AND otp_expires > NOW()`,
      [userId, otpCode]
    );
    return result.rows[0] || null;
  }

  // ===============================
  // مدیریت پروفایل
  // ===============================
  static async updateProfile(id, { fullName, email, phone, departmentId }) {
    const result = await pool.query(
      `UPDATE users SET full_name=$1, email=$2, phone=$3, department_id=$4, updated_at=NOW()
       WHERE id=$5 RETURNING id, full_name, email, phone, role`,
      [fullName, email, phone, departmentId, id]
    );
    return result.rows[0] || null;
  }

  static async updateProfilePhoto(id, filename) {
    const result = await pool.query(
      `UPDATE users SET profile_photo = $1, updated_at = NOW() WHERE id = $2 RETURNING id, profile_photo`,
      [filename, id]
    );
    return result.rows[0] || null;
  }

  // ===============================
  // امنیت و وضعیت حساب
  // ===============================
  static async updateLastLogin(id, ip = null, agent = null) {
    await pool.query(
      `UPDATE users SET last_login = NOW(), last_login_ip = $2, last_login_agent = $3, updated_at = NOW()
       WHERE id = $1`,
      [id, ip, agent]
    );
  }

  static async incrementFailedAttempts(id) {
    const result = await pool.query(
      `UPDATE users SET failed_login_attempts = failed_login_attempts + 1, updated_at = NOW()
       WHERE id = $1 RETURNING failed_login_attempts`,
      [id]
    );
    return result.rows[0] || null;
  }

  static async resetFailedAttempts(id) {
    await pool.query(
      `UPDATE users SET failed_login_attempts = 0, updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
  }

  static async activate(id) {
    const result = await pool.query(
      `UPDATE users SET is_active = true, updated_at = NOW() WHERE id = $1 RETURNING id, is_active`,
      [id]
    );
    return result.rows[0] || null;
  }

  static async deactivate(id) {
    const result = await pool.query(
      `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id, is_active`,
      [id]
    );
    return result.rows[0] || null;
  }

  static async suspend(id) {
    const result = await pool.query(
      `UPDATE users SET is_suspended = true, updated_at = NOW() WHERE id = $1 RETURNING id, is_suspended`,
      [id]
    );
    return result.rows[0] || null;
  }

  static async unsuspend(id) {
    const result = await pool.query(
      `UPDATE users SET is_suspended = false, updated_at = NOW() WHERE id = $1 RETURNING id, is_suspended`,
      [id]
    );
    return result.rows[0] || null;
  }

  static async toggle2FA(id, enabled) {
    const result = await pool.query(
      `UPDATE users SET two_factor_enabled = $2, updated_at = NOW() WHERE id = $1 RETURNING id, two_factor_enabled`,
      [id, enabled]
    );
    return result.rows[0] || null;
  }

  // ===============================
  // نقش و سطح دسترسی
  // ===============================
  static async updateRole(id, role) {
    const result = await pool.query(
      `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING id, role`,
      [role, id]
    );
    return result.rows[0] || null;
  }

  static async findByRole(role) {
    const result = await pool.query(
      `SELECT * FROM users WHERE role = $1 ORDER BY created_at DESC`,
      [role]
    );
    return result.rows;
  }

  // ===============================
  // گزارش‌گیری و لیست کردن
  // ===============================
  static async findAll({ limit = 50, offset = 0, active = null, verified = null, role = null } = {}) {
    let query = `SELECT * FROM users WHERE 1=1`;
    const params = [];
    let i = 1;

    if (active !== null) {
      query += ` AND is_active = $${i++}`;
      params.push(active);
    }
    if (verified !== null) {
      query += ` AND is_verified = $${i++}`;
      params.push(verified);
    }
    if (role !== null) {
      query += ` AND role = $${i++}`;
      params.push(role);
    }

    query += ` ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    return result.rows;
  }

  static async countUsers() {
    const result = await pool.query('SELECT COUNT(*) FROM users');
    return parseInt(result.rows[0].count, 10);
  }

  // ===============================
  // حذف کاربر
  // ===============================
  static async softDelete(id) {
    const result = await pool.query(
      `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id`,
      [id]
    );
    return result.rows[0] || null;
  }

  static async delete(id) {
    const result = await pool.query(
      `DELETE FROM users WHERE id = $1 RETURNING id`,
      [id]
    );
    return result.rows[0] || null;
  }

  // ===============================
  // پیدا کردن کاربر بر اساس sms_token
  // ===============================
  static async findBySmsToken(token) {
    const result = await pool.query(
      'SELECT * FROM users WHERE sms_token = $1 LIMIT 1',
      [token]
    );
    return result.rows[0] || null;
  }

  // ===============================
  // تایید شماره تلفن
  // ===============================
  static async updatePhoneVerified(userId) {
    await pool.query(
      'UPDATE users SET phone_verified = true, sms_token = NULL WHERE id = $1',
      [userId]
    );
  }

  // ===============================
  // متدهای داشبورد
  // ===============================
  static async count() {
    const result = await pool.query('SELECT COUNT(*) FROM users');
    return parseInt(result.rows[0].count, 10);
  }

  static async findRecent(limit = 5) {
    const result = await pool.query(
      'SELECT id, full_name, email, role, created_at FROM users ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return result.rows;
  }
}

module.exports = User;
