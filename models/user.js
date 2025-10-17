// models/User.js
const pool = require('../db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

class User {
  // ===============================
  // ایجاد کاربر جدید
  // ===============================
  static async create(userData) {
    const {
      name, email, password, role = 'citizen', national_id, phone,
      verification_token = null, is_verified = true, // پیش‌فرض true مطابق کد فعلی
      is_active = true
    } = userData;

    try {
      const hashedPassword = await bcrypt.hash(password, 12);

      const result = await pool.query(
        `INSERT INTO users (
          name, email, password, role, national_id, phone,
          verification_token, is_verified, is_active, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
        RETURNING id, name, email, role, national_id, phone, is_verified, is_active`,
        [name, email, hashedPassword, role, national_id, phone,
          verification_token, is_verified, is_active]
      );

      return result.rows[0];
    } catch (error) {
      console.error('User creation error:', error);
      throw error;
    }
  }

  // ===============================
  // پیدا کردن کاربر بر اساس reset_token
  // ===============================
  static async findByResetToken(token) {
    const result = await pool.query(
      `SELECT * FROM users 
       WHERE reset_token = $1 AND reset_token_expires > NOW() 
       LIMIT 1`,
      [token]
    );
    return result.rows[0] || null;
  }

  // ===============================
  // پاک کردن reset_token بعد از استفاده
  // ===============================
  static async clearResetToken(userId) {
    try {
      await pool.query(
        `UPDATE users 
         SET reset_token = NULL, reset_token_expires = NULL, updated_at = NOW()
         WHERE id = $1`,
        [userId]
      );
    } catch (error) {
      console.error('Clear reset token error:', error);
      throw error;
    }
  }

  // ===============================
  // Find users (Fixed for PostgreSQL)
  // ===============================
  static async findByEmail(email) {
    try {
      const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Find by email error:', error);
      throw error;
    }
  }

  static async findById(id) {
    try {
      const result = await pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Find by ID error:', error);
      throw error;
    }
  }

  static async findByPhone(phone) {
    try {
      const result = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Find by phone error:', error);
      throw error;
    }
  }

  static async findByNationalId(nationalId) {
    try {
      const result = await pool.query('SELECT * FROM users WHERE national_id = $1', [nationalId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Find by national ID error:', error);
      throw error;
    }
  }

  static async findBySmsToken(token) {
    try {
      const result = await pool.query(
        'SELECT * FROM users WHERE sms_verification_token = $1 AND sms_token_expires > NOW()',
        [token]
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error('Find by SMS token error:', error);
      throw error;
    }
  }

  // ===============================
  // Email verification
  // ===============================
  static async verifyEmail(token) {
    try {
      const userResult = await pool.query(
        'SELECT * FROM users WHERE verification_token = $1 AND is_verified = false LIMIT 1',
        [token]
      );

      if (!userResult.rows.length) return null;

      await pool.query(
        'UPDATE users SET is_verified = true, verification_token = NULL, updated_at = NOW() WHERE verification_token = $1',
        [token]
      );

      return userResult.rows[0];
    } catch (error) {
      console.error('Verify email error:', error);
      throw error;
    }
  }

  // ===============================
  // Phone verification
  // ===============================
  static async updatePhoneVerified(userId) {
    try {
      await pool.query(
        'UPDATE users SET phone_verified = true, sms_verification_token = NULL, sms_token_expires = NULL, updated_at = NOW() WHERE id = $1',
        [userId]
      );
    } catch (error) {
      console.error('Update phone verified error:', error);
      throw error;
    }
  }

  // ===============================
  // Password reset methods
  // ===============================
  static async setResetToken(email, token) {
    try {
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      const result = await pool.query(
        'UPDATE users SET reset_token = $1, reset_token_expires = $2, updated_at = NOW() WHERE email = $3 RETURNING id, email',
        [token, expires, email]
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error('Set reset token error:', error);
      throw error;
    }
  }

  static async updatePassword(userId, hashedPassword) {
    try {
      const result = await pool.query(
        'UPDATE users SET password = $1, reset_token = NULL, reset_token_expires = NULL, updated_at = NOW() WHERE id = $2 RETURNING id, email',
        [hashedPassword, userId]
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error('Update password error:', error);
      throw error;
    }
  }

  // ===============================
  // تغییر رمز (که در routes فراخوانی می‌شود)
  // ===============================
  static async changePassword(userId, currentPassword, newPassword) {
    try {
      const user = await this.findById(userId);
      if (!user) throw new Error('User not found');

      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        const err = new Error('Current password is incorrect');
        err.code = 'INVALID_CURRENT_PASSWORD';
        throw err;
      }

      const hashed = await bcrypt.hash(newPassword, 12);
      return await this.updatePassword(userId, hashed);
    } catch (error) {
      console.error('Change password error:', error);
      throw error;
    }
  }

  // ===============================
  // Profile management
  // ===============================
  // انعطاف‌پذیر: می‌تواند به صورت (userId, {name, avatar, twoFactorSecret, twoFactorEnabled})
  // یا به صورت (userId, name, email) فراخوانی شود (برای سازگاری با routeها)
  static async updateProfile(userId, profileDataOrName, maybeEmail) {
    try {
      let profileData = {};

      // اگر دومین پارامتر آبجکت است (شیء پروفایل)
      if (profileDataOrName && typeof profileDataOrName === 'object' && !Array.isArray(profileDataOrName)) {
        profileData = profileDataOrName;
      } else {
        // در غیر این صورت فرض کن امضاء (userId, name, email)
        profileData.name = profileDataOrName || null;
        if (maybeEmail) profileData.email = maybeEmail;
      }

      const { name, email, avatar, twoFactorSecret, twoFactorEnabled } = profileData;

      const updates = [];
      const params = [];
      let idx = 1;

      if (name !== undefined && name !== null) {
        updates.push(`name = $${idx++}`);
        params.push(name);
      }
      if (email !== undefined && email !== null) {
        updates.push(`email = $${idx++}`);
        params.push(email);
      }
      if (avatar !== undefined && avatar !== null) {
        updates.push(`avatar = $${idx++}`);
        params.push(avatar);
      }
      if (twoFactorSecret !== undefined) {
        updates.push(`two_factor_secret = $${idx++}`);
        params.push(twoFactorSecret);
      }
      if (twoFactorEnabled !== undefined) {
        updates.push(`two_factor_enabled = $${idx++}`);
        params.push(twoFactorEnabled);
      }

      if (updates.length === 0) {
        // چیزی برای آپدیت نیست
        return await this.findById(userId);
      }

      updates.push('updated_at = NOW()');
      const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
      params.push(userId);

      const result = await pool.query(query, params);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Update profile error:', error);
      throw error;
    }
  }

  // ===============================
  // Login and security
  // ===============================
  static async updateLastLogin(userId, ip = null, userAgent = null) {
    try {
      await pool.query(
        'UPDATE users SET last_login = NOW(), last_login_ip = $2, user_agent = $3, updated_at = NOW() WHERE id = $1',
        [userId, ip, userAgent]
      );
    } catch (error) {
      console.error('Update last login error:', error);
      throw error;
    }
  }

  // ===============================
  // Account management
  // ===============================
  static async delete(userId) {
    try {
      const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [userId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Delete user error:', error);
      throw error;
    }
  }

  // ===============================
  // Utility methods
  // ===============================
  static async count() {
    try {
      const result = await pool.query('SELECT COUNT(*) FROM users');
      return parseInt(result.rows[0].count, 10);
    } catch (error) {
      console.error('Count users error:', error);
      throw error;
    }
  }

  // یک findAll واحد و منعطف (پوشش برای admin/export و داشبورد)
  static async findAll(options = {}) {
    try {
      // اگر options آرایه یا عدد نبود، فرض کن می‌خوان همه کاربران فعال رو بگیرن
      if (typeof options === 'number') options = { limit: options };

      const {
        limit = 50,
        offset = 0,
        active = null,
        verified = null,
        role = null
      } = options;

      let query = 'SELECT * FROM users WHERE 1=1';
      const params = [];
      let paramCount = 0;

      if (active !== null) {
        paramCount++;
        query += ` AND is_active = $${paramCount}`;
        params.push(active);
      }
      if (verified !== null) {
        paramCount++;
        query += ` AND is_verified = $${paramCount}`;
        params.push(verified);
      }
      if (role !== null) {
        paramCount++;
        query += ` AND role = $${paramCount}`;
        params.push(role);
      }

      paramCount++;
      query += ` ORDER BY created_at DESC LIMIT $${paramCount}`;
      params.push(limit);

      paramCount++;
      query += ` OFFSET $${paramCount}`;
      params.push(offset);

      const result = await pool.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('Find all users error:', error);
      throw error;
    }
  }
}

module.exports = User;
