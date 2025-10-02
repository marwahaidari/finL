// models/Service.js
const db = require('../db');

class Service {
    static async create({ name, department_id, description, fee, required_documents }) {
        const result = await db.query(
            'INSERT INTO services (name, department_id, description, fee, required_documents) VALUES ($1,$2,$3,$4,$5) RETURNING *',
            [name, department_id, description, fee, required_documents]
        );
        return result.rows[0];
    }

    static async list() {
        const result = await db.query('SELECT * FROM services ORDER BY name');
        return result.rows;
    }

    static async listByDepartment(department_id) {
        const result = await db.query('SELECT * FROM services WHERE department_id=$1', [department_id]);
        return result.rows;
    }

    static async findById(id) {
        const result = await db.query('SELECT * FROM services WHERE id=$1', [id]);
        return result.rows[0];
    }

    static async update(id, { name, department_id, description, fee, required_documents }) {
        const result = await db.query(
            'UPDATE services SET name=$1, department_id=$2, description=$3, fee=$4, required_documents=$5 WHERE id=$6 RETURNING *',
            [name, department_id, description, fee, required_documents, id]
        );
        return result.rows[0];
    }

    static async delete(id) {
        await db.query('DELETE FROM services WHERE id=$1', [id]);
    }
}

module.exports = Service;
