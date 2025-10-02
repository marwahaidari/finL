// models/Department.js
const db = require('../db'); // فرض: db/index.js برای اتصال به PostgreSQL
const { v4: uuidv4 } = require('uuid');

class Department {
    constructor(id, name, description, is_active, created_at, updated_at) {
        this.id = id;
        this.name = name;
        this.description = description;
        this.is_active = is_active;
        this.created_at = created_at;
        this.updated_at = updated_at;
    }

    // ---------- CREATE ----------
    static async create({ name, description }) {
        const id = uuidv4();
        const created_at = new Date();
        const updated_at = new Date();
        const is_active = true;

        const query = `
            INSERT INTO departments (id, name, description, is_active, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `;
        const values = [id, name, description, is_active, created_at, updated_at];

        const { rows } = await db.query(query, values);
        return new Department(...Object.values(rows[0]));
    }

    // ---------- READ ----------
    static async findById(id) {
        const query = `SELECT * FROM departments WHERE id = $1`;
        const { rows } = await db.query(query, [id]);
        if (!rows[0]) return null;
        return new Department(...Object.values(rows[0]));
    }

    static async findAll({ activeOnly = false } = {}) {
        let query = `SELECT * FROM departments`;
        if (activeOnly) query += ` WHERE is_active = true`;
        const { rows } = await db.query(query);
        return rows.map(r => new Department(...Object.values(r)));
    }

    static async findByName(name) {
        const query = `SELECT * FROM departments WHERE name ILIKE $1`;
        const { rows } = await db.query(query, [`%${name}%`]);
        return rows.map(r => new Department(...Object.values(r)));
    }

    // ---------- UPDATE ----------
    static async update(id, { name, description, is_active }) {
        const updated_at = new Date();
        const query = `
            UPDATE departments
            SET name = $1, description = $2, is_active = $3, updated_at = $4
            WHERE id = $5
            RETURNING *
        `;
        const values = [name, description, is_active, updated_at, id];
        const { rows } = await db.query(query, values);
        if (!rows[0]) return null;
        return new Department(...Object.values(rows[0]));
    }

    // ---------- DELETE ----------
    static async delete(id) {
        const query = `DELETE FROM departments WHERE id = $1 RETURNING *`;
        const { rows } = await db.query(query, [id]);
        if (!rows[0]) return null;
        return new Department(...Object.values(rows[0]));
    }

    // ---------- STATS ----------
    static async countDepartments() {
        const query = `SELECT COUNT(*) AS total FROM departments`;
        const { rows } = await db.query(query);
        return parseInt(rows[0].total);
    }

    static async activeDepartments() {
        const query = `SELECT COUNT(*) AS total FROM departments WHERE is_active = true`;
        const { rows } = await db.query(query);
        return parseInt(rows[0].total);
    }

    // ---------- EXTRA FEATURE ----------
    // تعداد کارمندان هر دپارتمان
    static async employeesCount(departmentId) {
        const query = `
            SELECT COUNT(*) AS total 
            FROM users 
            WHERE department_id = $1 AND role = 'employee'
        `;
        const { rows } = await db.query(query, [departmentId]);
        return parseInt(rows[0].total);
    }
}

module.exports = Department;
