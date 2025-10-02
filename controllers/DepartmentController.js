const db = require('../db');

const DepartmentController = {

    // =============================
    // List all departments with pagination
    // =============================
    list: async (req, res, options = { page: 1, limit: 10 }) => {
        const { page, limit } = options;
        const offset = (page - 1) * limit;
        try {
            const { rows: departments } = await db.query(
                'SELECT * FROM departments ORDER BY name ASC LIMIT $1 OFFSET $2',
                [limit, offset]
            );

            const { rows: countResult } = await db.query('SELECT COUNT(*) FROM departments');
            const total = parseInt(countResult[0].count);
            const totalPages = Math.ceil(total / limit);

            return { departments, total, totalPages };
        } catch (err) {
            console.error('Department list error:', err);
            res.status(500).json({ error: 'خطا در دریافت دپارتمان‌ها' });
        }
    },

    // =============================
    // Create new department
    // =============================
    create: async (req, res) => {
        const { name, description } = req.body;
        try {
            const exists = await db.query('SELECT * FROM departments WHERE name=$1', [name]);
            if (exists.rows.length > 0) return res.status(400).json({ error: 'نام دپارتمان تکراری است' });

            const { rows } = await db.query(
                'INSERT INTO departments(name, description, active, created_at) VALUES($1, $2, true, NOW()) RETURNING *',
                [name, description]
            );
            res.status(201).json(rows[0]);
        } catch (err) {
            console.error('Department create error:', err);
            res.status(500).json({ error: 'خطا در ایجاد دپارتمان' });
        }
    },

    // =============================
    // Update department
    // =============================
    update: async (req, res) => {
        const { id } = req.params;
        const { name, description } = req.body;
        try {
            const exists = await db.query('SELECT * FROM departments WHERE name=$1 AND id<>$2', [name, id]);
            if (exists.rows.length > 0) return res.status(400).json({ error: 'نام دپارتمان تکراری است' });

            const { rows } = await db.query(
                'UPDATE departments SET name=$1, description=$2, updated_at=NOW() WHERE id=$3 RETURNING *',
                [name, description, id]
            );
            if (!rows[0]) return res.status(404).json({ error: 'دپارتمان پیدا نشد' });
            res.json(rows[0]);
        } catch (err) {
            console.error('Department update error:', err);
            res.status(500).json({ error: 'خطا در ویرایش دپارتمان' });
        }
    },

    // =============================
    // Delete department
    // =============================
    delete: async (req, res) => {
        const { id } = req.params;
        try {
            const { rowCount } = await db.query('DELETE FROM departments WHERE id=$1', [id]);
            if (rowCount === 0) return res.status(404).json({ error: 'دپارتمان پیدا نشد' });
            res.json({ message: 'دپارتمان حذف شد' });
        } catch (err) {
            console.error('Department delete error:', err);
            res.status(500).json({ error: 'خطا در حذف دپارتمان' });
        }
    },

    // =============================
    // Toggle Active/Inactive
    // =============================
    toggleActive: async (req, res) => {
        const { id } = req.params;
        try {
            const { rows } = await db.query('SELECT active FROM departments WHERE id=$1', [id]);
            if (!rows[0]) return res.status(404).json({ error: 'دپارتمان پیدا نشد' });

            const newStatus = !rows[0].active;
            const { rows: updated } = await db.query(
                'UPDATE departments SET active=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
                [newStatus, id]
            );
            res.json(updated[0]);
        } catch (err) {
            console.error('Toggle active error:', err);
            res.status(500).json({ error: 'خطا در تغییر وضعیت دپارتمان' });
        }
    },

    // =============================
    // Search / Filter with pagination
    // =============================
    search: async (req, res, options = { page: 1, limit: 10 }) => {
        const { q } = req.query;
        const { page, limit } = options;
        const offset = (page - 1) * limit;
        try {
            const { rows: departments } = await db.query(
                'SELECT * FROM departments WHERE name ILIKE $1 OR description ILIKE $1 ORDER BY name ASC LIMIT $2 OFFSET $3',
                [`%${q}%`, limit, offset]
            );

            const { rows: countResult } = await db.query(
                'SELECT COUNT(*) FROM departments WHERE name ILIKE $1 OR description ILIKE $1',
                [`%${q}%`]
            );
            const total = parseInt(countResult[0].count);
            const totalPages = Math.ceil(total / limit);

            return { departments, total, totalPages };
        } catch (err) {
            console.error('Department search error:', err);
            res.status(500).json({ error: 'خطا در جستجوی دپارتمان‌ها' });
        }
    },

    // =============================
    // Get Department by ID + linked services count
    // =============================
    getById: async (req, res) => {
        const { id } = req.params;
        try {
            const { rows } = await db.query(
                `SELECT d.*, COUNT(s.id) AS services_count
                 FROM departments d
                 LEFT JOIN services s ON s.department_id = d.id
                 WHERE d.id=$1
                 GROUP BY d.id`,
                [id]
            );
            if (!rows[0]) return res.status(404).json({ error: 'دپارتمان پیدا نشد' });
            res.json(rows[0]);
        } catch (err) {
            console.error('Get department by ID error:', err);
            res.status(500).json({ error: 'خطا در دریافت دپارتمان' });
        }
    }

};

module.exports = DepartmentController;
