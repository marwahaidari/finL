// controllers/reviewController.js
const Review = require('../models/Review');
const Request = require('../models/Request'); // مدل درخواست‌های E-Government
const Notification = require('../models/Notification');

const reviewController = {
    // ================================
    // 📌 ثبت بررسی جدید برای یک درخواست
    addReview: async (req, res) => {
        try {
            const { rating, comment, replyTo } = req.body;
            const userId = req.session.user.id;
            const requestId = req.params.requestId;

            // اعتبارسنجی rating (اگر reply نیست)
            if (!replyTo) {
                if (
                    !rating ||
                    isNaN(rating) ||
                    rating < 1 || rating > 5
                ) {
                    req.flash('error_msg', 'Rating must be a number between 1 and 5');
                    return res.redirect(`/requests/${requestId}`);
                }
            }

            // اعتبارسنجی comment
            if (!comment || !comment.trim()) {
                req.flash('error_msg', 'Comment is required');
                return res.redirect(`/requests/${requestId}`);
            }

            // اگر replyTo هست، بررسی کن که ریویو وجود داره و تایید شده است
            if (replyTo) {
                const parentReview = await Review.findById(replyTo);
                if (!parentReview || parentReview.status !== 'approved') {
                    req.flash('error_msg', 'Cannot reply to this review');
                    return res.redirect(`/requests/${requestId}`);
                }
            }

            // بررسی وجود درخواست
            const requestExists = await Request.findById(requestId);
            if (!requestExists) {
                req.flash('error_msg', 'Request not found');
                return res.redirect('/dashboard');
            }

            // ایجاد ریویو جدید
            const review = await Review.create({
                requestId: replyTo ? null : requestId,
                userId,
                rating: replyTo ? null : rating,
                comment,
                replyTo: replyTo || null,
                status: 'pending'
            });

            // ارسال نوتیف به مدیر سیستم
            await Notification.create(null, `New review pending approval for request #${requestId}`, 'info');

            req.flash('success_msg', 'Review submitted and awaiting approval!');
            res.redirect(`/requests/${requestId}`);
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Failed to add review.');
            res.redirect(`/requests/${req.params.requestId}`);
        }
    },

    // ================================
    // 📌 مشاهده بررسی‌ها یک درخواست با pagination و وضعیت
    getRequestReviews: async (req, res) => {
        try {
            const requestId = req.params.id;
            const page = parseInt(req.query.page) || 1;
            const limit = 10;
            const offset = (page - 1) * limit;

            const reviews = await Review.findByRequest(requestId, limit, offset, req.session.user.role);
            const totalReviews = await Review.countByRequest(requestId, req.session.user.role);
            const totalPages = Math.ceil(totalReviews / limit);
            const avgRating = await Review.getAverageRating(requestId);

            res.render('reviews', {
                reviews,
                requestId,
                avgRating,
                page,
                totalPages
            });
        } catch (err) {
            console.error(err);
            res.status(500).send('Error fetching reviews');
        }
    },

    // ================================
    // 📌 تایید یا رد بررسی توسط مدیر سیستم
    approveOrReject: async (req, res) => {
        try {
            if (req.session.user.role !== 'admin') {
                req.flash('error_msg', 'Unauthorized');
                return res.redirect('back');
            }

            const { id } = req.params;
            const { action } = req.body;
            const review = await Review.findById(id);

            if (!review) {
                req.flash('error_msg', 'Review not found');
                return res.redirect('back');
            }

            if (action === 'approve') {
                await Review.updateStatus(id, 'approved');
                await Notification.create(review.user_id, `Your review for request #${review.request_id} has been approved`, 'success');
                req.flash('success_msg', 'Review approved');
            } else if (action === 'reject') {
                await Review.updateStatus(id, 'rejected');
                await Notification.create(review.user_id, `Your review for request #${review.request_id} has been rejected`, 'warning');
                req.flash('success_msg', 'Review rejected');
            } else {
                req.flash('error_msg', 'Invalid action');
            }

            res.redirect('back');
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error updating review status');
            res.redirect('back');
        }
    },

    // ================================
    // 📌 ویرایش بررسی
    updateReview: async (req, res) => {
        try {
            const reviewId = req.params.id;
            const { rating, comment } = req.body;
            const userId = req.session.user.id;

            const review = await Review.findById(reviewId);
            if (!review) {
                req.flash('error_msg', 'Review not found');
                return res.redirect('back');
            }

            if (req.session.user.role !== 'admin' && review.user_id !== userId) {
                req.flash('error_msg', 'Unauthorized');
                return res.redirect('back');
            }

            // اگر reply هست، rating نباید تغییر کنه (یا null باشه)
            if (review.replyTo && rating) {
                req.flash('error_msg', 'Cannot set rating on a reply');
                return res.redirect('back');
            }

            // اعتبارسنجی rating در صورت وجود و reply نبودن
            if (!review.replyTo) {
                if (
                    !rating ||
                    isNaN(rating) ||
                    rating < 1 || rating > 5
                ) {
                    req.flash('error_msg', 'Rating must be a number between 1 and 5');
                    return res.redirect('back');
                }
            }

            if (!comment || !comment.trim()) {
                req.flash('error_msg', 'Comment is required');
                return res.redirect('back');
            }

            await Review.update(reviewId, userId, rating, comment);
            await Notification.create(review.user_id, 'Your review was updated', 'info');

            req.flash('success_msg', 'Review updated');
            res.redirect('back');
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error updating review');
            res.redirect('back');
        }
    },

    // ================================
    // 📌 حذف بررسی
    deleteReview: async (req, res) => {
        try {
            const reviewId = req.params.id;
            const userId = req.session.user.id;

            const review = await Review.findById(reviewId);
            if (!review) {
                req.flash('error_msg', 'Review not found');
                return res.redirect('back');
            }

            if (req.session.user.role !== 'admin' && review.user_id !== userId) {
                req.flash('error_msg', 'Unauthorized');
                return res.redirect('back');
            }

            // پیشنهاد: می‌تونید اینجا soft delete بزارید (مثلاً updateStatus به deleted)
            await Review.delete(reviewId, userId);
            await Notification.create(review.user_id, 'Your review was deleted', 'warning');

            req.flash('success_msg', 'Review deleted');
            res.redirect('back');
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error deleting review');
            res.redirect('back');
        }
    },

    // ================================
    // 📌 پاسخ به بررسی
    replyToReview: async (req, res) => {
        try {
            const reviewId = req.params.id;
            const { comment } = req.body;
            const userId = req.session.user.id;

            if (!comment || !comment.trim()) {
                req.flash('error_msg', 'Reply cannot be empty');
                return res.redirect('back');
            }

            const originalReview = await Review.findById(reviewId);
            if (!originalReview || originalReview.status !== 'approved') {
                req.flash('error_msg', 'Cannot reply to this review');
                return res.redirect('back');
            }

            const reply = await Review.create({
                requestId: null,
                userId,
                rating: null,
                comment,
                replyTo: reviewId,
                status: 'approved'  // پاسخ‌ها مستقیم تایید هستن
            });

            await Notification.create(originalReview.user_id, `Someone replied to your review`, 'info');

            req.flash('success_msg', 'Reply added successfully');
            res.redirect('back');
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Failed to add reply');
            res.redirect('back');
        }
    },

    // ================================
    // 📌 لیست بررسی‌های کاربر
    getUserReviews: async (req, res) => {
        try {
            const userId = req.params.id || req.session.user.id;
            const page = parseInt(req.query.page) || 1;
            const limit = 10;
            const offset = (page - 1) * limit;

            const reviews = await Review.findByUser(userId, limit, offset);
            const totalReviews = await Review.countByUser(userId);
            const totalPages = Math.ceil(totalReviews / limit);

            res.render('userReviews', { reviews, userId, page, totalPages });
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error fetching user reviews');
            res.redirect('back');
        }
    },

    // ================================
    // 📌 پیگیری وضعیت درخواست (new feature E-Gov)
    trackRequestStatus: async (req, res) => {
        try {
            const requestId = req.params.requestId;
            const request = await Request.findById(requestId);

            if (!request) {
                req.flash('error_msg', 'Request not found');
                return res.redirect('/dashboard');
            }

            res.render('requestStatus', { request });
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error fetching request status');
            res.redirect('/dashboard');
        }
    },

    // ================================
    // 📌 API JSON برای SPA
    apiGetReviewsByRequest: async (req, res) => {
        try {
            const requestId = req.params.id;
            const reviews = await Review.findByRequest(requestId, 10, 0);
            const avgRating = await Review.getAverageRating(requestId);

            res.json({ success: true, reviews, avgRating });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, error: 'Failed to fetch reviews' });
        }
    },

    // ================================
    // 📌 گزارش ادمین (new feature)
    getAdminReports: async (req, res) => {
        try {
            if (req.session.user.role !== 'admin') {
                req.flash('error_msg', 'Unauthorized');
                return res.redirect('/dashboard');
            }

            const page = parseInt(req.query.page) || 1;
            const limit = 20;
            const offset = (page - 1) * limit;

            const reports = await Review.getPendingReviews(limit, offset);
            const totalReports = await Review.countPendingReviews();
            const totalPages = Math.ceil(totalReports / limit);

            res.render('adminReports', { reports, page, totalPages });
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error fetching admin reports');
            res.redirect('/dashboard');
        }
    }
};

module.exports = reviewController;
