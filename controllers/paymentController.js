const Payment = require('../models/Payment');
const Notification = require('../models/Notification');

const paymentController = {
    // ================================
    // نمایش داشبورد پرداخت (EJS)
    // ================================
    getPaymentDashboard: (req, res) => {
        try {
            res.render('payments'); // 👈 نام فایل EJS شما
        } catch (err) {
            console.error("❌ Error rendering payments page:", err);
            res.status(500).send("خطا در بارگذاری صفحه پرداخت");
        }
    },

    // ================================
    // ایجاد پرداخت جدید
    // ================================
    createPayment: async (req, res) => {
        try {
            const { userId, amount, method, description } = req.body;
            if (!userId || !amount || !method) {
                return res.status(400).json({ error: "userId، amount و method الزامی هستند" });
            }

            const payment = await Payment.create(userId, { amount, method, description });

            await Notification.create(userId, `پرداخت جدید به مبلغ ${amount} با روش ${method} ثبت شد`, {
                type: "payment",
                priority: "normal"
            });

            const io = req.app.get('io');
            if (io) io.emit('paymentCreated', { payment });

            return res.status(201).json(payment);
        } catch (err) {
            console.error("❌ Error creating payment:", err);
            return res.status(500).json({ error: "خطا در ایجاد پرداخت" });
        }
    },

    // ================================
    // دریافت پرداخت با id
    // ================================
    getPaymentById: async (req, res) => {
        try {
            const { id } = req.params;
            const payment = await Payment.findById(id);
            if (!payment) return res.status(404).json({ error: "پرداخت پیدا نشد" });

            return res.json(payment);
        } catch (err) {
            console.error("❌ Error fetching payment:", err);
            return res.status(500).json({ error: "خطا در دریافت پرداخت" });
        }
    },

    // ================================
    // دریافت همه پرداخت‌های یک کاربر
    // ================================
    getUserPayments: async (req, res) => {
        try {
            const { userId } = req.params;
            const { limit, offset, status, method } = req.query;

            const payments = await Payment.findByUser(userId, {
                limit: parseInt(limit) || 20,
                offset: parseInt(offset) || 0,
                status,
                method
            });

            return res.json(payments);
        } catch (err) {
            console.error("❌ Error fetching user payments:", err);
            return res.status(500).json({ error: "خطا در دریافت لیست پرداخت‌ها" });
        }
    },

    // ================================
    // آپدیت وضعیت پرداخت
    // ================================
    updatePaymentStatus: async (req, res) => {
        try {
            const { id } = req.params;
            const { status, details } = req.body;
            if (!status) return res.status(400).json({ error: "وضعیت الزامی است" });

            const updatedPayment = await Payment.updateStatus(id, status, details);
            if (!updatedPayment) return res.status(404).json({ error: "پرداخت پیدا نشد" });

            await Notification.create(updatedPayment.userId, `وضعیت پرداخت شما به "${status}" تغییر کرد`, {
                type: "payment",
                priority: status === "failed" ? "high" : "normal"
            });

            const io = req.app.get('io');
            if (io) io.emit('paymentStatusUpdated', { payment: updatedPayment });

            return res.json(updatedPayment);
        } catch (err) {
            console.error("❌ Error updating payment:", err);
            return res.status(500).json({ error: "خطا در بروزرسانی وضعیت پرداخت" });
        }
    },

    // ================================
    // شمارش پرداخت‌های کاربر
    // ================================
    countUserPayments: async (req, res) => {
        try {
            const { userId } = req.params;
            const { status, method } = req.query;

            const count = await Payment.count(userId, { status, method });
            return res.json({ totalPayments: count });
        } catch (err) {
            console.error("❌ Error counting payments:", err);
            return res.status(500).json({ error: "خطا در شمارش پرداخت‌ها" });
        }
    },

    // ================================
    // دریافت تاریخچه تغییرات پرداخت
    // ================================
    getPaymentHistory: async (req, res) => {
        try {
            const { id } = req.params;
            const history = await Payment.getHistory(id);
            return res.json(history);
        } catch (err) {
            console.error("❌ Error fetching payment history:", err);
            return res.status(500).json({ error: "خطا در دریافت تاریخچه پرداخت" });
        }
    },

    // ================================
    // حذف نرم (غیرفعال کردن پرداخت)
    // ================================
    softDeletePayment: async (req, res) => {
        try {
            const { id } = req.params;
            const deleted = await Payment.softDelete(id);
            if (!deleted) return res.status(404).json({ error: "پرداخت پیدا نشد" });

            await Notification.create(deleted.userId, "پرداخت شما غیر فعال شد", {
                type: "payment",
                priority: "low"
            });

            const io = req.app.get('io');
            if (io) io.emit('paymentSoftDeleted', { payment: deleted });

            return res.json({ message: "پرداخت غیر فعال شد", deleted });
        } catch (err) {
            console.error("❌ Error soft deleting payment:", err);
            return res.status(500).json({ error: "خطا در غیر فعال کردن پرداخت" });
        }
    },

    // ================================
    // حذف کامل پرداخت
    // ================================
    deletePayment: async (req, res) => {
        try {
            const { id } = req.params;
            const deleted = await Payment.delete(id);

            if (deleted && deleted.userId) {
                await Notification.create(deleted.userId, "پرداخت شما به طور کامل حذف شد", {
                    type: "payment",
                    priority: "low"
                });
            }

            const io = req.app.get('io');
            if (io) io.emit('paymentDeleted', { paymentId: id });

            return res.json({ message: "پرداخت حذف شد" });
        } catch (err) {
            console.error("❌ Error deleting payment:", err);
            return res.status(500).json({ error: "خطا در حذف پرداخت" });
        }
    },

    // ================================
    // علامت‌گذاری پرداخت به عنوان پرداخت‌شده
    // ================================
    markAsPaid: async (req, res) => {
        try {
            const { id } = req.params;
            const payment = await Payment.markAsPaid(id);
            if (!payment) return res.status(404).json({ error: "پرداخت پیدا نشد" });

            await Notification.create(payment.userId, "پرداخت شما پرداخت شد ✅", {
                type: "payment",
                priority: "normal"
            });

            const io = req.app.get('io');
            if (io) io.emit('paymentMarkedAsPaid', { payment });

            return res.json(payment);
        } catch (err) {
            console.error("❌ Error marking payment as paid:", err);
            return res.status(500).json({ error: "خطا در بروزرسانی پرداخت" });
        }
    }
};

module.exports = paymentController;
