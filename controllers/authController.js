// controllers/authController.js
const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const User = require('../models/User');

const avatarDir = path.join(__dirname, '..', 'uploads', 'avatars');
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, avatarDir),
        filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
    }),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!['.png', '.jpg', '.jpeg'].includes(ext))
            return cb(new Error('فقط فرمت تصویر مجاز است'));
        cb(null, true);
    }
});

const authController = {
    registerPage: (req, res) => {
        return res.render('register', { oldInput: {}, error_msg: req.flash('error_msg'), success_msg: req.flash('success_msg') });
    },

    register: async (req, res) => {
        console.log('🔵 [REGISTER] body:', req.body);
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.render('register', { error_msg: errors.array()[0].msg, oldInput: req.body });
        }

        let { name, email, password, confirmPassword, role, phone, national_id, terms } = req.body;
        name = (name || '').trim();
        email = (email || '').trim().toLowerCase();
        role = (role || 'user').trim();
        phone = (phone || '').trim();
        national_id = (national_id || '').trim();

        console.log('🔵 [REGISTER] Processing:', { name, email, role, phone, national_id });

        // بررسی فیلدهای الزامی
        if (!name || !email || !password || !national_id) {
            return res.render('register', { error_msg: 'تمام فیلدهای الزامی را وارد کنید', oldInput: req.body });
        }

        if (password !== confirmPassword) {
            return res.render('register', { error_msg: 'رمز عبور مطابقت ندارد', oldInput: req.body });
        }

        if (!terms) {
            return res.render('register', { error_msg: 'قبول قوانین الزامی است', oldInput: req.body });
        }

        // اعتبارسنجی کد ملی
        const codeRegex = /^\d{10}$/;
        if (!codeRegex.test(national_id)) {
            return res.render('register', { error_msg: 'کد ملی نامعتبر است', oldInput: req.body });
        }

        // اعتبارسنجی رمز عبور
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
        if (!passwordRegex.test(password)) {
            return res.render('register', { error_msg: 'رمز عبور باید حداقل ۸ کاراکتر و شامل حروف بزرگ، کوچک، عدد و کاراکتر ویژه باشد', oldInput: req.body });
        }

        try {
            console.log('🔵 [REGISTER] Checking existing users...');
            const existingEmail = await User.findByEmail(email);
            if (existingEmail) {
                console.log('🔴 [REGISTER] Email already exists:', email);
                return res.render('register', { error_msg: 'ایمیل قبلا ثبت شده است', oldInput: req.body });
            }

            const existingNationalId = await User.findByNationalId(national_id);
            if (existingNationalId) {
                console.log('🔴 [REGISTER] National ID already exists:', national_id);
                return res.render('register', { error_msg: 'کد ملی قبلا ثبت شده است', oldInput: req.body });
            }

            const hashed = await bcrypt.hash(password, 12);
            console.log('🔵 [REGISTER] Creating user...');

            // ایجاد کاربر جدید - با پارامترهای درست
            const created = await User.create({
                nationalId: national_id,
                fullName: name,
                email: email,
                phone: phone,
                password: hashed,
                role: role,
                departmentId: null
            });

            console.log('✅ [REGISTER] User created:', created);

            req.session.user = {
                id: created.id,
                name: created.full_name,
                email: created.email,
                role: created.role
            };

            req.flash('success_msg', 'ثبت نام موفق. اکنون وارد شدید');
            return res.redirect('/dashboard');
        } catch (err) {
            console.error('🔴 [REGISTER] Error:', err);
            return res.render('register', { error_msg: 'خطا در ثبت نام، دوباره تلاش کنید', oldInput: req.body });
        }
    },

    loginPage: (req, res) => res.render('login', { oldInput: {}, error: req.flash('error') }),

    login: async (req, res) => {
        try {
            const { identifier, password } = req.body;
            console.log('🔵 [LOGIN] Attempt:', { identifier });

            if (!identifier || !password) {
                return res.render('login', { error: 'اطلاعات ناقص است', oldInput: req.body });
            }

            let user = null;

            // اگر ورودی شامل '@' باشد => ایمیل
            if (identifier.includes('@')) {
                console.log('🔵 [LOGIN] Searching by email:', identifier);
                user = await User.findByEmail(identifier.toLowerCase());
            } else {
                const val = identifier.trim();
                const nationalCodeRegex = /^\d{10}$/;

                // اگر ده رقم عددی بود => کد ملی
                if (nationalCodeRegex.test(val)) {
                    console.log('🔵 [LOGIN] Searching by national ID:', val);
                    user = await User.findByNationalId(val);
                }

                // اگر پیدا نکردیم => شماره موبایل
                if (!user) {
                    console.log('🔵 [LOGIN] Searching by phone:', val);
                    user = await User.findByPhone(val);
                }
            }

            console.log('🔵 [LOGIN] User found:', user ? 'YES' : 'NO');

            if (!user) {
                console.log('🔴 [LOGIN] User not found');
                return res.render('login', { error: 'اطلاعات ورود اشتباه است', oldInput: req.body });
            }

            console.log('🔵 [LOGIN] User status:', {
                is_active: user.is_active,
                is_verified: user.is_verified
            });

            if (!user.is_active) {
                return res.render('login', { error: 'حساب غیرفعال است', oldInput: req.body });
            }

            console.log('🔵 [LOGIN] Checking password...');
            const match = await bcrypt.compare(password, user.password);
            console.log('🔵 [LOGIN] Password match:', match);

            if (!match) {
                console.log('🔴 [LOGIN] Password incorrect');
                return res.render('login', { error: 'اطلاعات ورود اشتباه است', oldInput: req.body });
            }

            // آپدیت آخرین لاگین
            await User.updateLastLogin(user.id, req.ip, req.headers['user-agent']);

            req.session.user = {
                id: user.id,
                name: user.full_name,
                email: user.email,
                role: user.role
            };

            console.log('✅ [LOGIN] Login successful, redirecting to dashboard');
            req.flash('success_msg', 'ورود موفق');
            return res.redirect('/dashboard');
        } catch (err) {
            console.error('🔴 [LOGIN] Error:', err);
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
                if (req.body.name) payload.fullName = req.body.name.trim();
                if (req.file) payload.profile_photo = '/uploads/avatars/' + req.file.filename;
                if (req.body.phone) payload.phone = req.body.phone.trim();

                await User.updateProfile(userId, payload);
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