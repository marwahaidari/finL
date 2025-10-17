const Request = require('../models/Request');
const Document = require('../models/Document');
const User = require('../models/user'); // فرض می‌کنیم موجوده
const Notification = require('../models/Notification'); 
const path = require('path');
const fs = require('fs');

const multer = require('multer');
const uploadDir = path.join(__dirname, '..', 'uploads', 'requests');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const name = Date.now() + '_' + file.originalname.replace(/\s+/g, '_');
        cb(null, name);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
        if (!allowed.includes(file.mimetype)) return cb(new Error('Invalid file type'));
        cb(null, true);
    }
}).single('document');

const requestController = {
    // citizen creates a new request
    async create(req, res) {
        try {
            const user = req.session.user;
            if (!user) return res.redirect('/login');

            const { service_id, department_id, title, description, fee } = req.body;
            const created = await Request.create({
                user_id: user.id,
                service_id,
                department_id,
                title,
                description,
                fee: fee || 0
            });

            // optional: create notification
            if (Notification && Notification.create) {
                Notification.create(user.id, `درخواست ${created.id} با موفقیت ثبت شد`, { type: 'info' });
            }

            res.redirect(`/requests/${created.id}`);
        } catch (err) {
            console.error('create request error', err);
            req.flash('error_msg', 'خطا در ثبت درخواست');
            res.redirect('back');
        }
    },

    // render create page (EJS)
    createPage(req, res) {
        // باید سرویس‌ها/دپارتمان‌ها رو بفرستی به ویو (از مدل Service)
        res.render('requests/create', { error: null, oldInput: {} });
    },

    // list requests: behavior depends on role
    async list(req, res) {
        try {
            const user = req.session.user;
            if (!user) return res.redirect('/login');

            // اگر admin
            if (user.role === 'admin') {
                const rows = await Request.listAll({ filter: {}, limit: 100 });
                return res.render('requests/list_admin', { requests: rows });
            }

            // اگر officer -> لیست دپارتمان خودش
            if (user.role === 'officer' || user.role === 'department_head') {
                const rows = await Request.listByDepartment(user.department_id || null, { limit: 100 });
                return res.render('requests/list_officer', { requests: rows });
            }

            // citizen -> فقط درخواست‌های خودش
            const rows = await Request.listByUser(user.id);
            res.render('requests/list_citizen', { requests: rows });
        } catch (err) {
            console.error('list requests error', err);
            req.flash('error_msg', 'خطا در دریافت درخواست‌ها');
            res.redirect('/');
        }
    },

    // request detail
    async detail(req, res) {
        try {
            const user = req.session.user;
            const id = req.params.id;
            const reqObj = await Request.findById(id);
            if (!reqObj) {
                req.flash('error_msg', 'درخواست پیدا نشد');
                return res.redirect('/requests');
            }

            // permission check
            if (user.role === 'citizen' && reqObj.user_id !== user.id) {
                req.flash('error_msg', 'دسترسی ندارید');
                return res.redirect('/requests');
            }
            if (user.role === 'officer' && reqObj.department_id !== user.department_id) {
                req.flash('error_msg', 'این درخواست مربوط به دپارتمان شما نیست');
                return res.redirect('/requests');
            }

            const docs = await Document.listByRequest(id);
            res.render('requests/detail', { request: reqObj, documents: docs });
        } catch (err) {
            console.error('request detail error', err);
            req.flash('error_msg', 'خطا در بارگذاری جزئیات');
            res.redirect('/requests');
        }
    },

    // upload a document for a request (citizen or officer)
    uploadDocument(req, res) {
        upload(req, res, async function (err) {
            if (err) {
                console.error('upload error', err);
                req.flash('error_msg', err.message || 'Error uploading file');
                return res.redirect('back');
            }
            try {
                const user = req.session.user;
                const requestId = req.params.id;
                const file = req.file;
                if (!file) {
                    req.flash('error_msg', 'فایل ارسال نشده');
                    return res.redirect('back');
                }
                const saved = await Document.create({
                    request_id: requestId,
                    filename: file.originalname,
                    filepath: '/uploads/requests/' + file.filename,
                    mimetype: file.mimetype,
                    size: file.size,
                    uploaded_by: user.id
                });

                if (Notification && Notification.create) {
                    Notification.create(saved.uploaded_by, `فایل برای درخواست ${requestId} بارگذاری شد`, { type: 'info' });
                }

                res.redirect(`/requests/${requestId}`);
            } catch (e) {
                console.error('doc save error', e);
                req.flash('error_msg', 'خطا در ذخیره فایل');
                res.redirect('back');
            }
        });
    },

    // officer approves/rejects
    async review(req, res) {
        try {
            const user = req.session.user;
            if (!user || (user.role !== 'officer' && user.role !== 'department_head' && user.role !== 'admin')) {
                req.flash('error_msg', 'دسترسی ندارید');
                return res.redirect('/login');
            }

            const id = req.params.id;
            const { action, note } = req.body; // action: 'approve' or 'reject'
            const requestObj = await Request.findById(id);
            if (!requestObj) {
                req.flash('error_msg', 'درخواست پیدا نشد');
                return res.redirect('/requests');
            }

            if (user.role === 'officer' && requestObj.department_id !== user.department_id) {
                req.flash('error_msg', 'این درخواست مربوط به دپارتمان شما نیست');
                return res.redirect('/requests');
            }

            const status = action === 'approve' ? 'approved' : 'rejected';
            const updated = await Request.updateStatus(id, status, user.id, note || null);

            // notify user
            if (Notification && Notification.create) {
                Notification.create(requestObj.user_id, `درخواست شما ${status} شد`, { type: 'status', requestId: id });
            }

            req.flash('success_msg', `درخواست ${status} شد`);
            res.redirect(`/requests/${id}`);
        } catch (err) {
            console.error('review error', err);
            req.flash('error_msg', 'خطا در بررسی درخواست');
            res.redirect('back');
        }
    }
};

module.exports = requestController;
