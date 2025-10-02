const Message = require('../models/Message');
const Notification = require('../models/Notification');
const fs = require('fs');
const path = require('path');
const { Parser } = require('json2csv');
const FileType = require('file-type');

const ALLOWED_FILE_TYPES = [
    'image/png',
    'image/jpeg',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const lastMessageTime = new Map();

const messageController = {
    // ================================
    // 📌 لیست پیام‌ها با search و filter پیشرفته
    getMessages: async (req, res) => {
        try {
            const { orderId } = req.params;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;
            const offset = (page - 1) * limit;
            const { search, sender, pinned } = req.query;

            const messages = await Message.search(orderId, {
                limit,
                offset,
                search,
                sender,
                pinned: pinned === 'true' ? true : pinned === 'false' ? false : undefined
            });

            const totalMessages = await Message.countSearch(orderId, { search, sender, pinned });
            const totalPages = Math.ceil(totalMessages / limit);

            if (req.headers.accept?.includes('application/json')) {
                return res.json({ messages, page, totalPages, totalMessages });
            }

            res.render('messages', { messages, orderId, page, totalPages, search, sender, pinned });
        } catch (err) {
            console.error(err);
            res.status(500).send('Error fetching messages');
        }
    },

    // ================================
    // 📌 ارسال پیام + چند فایل ضمیمه + ریپلای
    sendMessage: async (req, res) => {
        try {
            const { orderId } = req.params;
            const { message, replyTo } = req.body;
            const senderId = req.session.user.id;

            // Rate limiting ساده
            const now = Date.now();
            if (lastMessageTime.has(senderId) && (now - lastMessageTime.get(senderId) < 3000)) {
                if (req.files) req.files.forEach(f => fs.unlinkSync(f.path));
                req.flash('error_msg', 'Please wait before sending another message');
                return res.redirect(`/orders/${orderId}/messages`);
            }

            if (!message?.trim() && (!req.files || req.files.length === 0)) {
                if (req.files) req.files.forEach(f => fs.unlinkSync(f.path));
                req.flash('error_msg', 'Message cannot be empty');
                return res.redirect(`/orders/${orderId}/messages`);
            }

            let attachments = [];
            if (req.files && req.files.length > 0) {
                for (let file of req.files) {
                    const buffer = fs.readFileSync(file.path);
                    const fileType = await FileType.fromBuffer(buffer);

                    if (!fileType || !ALLOWED_FILE_TYPES.includes(fileType.mime) || file.size > MAX_FILE_SIZE) {
                        fs.unlinkSync(file.path);
                        req.flash('error_msg', 'Invalid file type or file too large');
                        return res.redirect(`/orders/${orderId}/messages`);
                    }

                    const uploadDir = path.join(__dirname, '..', 'uploads', 'messages', new Date().toISOString().slice(0, 10));
                    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
                    const newFilePath = path.join(uploadDir, file.filename);
                    fs.renameSync(file.path, newFilePath);

                    attachments.push({
                        filename: file.originalname,
                        filepath: newFilePath,
                        mimetype: fileType.mime,
                        size: file.size
                    });
                }
            }

            const newMessage = await Message.create({
                orderId,
                senderId,
                message: message || '',
                replyTo: replyTo || null,
                attachments
            });

            lastMessageTime.set(senderId, now);

            // Notification
            const orderUsers = await Message.findUsersByOrder(orderId);
            for (let u of orderUsers) {
                if (u.id !== senderId) {
                    await Notification.create(u.id, `New message in order #${orderId}`, 'info');
                }
            }

            // Realtime
            const io = req.app.get('io');
            io.emit('newMessage', { orderId, message: newMessage });

            req.flash('success_msg', 'Message sent');
            res.redirect(`/orders/${orderId}/messages`);
        } catch (err) {
            console.error(err);
            if (req.files) req.files.forEach(f => fs.existsSync(f.path) && fs.unlinkSync(f.path));
            req.flash('error_msg', 'Error sending message');
            res.redirect(`/orders/${req.params.orderId}/messages`);
        }
    },

    // ================================
    // 📌 ویرایش پیام + ثبت تاریخچه ویرایش
    editMessage: async (req, res) => {
        try {
            const msg = await Message.findById(req.params.id);
            if (!msg) {
                req.flash('error_msg', 'Message not found');
                return res.redirect('back');
            }

            if (req.session.user.role !== 'admin' && msg.sender_id !== req.session.user.id) {
                req.flash('error_msg', 'Unauthorized');
                return res.redirect('back');
            }

            const { newText } = req.body;
            if (!newText?.trim()) {
                req.flash('error_msg', 'Message cannot be empty');
                return res.redirect('back');
            }

            await Message.update(req.params.id, { message: newText, edited_at: new Date() });
            await Message.addHistory(req.params.id, msg.message, req.session.user.id);

            const io = req.app.get('io');
            io.emit('editMessage', { id: req.params.id, newText });

            req.flash('success_msg', 'Message updated');
            res.redirect('back');
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error editing message');
            res.redirect('back');
        }
    },

    // ================================
    // 📌 حذف پیام + حذف فایل‌ها
    deleteMessage: async (req, res) => {
        try {
            const msg = await Message.findById(req.params.id);
            if (!msg) {
                req.flash('error_msg', 'Message not found');
                return res.redirect('back');
            }

            if (req.session.user.role !== 'admin' && msg.sender_id !== req.session.user.id) {
                req.flash('error_msg', 'Unauthorized');
                return res.redirect('back');
            }

            if (msg.attachments && msg.attachments.length > 0) {
                msg.attachments.forEach(a => fs.existsSync(a.filepath) && fs.unlinkSync(a.filepath));
            }

            await Message.delete(req.params.id);

            const io = req.app.get('io');
            io.emit('deleteMessage', { id: req.params.id });

            req.flash('success_msg', 'Message deleted');
            res.redirect('back');
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error deleting message');
            res.redirect('back');
        }
    },

    // ================================
    // 📌 پین / آن‌پین پیام (ادمین)
    togglePin: async (req, res) => {
        try {
            if (req.session.user.role !== 'admin') {
                req.flash('error_msg', 'Only admin can pin messages');
                return res.redirect('back');
            }

            const msg = await Message.findById(req.params.id);
            if (!msg) {
                req.flash('error_msg', 'Message not found');
                return res.redirect('back');
            }

            await Message.update(req.params.id, { is_pinned: !msg.is_pinned });

            const io = req.app.get('io');
            io.emit('pinMessage', { id: req.params.id, pinned: !msg.is_pinned });

            req.flash('success_msg', `Message ${msg.is_pinned ? 'unpinned' : 'pinned'} successfully`);
            res.redirect('back');
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error pinning message');
            res.redirect('back');
        }
    },

    // ================================
    // 📌 مارک به عنوان خوانده‌شده
    markAsRead: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.session.user.id;

            await Message.markAsRead(id, userId);

            const io = req.app.get('io');
            io.emit('readMessage', { id, userId });

            req.flash('success_msg', 'Message marked as read');
            res.redirect('back');
        } catch (err) {
            console.error(err);
            req.flash('error_msg', 'Error marking as read');
            res.redirect('back');
        }
    },

    // ================================
    // 📌 Reaction به پیام
    reactMessage: async (req, res) => {
        try {
            const { id } = req.params;
            const { emoji } = req.body;
            const userId = req.session.user.id;

            await Message.addReaction(id, userId, emoji);

            const io = req.app.get('io');
            io.emit('reactMessage', { id, userId, emoji });

            res.json({ success: true });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Error reacting to message' });
        }
    },

    // ================================
    // 📌 Export پیام‌ها (ادمین)
    exportMessages: async (req, res) => {
        try {
            if (req.session.user.role !== 'admin') {
                return res.status(403).send('Unauthorized');
            }

            const { orderId } = req.params;
            const messages = await Message.findByOrder(orderId);

            const parser = new Parser({ fields: ['id', 'message', 'sender_id', 'created_at'] });
            const csv = parser.parse(messages);

            res.header('Content-Type', 'text/csv');
            res.attachment(`messages_order_${orderId}.csv`);
            return res.send(csv);
        } catch (err) {
            console.error(err);
            res.status(500).send('Error exporting messages');
        }
    }
};

module.exports = messageController;
