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

// Ensure upload directories exist
const avatarDir = path.join(__dirname, '..', 'uploads', 'avatars');
if (!fs.existsSync(avatarDir)) {
    fs.mkdirSync(avatarDir, { recursive: true });
}

// Mail transporter
async function getTransporter() {
    if ((process.env.NODE_ENV || 'development') === 'development') {
        const testAccount = await nodemailer.createTestAccount();
        const transporter = nodemailer.createTransport({
            host: testAccount.smtp.host,
            port: testAccount.smtp.port,
            secure: testAccount.smtp.secure,
            auth: {
                user: testAccount.user,
                pass: testAccount.pass
            }
        });
        transporter.__isTest = true;
        transporter.__testAccount = testAccount;
        return transporter;
    }

    const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT || 587,
        secure: process.env.EMAIL_SECURE === 'true',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    transporter.__isTest = false;
    return transporter;
}

// Multer configuration for avatar uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, avatarDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 2 * 1024 * 1024 // 2MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

// Security configurations
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME = 15 * 60 * 1000; // 15 minutes
const activeSessions = new Map();
const MAX_SESSIONS_PER_USER = 3;

const authController = {

    // ========== REGISTRATION ==========
    registerPage: (req, res) => {
        res.render('register', {
            error_msg: req.flash('error_msg'),
            success_msg: req.flash('success_msg'),
            oldInput: {}
        });
    },
    /// In your authController.js - update the register method
    register: async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.render('register', {
                error_msg: errors.array()[0].msg,
                oldInput: req.body
            });
        }

        const { name, email, password, role, national_id, phone, terms } = req.body;

        try {
            // Check if user already exists
            const existingUser = await User.findByEmail(email);
            if (existingUser) {
                return res.render('register', {
                    error_msg: 'Email is already registered',
                    oldInput: req.body
                });
            }

            // Check if national ID exists
            const existingNationalId = await User.findByNationalId(national_id);
            if (existingNationalId) {
                return res.render('register', {
                    error_msg: 'National ID is already registered',
                    oldInput: req.body
                });
            }

            // Validate password strength
            const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
            if (!passwordRegex.test(password)) {
                return res.render('register', {
                    error_msg: 'Password must be at least 8 characters with uppercase, lowercase, number and special character',
                    oldInput: req.body
                });
            }

            // Create user in PostgreSQL (auto-verified)
            const newUser = await User.create({
                name,
                email,
                password,
                role: role || 'citizen',
                national_id,
                phone,
                verification_token: null, // No verification token needed
                is_verified: true, // Auto-verify user
                is_active: true
            });

            if (!newUser) {
                throw new Error('Failed to create user');
            }

            // Auto-login the user after registration
            req.session.user = {
                id: newUser.id,
                name: newUser.name,
                email: newUser.email,
                role: newUser.role,
                is_verified: true
            };

            // Update last login
            await User.updateLastLogin(newUser.id, req.ip, req.get('User-Agent'));

            req.flash('success_msg', `Welcome to Government Citizen Portal, ${name}!`);

            // Redirect based on role
            if (newUser.role === 'admin') {
                res.redirect('/admin/dashboard');
            } else if (newUser.role === 'employee') {
                res.redirect('/officer/dashboard'); // مسیر مخصوص employee
            } else {
                res.redirect('/profile');
            }

        } catch (error) {
            console.error('Registration error details:', error);

            // Handle specific PostgreSQL errors
            if (error.code === '23505') { // Unique violation
                const field = error.constraint.includes('email') ? 'Email' :
                    error.constraint.includes('national_id') ? 'National ID' : 'Field';
                return res.render('register', {
                    error_msg: `${field} already exists`,
                    oldInput: req.body
                });
            }

            res.render('register', {
                error_msg: 'Registration failed. Please try again.',
                oldInput: req.body
            });
        }
    },


    // ========== EMAIL VERIFICATION ==========
    verifyEmail: async (req, res) => {
        try {
            const user = await User.verifyEmail(req.params.token);

            if (user) {
                // Send welcome email
                try {
                    const transporter = await getTransporter();
                    await transporter.sendMail({
                        from: process.env.EMAIL_FROM || '"Government Portal" <noreply@portal.gov>',
                        to: user.email,
                        subject: 'Welcome to Government Citizen Portal!',
                        html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #1e293b;">Email Verified Successfully!</h2>
                <p>Hello <strong>${user.name}</strong>,</p>
                <p>Your email has been verified successfully. You can now access all features of the Government Citizen Portal.</p>
                <p>Thank you for joining us!</p>
              </div>
            `
                    });
                } catch (emailError) {
                    console.warn('Welcome email failed:', emailError);
                }

                req.flash('success_msg', 'Email verified successfully! You can now log in.');
                res.redirect('/login');
            } else {
                req.flash('error_msg', 'Invalid or expired verification link.');
                res.redirect('/register');
            }
        } catch (error) {
            console.error('Verification error:', error);
            req.flash('error_msg', 'Verification failed. Please try again.');
            res.redirect('/register');
        }
    },

    // ========== LOGIN ==========
    loginPage: (req, res) => {
        res.render('login', {
            error_msg: req.flash('error_msg'),
            success_msg: req.flash('success_msg'),
            oldInput: {}
        });
    },

    // In your authController.js - update the login method
    login: async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.render('login', {
                error_msg: errors.array()[0].msg,
                oldInput: req.body
            });
        }

        const { identifier, password, remember_me } = req.body;

        try {
            // Check login attempts
            const attemptKey = identifier.toLowerCase();
            const now = Date.now();
            const userAttempts = loginAttempts.get(attemptKey) || { count: 0, lastAttempt: 0 };

            if (userAttempts.count >= MAX_LOGIN_ATTEMPTS && (now - userAttempts.lastAttempt) < LOCK_TIME) {
                return res.render('login', {
                    error_msg: 'Too many login attempts. Please try again in 15 minutes.',
                    oldInput: req.body
                });
            }

            // Find user by email, phone, or national ID
            let user = null;
            if (identifier.includes('@')) {
                user = await User.findByEmail(identifier);
            } else if (/^\d{10,15}$/.test(identifier)) {
                user = await User.findByPhone(identifier);
            } else {
                user = await User.findByNationalId(identifier);
            }

            if (!user) {
                userAttempts.count++;
                userAttempts.lastAttempt = now;
                loginAttempts.set(attemptKey, userAttempts);

                return res.render('login', {
                    error_msg: 'Invalid credentials',
                    oldInput: req.body
                });
            }

            // Check if user is active
            if (!user.is_active) {
                return res.render('login', {
                    error_msg: 'Your account has been deactivated. Please contact support.',
                    oldInput: req.body
                });
            }

            // REMOVED: Email verification check - users can login immediately
            // if (!user.is_verified) {
            //   return res.render('login', {
            //     error_msg: 'Please verify your email before logging in.',
            //     oldInput: req.body
            //   });
            // }

            // Verify password
            const isPasswordValid = await bcrypt.compare(password, user.password);
            if (!isPasswordValid) {
                userAttempts.count++;
                userAttempts.lastAttempt = now;
                loginAttempts.set(attemptKey, userAttempts);

                return res.render('login', {
                    error_msg: 'Invalid credentials',
                    oldInput: req.body
                });
            }

            // Reset login attempts on successful login
            loginAttempts.delete(attemptKey);

            // Manage active sessions
            if (!activeSessions.has(user.id)) {
                activeSessions.set(user.id, new Set());
            }

            const userSessions = activeSessions.get(user.id);
            if (userSessions.size >= MAX_SESSIONS_PER_USER) {
                // Remove oldest session (first in Set)
                const firstSession = userSessions.values().next().value;
                userSessions.delete(firstSession);
            }

            userSessions.add(req.sessionID);

            // Set session data
            req.session.user = {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                is_verified: user.is_verified
            };

            // Set remember me cookie
            if (remember_me) {
                req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
            }

            // Update last login
            await User.updateLastLogin(user.id, req.ip, req.get('User-Agent'));

            req.flash('success_msg', `Welcome back, ${user.name}!`);

            // Redirect based on role
            if (user.role === 'admin') {
                res.redirect('/admin/dashboard');
            } else {
                res.redirect('/dashboard');
            }

        } catch (error) {
            console.error('Login error:', error);
            res.render('login', {
                error_msg: 'Login failed. Please try again.',
                oldInput: req.body
            });
        }
    },

    // ========== LOGOUT ==========
    logout: (req, res) => {
        if (req.session.user) {
            const userId = req.session.user.id;
            const userSessions = activeSessions.get(userId);
            if (userSessions) {
                userSessions.delete(req.sessionID);
                if (userSessions.size === 0) {
                    activeSessions.delete(userId);
                }
            }
        }

        req.session.destroy((err) => {
            if (err) {
                console.error('Logout error:', err);
            }
            res.redirect('/login');
        });
    },

    logoutOtherSessions: (req, res) => {
        const userId = req.session.user.id;
        const userSessions = activeSessions.get(userId);

        if (userSessions) {
            activeSessions.set(userId, new Set([req.sessionID]));
        }

        req.flash('success_msg', 'All other sessions have been logged out.');
        res.redirect('/profile');
    },

    // ========== PASSWORD RECOVERY ==========
    forgotPasswordPage: (req, res) => {
        res.render('forgot-password', {
            error_msg: req.flash('error_msg'),
            success_msg: req.flash('success_msg')
        });
    },

    forgotPassword: async (req, res) => {
        const { email } = req.body;

        try {
            const user = await User.findByEmail(email);
            if (!user) {
                // Don't reveal whether email exists
                req.flash('success_msg', 'If the email exists, a password reset link has been sent.');
                return res.redirect('/login');
            }

            // Generate reset token
            const resetToken = crypto.randomBytes(32).toString('hex');
            await User.setResetToken(email, resetToken);

            // Send reset email
            try {
                const transporter = await getTransporter();
                const resetUrl = `${req.protocol}://${req.get('host')}/reset/${resetToken}`;

                await transporter.sendMail({
                    from: process.env.EMAIL_FROM || '"Government Portal" <noreply@portal.gov>',
                    to: email,
                    subject: 'Password Reset Request - Government Citizen Portal',
                    html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1e293b;">Password Reset Request</h2>
              <p>Hello <strong>${user.name}</strong>,</p>
              <p>You requested to reset your password. Click the button below to create a new password:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" 
                   style="background-color: #facc15; color: #1e293b; padding: 12px 24px; 
                          text-decoration: none; border-radius: 8px; font-weight: bold; 
                          display: inline-block;">
                  Reset Password
                </a>
              </div>
              <p>Or copy and paste this link in your browser:</p>
              <p style="word-break: break-all; color: #64748b;">${resetUrl}</p>
              <p>This link will expire in 1 hour.</p>
              <p style="color: #64748b; font-size: 12px;">
                If you didn't request this reset, please ignore this email.
              </p>
            </div>
          `
                });
            } catch (emailError) {
                console.error('Reset email failed:', emailError);
                req.flash('error_msg', 'Failed to send reset email. Please try again.');
                return res.redirect('/forgot-password');
            }

            req.flash('success_msg', 'Password reset instructions have been sent to your email.');
            res.redirect('/login');

        } catch (error) {
            console.error('Forgot password error:', error);
            req.flash('error_msg', 'Password reset failed. Please try again.');
            res.redirect('/forgot-password');
        }
    },

    resetPasswordPage: async (req, res) => {
        try {
            const user = await User.findByResetToken(req.params.token);
            if (!user) {
                req.flash('error_msg', 'Invalid or expired reset token.');
                return res.redirect('/forgot-password');
            }

            res.render('reset-password', {
                error_msg: req.flash('error_msg'),
                token: req.params.token
            });
        } catch (error) {
            console.error('Reset password page error:', error);
            req.flash('error_msg', 'Invalid reset token.');
            res.redirect('/forgot-password');
        }
    },

    resetPassword: async (req, res) => {
        const { token } = req.params;
        const { password, confirmPassword } = req.body;

        try {
            // Validate token
            const user = await User.findByResetToken(token);
            if (!user) {
                req.flash('error_msg', 'Invalid or expired reset token.');
                return res.redirect('/forgot-password');
            }

            // Validate passwords match
            if (password !== confirmPassword) {
                req.flash('error_msg', 'Passwords do not match.');
                return res.redirect(`/reset/${token}`);
            }

            // Validate password strength
            const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
            if (!passwordRegex.test(password)) {
                req.flash('error_msg', 'Password must be at least 8 characters with uppercase, lowercase, number and special character.');
                return res.redirect(`/reset/${token}`);
            }

            // Hash new password and update
            const hashedPassword = await bcrypt.hash(password, 12);
            await User.updatePassword(user.id, hashedPassword);

            // Send confirmation email
            try {
                const transporter = await getTransporter();
                await transporter.sendMail({
                    from: process.env.EMAIL_FROM || '"Government Portal" <noreply@portal.gov>',
                    to: user.email,
                    subject: 'Password Changed Successfully - Government Citizen Portal',
                    html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1e293b;">Password Changed Successfully</h2>
              <p>Hello <strong>${user.name}</strong>,</p>
              <p>Your password has been changed successfully.</p>
              <p>If you didn't make this change, please contact support immediately.</p>
            </div>
          `
                });
            } catch (emailError) {
                console.warn('Password change confirmation email failed:', emailError);
            }

            req.flash('success_msg', 'Password reset successfully! You can now log in with your new password.');
            res.redirect('/login');

        } catch (error) {
            console.error('Reset password error:', error);
            req.flash('error_msg', 'Password reset failed. Please try again.');
            res.redirect(`/reset/${token}`);
        }
    },

    // ========== PROFILE MANAGEMENT ==========
    profile: async (req, res) => {
        try {
            const user = await User.findById(req.session.user.id);
            if (!user) {
                req.flash('error_msg', 'User not found.');
                return res.redirect('/login');
            }

            res.render('profile', {
                user,
                error_msg: req.flash('error_msg'),
                success_msg: req.flash('success_msg')
            });
        } catch (error) {
            console.error('Profile error:', error);
            req.flash('error_msg', 'Failed to load profile.');
            res.redirect('/dashboard');
        }
    },

    updateProfile: async (req, res) => {
        try {
            const { name, phone } = req.body;
            const updateData = { name };

            if (phone) {
                updateData.phone = phone;
            }

            await User.updateProfile(req.session.user.id, updateData);

            // Update session data
            req.session.user.name = name;

            req.flash('success_msg', 'Profile updated successfully.');
            res.redirect('/profile');
        } catch (error) {
            console.error('Update profile error:', error);
            req.flash('error_msg', 'Failed to update profile.');
            res.redirect('/profile');
        }
    },

    changePassword: async (req, res) => {
        const { currentPassword, newPassword, confirmPassword } = req.body;

        try {
            const user = await User.findById(req.session.user.id);

            // Verify current password
            const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
            if (!isCurrentPasswordValid) {
                req.flash('error_msg', 'Current password is incorrect.');
                return res.redirect('/profile');
            }

            // Check if new passwords match
            if (newPassword !== confirmPassword) {
                req.flash('error_msg', 'New passwords do not match.');
                return res.redirect('/profile');
            }

            // Validate new password strength
            const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
            if (!passwordRegex.test(newPassword)) {
                req.flash('error_msg', 'New password must be at least 8 characters with uppercase, lowercase, number and special character.');
                return res.redirect('/profile');
            }

            // Hash and update new password
            const hashedPassword = await bcrypt.hash(newPassword, 12);
            await User.updatePassword(user.id, hashedPassword);

            req.flash('success_msg', 'Password changed successfully.');
            res.redirect('/profile');

        } catch (error) {
            console.error('Change password error:', error);
            req.flash('error_msg', 'Failed to change password.');
            res.redirect('/profile');
        }
    },

    uploadProfilePhoto: [
        upload.single('avatar'),
        async (req, res) => {
            try {
                if (!req.file) {
                    req.flash('error_msg', 'Please select an image to upload.');
                    return res.redirect('/profile');
                }

                const user = await User.findById(req.session.user.id);

                // Delete old avatar if exists
                if (user.avatar) {
                    const oldAvatarPath = path.join(avatarDir, path.basename(user.avatar));
                    if (fs.existsSync(oldAvatarPath)) {
                        fs.unlinkSync(oldAvatarPath);
                    }
                }

                // Update user with new avatar path
                const avatarPath = `/uploads/avatars/${req.file.filename}`;
                await User.updateProfile(req.session.user.id, { avatar: avatarPath });

                req.flash('success_msg', 'Profile photo updated successfully.');
                res.redirect('/profile');

            } catch (error) {
                console.error('Upload profile photo error:', error);
                req.flash('error_msg', 'Failed to upload profile photo.');
                res.redirect('/profile');
            }
        }
    ],

    deleteAccount: async (req, res) => {
        try {
            const user = await User.findById(req.session.user.id);

            // Delete avatar file if exists
            if (user.avatar) {
                const avatarPath = path.join(avatarDir, path.basename(user.avatar));
                if (fs.existsSync(avatarPath)) {
                    fs.unlinkSync(avatarPath);
                }
            }

            // Delete user account
            await User.delete(req.session.user.id);

            // Clear sessions
            activeSessions.delete(req.session.user.id);

            req.session.destroy((err) => {
                if (err) {
                    console.error('Session destruction error:', err);
                }
                req.flash('success_msg', 'Your account has been deleted successfully.');
                res.redirect('/register');
            });

        } catch (error) {
            console.error('Delete account error:', error);
            req.flash('error_msg', 'Failed to delete account.');
            res.redirect('/profile');
        }
    },

    // ========== 2FA ==========
    enable2FA: async (req, res) => {
        try {
            const secret = speakeasy.generateSecret({
                name: `Government Portal (${req.session.user.email})`
            });

            await User.updateProfile(req.session.user.id, {
                twoFactorSecret: secret.base32,
                twoFactorEnabled: false
            });

            const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

            res.render('enable-2fa', {
                secret: secret.base32,
                qrCodeUrl,
                error_msg: req.flash('error_msg')
            });
        } catch (error) {
            console.error('Enable 2FA error:', error);
            req.flash('error_msg', 'Failed to enable 2FA.');
            res.redirect('/profile');
        }
    },

    verify2FA: async (req, res) => {
        const { token } = req.body;

        try {
            const user = await User.findById(req.session.user.id);

            const verified = speakeasy.totp.verify({
                secret: user.two_factor_secret,
                encoding: 'base32',
                token: token,
                window: 1
            });

            if (verified) {
                await User.updateProfile(req.session.user.id, {
                    twoFactorEnabled: true
                });

                req.flash('success_msg', 'Two-factor authentication enabled successfully.');
                res.redirect('/profile');
            } else {
                req.flash('error_msg', 'Invalid verification code. Please try again.');
                res.redirect('/2fa/setup');
            }
        } catch (error) {
            console.error('Verify 2FA error:', error);
            req.flash('error_msg', 'Failed to verify 2FA code.');
            res.redirect('/2fa/setup');
        }
    },

    disable2FA: async (req, res) => {
        try {
            await User.updateProfile(req.session.user.id, {
                twoFactorSecret: null,
                twoFactorEnabled: false
            });

            req.flash('success_msg', 'Two-factor authentication disabled successfully.');
            res.redirect('/profile');
        } catch (error) {
            console.error('Disable 2FA error:', error);
            req.flash('error_msg', 'Failed to disable 2FA.');
            res.redirect('/profile');
        }
    },

    // ========== UTILITY METHODS ==========
    generateStrongPassword: async (req, res) => {
        try {
            let password;

            if (process.env.OPENAI_API_KEY) {
                const configuration = new Configuration({
                    apiKey: process.env.OPENAI_API_KEY,
                });
                const openai = new OpenAIApi(configuration);

                const completion = await openai.createChatCompletion({
                    model: "gpt-3.5-turbo",
                    messages: [{
                        role: "user",
                        content: "Generate a strong, secure password of 12 characters including uppercase, lowercase, numbers, and special characters. Return only the password without any explanation."
                    }],
                    max_tokens: 20,
                });

                password = completion.data.choices[0].message.content.trim();
            } else {
                // Fallback password generator
                const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?";
                password = "";
                for (let i = 0; i < 12; i++) {
                    password += chars.charAt(Math.floor(Math.random() * chars.length));
                }
            }

            res.json({ password });
        } catch (error) {
            console.error('Generate password error:', error);

            // Simple fallback
            const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
            let password = "";
            for (let i = 0; i < 12; i++) {
                password += chars.charAt(Math.floor(Math.random() * chars.length));
            }

            res.json({ password });
        }
    },

    // ========== SESSION MANAGEMENT ==========
    getActiveSessions: (req, res) => {
        const userId = req.session.user.id;
        const userSessions = activeSessions.get(userId) || new Set();
        const currentSessionId = req.sessionID;

        const sessions = Array.from(userSessions).map(sessionId => ({
            id: sessionId,
            isCurrent: sessionId === currentSessionId,
            // You could store more session info like IP, user agent, last activity
        }));

        res.render('sessions', { sessions });
    }
};

module.exports = authController;
