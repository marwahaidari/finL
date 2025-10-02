// db/reviews.js
// Reviews DB Layer: citizens can rate services/officers, admins can moderate.
// Future-proof: reply, report, like/dislike, pagination, search, stats.

const { query, transaction } = require("./index");

const Review = {
    // create review
    create: async ({ userId, serviceId = null, officerId = null, rating, content }) => {
        if (!serviceId && !officerId) {
            throw new Error("Review must be linked to a service or officer");
        }
        const res = await query(
            `INSERT INTO reviews (user_id, service_id, officer_id, rating, content, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
            [userId, serviceId, officerId, rating, content]
        );
        return res.rows[0];
    },

    // update review content or rating (only by author)
    update: async (reviewId, userId, { rating = null, content = null }) => {
        const updates = [];
        const params = [];
        let idx = 1;

        if (rating !== null) {
            updates.push(`rating = $${idx++}`);
            params.push(rating);
        }
        if (content !== null) {
            updates.push(`content = $${idx++}`);
            params.push(content);
        }

        if (!updates.length) return null;
        params.push(reviewId, userId);

        const res = await query(
            `UPDATE reviews SET ${updates.join(", ")}, updated_at = NOW()
       WHERE id = $${idx++} AND user_id = $${idx}
       RETURNING *`,
            params
        );
        return res.rows[0];
    },

    // soft delete review (author or admin)
    delete: async (reviewId, userId, isAdmin = false) => {
        if (isAdmin) {
            await query(`UPDATE reviews SET is_deleted = TRUE WHERE id = $1`, [reviewId]);
        } else {
            await query(`UPDATE reviews SET is_deleted = TRUE WHERE id = $1 AND user_id = $2`, [
                reviewId,
                userId,
            ]);
        }
        return true;
    },

    // reply to review (admin/officer response)
    reply: async ({ reviewId, responderId, responderRole, content }) => {
        const res = await query(
            `INSERT INTO review_replies (review_id, responder_id, responder_role, content, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
            [reviewId, responderId, responderRole, content]
        );
        return res.rows[0];
    },

    // like/dislike a review
    react: async ({ reviewId, userId, reaction }) => {
        if (!["like", "dislike"].includes(reaction)) throw new Error("Invalid reaction");
        const res = await query(
            `INSERT INTO review_reactions (review_id, user_id, reaction, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (review_id, user_id) DO UPDATE SET reaction = EXCLUDED.reaction, updated_at = NOW()
       RETURNING *`,
            [reviewId, userId, reaction]
        );
        return res.rows[0];
    },

    // report a review (for abuse/inappropriate content)
    report: async ({ reviewId, reporterId, reason }) => {
        const res = await query(
            `INSERT INTO review_reports (review_id, reporter_id, reason, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING *`,
            [reviewId, reporterId, reason]
        );
        return res.rows[0];
    },

    // list reviews for a service/officer
    list: async ({ serviceId = null, officerId = null, limit = 20, offset = 0 }) => {
        let sql = `SELECT r.*, u.name AS user_name
               FROM reviews r
               LEFT JOIN users u ON u.id = r.user_id
               WHERE r.is_deleted = FALSE`;
        const params = [];
        let idx = 1;

        if (serviceId) {
            sql += ` AND r.service_id = $${idx++}`;
            params.push(serviceId);
        }
        if (officerId) {
            sql += ` AND r.officer_id = $${idx++}`;
            params.push(officerId);
        }

        sql += ` ORDER BY r.created_at DESC LIMIT $${idx++} OFFSET $${idx}`;
        params.push(limit, offset);

        const res = await query(sql, params);
        return res.rows;
    },

    // get review details + replies + reactions
    getFullReview: async (reviewId) => {
        const reviewRes = await query(
            `SELECT r.*, u.name AS user_name
       FROM reviews r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.id = $1`,
            [reviewId]
        );
        const review = reviewRes.rows[0];
        if (!review) return null;

        const repliesRes = await query(
            `SELECT rr.*, u.name AS responder_name
       FROM review_replies rr
       LEFT JOIN users u ON u.id = rr.responder_id
       WHERE rr.review_id = $1
       ORDER BY rr.created_at ASC`,
            [reviewId]
        );

        const reactionsRes = await query(
            `SELECT reaction, COUNT(*) AS count
       FROM review_reactions
       WHERE review_id = $1
       GROUP BY reaction`,
            [reviewId]
        );

        return {
            ...review,
            replies: repliesRes.rows,
            reactions: reactionsRes.rows.reduce((acc, r) => {
                acc[r.reaction] = parseInt(r.count);
                return acc;
            }, {}),
        };
    },

    // calculate average rating for service/officer
    averageRating: async ({ serviceId = null, officerId = null }) => {
        let sql = `SELECT AVG(rating)::numeric(10,2) AS avg_rating, COUNT(*) AS total
               FROM reviews WHERE is_deleted = FALSE`;
        const params = [];
        let idx = 1;

        if (serviceId) {
            sql += ` AND service_id = $${idx++}`;
            params.push(serviceId);
        }
        if (officerId) {
            sql += ` AND officer_id = $${idx++}`;
            params.push(officerId);
        }

        const res = await query(sql, params);
        return res.rows[0];
    },

    // admin moderation: list reports
    listReports: async (limit = 50, offset = 0) => {
        const res = await query(
            `SELECT rr.*, r.content AS review_content, u.name AS reporter_name
       FROM review_reports rr
       LEFT JOIN reviews r ON r.id = rr.review_id
       LEFT JOIN users u ON u.id = rr.reporter_id
       ORDER BY rr.created_at DESC
       LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
        return res.rows;
    },
};

module.exports = Review;
