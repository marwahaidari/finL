const pool = require('../db');
const { validationResult } = require('express-validator');
const path = require('path');
const fs = require('fs');

// فرض بر این که middleware ای توی express داری که user رو تو req.user میذاره
// و user شامل id و role هست

class AssignmentController {
    // ثبت درخواست جدید (کاربر عادی)
    static async createRequest(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            if (req.headers.accept.includes('json')) {
                return res.status(400).json({ success: false, errors: errors.array() });
            } else {
                return res.render('assignments/create', { errors: errors.array(), oldInput: req.body });
            }
        }

        const userId = req.user.id;
        const { service_id, description } = req.body;
        let filePath = null;

        if (req.file) {
            filePath = '/uploads/assignments/' + req.file.filename;
        }

        try {
            const result = await pool.query(
                `INSERT INTO assignments 
                (user_id, service_id, description, attachment, status, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, 'Pending', NOW(), NOW()) RETURNING *`,
                [userId, service_id, description, filePath]
            );

            if (req.headers.accept.includes('json')) {
                res.status(201).json({ success: true, request: result.rows[0] });
            } else {
                res.redirect('/assignments/my');
            }
        } catch (err) {
            console.error('Error creating request:', err);
            if (req.headers.accept.includes('json')) {
                res.status(500).json({ success: false, message: 'خطا در ثبت درخواست' });
            } else {
                res.render('assignments/create', { errors: [{ msg: 'خطا در ثبت درخواست' }], oldInput: req.body });
            }
        }
    }

    // گرفتن همه درخواست‌ها (ادمین/افسر)
    static async getAllRequests(req, res) {
        if (!['admin', 'officer'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'دسترسی غیرمجاز' });
        }

        const { status, user_id, service_id, page = 1, limit = 10, search } = req.query;
        const offset = (page - 1) * limit;

        let baseQuery = `
            SELECT a.*, u.full_name AS citizen_name, s.name AS service_name
            FROM assignments a
            JOIN users u ON a.user_id = u.id
            JOIN services s ON a.service_id = s.id
            WHERE 1=1
        `;
        let params = [];
        let idx = 1;

        if (status) { baseQuery += ` AND a.status=$${idx++}`; params.push(status); }
        if (user_id) { baseQuery += ` AND a.user_id=$${idx++}`; params.push(user_id); }
        if (service_id) { baseQuery += ` AND a.service_id=$${idx++}`; params.push(service_id); }
        if (search) { baseQuery += ` AND (u.full_name ILIKE $${idx} OR s.name ILIKE $${idx})`; params.push(`%${search}%`); idx++; }

        baseQuery += ` ORDER BY a.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
        params.push(limit, offset);

        try {
            const result = await pool.query(baseQuery, params);
            if (req.headers.accept.includes('json')) {
                res.json({ success: true, requests: result.rows });
            } else {
                res.render('assignments/list', { requests: result.rows, query: req.query });
            }
        } catch (err) {
            console.error('Error fetching all requests:', err);
            if (req.headers.accept.includes('json')) {
                res.status(500).json({ success: false, message: 'خطا در دریافت درخواست‌ها' });
            } else {
                res.render('assignments/list', { requests: [], query: req.query, errors: [{ msg: 'خطا در دریافت درخواست‌ها' }] });
            }
        }
    }

    // گرفتن یک درخواست با ID
    static async getRequestById(req, res) {
        const { id } = req.params;

        try {
            const result = await pool.query(
                `SELECT a.*, u.full_name AS citizen_name, s.name AS service_name
                 FROM assignments a
                 JOIN users u ON a.user_id = u.id
                 JOIN services s ON a.service_id = s.id
                 WHERE a.id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                if (req.headers.accept.includes('json')) return res.status(404).json({ success: false, message: 'درخواست یافت نشد' });
                return res.render('assignments/detail', { request: null, errors: [{ msg: 'درخواست یافت نشد' }] });
            }

            const request = result.rows[0];
            if (req.user.role === 'citizen' && req.user.id !== request.user_id) {
                if (req.headers.accept.includes('json')) return res.status(403).json({ success: false, message: 'دسترسی غیرمجاز' });
                return res.render('assignments/detail', { request: null, errors: [{ msg: 'دسترسی غیرمجاز' }] });
            }

            if (req.headers.accept.includes('json')) res.json({ success: true, request });
            else res.render('assignments/detail', { request });
        } catch (err) {
            console.error('Error fetching request by ID:', err);
            if (req.headers.accept.includes('json')) res.status(500).json({ success: false, message: 'خطا در دریافت درخواست' });
            else res.render('assignments/detail', { request: null, errors: [{ msg: 'خطا در دریافت درخواست' }] });
        }
    }

    // بروزرسانی وضعیت درخواست
    static async updateRequestStatus(req, res) {
        if (!['admin', 'officer'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'دسترسی غیرمجاز' });
        }

        const { id } = req.params;
        const { status, reviewed_by } = req.body;
        const allowedStatuses = ['Pending', 'Approved', 'Rejected', 'In Progress', 'Completed'];
        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: 'وضعیت نامعتبر است' });
        }

        try {
            const result = await pool.query(
                `UPDATE assignments SET status=$1, reviewed_by=$2, updated_at=NOW()
                 WHERE id=$3 RETURNING *`,
                [status, reviewed_by || req.user.id, id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'درخواست یافت نشد' });
            }

            if (req.headers.accept.includes('json')) res.json({ success: true, updated: result.rows[0] });
            else res.redirect(`/assignments/${id}`);
        } catch (err) {
            console.error('Error updating request status:', err);
            if (req.headers.accept.includes('json')) res.status(500).json({ success: false, message: 'خطا در بروزرسانی وضعیت' });
            else res.redirect(`/assignments/${id}`);
        }
    }

    // گرفتن درخواست‌های یک کاربر
    static async getCitizenRequests(req, res) {
        const userId = req.params.userId;
        if (req.user.role === 'citizen' && req.user.id != userId) {
            return res.status(403).json({ success: false, message: 'دسترسی غیرمجاز' });
        }

        try {
            const result = await pool.query(
                `SELECT a.*, s.name AS service_name
                 FROM assignments a
                 JOIN services s ON a.service_id = s.id
                 WHERE a.user_id=$1
                 ORDER BY a.created_at DESC`,
                [userId]
            );

            if (req.headers.accept.includes('json')) res.json({ success: true, requests: result.rows });
            else res.render('assignments/my', { requests: result.rows });
        } catch (err) {
            console.error('Error fetching citizen requests:', err);
            if (req.headers.accept.includes('json')) res.status(500).json({ success: false, message: 'خطا در دریافت درخواست‌ها' });
            else res.render('assignments/my', { requests: [], errors: [{ msg: 'خطا در دریافت درخواست‌ها' }] });
        }
    }

    // حذف درخواست
    static async deleteRequest(req, res) {
        const { id } = req.params;

        try {
            const check = await pool.query(`SELECT * FROM assignments WHERE id=$1`, [id]);
            if (check.rows.length === 0) {
                if (req.headers.accept.includes('json')) return res.status(404).json({ success: false, message: 'درخواست یافت نشد' });
                return res.redirect('/assignments/my');
            }

            const request = check.rows[0];
            if (req.user.role === 'citizen' && req.user.id !== request.user_id) {
                if (req.headers.accept.includes('json')) return res.status(403).json({ success: false, message: 'دسترسی غیرمجاز' });
                return res.redirect('/assignments/my');
            }

            const result = await pool.query(`DELETE FROM assignments WHERE id=$1 RETURNING *`, [id]);

            if (req.headers.accept.includes('json')) res.json({ success: true, message: 'درخواست حذف شد' });
            else res.redirect('/assignments/my');
        } catch (err) {
            console.error('Error deleting request:', err);
            if (req.headers.accept.includes('json')) res.status(500).json({ success: false, message: 'خطا در حذف درخواست' });
            else res.redirect('/assignments/my');
        }
    }
}

module.exports = AssignmentController;
