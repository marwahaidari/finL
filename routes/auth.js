const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController'); // درست است
const { ensureAuthenticated } = require('../middlewares/authMiddleware');
const multer = require('multer');
const path = require('path');
const rateLimit = require('express-rate-limit');

// =============================
// Rate Limiter for Security
// =============================
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many login attempts. Please try again later.'
});

// =============================
// Multer Config for Profile Photo
// =============================
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/profile_photos'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Invalid file type'));
    }
});

// =============================
// Registration Routes
// =============================
router.get('/register', authController.registerPage);
router.post(
    '/register',
    [
        body('name').notEmpty().withMessage('Full name is required'),
        body('email').isEmail().withMessage('Invalid email address'),
        body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
        body('confirmPassword').custom((value, { req }) => value === req.body.password).withMessage('Passwords do not match'),
    ],
    authController.register
);

// =============================
// Verification Routes
// =============================
router.get('/verify/:token', authController.verifyEmail);
router.get('/verify-sms/:code', authController.verifyPhone);

// =============================
// Login Routes
// =============================
router.get('/login', authController.loginPage);
router.post(
    '/login',
    loginLimiter,
    [
        body('identifier').notEmpty().withMessage('Email, National ID, or Phone is required'),
        body('password').notEmpty().withMessage('Password is required'),
    ],
    authController.login
);

// =============================
// 2FA Routes
// =============================
router.get('/2fa/setup', ensureAuthenticated, authController.enable2FA);
router.post('/2fa/verify', ensureAuthenticated, authController.verify2FA);

// =============================
// Logout Routes
// =============================
router.get('/logout', ensureAuthenticated, authController.logout);
router.post('/logout-all', ensureAuthenticated, authController.logoutOtherSessions);

// =============================
// Password Recovery
// =============================
router.get('/forgot-password', authController.forgotPasswordPage);
router.post('/forgot-password', authController.forgotPassword);
router.get('/reset/:token', authController.resetPasswordPage);
router.post('/reset/:token', authController.resetPassword);

// =============================
// Profile Management
// =============================
router.get('/profile', ensureAuthenticated, authController.profile);
router.post('/profile', ensureAuthenticated, upload.single('avatar'), authController.updateProfile);
router.post('/profile/change-password', ensureAuthenticated, authController.changePassword);
router.post('/profile/upload-photo', ensureAuthenticated, authController.uploadProfilePhoto);
router.post('/profile/delete-account', ensureAuthenticated, authController.deleteAccount);

// =============================
// Strong Password Generator (API Example)
// =============================
router.get('/generate-password', ensureAuthenticated, authController.generateStrongPassword);

module.exports = router;
