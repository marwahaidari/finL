const express = require('express');
const router = express.Router();
const { body, validationResult, query } = require('express-validator');
const departmentController = require('../controllers/DepartmentController');
const { ensureAuthenticated, checkRole } = require('../middlewares/authMiddleware');

// =============================
// List all departments (admin view) with pagination
// =============================
router.get('/', ensureAuthenticated(), checkRole(['admin']), async (req, res) => {
    try {
        const isApi = req.query.api === 'true';
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;

        const result = await departmentController.list(req, res, { page, limit });

        if (isApi) {
            res.json(result);
        } else {
            res.render('departments/list', {
                departments: result.departments,
                currentPage: page,
                totalPages: result.totalPages
            });
        }
    } catch (err) {
        console.error('Error fetching departments:', err);
        res.status(500).send('خطا در دریافت دپارتمان‌ها');
    }
});

// =============================
// Create new department
// =============================
router.post(
    '/',
    ensureAuthenticated(),
    checkRole(['admin']),
    [
        body('name')
            .notEmpty().withMessage('Department name is required')
            .isLength({ min: 3 }).withMessage('Name must be at least 3 characters'),
        body('description')
            .optional()
            .isLength({ max: 255 }).withMessage('Description too long'),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
        await departmentController.create(req, res);
    }
);

// =============================
// Update department
// =============================
router.put(
    '/:id',
    ensureAuthenticated(),
    checkRole(['admin']),
    [
        body('name').notEmpty().withMessage('Department name is required'),
        body('description').optional().isLength({ max: 255 })
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
        await departmentController.update(req, res);
    }
);

// =============================
// Delete department
// =============================
router.delete('/:id', ensureAuthenticated(), checkRole(['admin']), async (req, res) => {
    await departmentController.delete(req, res);
});

// =============================
// Toggle Active/Inactive
// =============================
router.patch('/:id/toggle', ensureAuthenticated(), checkRole(['admin']), async (req, res) => {
    await departmentController.toggleActive(req, res);
});

// =============================
// Search / Filter with pagination
// =============================
router.get('/search',
    ensureAuthenticated(),
    checkRole(['admin']),
    [
        query('q').notEmpty().withMessage('Search query required'),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1 })
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const result = await departmentController.search(req, res, { page, limit });
        res.render('departments/list', {
            departments: result.departments,
            currentPage: page,
            totalPages: result.totalPages
        });
    }
);

// =============================
// Get department details including linked services count
// =============================
router.get('/:id', ensureAuthenticated(), checkRole(['admin', 'officer']), async (req, res) => {
    await departmentController.getDetails(req, res);
});

module.exports = router;
