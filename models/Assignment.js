const pool = require('../db');  // فرض بر اینکه فایل db.js اتصال به postgres رو داره

class Assignment {
    // ایجاد درخواست جدید
    static async create(userId, serviceId, details = {}, status = 'Submitted', isActive = true) {
        try {
            const result = await pool.query(
                `INSERT INTO requests 
         (user_id, service_id, status, details, is_active, created_at, updated_at) 
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         RETURNING *`,
                [userId, serviceId, status, JSON.stringify(details), isActive]
            );
            return result.rows[0];
        } catch (error) {
            throw new Error('Failed to create assignment: ' + error.message);
        }
    }

    // گرفتن درخواست بر اساس id
    static async findById(id, activeOnly = true) {
        try {
            let query = 'SELECT * FROM requests WHERE id = $1';
            const params = [id];
            if (activeOnly) {
                query += ' AND is_active = TRUE';
            }
            const result = await pool.query(query, params);
            return result.rows[0];
        } catch (error) {
            throw new Error('Failed to fetch assignment by id: ' + error.message);
        }
    }

    // گرفتن درخواست‌ها بر اساس کاربر با pagination
    static async findByUser(userId, { limit = 50, offset = 0, activeOnly = true } = {}) {
        try {
            let query = 'SELECT * FROM requests WHERE user_id = $1';
            const params = [userId];
            if (activeOnly) {
                query += ' AND is_active = TRUE';
            }
            query += ' ORDER BY created_at DESC LIMIT $2 OFFSET $3';
            params.push(limit, offset);
            const result = await pool.query(query, params);
            return result.rows;
        } catch (error) {
            throw new Error('Failed to fetch assignments by user: ' + error.message);
        }
    }

    // آپدیت وضعیت یا جزئیات درخواست
    static async updateStatusAndDetails(id, status, details) {
        try {
            const result = await pool.query(
                `UPDATE requests
         SET status = $1, details = $2, updated_at = NOW()
         WHERE id = $3 AND is_active = TRUE
         RETURNING *`,
                [status, JSON.stringify(details), id]
            );
            if (result.rows.length === 0) {
                throw new Error('Assignment not found or inactive');
            }
            return result.rows[0];
        } catch (error) {
            throw new Error('Failed to update assignment: ' + error.message);
        }
    }

    // حذف نرم (soft delete)
    static async softDelete(id) {
        try {
            const result = await pool.query(
                `UPDATE requests
         SET is_active = FALSE, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
                [id]
            );
            if (result.rows.length === 0) {
                throw new Error('Assignment not found');
            }
            return result.rows[0];
        } catch (error) {
            throw new Error('Failed to soft delete assignment: ' + error.message);
        }
    }

    // شمارش درخواست‌ها برای گزارش
    static async countByStatus(status = null, activeOnly = true) {
        try {
            let query = 'SELECT COUNT(*) AS total FROM requests WHERE 1=1';
            const params = [];
            if (status !== null) {
                query += ' AND status = $1';
                params.push(status);
            }
            if (activeOnly) {
                query += status !== null ? ' AND is_active = TRUE' : ' AND is_active = TRUE';
            }
            const result = await pool.query(query, params);
            return parseInt(result.rows[0].total, 10);
        } catch (error) {
            throw new Error('Failed to count assignments: ' + error.message);
        }
    }

    // جستجو با فیلترهای مختلف (status, service, date range)
    static async search({ userId = null, status = null, serviceId = null, fromDate = null, toDate = null, limit = 50, offset = 0 }) {
        try {
            let query = 'SELECT * FROM requests WHERE 1=1';
            const params = [];
            let idx = 1;

            if (userId !== null) {
                query += ` AND user_id = $${idx++}`;
                params.push(userId);
            }
            if (status !== null) {
                query += ` AND status = $${idx++}`;
                params.push(status);
            }
            if (serviceId !== null) {
                query += ` AND service_id = $${idx++}`;
                params.push(serviceId);
            }
            if (fromDate !== null) {
                query += ` AND created_at >= $${idx++}`;
                params.push(fromDate);
            }
            if (toDate !== null) {
                query += ` AND created_at <= $${idx++}`;
                params.push(toDate);
            }

            query += ' ORDER BY created_at DESC LIMIT $' + idx++ + ' OFFSET $' + idx++;
            params.push(limit, offset);

            const result = await pool.query(query, params);
            return result.rows;
        } catch (error) {
            throw new Error('Failed to search assignments: ' + error.message);
        }
    }
}

module.exports = Assignment;
