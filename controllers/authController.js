// controllers/authController.js
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const crypto = require('crypto');
const fs = require('fs');
const { Configuration, OpenAIApi } = require("openai");

// =============================
// Ensure upload folder exists
// =============================
const avatarDir = path.join(__dirname, '..', 'uploads', 'avatars');
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

// =============================
// Mail transporter helper
// =============================
async function getTransporter() {
    try {
        if ((process.env.NODE_ENV || 'development') === 'development') {
            const testAccount = await nodemailer.createTestAccount();
            const transporter = nodemailer.createTransport({
                host: testAccount.smtp.host,
                port: testAccount.smtp.port,
                secure: testAccount.smtp.secure,
                auth: { user: testAccount.user, pass: testAccount.pass }
            });
            transporter.__isTest = true;
            transporter.__testAccount = testAccount;
            return transporter;
        }

        if (!process.env.EMAIL_HOST && !process.env.EMAIL_USER) {
            console.warn('EMAIL_HOST / EMAIL_USER not set. Mailer may not work in production.');
        }

        const transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST || undefined,
            port: process.env.EMAIL_PORT ? Number(process.env.EMAIL_PORT) : undefined,
            secure: process.env.EMAIL_SECURE === 'true' || false,
            service: process.env.EMAIL_SERVICE || undefined,
            auth: process.env.EMAIL_USER ? { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } : undefined
        });

        transporter.verify((err, success) => {
            if (err) console.warn('Mailer verify warning:', err);
            else console.log('Mailer is ready');
        });

        transporter.__isTest = false;
        return transporter;
    } catch (err) {
        console.error('Error creating transporter:', err);
        throw err;
    }
}

// =============================
// Multer Upload Config
// =============================
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, avatarDir),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!['.png', '.jpg', '.jpeg'].includes(ext)) {
            return cb(new Error('فقط فرمت تصویر مجاز است'));
        }
        cb(null, true);
    }
});

// =============================
// Login Attempts + Active Sessions
// =============================
const loginAttempts = {};
const MAX_ATTEMPTS = 5;
const LOCK_TIME = 10 * 60 * 1000;
const activeSessions = {};
const MAX_ACTIVE_SESSIONS = 3;

// =============================
// Auth Controller
// =============================
const authController = {

    // ---------- Register ----------
    registerPage: (req, res) => res.render('register', { error: null, oldInput: {} }),
    register: async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.render('register', { error: errors.array()[0].msg, oldInput: req.body });
        }

        const { name, email, password } = req.body;
        try {
            const existingUser = await User.findByEmail(email);
            if (existingUser) return res.render('register', { error: 'ایمیل قبلا ثبت شده است', oldInput: req.body });

            const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
            if (!passwordRegex.test(password)) {
                return res.render('register', {
                    error: 'رمز عبور باید شامل حروف بزرگ، کوچک، عدد و کاراکتر خاص باشد',
                    oldInput: req.body
                });
            }

            const hashedPassword = await bcrypt.hash(password, 12);
            const verificationToken = crypto.randomBytes(32).toString('hex');

            await User.create({
                name,
                email,
                password: hashedPassword,
                role: 'user',
                verification_token: verificationToken,
                is_verified: false,
                is_active: true,
                notificationsEnabled: true
            });

            const link = `${req.protocol}://${req.get('host')}/verify/${verificationToken}`;
            const transporter = await getTransporter();
            const fromAddress = process.env.EMAIL_FROM || process.env.EMAIL_USER || `"NoReply" <no-reply@example.com>`;

            const mailOptions = {
                from: fromAddress,
                to: email,
                subject: 'تایید حساب کاربری',
                html: `<p>سلام ${name}، برای تایید حساب روی <a href="${link}">این لینک</a> کلیک کنید.</p>`
            };

            const info = await transporter.sendMail(mailOptions);

            if (transporter.__isTest) {
                console.log('Test email sent. Preview URL:', nodemailer.getTestMessageUrl(info));
            } else {
                console.log('Verification email sent to', email);
            }

            req.flash('success_msg', 'ثبت نام موفق، ایمیل تایید ارسال شد');
            res.redirect('/dashboard');
        } catch (err) {
            console.error('Error in register:', err);
            res.render('register', { error: 'خطا در ثبت نام', oldInput: req.body });
        }
    },

    // ---------- Email & Phone Verification ----------
    verifyEmail: async (req, res) => {
        try {
            const user = await User.verifyEmail(req.params.token);
            if (!user) {
                req.flash('error_msg', 'لینک تایید نامعتبر یا منقضی شده است');
                return res.redirect('/login');
            }

            try {
                const transporter = await getTransporter();
                const fromAddress = process.env.EMAIL_FROM || process.env.EMAIL_USER || `"NoReply" <no-reply@example.com>`;
                const info = await transporter.sendMail({
                    from: fromAddress,
                    to: user.email,
                    subject: 'خوش آمدید',
                    html: `<p>سلام ${user.name} عزیز، حساب شما تایید شد و خوش آمدید!</p>`
                });
                if (transporter.__isTest) {
                    console.log('Welcome email preview URL:', nodemailer.getTestMessageUrl(info));
                }
            } catch (mailErr) {
                console.warn('Warning: welcome email failed:', mailErr);
            }

            req.flash('success_msg', 'حساب شما تایید شد، وارد شوید');
            res.redirect('/profile');
        } catch (err) {
            console.error('Error in verifyEmail:', err);
            req.flash('error_msg', 'خطا در تایید حساب');
            res.redirect('/login');
        }
    },

    verifyPhone: async (req, res) => {
        const { code } = req.params;
        try {
            const user = await User.findBySmsToken(code);
            if (!user) {
                req.flash('error_msg', 'کد تایید نامعتبر است');
                return res.redirect('/login');
            }

            await User.updatePhoneVerified(user.id);
            req.flash('success_msg', 'شماره تلفن شما تایید شد');
            res.redirect('/dashboard');
        } catch (err) {
            console.error('Error in verifyPhone:', err);
            req.flash('error_msg', 'خطا در تایید شماره تلفن');
            res.redirect('/login');
        }
    },

    // ---------- Login ----------
    loginPage: (req, res) => res.render('login', { error: null, oldInput: {} }),
    login: async (req, res) => {
        const { identifier, password, rememberMe } = req.body;
        try {
            let user = null;
            if (identifier.includes('@')) user = await User.findByEmail(identifier);
            else if (/^\d{10,15}$/.test(identifier)) user = await User.findByPhone(identifier);
            else user = await User.findByNationalId(identifier);

            if (!user) return res.render('login', { error: 'اطلاعات ورود اشتباه است', oldInput: req.body });
            if (!user.is_active) return res.render('login', { error: 'حساب شما غیرفعال شده است.', oldInput: req.body });

            if (!loginAttempts[identifier]) loginAttempts[identifier] = { count: 0, lastAttempt: Date.now() };
            if (loginAttempts[identifier].count >= MAX_ATTEMPTS &&
                Date.now() - loginAttempts[identifier].lastAttempt < LOCK_TIME) {
                return res.render('login', { error: 'تعداد تلاش زیاد، بعدا امتحان کنید', oldInput: req.body });
            }

            const match = await bcrypt.compare(password, user.password);
            if (!match) {
                loginAttempts[identifier].count++;
                loginAttempts[identifier].lastAttempt = Date.now();
                return res.render('login', { error: 'اطلاعات ورود اشتباه است', oldInput: req.body });
            }

            loginAttempts[identifier] = { count: 0, lastAttempt: Date.now() };

            if (!user.is_verified) return res.render('login', { error: 'حساب شما تایید نشده است.', oldInput: req.body });

            if (!activeSessions[user.id]) activeSessions[user.id] = [];
            if (activeSessions[user.id].length >= MAX_ACTIVE_SESSIONS) activeSessions[user.id].shift();
            activeSessions[user.id].push(req.session.id);

            req.session.user = { id: user.id, name: user.name, role: user.role };
            if (rememberMe) req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000;

            await User.updateLastLogin(user.id, req.ip, req.headers['user-agent']);
            req.flash('success_msg', 'ورود موفق');
            res.redirect('/dashboard');
        } catch (err) {
            console.error('Error in login:', err);
            res.render('login', { error: 'خطا در ورود', oldInput: req.body });
        }
    },

    // ---------- Logout ----------
    logout: (req, res) => {
        if (req.session.user && activeSessions[req.session.user.id]) {
            activeSessions[req.session.user.id] =
                activeSessions[req.session.user.id].filter(s => s !== req.session.id);
        }
        req.session.destroy(() => {
            req.flash('success_msg', 'شما خارج شدید');
            res.redirect('/login');
        });
    },

    logoutOtherSessions: (req, res) => {
        const userId = req.session.user?.id;
        if (userId && activeSessions[userId]) activeSessions[userId] = [req.session.id];
        req.flash('success_msg', 'سایر نشست‌ها خارج شدند');
        res.redirect('/sessions');
    },

    // ---------- Password Recovery ----------
    forgotPasswordPage: (req, res) => res.render('forgotPassword', { error: null }),
    forgotPassword: async (req, res) => {
        const { email } = req.body;
        try {
            const user = await User.findByEmail(email);
            if (!user) return res.render('forgotPassword', { error: 'کاربری با این ایمیل یافت نشد' });

            const resetToken = crypto.randomBytes(32).toString('hex');
            await User.setResetToken(email, resetToken);

            const link = `${req.protocol}://${req.get('host')}/reset/${resetToken}`;
            try {
                const transporter = await getTransporter();
                const fromAddress = process.env.EMAIL_FROM || process.env.EMAIL_USER || `"NoReply" <no-reply@example.com>`;
                const info = await transporter.sendMail({
                    from: fromAddress,
                    to: email,
                    subject: 'بازیابی رمز عبور',
                    html: `<p>برای بازیابی رمز روی <a href="${link}">این لینک</a> کلیک کنید</p>`
                });
                if (transporter.__isTest) {
                    console.log('Reset email preview URL:', nodemailer.getTestMessageUrl(info));
                }
            } catch (mailErr) {
                console.warn('Warning: reset email failed:', mailErr);
            }

            req.flash('success_msg', 'ایمیل بازیابی ارسال شد');
            res.redirect('/login');
        } catch (err) {
            console.error('Error in forgotPassword:', err);
            res.render('forgotPassword', { error: 'خطا در ارسال ایمیل' });
        }
    },

    resetPasswordPage: async (req, res) => {
        try {
            const user = await User.findByResetToken(req.params.token);
            if (!user) {
                req.flash('error_msg', 'لینک ریست نامعتبر یا منقضی شده');
                return res.redirect('/forgot-password');
            }
            res.render('resetPassword', { error: null, token: req.params.token });
        } catch (err) {
            console.error('Error in resetPasswordPage:', err);
            req.flash('error_msg', 'خطا در بارگذاری صفحه');
            res.redirect('/forgot-password');
        }
    },

    resetPassword: async (req, res) => {
        const { token } = req.params;
        const { password } = req.body;
        try {
            const user = await User.findByResetToken(token);
            if (!user) {
                req.flash('error_msg', 'لینک ریست نامعتبر یا منقضی شده');
                return res.redirect('/forgot-password');
            }

            const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
            if (!passwordRegex.test(password)) {
                req.flash('error_msg', 'رمز عبور باید قوی باشد');
                return res.redirect(`/reset/${token}`);
            }

            const hashed = await bcrypt.hash(password, 12);
            await User.updatePassword(user.id, hashed);
            await User.clearResetToken(user.id);

            req.flash('success_msg', 'رمز عبور تغییر کرد');
            res.redirect('/login');
        } catch (err) {
            console.error('Error in resetPassword:', err);
            req.flash('error_msg', 'خطا در تغییر رمز');
            res.redirect(`/reset/${token}`);
        }
    },

    // ---------- Profile ----------
    profile: async (req, res) => {
        const userId = req.session.user?.id;
        if (!userId) {
            req.flash('error_msg', 'ابتدا وارد حساب شوید');
            return res.redirect('/login');
        }
        try {
            const user = await User.findById(userId);
            if (!user) {
                req.flash('error_msg', 'کاربر پیدا نشد');
                return res.redirect('/login');
            }
            res.render('profile', { user, error: null, success: null });
        } catch (err) {
            console.error('Error in profile:', err);
            req.flash('error_msg', 'خطا در بارگذاری پروفایل');
            res.redirect('/login');
        }
    },

    updateProfile: async (req, res) => {
        const userId = req.session.user?.id;
        if (!userId) {
            req.flash('error_msg', 'ابتدا وارد حساب شوید');
            return res.redirect('/login');
        }
        try {
            const user = await User.findById(userId);
            if (!user) {
                req.flash('error_msg', 'کاربر پیدا نشد');
                return res.redirect('/login');
            }

            const { name } = req.body;
            let avatarPath = user.avatar;

            if (req.file) {
                if (avatarPath) {
                    const oldPath = path.join(avatarDir, path.basename(avatarPath));
                    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
                }
                avatarPath = '/uploads/avatars/' + req.file.filename;
            }

            await User.updateProfile(userId, { name, avatar: avatarPath });
            req.flash('success_msg', 'پروفایل به‌روزرسانی شد');
            res.redirect('/profile');
        } catch (err) {
            console.error('Error in updateProfile:', err);
            req.flash('error_msg', 'خطا در به‌روزرسانی پروفایل');
            res.redirect('/profile');
        }
    },

    changePassword: async (req, res) => {
        const userId = req.session.user?.id;
        if (!userId) {
            req.flash('error_msg', 'ابتدا وارد حساب شوید');
            return res.redirect('/login');
        }
        const { currentPassword, newPassword, confirmPassword } = req.body;
        try {
            const user = await User.findById(userId);
            if (!user) return res.redirect('/login');

            const match = await bcrypt.compare(currentPassword, user.password);
            if (!match) {
                req.flash('error_msg', 'رمز فعلی اشتباه است');
                return res.redirect('/profile');
            }

            if (newPassword !== confirmPassword) {
                req.flash('error_msg', 'رمزهای جدید یکسان نیستند');
                return res.redirect('/profile');
            }

            const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
            if (!passwordRegex.test(newPassword)) {
                req.flash('error_msg', 'رمز عبور باید حداقل 8 کاراکتر شامل حروف بزرگ، کوچک، عدد و کاراکتر خاص باشد');
                return res.redirect('/profile');
            }

            const hashed = await bcrypt.hash(newPassword, 12);
            await User.updatePassword(userId, hashed);

            req.flash('success_msg', 'رمز عبور با موفقیت تغییر کرد');
            res.redirect('/profile');
        } catch (err) {
            console.error('Error in changePassword:', err);
            req.flash('error_msg', 'خطا در تغییر رمز');
            res.redirect('/profile');
        }
    },

    uploadProfilePhoto: async (req, res) => {
        const userId = req.session.user?.id;
        if (!userId) {
            req.flash('error_msg', 'ابتدا وارد حساب شوید');
            return res.redirect('/login');
        }
        try {
            const user = await User.findById(userId);
            if (!user) return res.redirect('/login');

            if (!req.file) {
                req.flash('error_msg', 'عکس پروفایل ارسال نشده');
                return res.redirect('/profile');
            }

            if (user.avatar) {
                const oldPath = path.join(avatarDir, path.basename(user.avatar));
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }

            const avatarPath = '/uploads/avatars/' + req.file.filename;
            await User.updateProfile(userId, { avatar: avatarPath });

            req.flash('success_msg', 'عکس پروفایل با موفقیت آپلود شد');
            res.redirect('/profile');
        } catch (err) {
            console.error('Error in uploadProfilePhoto:', err);
            req.flash('error_msg', 'خطا در آپلود عکس پروفایل');
            res.redirect('/profile');
        }
    },

    deleteAccount: async (req, res) => {
        const userId = req.session.user?.id;
        if (!userId) {
            req.flash('error_msg', 'ابتدا وارد حساب شوید');
            return res.redirect('/login');
        }
        try {
            const user = await User.findById(userId);
            if (!user) return res.redirect('/login');

            if (user.avatar) {
                const avatarPath = path.join(avatarDir, path.basename(user.avatar));
                if (fs.existsSync(avatarPath)) fs.unlinkSync(avatarPath);
            }

            await User.delete(userId);
            activeSessions[userId] = [];

            req.session.destroy(() => {
                req.flash('success_msg', 'حساب شما حذف شد');
                res.redirect('/register');
            });
        } catch (err) {
            console.error('Error in deleteAccount:', err);
            req.flash('error_msg', 'خطا در حذف حساب');
            res.redirect('/profile');
        }
    },

    // ---------- 2FA ----------
    enable2FA: async (req, res) => {
        const userId = req.session.user?.id;
        if (!userId) return res.redirect('/login');
        try {
            const secret = speakeasy.generateSecret({ length: 20 });
            const user = await User.findById(userId);
            if (!user) return res.redirect('/login');

            await User.updateProfile(userId, { twoFactorSecret: secret.base32, twoFactorEnabled: false });

            const otpAuthUrl = speakeasy.otpauthURL({ secret: secret.ascii, label: `${user.email}`, issuer: 'MyApp' });
            const qrCodeDataUrl = await qrcode.toDataURL(otpAuthUrl);
            res.render('enable2fa', { qrCodeDataUrl, secret: secret.base32 });
        } catch (err) {
            console.error('Error in enable2FA:', err);
            req.flash('error_msg', 'خطا در فعالسازی 2FA');
            res.redirect('/profile');
        }
    },

    verify2FA: async (req, res) => {
        const userId = req.session.user?.id;
        const { token } = req.body;
        if (!userId || !token) {
            req.flash('error_msg', 'ابتدا وارد حساب شوید یا کد را وارد کنید');
            return res.redirect('/2fa/setup');
        }
        try {
            const user = await User.findById(userId);
            if (!user || !user.twoFactorSecret) {
                req.flash('error_msg', '2FA فعال نیست');
                return res.redirect('/profile');
            }

            const verified = speakeasy.totp.verify({ secret: user.twoFactorSecret, encoding: 'base32', token });
            if (verified) {
                await User.updateProfile(userId, { twoFactorEnabled: true });
                req.flash('success_msg', 'احراز هویت دو مرحله‌ای فعال شد');
                res.redirect('/profile');
            } else {
                req.flash('error_msg', 'کد نامعتبر است');
                res.redirect('/2fa/setup');
            }
        } catch (err) {
            console.error('Error in verify2FA:', err);
            req.flash('error_msg', 'خطا در تایید کد 2FA');
            res.redirect('/2fa/setup');
        }
    },

    // ---------- Strong Password Generator ----------
    generateStrongPassword: async (req, res) => {
        try {
            if (process.env.OPENAI_API_KEY) {
                const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
                const openai = new OpenAIApi(configuration);

                const completion = await openai.createChatCompletion({
                    model: "gpt-3.5-turbo",
                    messages: [{ role: "user", content: "Generate a strong, secure password of 12 characters including uppercase, lowercase, numbers, and special characters." }],
                    max_tokens: 30,
                });

                const password = completion.data.choices[0].message.content.trim();
                return res.json({ password });
            }

            const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+~`|}{[]:;?,./-=";
            let pwd = "";
            for (let i = 0; i < 12; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
            return res.json({ password: pwd });
        } catch (err) {
            console.error('Error in generateStrongPassword:', err);
            res.status(500).json({ error: 'خطا در تولید رمز عبور' });
        }
    }
};

// =============================
// Export
// =============================
module.exports = authController;
module.exports.upload = upload;
