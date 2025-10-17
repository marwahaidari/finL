const { Pool } = require("pg");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

dotenv.config();
console.log("DB_USER:", process.env.DB_USER);
console.log("DB_PASSWORD:", process.env.DB_PASSWORD);

// ================================
// 📌 Pool Configuration
// ================================
const pool = new Pool({
    user: process.env.DB_USER,                         // Database username
    password: process.env.DB_PASSWORD,                 // Database password
    host: process.env.DB_HOST || "localhost",          // Database host
    port: parseInt(process.env.DB_PORT) || 5432,       // Database port
    database: process.env.DB_NAME || "egovdb",         // Database name
    ssl:
        process.env.NODE_ENV === "production"
            ? { rejectUnauthorized: false }
            : false,
    max: parseInt(process.env.DB_MAX_POOL) || 20,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
    connectionTimeoutMillis: parseInt(process.env.DB_CONN_TIMEOUT) || 5000, // ⬅️ افزایش Timeout
});

// ================================
// 📌 Query Metrics & Logging
// ================================
const metrics = {
    totalQueries: 0,
    slowQueries: 0,
    lastQueryTimeMs: 0,
    logSlowQueryThreshold: 500 // ms
};

async function query(text, params = []) {
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;

        metrics.totalQueries++;
        metrics.lastQueryTimeMs = duration;
        if (duration > metrics.logSlowQueryThreshold) metrics.slowQueries++;

        console.log(
            `[DB QUERY] ${text} | Params: ${JSON.stringify(
                params
            )} | Duration: ${duration}ms`
        );

        // Save slow queries
        if (duration > metrics.logSlowQueryThreshold) {
            const logPath = path.join(__dirname, "slow_queries.log");
            fs.appendFileSync(
                logPath,
                `[${new Date().toISOString()}] ${text} | Duration: ${duration}ms | Params: ${JSON.stringify(
                    params
                )}\n`
            );
        }

        return res;
    } catch (err) {
        console.error(`[DB ERROR] ${text} | Params: ${JSON.stringify(params)}`);
        console.error(err.stack);
        throw err;
    }
}

// ================================
// 📌 Transaction Helper
// ================================
async function transaction(callback) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await callback(client);
        await client.query("COMMIT");
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("[DB TRANSACTION ERROR]", err.stack);
        throw err;
    } finally {
        client.release();
    }
}

// ================================
// 📌 Health Check & Auto Reconnect
// ================================
async function testConnection(retries = 5, delayMs = 2000) {
    for (let i = 1; i <= retries; i++) {
        try {
            const client = await pool.connect();
            console.log(`✅ PostgreSQL connected successfully (try ${i})`);
            client.release();
            return;
        } catch (err) {
            console.error(`❌ DB connection attempt ${i} failed`, err.message);

            // افزایش فاصله بین تلاش‌ها به تدریج
            if (i < retries) {
                const wait = delayMs * i;
                console.log(`⏳ Retrying in ${wait}ms...`);
                await new Promise((r) => setTimeout(r, wait));
            } else {
                console.error("💥 Could not connect to DB after retries. Exiting...");
                process.exit(1);
            }
        }
    }
}

// ================================
// 📌 Graceful Shutdown
// ================================
function shutdown() {
    console.log("🔌 Shutting down DB pool...");
    pool.end(() => {
        console.log("✅ DB pool closed");
        process.exit(0);
    });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("uncaughtException", (err) => {
    console.error("💥 Uncaught Exception:", err);
    shutdown();
});
process.on("unhandledRejection", (reason) => {
    console.error("💥 Unhandled Rejection:", reason);
    shutdown();
});

// Run health check
testConnection();

// ================================
// 📌 Optional: Metrics API (future-ready)
// ================================
function getMetrics() {
    return { ...metrics };
}

// ================================
// 📌 Export
// ================================
module.exports = { pool, query, transaction, getMetrics };
