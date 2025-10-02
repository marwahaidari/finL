// models/Settings.js
const pool = require('../db'); // database connection

const Settings = {
    create: async (key, value, options = {}) => {
        const { description = null, category = null, type = null, isActive = true } = options;
        const query = `
            INSERT INTO settings (key, value, description, category, type, is_active)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`;
        const values = [key, value, description, category, type, isActive];
        const { rows } = await pool.query(query, values);
        return rows[0];
    },

    findAll: async ({ limit = 50, offset = 0, activeOnly = true, category = null, type = null } = {}) => {
        let query = `SELECT * FROM settings WHERE 1=1`;
        const values = [];
        if (activeOnly) {
            values.push(true);
            query += ` AND is_active = $${values.length}`;
        }
        if (category) {
            values.push(category);
            query += ` AND category = $${values.length}`;
        }
        if (type) {
            values.push(type);
            query += ` AND type = $${values.length}`;
        }
        query += ` ORDER BY id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
        values.push(limit, offset);
        const { rows } = await pool.query(query, values);
        return rows;
    },

    findByKey: async (key) => {
        const query = `SELECT * FROM settings WHERE key = $1 LIMIT 1`;
        const { rows } = await pool.query(query, [key]);
        return rows[0];
    },

    update: async (id, { value, description, category, type, isActive }) => {
        const query = `
            UPDATE settings
            SET value = $1,
                description = $2,
                category = $3,
                type = $4,
                is_active = $5,
                updated_at = NOW()
            WHERE id = $6
            RETURNING *`;
        const values = [value, description, category, type, isActive, id];
        const { rows } = await pool.query(query, values);
        return rows[0];
    },

    softDelete: async (id) => {
        const query = `
            UPDATE settings
            SET is_active = false, updated_at = NOW()
            WHERE id = $1
            RETURNING *`;
        const { rows } = await pool.query(query, [id]);
        return rows[0];
    },

    delete: async (id) => {
        const query = `DELETE FROM settings WHERE id = $1`;
        await pool.query(query, [id]);
        return true;
    },

    search: async (keyword, { limit = 50, offset = 0, activeOnly = true, category = null } = {}) => {
        let query = `SELECT * FROM settings WHERE (key ILIKE $1 OR value::text ILIKE $1)`;
        const values = [`%${keyword}%`];
        if (activeOnly) {
            values.push(true);
            query += ` AND is_active = $${values.length}`;
        }
        if (category) {
            values.push(category);
            query += ` AND category = $${values.length}`;
        }
        query += ` ORDER BY id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
        values.push(limit, offset);
        const { rows } = await pool.query(query, values);
        return rows;
    },

    count: async ({ activeOnly = true, category = null, type = null } = {}) => {
        let query = `SELECT COUNT(*) FROM settings WHERE 1=1`;
        const values = [];
        if (activeOnly) {
            values.push(true);
            query += ` AND is_active = $${values.length}`;
        }
        if (category) {
            values.push(category);
            query += ` AND category = $${values.length}`;
        }
        if (type) {
            values.push(type);
            query += ` AND type = $${values.length}`;
        }
        const { rows } = await pool.query(query, values);
        return parseInt(rows[0].count, 10);
    },

    addReaction: async (id, userId, reaction) => {
        const query = `
            INSERT INTO setting_reactions (setting_id, user_id, reaction)
            VALUES ($1, $2, $3)
            RETURNING *`;
        const { rows } = await pool.query(query, [id, userId, reaction]);
        return rows[0];
    },

    getReactions: async (id) => {
        const query = `SELECT * FROM setting_reactions WHERE setting_id = $1`;
        const { rows } = await pool.query(query, [id]);
        return rows;
    }
};

module.exports = Settings;
