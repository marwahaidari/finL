const fs = require('fs');
const Order = require('../models/Order');
const Notification = require('../models/Notification');
const User = require('../models/User');
const File = require('../models/File');
const Message = require('../models/Message');

const orderController = {
    // ================================
    // 📌 لیست سفارش‌ها (با search + filter + sort + pagination)
    getOrders: async (req, res) => {
        try {
            if (!req.session.user) return res.redirect('/login');

            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;

            const status = req.query.status || 'all'; // all, paid, unpaid, pending, completed, canceled
            const search = req.query.search || '';
            const sort = req.query.sort || 'latest'; // latest, oldest, paidFirst, unpaidFirst

            let orders, totalOrders;
            if (req.session.user.role === 'admin') {
                orders = await Order.findAllAdvanced(limit, offset, { status, search, sort });
                totalOrders = await Order.countAllWithFilter(status, search);
            } else {
                orders = await Order.findByUserAdvanced(req.session.user.id, limit, offset, { status, search, sort });
                totalOrders = await Order.countByUser(req.session.user.id, status, search);
            }

            // 🟡 محاسبه progressWidth برای هر سفارش
            orders = orders.map(order => {
                let progressWidth = '0%';
                if (order.status === 'pending') progressWidth = '50%';
                else if (order.status === 'completed') progressWidth = '100%';
                return { ...order, progressWidth };
            });

            const totalPages = Math.ceil(totalOrders / limit);

            res.render('orders', {
                orders,
                user: req.session.user,
                page,
                totalPages,
                status,
                search,
                sort
            });
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Could not load orders');
            res.redirect('/dashboard');
        }
    },

    // ================================
    // 📌 ایجاد سفارش جدید
    createOrder: async (req, res) => {
        try {
            if (!req.session.user) return res.redirect('/login');
            const { title, description } = req.body;

            if (!title || !description) {
                req.flash('error_msg', 'All fields are required');
                return res.redirect('/orders/create');
            }

            const order = await Order.create(req.session.user.id, title, description);

            req.flash('success_msg', 'Order created successfully');
            await Notification.create(req.session.user.id, `Your order "${order.title}" has been created.`);

            const io = req.app.get('io');
            io.emit('newOrder', { orderId: order.id, title: order.title, user: req.session.user.name });

            res.redirect('/orders');
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error creating order');
            res.redirect('/orders');
        }
    },

    // ================================
    // 📌 فرم ویرایش سفارش
    editForm: async (req, res) => {
        try {
            if (!req.session.user) return res.redirect('/login');
            const order = await Order.findById(req.params.id);
            if (!order || (req.session.user.role !== 'admin' && order.user_id !== req.session.user.id)) {
                req.flash('error_msg', 'Unauthorized access');
                return res.redirect('/orders');
            }
            res.render('editOrder', { order });
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error loading order for edit');
            res.redirect('/orders');
        }
    },

    // ================================
    // 📌 ویرایش سفارش
    updateOrder: async (req, res) => {
        try {
            if (!req.session.user) return res.redirect('/login');
            const { title, description, status } = req.body;
            const order = await Order.findById(req.params.id);

            if (!order || (req.session.user.role !== 'admin' && order.user_id !== req.session.user.id)) {
                req.flash('error_msg', 'Unauthorized');
                return res.redirect('/orders');
            }

            await Order.update(req.params.id, title, description, status);

            if (req.session.user.role === 'admin') {
                await Notification.create(order.user_id, `Your order "${order.title}" was updated by admin.`);
            }

            req.flash('success_msg', 'Order updated');
            res.redirect('/orders');
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error updating order');
            res.redirect('/orders');
        }
    },

    // ================================
    // 📌 آرشیو یا حذف سفارش (Soft delete)
    archiveOrder: async (req, res) => {
        try {
            if (!req.session.user) return res.redirect('/login');
            const order = await Order.findById(req.params.id);

            if (!order || (req.session.user.role !== 'admin' && order.user_id !== req.session.user.id)) {
                req.flash('error_msg', 'Unauthorized');
                return res.redirect('/orders');
            }

            await Order.archive(req.params.id);
            req.flash('success_msg', 'Order archived');
            res.redirect('/orders');
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error archiving order');
            res.redirect('/orders');
        }
    },

    // ================================
    // 📌 حذف کامل سفارش (همراه فایل و پیام‌ها)
    deleteOrder: async (req, res) => {
        try {
            if (!req.session.user) return res.redirect('/login');
            const order = await Order.findById(req.params.id);

            if (!order || (req.session.user.role !== 'admin' && order.user_id !== req.session.user.id)) {
                req.flash('error_msg', 'Unauthorized');
                return res.redirect('/orders');
            }

            const files = await File.findByOrder(order.id);
            for (const f of files) {
                if (fs.existsSync(f.filepath)) fs.unlinkSync(f.filepath);
                await File.delete(f.id);
            }

            const messages = await Message.findByOrder(order.id);
            for (const m of messages) {
                await Message.delete(m.id);
            }

            await Order.delete(req.params.id);
            req.flash('success_msg', 'Order and related files/messages deleted');
            res.redirect('/orders');
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error deleting order');
            res.redirect('/orders');
        }
    },

    // ================================
    // 📌 پرداخت سفارش
    payOrder: async (req, res) => {
        try {
            if (!req.session.user) return res.redirect('/login');
            const order = await Order.findById(req.params.id);

            if (!order || (req.session.user.role !== 'admin' && order.user_id !== req.session.user.id)) {
                req.flash('error_msg', 'Unauthorized');
                return res.redirect('/orders');
            }

            await Order.pay(req.params.id);

            await Notification.create(req.session.user.id, `Payment successful for order #${req.params.id}`);

            const io = req.app.get('io');
            io.emit('orderPaid', { orderId: req.params.id });

            req.flash('success_msg', 'Payment successful');
            res.redirect('/orders');
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error processing payment');
            res.redirect('/orders');
        }
    },

    // ================================
    // 📌 تاریخچه پرداخت‌ها
    getPaidOrders: async (req, res) => {
        try {
            if (!req.session.user) return res.redirect('/login');
            const orders = await Order.findPaidByUser(req.session.user.id);
            res.render('payments', { orders });
        } catch (err) {
            console.error(err);
            res.render('payments', { orders: [], error_msg: 'Could not load payment history' });
        }
    },

    // ================================
    // 📌 گزارش مدیر
    getAdminReports: async (req, res) => {
        try {
            if (req.session.user.role !== 'admin') {
                req.flash('error_msg', 'Unauthorized');
                return res.redirect('/dashboard');
            }

            const orders = await Order.findAll();
            const paidOrders = orders.filter(o => o.paid);
            const unpaidOrders = orders.filter(o => !o.paid);

            const totalRevenue = paidOrders.reduce((sum, o) => sum + (o.amount || 0), 0);
            const users = await User.findAll();

            res.render('adminReports', {
                orders,
                chartData: { paid: paidOrders.length, unpaid: unpaidOrders.length },
                summary: {
                    totalUsers: users.length,
                    totalOrders: orders.length,
                    paidOrders: paidOrders.length,
                    unpaidOrders: unpaidOrders.length,
                    totalRevenue
                }
            });
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error generating reports');
            res.redirect('/dashboard');
        }
    },

    // ================================
    // 📌 نمایش جزئیات سفارش + progressWidth
    getOrderDetail: async (req, res) => {
        try {
            if (!req.session.user) return res.redirect('/login');

            const orderId = req.params.id;
            const order = await Order.findById(orderId);

            if (!order || (req.session.user.role !== 'admin' && order.user_id !== req.session.user.id)) {
                req.flash('error_msg', 'Unauthorized');
                return res.redirect('/orders');
            }

            let progressWidth = '0%';
            if (order.status === 'pending') progressWidth = '50%';
            else if (order.status === 'completed') progressWidth = '100%';

            const attachments = await File.findByOrder(orderId);
            const history = await Order.getHistory ? await Order.getHistory(orderId) : [];
            const reviews = await Order.getReviews ? await Order.getReviews(orderId) : [];

            res.render('orderDetail', {
                order,
                attachments,
                history,
                reviews,
                progressWidth
            });
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error loading order detail');
            res.redirect('/orders');
        }
    },

    // ================================
    // 📌 API JSON
    apiGetOrders: async (req, res) => {
        try {
            let orders;
            if (req.session.user.role === 'admin') {
                orders = await Order.findAll();
            } else {
                orders = await Order.findByUser(req.session.user.id);
            }
            res.json({ success: true, orders });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, error: 'Could not fetch orders' });
        }
    }
};

module.exports = orderController;
