// controllers/adminController.js
// ⚠️ این کنترلر بزرگه چون همه‌ی سکشن‌های مدیریتی رو پوشش می‌ده.
// وابستگی‌ها: فرض شده مدل‌های زیر با امضاهای استفاده‌شده وجود دارن.

const User = require('../models/User');
const Order = require('../models/Order');
const Review = require('../models/Review');
const Notification = require('../models/Notification');
const Message = require('../models/Message');
const AuditLog = require('../models/AuditLog');
const Document = require('../models/Document');
const Complaint = require('../models/Complaint');
const Appointment = require('../models/Appointment');
const Payment = require('../models/Payment');
const FileModel = require('../models/File'); // rename to avoid clash with global File
const Service = require('../models/Service');
const Settings = require('../models/Setings');
const Backup = require('../utils/Backup');
const AI = require('../utils/AI');
const { Parser } = require('json2csv');

// ==========================
// Helpers
// ==========================
const ok = (req, msg) => req.flash?.('success_msg', msg);
const bad = (req, msg) => req.flash?.('error_msg', msg);
const info = (req, msg) => req.flash?.('info_msg', msg);

const pick = (obj, keys) =>
    keys.reduce((o, k) => (obj?.[k] !== undefined ? ((o[k] = obj[k]), o) : o), {});

const paginateArray = (items, { page = 1, limit = 20 } = {}) => {
    page = Math.max(parseInt(page || 1, 10), 1);
    limit = Math.max(parseInt(limit || 20, 10), 1);
    const start = (page - 1) * limit;
    const end = start + limit;
    return {
        rows: items.slice(start, end),
        page,
        pages: Math.ceil(items.length / limit),
        total: items.length,
        limit,
    };
};
const safeArray = (v) =>
    Array.isArray(v) ? v : v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : [];

const requireAdmin = (req) => {
    if (!req.session?.user || !['admin', 'superadmin'].includes(req.session.user.role)) {
        const err = new Error('Forbidden');
        err.status = 403;
        throw err;
    }
};

const sendRealtime = (req, channel, event, payload) => {
    try {
        const io = req.app?.get?.('io');
        if (io) io.to(channel).emit(event, payload);
    } catch (_) { }
};

const maybeJSON = (req) => req.xhr || req.headers.accept?.includes('application/json');
const asJSONorRender = (req, res, view, data) => {
    if (maybeJSON(req)) return res.json({ success: true, ...data });
    return res.render(view, data);
};

// ==========================
// Controller
// ==========================
const adminController = {
    // ==========================
    // USERS
    // ==========================
    getUsers: async (req, res) => {
        try {
            requireAdmin(req);
            const { q, role, active, sort = 'created_at:desc', page = 1, limit = 20 } = req.query;
            const rows = await User.findAll(); // -> array of users
            let list = rows;

            if (q) {
                const ql = q.toLowerCase();
                list = list.filter((u) =>
                    [u.full_name || u.name, u.email, u.phone, u.national_id]
                        .filter(Boolean)
                        .some((x) => String(x).toLowerCase().includes(ql))
                );
            }
            if (role) list = list.filter((u) => String(u.role) === String(role));
            if (active === 'true') list = list.filter((u) => u.is_active === true || u.active === true);
            if (active === 'false') list = list.filter((u) => !(u.is_active === true || u.active === true));

            const [sortKey, sortDir] = sort.split(':');
            list.sort((a, b) => {
                const av = a?.[sortKey];
                const bv = b?.[sortKey];
                if (av == null && bv != null) return sortDir === 'asc' ? -1 : 1;
                if (av != null && bv == null) return sortDir === 'asc' ? 1 : -1;
                if (av == null && bv == null) return 0;
                if (av < bv) return sortDir === 'asc' ? -1 : 1;
                if (av > bv) return sortDir === 'asc' ? 1 : -1;
                return 0;
            });

            const pager = paginateArray(list, { page, limit });
            return asJSONorRender(req, res, 'admin/users', {
                users: pager.rows,
                pager,
                filters: pick(req.query, ['q', 'role', 'active', 'sort']),
            });
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error fetching users');
            return res.redirect('/dashboard');
        }
    },

    getUserById: async (req, res) => {
        try {
            requireAdmin(req);
            const user = await User.findById(req.params.id);
            if (!user) return res.status(404).send('User not found');
            const lastLogins = await User.getLoginHistory?.(req.params.id, 10);
            return asJSONorRender(req, res, 'admin/userDetail', { user, lastLogins });
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error fetching user details');
            return res.redirect('/admin/users');
        }
    },

    createUser: async (req, res) => {
        try {
            requireAdmin(req);
            const { nationalId, fullName, email, phone, password, role = 'citizen', address } = req.body;
            const u = await User.create({
                nationalId,
                name: fullName,
                email,
                phone,
                password,
                role,
                address,
            });
            await AuditLog.create(req.session.user.id, `Created user ${u.id}:${u.email}`);
            ok(req, '✅ User created successfully');
            return res.redirect('/admin/users');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error creating user');
            return res.redirect('/admin/users');
        }
    },

    updateUser: async (req, res) => {
        try {
            requireAdmin(req);
            const { fullName, email, phone, role, address } = req.body;
            await User.updateProfile(req.params.id, fullName, email, phone, address);
            if (role) await User.changeRole?.(req.params.id, role) || User.updateRole?.(req.params.id, role);
            await AuditLog.create(req.session.user.id, `Updated user ${req.params.id}`);
            ok(req, '✅ User updated successfully');
            return res.redirect('/admin/users');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error updating user');
            return res.redirect('/admin/users');
        }
    },

    deactivateUser: async (req, res) => {
        try {
            requireAdmin(req);
            await User.toggleActive(req.params.id, false);
            await AuditLog.create(req.session.user.id, `Deactivated user ${req.params.id}`);
            ok(req, '⚠️ User deactivated');
            return res.redirect('/admin/users');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error deactivating user');
            return res.redirect('/admin/users');
        }
    },

    activateUser: async (req, res) => {
        try {
            requireAdmin(req);
            await User.toggleActive(req.params.id, true);
            await AuditLog.create(req.session.user.id, `Activated user ${req.params.id}`);
            ok(req, '✅ User activated');
            return res.redirect('/admin/users');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error activating user');
            return res.redirect('/admin/users');
        }
    },

    resetPassword: async (req, res) => {
        try {
            requireAdmin(req);
            await User.resetPassword(req.params.id, req.body.newPassword);
            await AuditLog.create(req.session.user.id, `Reset password for user ${req.params.id}`);
            ok(req, '🔑 Password reset');
            return res.redirect('/admin/users');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error resetting password');
            return res.redirect('/admin/users');
        }
    },

    suspendUser: async (req, res) => {
        try {
            requireAdmin(req);
            await User.suspend?.(req.params.id);
            await AuditLog.create(req.session.user.id, `Suspended user ${req.params.id}`);
            ok(req, '🚫 User suspended');
            return res.redirect('/admin/users');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error suspending user');
            return res.redirect('/admin/users');
        }
    },

    assignRoleToUser: async (req, res) => {
        try {
            requireAdmin(req);
            await User.changeRole?.(req.params.id, req.body.role) || User.updateRole?.(req.params.id, req.body.role);
            await AuditLog.create(req.session.user.id, `Changed role for user ${req.params.id} to ${req.body.role}`);
            ok(req, '✅ Role updated successfully');
            return res.redirect('/admin/users');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error assigning role');
            return res.redirect('/admin/users');
        }
    },

    toggle2FA: async (req, res) => {
        try {
            requireAdmin(req);
            await User.toggle2FA?.(req.params.id, !!req.body.enabled);
            await AuditLog.create(req.session.user.id, `Toggled 2FA for user ${req.params.id}`);
            ok(req, '🔐 2FA updated');
            return res.redirect('/admin/users');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error toggling 2FA');
            return res.redirect('/admin/users');
        }
    },

    bulkUsers: async (req, res) => {
        try {
            requireAdmin(req);
            const ids = safeArray(req.body.ids);
            const action = req.body.action;
            if (!ids.length) throw new Error('No ids provided');

            const map = {
                activate: (id) => User.toggleActive(id, true),
                deactivate: (id) => User.toggleActive(id, false),
                suspend: (id) => User.suspend?.(id),
                reset2FA: (id) => User.toggle2FA?.(id, false),
                delete: (id) => User.delete?.(id),
            };
            const fn = map[action];
            if (!fn) throw new Error('Invalid action');

            await Promise.all(ids.map(fn));
            await AuditLog.create(req.session.user.id, `Bulk users: ${action} => [${ids.join(',')}]`);
            ok(req, '✅ Bulk operation completed');
            return res.redirect('/admin/users');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Bulk users operation failed');
            return res.redirect('/admin/users');
        }
    },

    exportUsers: async (req, res) => {
        try {
            requireAdmin(req);
            const users = await User.findAll();
            const rows = users.map((u) =>
                pick(u, ['id', 'full_name', 'name', 'email', 'phone', 'role', 'is_active', 'created_at'])
            );
            if (req.query.format === 'json') {
                res.header('Content-Type', 'application/json');
                return res.send(rows);
            }
            const parser = new Parser();
            const csv = parser.parse(rows);
            res.header('Content-Type', 'text/csv');
            res.attachment('users.csv');
            return res.send(csv);
        } catch (err) {
            console.error(err);
            bad(req, '❌ Export users failed');
            return res.redirect('/admin/users');
        }
    },

    impersonate: async (req, res) => {
        try {
            requireAdmin(req);
            const targetId = req.params.id;
            const user = await User.findById(targetId);
            if (!user) throw new Error('User not found');
            req.session._impersonatedFrom = req.session.user;
            req.session.user = { id: user.id, name: user.name || user.full_name, role: user.role };
            await AuditLog.create(req.session._impersonatedFrom.id, `Impersonated user ${user.id}`);
            info(req, `You are now impersonating ${user.email || user.full_name}`);
            return res.redirect('/dashboard');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Impersonation failed');
            return res.redirect('/admin/users');
        }
    },

    stopImpersonate: async (req, res) => {
        try {
            if (req.session._impersonatedFrom) {
                await AuditLog.create(req.session._impersonatedFrom.id, 'Stopped impersonation');
                req.session.user = req.session._impersonatedFrom;
                delete req.session._impersonatedFrom;
            }
        } catch (err) {
            console.error(err);
            bad(req, '❌ Stop impersonation failed');
        } finally {
            return res.redirect('/admin/users');
        }
    },

    // ==========================
    // ORDERS
    // ==========================
    getOrders: async (req, res) => {
        try {
            requireAdmin(req);
            const { q, status, department, officerId, paid, sort = 'created_at:desc', page = 1, limit = 20 } = req.query;

            // اگر مدل Order توابع سمت DB داره بهتره از آن‌ها استفاده کنی (برای pagination واقعی)
            const all = await Order.findAll(); // یا Order.findAll(status, department, ...)
            let list = all;

            if (q) {
                const ql = q.toLowerCase();
                list = list.filter((o) =>
                    [o.title, o.description, o.reference_no].filter(Boolean).some((x) => String(x).toLowerCase().includes(ql))
                );
            }
            if (status) list = list.filter((o) => String(o.status) === String(status));
            if (department) list = list.filter((o) => String(o.department) === String(department));
            if (officerId) list = list.filter((o) => String(o.officer_id) === String(officerId));
            if (paid === 'true') list = list.filter((o) => o.paid === true);
            if (paid === 'false') list = list.filter((o) => o.paid !== true);

            const [sortKey, sortDir] = sort.split(':');
            list.sort((a, b) => {
                const av = a?.[sortKey];
                const bv = b?.[sortKey];
                if (av == null && bv != null) return sortDir === 'asc' ? -1 : 1;
                if (av != null && bv == null) return sortDir === 'asc' ? 1 : -1;
                if (av == null && bv == null) return 0;
                if (av < bv) return sortDir === 'asc' ? -1 : 1;
                if (av > bv) return sortDir === 'asc' ? 1 : -1;
                return 0;
            });

            const pager = paginateArray(list, { page, limit });
            return asJSONorRender(req, res, 'admin/orders', {
                orders: pager.rows,
                pager,
                filters: pick(req.query, ['q', 'status', 'department', 'officerId', 'paid', 'sort']),
            });
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error fetching orders');
            return res.redirect('/dashboard');
        }
    },

    getOrder: async (req, res) => {
        try {
            requireAdmin(req);
            const order = await Order.findById(req.params.id);
            if (!order) return res.status(404).send('Order not found');
            const reviews = await Review.findByOrder?.(order.id, 50, 0, req.session.user.role);
            const files = await FileModel.findByOrder?.(order.id);
            return asJSONorRender(req, res, 'admin/orderDetail', { order, reviews, files });
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error fetching order');
            return res.redirect('/admin/orders');
        }
    },

    updateOrderStatus: async (req, res) => {
        try {
            requireAdmin(req);
            const updated = await Order.updateStatus(req.params.id, req.body.status);
            await AuditLog.create(req.session.user.id, `Changed order#${req.params.id} status => ${req.body.status}`);
            if (updated?.user_id) {
                await Notification.create(updated.user_id, `Your request "${updated.title}" status: ${req.body.status}`, 'service', 'info');
                sendRealtime(req, `user_${updated.user_id}`, 'orderStatus', { id: updated.id, status: updated.status });
            }
            ok(req, '✅ Order status updated');
            return res.redirect(`/admin/orders/${req.params.id}`);
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error updating order status');
            return res.redirect('/admin/orders');
        }
    },

    assignOrderOfficer: async (req, res) => {
        try {
            requireAdmin(req);
            const { officerId } = req.body;
            const updated = await Order.assignOfficer?.(req.params.id, officerId);
            await AuditLog.create(req.session.user.id, `Assigned officer ${officerId} to order#${req.params.id}`);
            ok(req, '👮 Officer assigned');
            return res.redirect(`/admin/orders/${req.params.id}`);
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error assigning officer');
            return res.redirect('/admin/orders');
        }
    },

    bulkOrders: async (req, res) => {
        try {
            requireAdmin(req);
            const ids = safeArray(req.body.ids);
            const action = req.body.action;
            if (!ids.length) throw new Error('No ids provided');

            const map = {
                close: (id) => Order.updateStatus(id, 'closed'),
                approve: (id) => Order.updateStatus(id, 'approved'),
                reject: (id) => Order.updateStatus(id, 'rejected'),
                archive: (id) => Order.archive?.(id, true),
            };
            const fn = map[action];
            if (!fn) throw new Error('Invalid action');

            await Promise.all(ids.map(fn));
            await AuditLog.create(req.session.user.id, `Bulk orders: ${action} => [${ids.join(',')}]`);
            ok(req, '✅ Bulk operation completed');
            return res.redirect('/admin/orders');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Bulk orders operation failed');
            return res.redirect('/admin/orders');
        }
    },

    exportOrders: async (req, res) => {
        try {
            requireAdmin(req);
            const orders = await Order.findAll();
            const rows = orders.map((o) =>
                pick(o, ['id', 'title', 'status', 'priority', 'department', 'officer_id', 'paid', 'created_at'])
            );
            if (req.query.format === 'json') {
                res.header('Content-Type', 'application/json');
                return res.send(rows);
            }
            const parser = new Parser();
            const csv = parser.parse(rows);
            res.header('Content-Type', 'text/csv');
            res.attachment('orders.csv');
            return res.send(csv);
        } catch (err) {
            console.error(err);
            bad(req, '❌ Export orders failed');
            return res.redirect('/admin/orders');
        }
    },

    // ==========================
    // DOCUMENTS
    // ==========================
    getDocuments: async (req, res) => {
        try {
            requireAdmin(req);
            const { q, type, status, page = 1, limit = 20 } = req.query;
            const docs = await Document.findAll?.();
            let list = docs || [];
            if (q) {
                const ql = q.toLowerCase();
                list = list.filter((d) => [d.title, d.reference_no].filter(Boolean).some((x) => String(x).toLowerCase().includes(ql)));
            }
            if (type) list = list.filter((d) => String(d.type) === String(type));
            if (status) list = list.filter((d) => String(d.status) === String(status));
            const pager = paginateArray(list, { page, limit });
            return asJSONorRender(req, res, 'admin/documents', { documents: pager.rows, pager, filters: pick(req.query, ['q', 'type', 'status']) });
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error fetching documents');
            return res.redirect('/dashboard');
        }
    },

    createDocument: async (req, res) => {
        try {
            requireAdmin(req);
            const doc = await Document.create?.(req.body);
            await AuditLog.create(req.session.user.id, `Created document ${doc?.id}`);
            ok(req, '📄 Document created');
            return res.redirect('/admin/documents');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error creating document');
            return res.redirect('/admin/documents');
        }
    },

    updateDocument: async (req, res) => {
        try {
            requireAdmin(req);
            const doc = await Document.update?.(req.params.id, req.body);
            await AuditLog.create(req.session.user.id, `Updated document ${req.params.id}`);
            ok(req, '✅ Document updated');
            return res.redirect('/admin/documents');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error updating document');
            return res.redirect('/admin/documents');
        }
    },

    deleteDocument: async (req, res) => {
        try {
            requireAdmin(req);
            await Document.delete?.(req.params.id);
            await AuditLog.create(req.session.user.id, `Deleted document ${req.params.id}`);
            ok(req, '🗑️ Document deleted');
            return res.redirect('/admin/documents');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error deleting document');
            return res.redirect('/admin/documents');
        }
    },

    // ==========================
    // COMPLAINTS
    // ==========================
    getComplaints: async (req, res) => {
        try {
            requireAdmin(req);
            const { q, status, page = 1, limit = 20 } = req.query;
            const all = await Complaint.findAll?.();
            let list = all || [];
            if (q) {
                const ql = q.toLowerCase();
                list = list.filter((c) => [c.subject, c.description].filter(Boolean).some((x) => String(x).toLowerCase().includes(ql)));
            }
            if (status) list = list.filter((c) => String(c.status) === String(status));
            const pager = paginateArray(list, { page, limit });
            return asJSONorRender(req, res, 'admin/complaints', { complaints: pager.rows, pager, filters: pick(req.query, ['q', 'status']) });
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error fetching complaints');
            return res.redirect('/dashboard');
        }
    },

    updateComplaintStatus: async (req, res) => {
        try {
            requireAdmin(req);
            const { status } = req.body;
            const updated = await Complaint.updateStatus?.(req.params.id, status);
            if (updated?.user_id) {
                await Notification.create(updated.user_id, `Your complaint status updated to ${status}`, 'service', 'info');
                sendRealtime(req, `user_${updated.user_id}`, 'complaintStatus', { id: updated.id, status });
            }
            await AuditLog.create(req.session.user.id, `Complaint#${req.params.id} => ${status}`);
            ok(req, '✅ Complaint status updated');
            return res.redirect('/admin/complaints');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error updating complaint');
            return res.redirect('/admin/complaints');
        }
    },

    // ==========================
    // APPOINTMENTS
    // ==========================
    getAppointments: async (req, res) => {
        try {
            requireAdmin(req);
            const { q, status, officerId, from, to, page = 1, limit = 20 } = req.query;
            const all = await Appointment.findAll?.();
            let list = all || [];
            if (q) {
                const ql = q.toLowerCase();
                list = list.filter((a) =>
                    [a.subject, a.location].filter(Boolean).some((x) => String(x).toLowerCase().includes(ql))
                );
            }
            if (status) list = list.filter((a) => String(a.status) === String(status));
            if (officerId) list = list.filter((a) => String(a.officer_id) === String(officerId));
            if (from) list = list.filter((a) => new Date(a.start_time) >= new Date(from));
            if (to) list = list.filter((a) => new Date(a.end_time) <= new Date(to));
            const pager = paginateArray(list, { page, limit });
            return asJSONorRender(req, res, 'admin/appointments', { appointments: pager.rows, pager, filters: pick(req.query, ['q', 'status', 'officerId', 'from', 'to']) });
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error fetching appointments');
            return res.redirect('/dashboard');
        }
    },

    updateAppointment: async (req, res) => {
        try {
            requireAdmin(req);
            await Appointment.update?.(req.params.id, req.body);
            await AuditLog.create(req.session.user.id, `Updated appointment ${req.params.id}`);
            ok(req, '✅ Appointment updated');
            return res.redirect('/admin/appointments');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error updating appointment');
            return res.redirect('/admin/appointments');
        }
    },

    // ==========================
    // PAYMENTS
    // ==========================
    getPayments: async (req, res) => {
        try {
            requireAdmin(req);
            const { q, status, method, page = 1, limit = 20 } = req.query;
            const all = await Payment.findAll?.();
            let list = all || [];
            if (q) {
                const ql = q.toLowerCase();
                list = list.filter((p) => [p.reference, p.description].filter(Boolean).some((x) => String(x).toLowerCase().includes(ql)));
            }
            if (status) list = list.filter((p) => String(p.status) === String(status));
            if (method) list = list.filter((p) => String(p.method) === String(method));
            const pager = paginateArray(list, { page, limit });
            return asJSONorRender(req, res, 'admin/payments', { payments: pager.rows, pager, filters: pick(req.query, ['q', 'status', 'method']) });
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error fetching payments');
            return res.redirect('/dashboard');
        }
    },

    refundPayment: async (req, res) => {
        try {
            requireAdmin(req);
            const p = await Payment.refund?.(req.params.id, req.body.reason);
            if (p?.user_id) {
                await Notification.create(p.user_id, `Your payment ${p.reference} refunded`, 'payment', 'warning');
                sendRealtime(req, `user_${p.user_id}`, 'paymentRefunded', { id: p.id, reference: p.reference });
            }
            await AuditLog.create(req.session.user.id, `Refunded payment ${req.params.id}`);
            ok(req, '↩️ Payment refunded');
            return res.redirect('/admin/payments');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error refunding payment');
            return res.redirect('/admin/payments');
        }
    },

    // ==========================
    // NOTIFICATIONS (جایگزین notificationController)
    // ==========================
    listNotifications: async (req, res) => {
        try {
            requireAdmin(req);
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;
            const offset = (page - 1) * limit;
            const type = req.query.type || 'all';

            const { notifications, total } = await Notification.findAllAdmin?.(limit, offset, type) ||
                (async () => {
                    // fallback: بگیریم همه و دستی paginate کنیم
                    const all = await Notification.findByUser(null, 1000, 0, type); // (برای همه)
                    return { notifications: all, total: all.length };
                })();

            const totalPages = Math.ceil(total / limit);
            return asJSONorRender(req, res, 'admin/notifications', { notifications, page, totalPages, total, type });
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error fetching notifications');
            return res.redirect('/dashboard');
        }
    },

    createNotification: async (req, res) => {
        try {
            requireAdmin(req);
            const { userId, message, type = 'service', priority = 'normal' } = req.body;
            const notif = await Notification.create(userId || null, message, type, priority);
            if (userId) {
                sendRealtime(req, `user_${userId}`, 'newNotification', notif);
            } else {
                const io = req.app.get('io');
                io?.emit('broadcastNotification', notif);
            }
            await AuditLog.create(req.session.user.id, `Created notification => ${userId || 'broadcast'}`);
            ok(req, '📣 Notification sent');
            return res.redirect('/admin/notifications');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error creating notification');
            return res.redirect('/admin/notifications');
        }
    },

    deleteNotification: async (req, res) => {
        try {
            requireAdmin(req);
            await Notification.deleteAdmin?.(req.params.id) || Notification.delete?.(req.params.id, null);
            await AuditLog.create(req.session.user.id, `Deleted notification ${req.params.id}`);
            ok(req, '🗑️ Notification deleted');
            return res.redirect('/admin/notifications');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error deleting notification');
            return res.redirect('/admin/notifications');
        }
    },

    // ==========================
    // MESSAGES
    // ==========================
    getMessages: async (req, res) => {
        try {
            requireAdmin(req);
            const { q, page = 1, limit = 20 } = req.query;
            // برای پنل ادمین، همه‌ی پیام‌ها
            const all = await Message.findAll?.();
            let list = all || [];
            if (q) {
                const ql = q.toLowerCase();
                list = list.filter((m) => String(m.content || '').toLowerCase().includes(ql));
            }
            const pager = paginateArray(list, { page, limit });
            return asJSONorRender(req, res, 'admin/messages', { messages: pager.rows, pager, filters: pick(req.query, ['q']) });
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error fetching messages');
            return res.redirect('/dashboard');
        }
    },

    replyMessage: async (req, res) => {
        try {
            requireAdmin(req);
            const { replyTo, toUserId, content } = req.body;
            const msg = await Message.create({
                senderId: req.session.user.id,
                receiverId: toUserId,
                content,
                replyTo: replyTo || null,
            });
            sendRealtime(req, `user_${toUserId}`, 'newMessage', msg);
            ok(req, '✉️ Reply sent');
            return res.redirect('/admin/messages');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error replying message');
            return res.redirect('/admin/messages');
        }
    },

    deleteMessage: async (req, res) => {
        try {
            requireAdmin(req);
            await Message.adminDelete?.(req.params.id) || Message.delete?.(req.params.id, req.session.user.id);
            await AuditLog.create(req.session.user.id, `Admin deleted message ${req.params.id}`);
            ok(req, '🗑️ Message deleted');
            return res.redirect('/admin/messages');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error deleting message');
            return res.redirect('/admin/messages');
        }
    },

    // ==========================
    // FILES (مدیریت فایل‌های بارگذاری‌شده)
    // ==========================
    getFiles: async (req, res) => {
        try {
            requireAdmin(req);
            const { page = 1, limit = 50 } = req.query;
            const all = await FileModel.findAll?.(10000, 0) || [];
            const pager = paginateArray(all, { page, limit });
            return asJSONorRender(req, res, 'admin/files', { files: pager.rows, pager });
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error fetching files');
            return res.redirect('/dashboard');
        }
    },

    deleteFile: async (req, res) => {
        try {
            requireAdmin(req);
            await FileModel.delete(req.params.id);
            await AuditLog.create(req.session.user.id, `Deleted file ${req.params.id}`);
            ok(req, '🗑️ File deleted');
            return res.redirect('/admin/files');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error deleting file');
            return res.redirect('/admin/files');
        }
    },

    // ==========================
    // SERVICES (لیست سرویس‌های قابل درخواست)
    // ==========================
    getServices: async (req, res) => {
        try {
            requireAdmin(req);
            const { q, page = 1, limit = 20 } = req.query;
            const all = await Service.findAll?.();
            let list = all || [];
            if (q) {
                const ql = q.toLowerCase();
                list = list.filter((s) => [s.name, s.code].filter(Boolean).some((x) => String(x).toLowerCase().includes(ql)));
            }
            const pager = paginateArray(list, { page, limit });
            return asJSONorRender(req, res, 'admin/services', { services: pager.rows, pager, filters: pick(req.query, ['q']) });
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error fetching services');
            return res.redirect('/dashboard');
        }
    },

    createService: async (req, res) => {
        try {
            requireAdmin(req);
            const s = await Service.create?.(req.body);
            await AuditLog.create(req.session.user.id, `Created service ${s?.id}`);
            ok(req, '🧩 Service created');
            return res.redirect('/admin/services');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error creating service');
            return res.redirect('/admin/services');
        }
    },

    updateService: async (req, res) => {
        try {
            requireAdmin(req);
            await Service.update?.(req.params.id, req.body);
            await AuditLog.create(req.session.user.id, `Updated service ${req.params.id}`);
            ok(req, '✅ Service updated');
            return res.redirect('/admin/services');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error updating service');
            return res.redirect('/admin/services');
        }
    },

    deleteService: async (req, res) => {
        try {
            requireAdmin(req);
            await Service.delete?.(req.params.id);
            await AuditLog.create(req.session.user.id, `Deleted service ${req.params.id}`);
            ok(req, '🗑️ Service deleted');
            return res.redirect('/admin/services');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error deleting service');
            return res.redirect('/admin/services');
        }
    },

    // ==========================
    // SETTINGS (تنظیمات سامانه)
    // ==========================
    getSettings: async (req, res) => {
        try {
            requireAdmin(req);
            const settings = await Settings.getAll?.();
            return asJSONorRender(req, res, 'admin/settings', { settings });
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error fetching settings');
            return res.redirect('/dashboard');
        }
    },

    updateSettings: async (req, res) => {
        try {
            requireAdmin(req);
            await Settings.updateMany?.(req.body);
            await AuditLog.create(req.session.user.id, `Updated settings`);
            ok(req, '⚙️ Settings updated');
            return res.redirect('/admin/settings');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error updating settings');
            return res.redirect('/admin/settings');
        }
    },

    // ==========================
    // REPORTS (گزارش‌ها)
    // ==========================
    reportsOverview: async (req, res) => {
        try {
            requireAdmin(req);
            const [orderStats, userCount, unreadNotifs] = await Promise.all([
                Order.getStats?.(),
                User.countAll?.(),
                Notification.countUnread?.(req.session.user.id),
            ]);
            return asJSONorRender(req, res, 'admin/reports', {
                orderStats: orderStats || [],
                userCount: userCount || 0,
                unreadNotifs: unreadNotifs || 0,
            });
        } catch (err) {
            console.error(err);
            bad(req, '❌ Error building reports');
            return res.redirect('/dashboard');
        }
    },

    exportReport: async (req, res) => {
        try {
            requireAdmin(req);
            const { type = 'orders' } = req.query;
            let rows = [];
            if (type === 'orders') {
                const orders = await Order.findAll();
                rows = orders.map((o) => pick(o, ['id', 'title', 'status', 'priority', 'created_at']));
            } else if (type === 'users') {
                const users = await User.findAll();
                rows = users.map((u) => pick(u, ['id', 'name', 'email', 'role', 'is_active', 'created_at']));
            } else {
                rows = [];
            }
            if (req.query.format === 'json') {
                res.header('Content-Type', 'application/json');
                return res.send(rows);
            }
            const parser = new Parser();
            const csv = parser.parse(rows);
            res.header('Content-Type', 'text/csv');
            res.attachment(`${type}.csv`);
            return res.send(csv);
        } catch (err) {
            console.error(err);
            bad(req, '❌ Export report failed');
            return res.redirect('/admin/reports');
        }
    },

    // ==========================
    // AI (دستیار ادمین)
    // ==========================
    aiAssist: async (req, res) => {
        try {
            requireAdmin(req);
            const { prompt, mode = 'summary' } = req.body;
            const result = await AI.run?.({ prompt, mode });
            await AuditLog.create(req.session.user.id, `AI assist (${mode})`);
            return asJSONorRender(req, res, 'admin/ai', { result, prompt, mode });
        } catch (err) {
            console.error(err);
            bad(req, '❌ AI assist failed');
            return res.redirect('/admin/ai');
        }
    },

    // ==========================
    // BACKUP (پشتیبان‌گیری/بازیابی)
    // ==========================
    backupNow: async (req, res) => {
        try {
            requireAdmin(req);
            const file = await Backup.create?.(); // returns backup file path/name
            await AuditLog.create(req.session.user.id, `Created backup ${file}`);
            ok(req, '💾 Backup created');
            return asJSONorRender(req, res, 'admin/backup', { lastBackup: file });
        } catch (err) {
            console.error(err);
            bad(req, '❌ Backup failed');
            return res.redirect('/admin/backup');
        }
    },

    restoreBackup: async (req, res) => {
        try {
            requireAdmin(req);
            await Backup.restore?.(req.body.file);
            await AuditLog.create(req.session.user.id, `Restored backup ${req.body.file}`);
            ok(req, '♻️ Backup restored');
            return res.redirect('/admin/backup');
        } catch (err) {
            console.error(err);
            bad(req, '❌ Restore failed');
            return res.redirect('/admin/backup');
        }
    },
};

module.exports = adminController;
