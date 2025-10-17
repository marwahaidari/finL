const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const path = require('path');
const authController = require('../controllers/authController');
const { ensureAuthenticated } = require('../middlewares/authMiddleware');
const { redirectIfAuthenticated } = require('../middlewares/authRedirect');
const rateLimit = require('express-rate-limit');
const multer = require('multer');

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
router.get('/register', redirectIfAuthenticated, authController.registerPage);
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

// =============================
// Login Routes
// =============================
router.get('/login', redirectIfAuthenticated, authController.loginPage);
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

router.get('/logout', ensureAuthenticated, authController.logout);

router.get('/profile', ensureAuthenticated, authController.profile);
router.post('/profile', ensureAuthenticated, upload.single('photo'), authController.updateProfile);
router.post('/profile/change-password', ensureAuthenticated, authController.changePassword);

module.exports = router;
