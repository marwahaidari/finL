const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');

const Request = {
    async create({ user_id, service_id, department_id, title, description, fee = 0 }) {
        const id = uuidv4();
        const now = new Date();
        const text = `
      INSERT INTO requests (id, user_id, service_id, department_id, title, description, fee, status, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `;
        const values = [id, user_id, service_id, department_id, title, description, fee, 'submitted', now, now];
        const { rows } = await pool.query(text, values);
        return rows[0];
    },

    async findById(id) {
        const { rows } = await pool.query('SELECT * FROM requests WHERE id = $1', [id]);
        return rows[0];
    },

    async listByUser(user_id, { limit = 50, offset = 0 } = {}) {
        const { rows } = await pool.query(
            `SELECT * FROM requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
            [user_id, limit, offset]
        );
        return rows;
    },

    async listByDepartment(department_id, { status, search, limit = 50, offset = 0 } = {}) {
        let q = `SELECT * FROM requests WHERE department_id = $1`;
        const params = [department_id];
        if (status) { params.push(status); q += ` AND status = $${params.length}`; }
        if (search) { params.push(`%${search}%`); q += ` AND (title ILIKE $${params.length} OR description ILIKE $${params.length})`; }
        params.push(limit, offset);
        q += ` ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
        const { rows } = await pool.query(q, params);
        return rows;
    },

    async listAll({ filter = {}, limit = 50, offset = 0 } = {}) {
        const parts = [];
        const params = [];
        if (filter.status) { params.push(filter.status); parts.push(`status = $${params.length}`); }
        if (filter.service_id) { params.push(filter.service_id); parts.push(`service_id = $${params.length}`); }
        if (filter.user_id) { params.push(filter.user_id); parts.push(`user_id = $${params.length}`); }
        let where = parts.length ? ('WHERE ' + parts.join(' AND ')) : '';
        const q = `SELECT * FROM requests ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);
        const { rows } = await pool.query(q, params);
        return rows;
    },

    async updateStatus(id, status, reviewer_id, note = null) {
        const now = new Date();
        const q = `UPDATE requests SET status = $1, reviewer_id = $2, review_note = $3, updated_at = $4 WHERE id = $5 RETURNING *`;
        const values = [status, reviewer_id, note, now, id];
        const { rows } = await pool.query(q, values);
        return rows[0];
    },

    // optional helper: update fields
    async update(id, data = {}) {
        const fields = [];
        const values = [];
        let idx = 1;
        for (const key of Object.keys(data)) {
            fields.push(`${key} = $${idx++}`);
            values.push(data[key]);
        }
        if (fields.length === 0) return this.findById(id);
        values.push(id);
        const q = `UPDATE requests SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`;
        const { rows } = await pool.query(q, values);
        return rows[0];
    }
};

module.exports = Request;
