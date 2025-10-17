const User = require('../models/User');
const Order = require('../models/Order');
const Request = require('../models/Request');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const Payment = require('../models/Payment');
const Assignment = require('../models/Assignment');

module.exports = {
    dashboardPage: async (req, res) => {
        try {
            if (!req.user) throw new Error('User not found in session');

            const role = req.user.role;

            // =============================
            // 📊 آمار اصلی
            // =============================
            const [
                totalUsers,
                totalOrders,
                totalRequests,
                totalMessages,
                totalNotifications,
                totalPayments,
                totalAssignments
            ] = await Promise.all([
                role === 'admin' && User.countUsers ? User.countUsers() : 0,
                Order.count(),
                Request.count(),
                Message.count(),
                Notification.count(),
                Payment.count(),
                Assignment.count()
            ]);

            // 📈 آمار وضعیت سفارش‌ها
            const [pendingOrders, completedOrders, cancelledOrders] = await Promise.all([
                Order.countByStatus ? Order.countByStatus('pending') : 0,
                Order.countByStatus ? Order.countByStatus('completed') : 0,
                Order.countByStatus ? Order.countByStatus('cancelled') : 0
            ]);

            // 📈 آمار پرداختی‌ها
            const paidOrders = Order.countByPaymentStatus
                ? await Order.countByPaymentStatus('paid')
                : totalPayments;

            // =============================
            // 🕓 آخرین آیتم‌ها
            // =============================
            const [
                recentOrders,
                recentRequests,
                recentAssignments,
                recentMessages,
                recentNotifications
            ] = await Promise.all([
                Order.findRecent ? Order.findRecent(role === 'officer' ? { officerId: req.user.id } : {}) : [],
                Request.findRecent ? Request.findRecent() : [],
                Assignment.findRecent ? Assignment.findRecent(role === 'officer' ? { officerId: req.user.id } : {}) : [],
                Message.findRecent ? Message.findRecent() : [],
                Notification.findRecent ? Notification.findRecent() : []
            ]);

            // 👤 لیست کاربران فقط برای ادمین
            const users = role === 'admin' && User.findAll ? await User.findAll() : [];

            // =============================
            // 🧭 انتخاب View براساس نقش
            // =============================
            let viewName = 'dashboard'; // پیش‌فرض
            if (role === 'officer') viewName = 'officerDashboard';
            else if (role !== 'admin') viewName = 'profile';

            // =============================
            // 📤 ارسال داده‌ها به View
            // =============================
            res.render(viewName, {
                user: req.user,
                role,
                stats: {
                    total_users: totalUsers,
                    total_orders: totalOrders,
                    total_requests: totalRequests,
                    total_messages: totalMessages,
                    total_notifications: totalNotifications,
                    total_payments: totalPayments,
                    total_assignments: totalAssignments,
                    paid_orders: paidOrders,
                    pending_orders: pendingOrders,
                    completed_orders: completedOrders,
                    orderStats: [pendingOrders, completedOrders, cancelledOrders],
                    requestStats: [
                        Request.countByStatus ? await Request.countByStatus('pending') : 0,
                        Request.countByStatus ? await Request.countByStatus('approved') : 0,
                        Request.countByStatus ? await Request.countByStatus('rejected') : 0
                    ]
                },
                orders: recentOrders,
                users,
                recentOrders,
                recentRequests,
                recentAssignments,
                recentMessages,
                recentNotifications,
                success_msg: req.flash('success_msg'),
                error_msg: req.flash('error_msg')
            });

        } catch (err) {
            console.error('Dashboard Controller Error:', err);
            res.status(500).render('dashboard', {
                user: req.user || null,
                stats: {
                    total_users: 0,
                    total_orders: 0,
                    total_requests: 0,
                    total_messages: 0,
                    total_notifications: 0,
                    total_payments: 0,
                    total_assignments: 0,
                    paid_orders: 0,
                    pending_orders: 0,
                    completed_orders: 0,
                    orderStats: [0, 0, 0],
                    requestStats: [0, 0, 0]
                },
                orders: [],
                users: [],
                recentOrders: [],
                recentRequests: [],
                recentAssignments: [],
                recentMessages: [],
                recentNotifications: [],
                error_msg: 'خطا در بارگذاری اطلاعات داشبورد'
            });
        }
    }
};
