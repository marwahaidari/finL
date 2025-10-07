// routes/auth.js
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { ensureAuthenticated } = require('../middlewares/authMiddleware'); // فرضاً دارید

router.get('/register', authController.registerPage);
router.post('/register',
  [
    body('name').notEmpty().withMessage('نام الزامی است'),
    body('email').isEmail().withMessage('ایمیل نامعتبر'),
    body('password').isLength({ min: 8 }).withMessage('رمز حداقل 8 کاراکتر'),
    body('confirmPassword').custom((v, { req }) => v === req.body.password).withMessage('رمزها مطابقت ندارند')
  ],
  authController.register
);

router.get('/login', authController.loginPage);
router.post('/login', authController.login);

router.get('/logout', ensureAuthenticated, authController.logout);

router.get('/profile', ensureAuthenticated, authController.profile);
router.post('/profile', ensureAuthenticated, authController.updateProfile);

router.post('/profile/change-password', ensureAuthenticated, authController.changePassword);

module.exports = router;
