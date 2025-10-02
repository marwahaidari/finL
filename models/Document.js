// models/Document.js
const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');

const Document = {
    async create({ request_id, filename, filepath, mimetype, size, uploaded_by }) {
        const id = uuidv4();
        const now = new Date();
        const q = `INSERT INTO documents (id, request_id, filename, filepath, mimetype, size, uploaded_by, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`;
        const values = [id, request_id, filename, filepath, mimetype, size, uploaded_by, now];
        const { rows } = await pool.query(q, values);
        return rows[0];
    },

    async listByRequest(request_id) {
        const { rows } = await pool.query('SELECT * FROM documents WHERE request_id = $1 ORDER BY created_at', [request_id]);
        return rows;
    },

    async findById(id) {
        const { rows } = await pool.query('SELECT * FROM documents WHERE id = $1', [id]);
        return rows[0];
    },

    async delete(id) {
        const doc = await this.findById(id);
        if (!doc) return null;
        await pool.query('DELETE FROM documents WHERE id = $1', [id]);
        return doc;
    }
};

module.exports = Document;
