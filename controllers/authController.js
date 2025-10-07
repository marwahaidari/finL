// controllers/authController.js
const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const User = require('../models/User'); // فرض: مدل شما متدهای زیر را دارد: create, findByEmail, findById, updateById, updatePassword

// avatar dir
const avatarDir = path.join(__dirname, '..', 'uploads', 'avatars');
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

// multer (برای آپلود عکس پروفایل)
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, avatarDir),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.png', '.jpg', '.jpeg'].includes(ext)) return cb(new Error('فقط فرمت تصویر مجاز است'));
    cb(null, true);
  }
});

const authController = {
  registerPage: (req, res) => {
    return res.render('register', { oldInput: {}, error_msg: req.flash('error_msg'), success_msg: req.flash('success_msg') });
  },

  register: async (req, res) => {
    console.log('[REGISTER] body:', req.body);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render('register', { error_msg: errors.array()[0].msg, oldInput: req.body });
    }

    let { name, email, password, confirmPassword, role, phone, terms } = req.body;
    name = (name || '').trim();
    email = (email || '').trim().toLowerCase();
    role = (role || 'user').trim();
    phone = (phone || '').trim();

    if (!name || !email || !password) {
      return res.render('register', { error_msg: 'تمام فیلدها الزامی هستند', oldInput: req.body });
    }
    if (password !== confirmPassword) return res.render('register', { error_msg: 'رمز عبور مطابقت ندارد', oldInput: req.body });
    if (!terms) return res.render('register', { error_msg: 'قبول قوانین الزامی است', oldInput: req.body });

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
    if (!passwordRegex.test(password)) return res.render('register', { error_msg: 'رمز عبور ضعیف است', oldInput: req.body });

    try {
      const existing = await User.findByEmail(email);
      if (existing) return res.render('register', { error_msg: 'ایمیل قبلا ثبت شده است', oldInput: req.body });

      const hashed = await bcrypt.hash(password, 12);

      // توجه: only columns that exist in your users table
      const created = await User.create({
        name,
        email,
        password: hashed,
        role,
        phone,
        is_active: true
      });

      // اگر مدل شما created را برنمی‌گرداند، می‌توانید دوباره findByEmail کنید.
      req.session.user = { id: created.id, name: created.name };
      req.flash('success_msg', 'ثبت نام موفق. اکنون وارد شدید');
      return res.redirect('/dashboard');
    } catch (err) {
      console.error('[REGISTER] Error:', err);
      return res.render('register', { error_msg: 'خطا در ثبت نام، دوباره تلاش کنید', oldInput: req.body });
    }
  },

  loginPage: (req, res) => res.render('login', { oldInput: {}, error: req.flash('error') }),

  login: async (req, res) => {
    try {
      const { identifier, password } = req.body;
      if (!identifier || !password) return res.render('login', { error: 'اطلاعات ناقص است', oldInput: req.body });

      let user = null;
      if (identifier.includes('@')) user = await User.findByEmail(identifier.toLowerCase());
      else user = await User.findByPhone ? await User.findByPhone(identifier) : null;

      if (!user) return res.render('login', { error: 'اطلاعات ورود اشتباه است', oldInput: req.body });
      if (!user.is_active) return res.render('login', { error: 'حساب غیرفعال است', oldInput: req.body });

      const match = await bcrypt.compare(password, user.password);
      if (!match) return res.render('login', { error: 'اطلاعات ورود اشتباه است', oldInput: req.body });

      req.session.user = { id: user.id, name: user.name };
      req.flash('success_msg', 'ورود موفق');
      return res.redirect('/dashboard');
    } catch (err) {
      console.error('[LOGIN] Error:', err);
      return res.render('login', { error: 'خطا در ورود', oldInput: req.body });
    }
  },

  logout: (req, res) => {
    req.session.destroy(() => {
      req.flash('success_msg', 'خارج شدید');
      res.redirect('/login');
    });
  },

  profile: async (req, res) => {
    const userId = req.session.user?.id;
    if (!userId) {
      req.flash('error_msg', 'ابتدا وارد شوید');
      return res.redirect('/login');
    }
    try {
      const user = await User.findById(userId);
      if (!user) {
        req.flash('error_msg', 'کاربر یافت نشد');
        return res.redirect('/login');
      }
      res.render('profile', { user, error: req.flash('error_msg'), success: req.flash('success_msg') });
    } catch (err) {
      console.error('[PROFILE] Error:', err);
      req.flash('error_msg', 'خطا در بارگذاری پروفایل');
      res.redirect('/login');
    }
  },

  updateProfile: [
    upload.single('avatar'),
    async (req, res) => {
      const userId = req.session.user?.id;
      if (!userId) return res.redirect('/login');
      try {
        const payload = {};
        if (req.body.name) payload.name = req.body.name.trim();
        if (req.file) payload.avatar = '/uploads/avatars/' + req.file.filename;
        if (req.body.phone) payload.phone = req.body.phone.trim();

        await User.updateById(userId, payload);
        req.flash('success_msg', 'پروفایل به‌روزرسانی شد');
        res.redirect('/profile');
      } catch (err) {
        console.error('[UPDATE PROFILE] Error:', err);
        req.flash('error_msg', 'خطا در بروزرسانی پروفایل');
        res.redirect('/profile');
      }
    }
  ],

  changePassword: async (req, res) => {
    const userId = req.session.user?.id;
    if (!userId) {
      req.flash('error_msg', 'ابتدا وارد شوید');
      return res.redirect('/login');
    }
    try {
      const { currentPassword, newPassword, confirmPassword } = req.body;
      if (!newPassword || newPassword !== confirmPassword) {
        req.flash('error_msg', 'رمز جدید نامعتبر یا مطابقت ندارد');
        return res.redirect('/profile');
      }
      const user = await User.findById(userId);
      const match = await bcrypt.compare(currentPassword, user.password);
      if (!match) {
        req.flash('error_msg', 'رمز فعلی اشتباه است');
        return res.redirect('/profile');
      }
      const hashed = await bcrypt.hash(newPassword, 12);
      await User.updatePassword(userId, hashed);
      req.flash('success_msg', 'رمز با موفقیت تغییر کرد');
      res.redirect('/profile');
    } catch (err) {
      console.error('[CHANGE PASSWORD] Error:', err);
      req.flash('error_msg', 'خطا در تغییر رمز');
      res.redirect('/profile');
    }
  }
};

module.exports = authController;
module.exports.upload = upload;
