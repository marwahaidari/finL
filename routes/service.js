const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const serviceController = require('../controllers/ServiceController');
const { ensureAuthenticated, checkRole } = require('../middlewares/authMiddleware');

// List all services (admin)
router.get('/', ensureAuthenticated(), checkRole(['admin']), serviceController.list);

// List services by department
router.get('/department/:department_id', ensureAuthenticated(), serviceController.listByDepartment);

// Create service
router.post(
    '/',
    ensureAuthenticated(),
    checkRole(['admin']),
    [
        body('name').notEmpty().withMessage('Service name is required'),
        body('department_id').notEmpty().withMessage('Department is required'),
        body('fee').isNumeric().withMessage('Fee must be a number'),
        body('required_documents').optional()
    ],
    serviceController.create
);

// Update service
router.put(
    '/:id',
    ensureAuthenticated(),
    checkRole(['admin']),
    [
        body('name').notEmpty().withMessage('Service name is required'),
        body('department_id').notEmpty().withMessage('Department is required'),
        body('fee').isNumeric().withMessage('Fee must be a number'),
        body('required_documents').optional()
    ],
    serviceController.update
);

// Delete service
router.delete('/:id', ensureAuthenticated(), checkRole(['admin']), serviceController.delete);

module.exports = router;
