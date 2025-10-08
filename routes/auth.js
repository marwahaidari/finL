// routes/auth.js
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { ensureAuthenticated } = require('../middlewares/authMiddleware');
const { redirectIfAuthenticated } = require('../middlewares/authRedirect'); // Add this

const registerValidation = [
  body('name').notEmpty().trim().withMessage('Full name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/)
    .withMessage('Password must contain uppercase, lowercase, number and special character'),
  body('confirmPassword').custom((value, { req }) => {
    if (value !== req.body.password) {
      throw new Error('Passwords do not match');
    }
    return true;
  }),
  body('role').isIn(['citizen', 'employee']).withMessage('Valid role is required'),
  body('national_id').notEmpty().withMessage('National ID is required'),
  body('phone').notEmpty().withMessage('Phone number is required'),
  body('terms').equals('on').withMessage('You must accept terms and conditions')
];

// Use redirectIfAuthenticated to prevent logged-in users from accessing these pages
router.get('/register', redirectIfAuthenticated, authController.registerPage);
router.post('/register', redirectIfAuthenticated, registerValidation, authController.register);

router.get('/login', redirectIfAuthenticated, authController.loginPage);
router.post('/login', redirectIfAuthenticated, authController.login);

router.get('/logout', ensureAuthenticated, authController.logout);

router.get('/profile', ensureAuthenticated, authController.profile);
router.post('/profile', ensureAuthenticated, authController.updateProfile);

router.post('/profile/change-password', ensureAuthenticated, authController.changePassword);

module.exports = router;