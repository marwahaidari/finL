// controllers/orderController.js
const fs = require('fs');
const path = require('path');
const Order = require('../models/Order');
const Notification = require('../models/Notification');
const User = require('../models/user');
const File = require('../models/File');
const Message = require('../models/Message');

const orderController = {
    // Helper used by routes
    getOrderById: async (id) => {
        return await Order.findById(id);
    },

    // لیست سفارش‌ها (با pagination/search/filter)
    getOrders: async (req, res) => {
        try {
            if (!req.session.user) return res.redirect('/login');

            const page = Math.max(1, parseInt(req.query.page) || 1);
            const limit = parseInt(req.query.limit) || 10;
            const status = req.query.status || 'all';
            const search = req.query.search || '';
            const sort = req.query.sort || 'latest';

            let orders = [];
            let totalOrders = 0;

            if (req.session.user.role === 'admin') {
                // استفاده از متد fallback: findAllAdvanced یا findAll
                if (typeof Order.findAllAdvanced === 'function') {
                    const offset = (page - 1) * limit;
                    orders = await Order.findAllAdvanced(limit, offset, { status, search, sort });
                    totalOrders = await (Order.countAllWithFilter ? Order.countAllWithFilter(status, search) : (orders.length));
                } else {
                    orders = await Order.findAll({ limit, offset: (page - 1) * limit, status: status === 'all' ? null : status });
                    totalOrders = await (Order.count ? Order.count() : orders.length);
                }
            } else {
                // کاربر عادی: سعی کن از advanced یا paginated استفاده کنی، در غیر اینصورت fallback امن
                if (typeof Order.findByUserAdvanced === 'function') {
                    const result = await Order.findByUserAdvanced(req.session.user.id, limit, (page - 1) * limit, { status, search, sort });
                    orders = result.orders || [];
                    totalOrders = result.total || orders.length;
                } else if (typeof Order.findByUserPaginated === 'function') {
                    const result = await Order.findByUserPaginated(req.session.user.id, page, search, limit);
                    orders = result.orders || [];
                    totalOrders = result.total || (result.totalPages ? result.totalPages * limit : orders.length);
                } else if (typeof Order.findByUser === 'function') {
                    orders = await Order.findByUser(req.session.user.id);
                    totalOrders = orders.length;
                } else {
                    // fallback ایمن: تلاش برای خواندن همه سفارش‌ها مربوط به کاربر از findAll با فیلتر user_id (در صورت پشتیبانی)
                    try {
                        const maybeAll = await Order.findAll({ limit, offset: (page - 1) * limit, status: status === 'all' ? null : status });
                        // فیلتر سمت سرور براساس user_id اگر مدل برگرداند
                        orders = (Array.isArray(maybeAll) ? maybeAll.filter(o => String(o.user_id) === String(req.session.user.id)) : []);
                        totalOrders = orders.length;
                    } catch (e) {
                        orders = [];
                        totalOrders = 0;
                    }
                }
            }

            // progressWidth per order
            orders = (orders || []).map(order => {
                let progressWidth = '0%';
                if (order.status === 'pending') progressWidth = '50%';
                else if (order.status === 'completed') progressWidth = '100%';
                return { ...order, progressWidth };
            });

            const totalPages = Math.max(1, Math.ceil((totalOrders || orders.length) / limit));

            res.render('orders', {
                title: 'سفارش‌ها',
                orders,
                user: req.session.user,
                page,
                totalPages,
                status,
                search,
                sort
            });
        } catch (err) {
            console.error('getOrders error:', err);
            req.flash && req.flash('error_msg', 'Could not load orders');
            res.render('orders', { title: 'سفارش‌ها', orders: [], user: req.session.user, page: 1, totalPages: 1, status: 'all', search: '', sort: 'latest' });
        }
    },

    // ایجاد سفارش (با پشتیبانی از attachments, tags, department, priority, eta)
    createOrder: async (req, res) => {
        try {
            if (!req.session.user) return res.redirect('/login');

            const { title, description } = req.body;
            if (!title || !description) {
                req.flash && req.flash('error_msg', 'All fields are required');
                return res.redirect('/orders/create');
            }

            // attachments from multer (support various storage shapes)
            const attachments = (req.files || []).map(f => ({
                name: f.originalname || f.filename || f.name,
                path: f.path || f.filepath || f.location || f.destination || ''
            }));
            const tags = req.body.tags ? (Array.isArray(req.body.tags) ? req.body.tags : [req.body.tags]) : [];
            const department = req.body.department || null;
            const priority = req.body.priority || 'normal';
            const eta = req.body.eta || null;

            const order = await Order.create(req.session.user.id, title, description, { tags, department, attachments, priority, eta });

            req.flash && req.flash('success_msg', 'Order created successfully');
            if (Notification && typeof Notification.create === 'function') {
                try { await Notification.create(req.session.user.id, `Your order "${order.title}" has been created.`); } catch (e) { /* ignore notification errors */ }
            }

            const io = req.app && req.app.get ? req.app.get('io') : null;
            if (io) io.emit('newOrder', { id: order.id, title: order.title, user: req.session.user.name });

            res.redirect('/orders');
        } catch (err) {
            console.error('createOrder error:', err);
            req.flash && req.flash('error_msg', 'Error creating order');
            res.redirect('/orders');
        }
    },

    // فرم ویرایش
    editForm: async (req, res) => {
        try {
            if (!req.session.user) return res.redirect('/login');
            const order = await Order.findById(req.params.id);
            if (!order || (req.session.user.role !== 'admin' && String(order.user_id) !== String(req.session.user.id))) {
                req.flash && req.flash('error_msg', 'Unauthorized access');
                return res.redirect('/orders');
            }
            res.render('editOrder', { title: 'ویرایش سفارش', order });
        } catch (err) {
            console.error('editForm error:', err);
            req.flash && req.flash('error_msg', 'Error loading order for edit');
            res.redirect('/orders');
        }
    },

    // ویرایش سفارش
    updateOrder: async (req, res) => {
        try {
            if (!req.session.user) return res.redirect('/login');
            const { title, description, status } = req.body;
            const order = await Order.findById(req.params.id);

            if (!order || (req.session.user.role !== 'admin' && String(order.user_id) !== String(req.session.user.id))) {
                req.flash && req.flash('error_msg', 'Unauthorized');
                return res.redirect('/orders');
            }

            const attachments = (req.files || []).map(f => ({
                name: f.originalname || f.filename || f.name,
                path: f.path || f.filepath || f.location || f.destination || ''
            }));
            const tags = req.body.tags ? (Array.isArray(req.body.tags) ? req.body.tags : [req.body.tags]) : [];

            await Order.update(req.params.id, {
                title,
                description,
                status,
                tags,
                department: req.body.department || null,
                priority: req.body.priority || null,
                eta: req.body.eta || null,
                attachments
            });

            if (req.session.user.role === 'admin' && Notification && typeof Notification.create === 'function') {
                try { await Notification.create(order.user_id, `Your order "${order.title}" was updated by admin.`); } catch (e) { /* ignore */ }
            }

            req.flash && req.flash('success_msg', 'Order updated');
            res.redirect('/orders');
        } catch (err) {
            console.error('updateOrder error:', err);
            req.flash && req.flash('error_msg', 'Error updating order');
            res.redirect('/orders');
        }
    },

    // آرشیو / soft delete
    archiveOrder: async (req, res) => {
        try {
            if (!req.session.user) return res.redirect('/login');
            const order = await Order.findById(req.params.id);
            if (!order || (req.session.user.role !== 'admin' && String(order.user_id) !== String(req.session.user.id))) {
                req.flash && req.flash('error_msg', 'Unauthorized');
                return res.redirect('/orders');
            }
            if (typeof Order.softDelete === 'function') await Order.softDelete(req.params.id);
            req.flash && req.flash('success_msg', 'Order archived');
            res.redirect('/orders');
        } catch (err) {
            console.error('archiveOrder error:', err);
            req.flash && req.flash('error_msg', 'Error archiving order');
            res.redirect('/orders');
        }
    },

    // حذف کامل (hard delete)
    deleteOrder: async (req, res) => {
        try {
            if (!req.session.user) return res.redirect('/login');
            const order = await Order.findById(req.params.id);
            if (!order || (req.session.user.role !== 'admin' && String(order.user_id) !== String(req.session.user.id))) {
                req.flash && req.flash('error_msg', 'Unauthorized');
                return res.redirect('/orders');
            }

            if (typeof Order.hardDelete === 'function') await Order.hardDelete(req.params.id);

            req.flash && req.flash('success_msg', 'Order and related data deleted');
            res.redirect('/orders');
        } catch (err) {
            console.error('deleteOrder error:', err);
            req.flash && req.flash('error_msg', 'Error deleting order');
            res.redirect('/orders');
        }
    },

    // پرداخت سفارش
    payOrder: async (req, res) => {
        try {
            if (!req.session.user) return res.redirect('/login');
            const order = await Order.findById(req.params.id);

            if (!order || (req.session.user.role !== 'admin' && String(order.user_id) !== String(req.session.user.id))) {
                req.flash && req.flash('error_msg', 'Unauthorized');
                return res.redirect('/orders');
            }

            const amount = parseFloat(req.body.amount) || 0;
            const method = req.body.method || 'online';
            if (typeof Order.pay === 'function') await Order.pay(req.params.id, { amount, method });

            if (Notification && typeof Notification.create === 'function') {
                try { await Notification.create(req.session.user.id, `Payment successful for order #${req.params.id}`); } catch (e) { /* ignore */ }
            }

            const io = req.app && req.app.get ? req.app.get('io') : null;
            if (io) io.emit('orderPaid', { id: String(req.params.id) });

            req.flash && req.flash('success_msg', 'Payment successful');
            res.redirect('/orders');
        } catch (err) {
            console.error('payOrder error:', err);
            req.flash && req.flash('error_msg', 'Error processing payment');
            res.redirect('/orders');
        }
    },

    // تاریخچه پرداخت‌ها
    getPaidOrders: async (req, res) => {
        try {
            if (!req.session.user) return res.redirect('/login');
            const orders = (typeof Order.findPaidByUser === 'function') ? await Order.findPaidByUser(req.session.user.id) : [];
            res.render('payments', { title: 'تاریخچه پرداخت', orders });
        } catch (err) {
            console.error('getPaidOrders error:', err);
            res.render('payments', { orders: [], error_msg: 'Could not load payment history' });
        }
    },

    // گزارش مدیر
    getAdminReports: async (req, res) => {
        try {
            if (!req.session.user || req.session.user.role !== 'admin') {
                req.flash && req.flash('error_msg', 'Unauthorized');
                return res.redirect('/dashboard');
            }

            const orders = (typeof Order.findAll === 'function') ? await Order.findAll() : [];
            const paidOrders = (orders || []).filter(o => o.paid);
            const unpaidOrders = (orders || []).filter(o => !o.paid);
            const totalRevenue = paidOrders.reduce((sum, o) => sum + (o.amount || 0), 0);
            const users = (typeof User.findAll === 'function') ? await User.findAll() : [];

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
            console.error('getAdminReports error:', err);
            req.flash && req.flash('error_msg', 'Error generating reports');
            res.redirect('/dashboard');
        }
    },

    // نمایش جزئیات سفارش
    getOrderDetail: async (req, res) => {
        try {
            if (!req.session.user) return res.redirect('/login');
            const orderId = req.params.id;
            const order = await Order.findById(orderId);
            if (!order || (req.session.user.role !== 'admin' && String(order.user_id) !== String(req.session.user.id))) {
                req.flash && req.flash('error_msg', 'Unauthorized');
                return res.redirect('/orders');
            }

            let progressWidth = '0%';
            if (order.status === 'pending') progressWidth = '50%';
            else if (order.status === 'completed') progressWidth = '100%';

            const files = (File && typeof File.findByOrder === 'function') ? await File.findByOrder(orderId) : (order.attachments || []);
            const messages = (Message && typeof Message.findByOrder === 'function') ? await Message.findByOrder(orderId) : [];

            res.render('orderDetail', {
                title: `جزئیات سفارش #${order.id}`,
                order,
                progressWidth,
                files,
                messages
            });
        } catch (err) {
            console.error('getOrderDetail error:', err);
            req.flash && req.flash('error_msg', 'Error loading order detail');
            res.redirect('/orders');
        }
    },

    // API JSON ساده
    apiGetOrders: async (req, res) => {
        try {
            if (!req.session.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
            let orders;
            if (req.session.user.role === 'admin') {
                orders = (typeof Order.findAll === 'function') ? await Order.findAll() : [];
            } else {
                if (typeof Order.findByUser === 'function') orders = await Order.findByUser(req.session.user.id);
                else if (typeof Order.findByUserPaginated === 'function') {
                    const r = await Order.findByUserPaginated(req.session.user.id, 1, '', 100);
                    orders = r.orders || [];
                } else orders = [];
            }
            res.json({ success: true, orders });
        } catch (err) {
            console.error('apiGetOrders error:', err);
            res.status(500).json({ success: false, error: 'Could not fetch orders' });
        }
    }
};

module.exports = orderController;
