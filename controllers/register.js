const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { validationResult } = require('express-validator');
const User = require('../models/User');
const { getTransporter } = require('../utils/mailer'); // فرض کنید تابع mailer جداگانه باشد

const register = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.render('register', { error_msg: errors.array()[0].msg, oldInput: req.body });
        }

        let { name, email, password, confirmPassword, terms } = req.body;
        name = name?.trim();
        email = email?.trim();
        password = password?.trim();
        confirmPassword = confirmPassword?.trim();

        if (!name || !email || !password) {
            return res.render('register', { error_msg: 'همه فیلدها الزامی هستند', oldInput: req.body });
        }

        if (password !== confirmPassword) {
            return res.render('register', { error_msg: 'رمز عبور و تکرار آن مطابقت ندارند', oldInput: req.body });
        }

        if (!terms) {
            return res.render('register', { error_msg: 'قبول قوانین الزامی است', oldInput: req.body });
        }

        // بررسی پیچیدگی رمز عبور
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
        if (!passwordRegex.test(password)) {
            return res.render('register', { error_msg: 'رمز عبور باید حداقل 8 کاراکتر شامل حروف بزرگ، کوچک، عدد و کاراکتر خاص باشد', oldInput: req.body });
        }

        // بررسی ایمیل تکراری
        const existingUser = await User.findByEmail(email);
        if (existingUser) {
            return res.render('register', { error_msg: 'این ایمیل قبلا ثبت شده است', oldInput: req.body });
        }

        // هش کردن رمز
        const hashedPassword = await bcrypt.hash(password, 12);
        const verificationToken = crypto.randomBytes(32).toString('hex');

        // ایجاد کاربر
        const newUser = await User.create({
            name,
            email,
            password: hashedPassword,
            verification_token: verificationToken,
            is_verified: false,
            is_active: true
        });

        // ست کردن سشن
        req.session.user = { id: newUser.id, name: newUser.name };

        // ارسال ایمیل تایید
        try {
            const transporter = await getTransporter();
            const link = `${req.protocol}://${req.get('host')}/verify/${verificationToken}`;
            await transporter.sendMail({
                from: `"NoReply" <no-reply@example.com>`,
                to: email,
                subject: 'تایید حساب کاربری',
                html: `<p>سلام ${name}، برای تایید حساب روی <a href="${link}">این لینک</a> کلیک کنید.</p>`
            });
        } catch (err) {
            console.warn('خطا در ارسال ایمیل (غیر بحرانی):', err);
        }

        req.flash('success_msg', 'ثبت نام موفق، ایمیل تایید ارسال شد');
        res.redirect('/dashboard');

    } catch (err) {
        console.error('خطا در ثبت نام:', err);
        res.render('register', { error_msg: 'خطا در ثبت نام، لطفا دوباره تلاش کنید', oldInput: req.body });
    }
};

module.exports = { register };
