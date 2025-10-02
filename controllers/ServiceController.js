const db = require('../db');

const ServiceController = {
    list: async (req, res) => {
        try {
            const { rows } = await db.query(
                `SELECT s.*, d.name as department_name 
                 FROM services s 
                 JOIN departments d ON s.department_id = d.id 
                 ORDER BY s.name ASC`
            );
            res.json(rows);
        } catch (err) {
            console.error('Service list error:', err);
            res.status(500).json({ error: 'خطا در دریافت سرویس‌ها' });
        }
    },

    listByDepartment: async (req, res) => {
        const { department_id } = req.params;
        try {
            const { rows } = await db.query(
                'SELECT * FROM services WHERE department_id=$1 ORDER BY name ASC',
                [department_id]
            );
            res.json(rows);
        } catch (err) {
            console.error('Service list by department error:', err);
            res.status(500).json({ error: 'خطا در دریافت سرویس‌ها' });
        }
    },

    create: async (req, res) => {
        const { name, department_id, fee, required_documents } = req.body;
        try {
            const { rows } = await db.query(
                'INSERT INTO services(name, department_id, fee, required_documents) VALUES($1,$2,$3,$4) RETURNING *',
                [name, department_id, fee, required_documents]
            );
            res.status(201).json(rows[0]);
        } catch (err) {
            console.error('Service create error:', err);
            res.status(500).json({ error: 'خطا در ایجاد سرویس' });
        }
    },

    update: async (req, res) => {
        const { id } = req.params;
        const { name, department_id, fee, required_documents } = req.body;
        try {
            const { rows } = await db.query(
                'UPDATE services SET name=$1, department_id=$2, fee=$3, required_documents=$4 WHERE id=$5 RETURNING *',
                [name, department_id, fee, required_documents, id]
            );
            res.json(rows[0]);
        } catch (err) {
            console.error('Service update error:', err);
            res.status(500).json({ error: 'خطا در ویرایش سرویس' });
        }
    },

    delete: async (req, res) => {
        const { id } = req.params;
        try {
            await db.query('DELETE FROM services WHERE id=$1', [id]);
            res.json({ message: 'سرویس حذف شد' });
        } catch (err) {
            console.error('Service delete error:', err);
            res.status(500).json({ error: 'خطا در حذف سرویس' });
        }
    },
};

module.exports = ServiceController;
