const User = require('../models/User');
const ServiceRequest = require('../models/ServiceRequest');
const Feedback = require('../models/Feedback');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const ALLOWED_AVATAR_EXTENSIONS = ['.png', '.jpg', '.jpeg'];
const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2MB

const profileController = {
    // ================================
    // 📌 مشاهده پروفایل (برای خود یا ادمین)
    getProfile: async (req, res) => {
        try {
            const userId = req.params.id || req.session.user.id;
            const currentUser = req.session.user;

            if (currentUser.role !== 'admin' && userId !== currentUser.id) {
                req.flash('error_msg', 'Unauthorized access');
                return res.redirect('/dashboard');
            }

            const user = await User.findById(userId);
            if (!user) {
                req.flash('error_msg', 'User not found');
                return res.redirect('/dashboard');
            }

            const requests = await ServiceRequest.findByUser(userId, 10, 0);
            const feedbacks = await Feedback.findByUser(userId, 10, 0);

            // 📊 آمار
            const totalRequests = await ServiceRequest.countByUser(userId);
            const approvedRequests = await ServiceRequest.countByStatus(userId, 'approved');
            const pendingRequests = await ServiceRequest.countByStatus(userId, 'pending');
            const rejectedRequests = await ServiceRequest.countByStatus(userId, 'rejected');
            const totalFeedbacks = await Feedback.countByUser(userId);

            res.render('profile', {
                user,
                requests,
                feedbacks,
                stats: { totalRequests, approvedRequests, pendingRequests, rejectedRequests, totalFeedbacks },
                currentUser
            });
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error loading profile');
            res.redirect('/dashboard');
        }
    },

    // ================================
    // 📌 بروزرسانی پروفایل
    updateProfile: async (req, res) => {
        try {
            const userId = req.session.user.id;
            const { name, email, phone, address } = req.body;

            if (!name || !email) {
                req.flash('error_msg', 'Name and email are required');
                return res.redirect('/profile');
            }

            // اگر بخوای می‌تونی اینجا چک کنی که ایمیل یا نام تکراری نباشه

            const updatedUser = await User.updateProfile(userId, { name, email, phone, address });
            req.session.user = { ...req.session.user, ...updatedUser };

            req.flash('success_msg', 'Profile updated successfully');
            res.redirect('/profile');
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error updating profile');
            res.redirect('/profile');
        }
    },

    // ================================
    // 📌 تغییر رمز عبور
    changePassword: async (req, res) => {
        try {
            const userId = req.session.user.id;
            const { currentPassword, newPassword, confirmPassword } = req.body;

            if (!currentPassword || !newPassword || !confirmPassword) {
                req.flash('error_msg', 'All password fields are required');
                return res.redirect('/profile');
            }

            if (newPassword !== confirmPassword) {
                req.flash('error_msg', 'New passwords do not match');
                return res.redirect('/profile');
            }

            const user = await User.findById(userId);
            if (!user) {
                req.flash('error_msg', 'User not found');
                return res.redirect('/profile');
            }

            const isMatch = await bcrypt.compare(currentPassword, user.password);
            if (!isMatch) {
                req.flash('error_msg', 'Current password is incorrect');
                return res.redirect('/profile');
            }

            const hashedPassword = await bcrypt.hash(newPassword, 12);
            await User.updateProfile(userId, { password: hashedPassword });

            req.flash('success_msg', 'Password changed successfully');
            res.redirect('/profile');
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error changing password');
            res.redirect('/profile');
        }
    },

    // ================================
    // 📌 تغییر آواتار
    updateAvatar: async (req, res) => {
        try {
            const file = req.file;
            if (!file) {
                req.flash('error_msg', 'No file uploaded');
                return res.redirect('/profile');
            }

            if (file.size > MAX_AVATAR_SIZE) {
                fs.unlinkSync(file.path);
                req.flash('error_msg', 'Avatar is too large (max 2MB)');
                return res.redirect('/profile');
            }

            const ext = path.extname(file.originalname).toLowerCase();
            if (!ALLOWED_AVATAR_EXTENSIONS.includes(ext)) {
                fs.unlinkSync(file.path);
                req.flash('error_msg', 'Invalid avatar file type');
                return res.redirect('/profile');
            }

            const userId = req.session.user.id;
            const user = await User.findById(userId);

            if (user.avatar_url) {
                try {
                    if (fs.existsSync(user.avatar_url)) {
                        fs.unlinkSync(user.avatar_url);
                    }
                } catch (err) {
                    console.error('Failed to delete old avatar:', err);
                }
            }

            const updatedUser = await User.setAvatar(userId, file.path);
            req.session.user.avatar_url = updatedUser.avatar_url;

            req.flash('success_msg', 'Avatar updated successfully');
            res.redirect('/profile');
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error updating avatar');
            res.redirect('/profile');
        }
    },

    // ================================
    // 📌 تاریخچه درخواست‌ها (Service Requests)
    getRequestsHistory: async (req, res) => {
        try {
            const userId = req.session.user.id;
            const page = parseInt(req.query.page) || 1;
            const limit = 10;
            const offset = (page - 1) * limit;

            const requests = await ServiceRequest.findByUser(userId, limit, offset);
            const totalRequests = await ServiceRequest.countByUser(userId);
            const totalPages = Math.ceil(totalRequests / limit);

            res.render('profileRequests', { requests, page, totalPages });
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error loading request history');
            res.redirect('/profile');
        }
    },

    // ================================
    // 📌 تاریخچه بازخوردها
    getFeedbacksHistory: async (req, res) => {
        try {
            const userId = req.session.user.id;
            const page = parseInt(req.query.page) || 1;
            const limit = 10;
            const offset = (page - 1) * limit;

            const feedbacks = await Feedback.findByUser(userId, limit, offset);
            const totalFeedbacks = await Feedback.countByUser(userId);
            const totalPages = Math.ceil(totalFeedbacks / limit);

            res.render('profileFeedbacks', { feedbacks, page, totalPages });
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error loading feedbacks');
            res.redirect('/profile');
        }
    },

    // ================================
    // 📌 API JSON برای SPA
    apiGetProfile: async (req, res) => {
        try {
            const userId = req.params.id || req.session.user.id;
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }

            const requests = await ServiceRequest.findByUser(userId, 10, 0);
            const feedbacks = await Feedback.findByUser(userId, 10, 0);

            const totalRequests = await ServiceRequest.countByUser(userId);
            const approvedRequests = await ServiceRequest.countByStatus(userId, 'approved');
            const pendingRequests = await ServiceRequest.countByStatus(userId, 'pending');
            const rejectedRequests = await ServiceRequest.countByStatus(userId, 'rejected');
            const totalFeedbacks = await Feedback.countByUser(userId);

            res.json({
                success: true,
                user,
                requests,
                feedbacks,
                stats: { totalRequests, approvedRequests, pendingRequests, rejectedRequests, totalFeedbacks }
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, error: 'Could not fetch profile' });
        }
    }
};

module.exports = profileController;
