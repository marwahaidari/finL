// config/db.js
/**
 * Professional PostgreSQL Database Configuration
 * -----------------------------------------------
 * این فایل اتصال به دیتابیس را مدیریت می‌کند و قابلیت استفاده در محیط‌های مختلف را دارد.
 * از Pool برای مدیریت اتصالات و بهینه‌سازی performance استفاده شده است.
 */

const { Pool } = require('pg');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

// تعریف تنظیمات دیتابیس بر اساس environment
const env = process.env.NODE_ENV || 'development';

const dbConfig = {
    development: {
        user: process.env.DB_USER || 'postgres',
        host: process.env.DB_HOST || 'localhost',
        database: process.env.DB_NAME || 'egov_development',
        password: process.env.DB_PASSWORD || 'password',
        port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 5432,
        max: 20,           // حداکثر تعداد اتصال همزمان
        idleTimeoutMillis: 30000, // 30 ثانیه قبل از آزادسازی اتصال idle
        connectionTimeoutMillis: 2000, // 2 ثانیه timeout برای اتصال
    },
    test: {
        user: process.env.DB_USER || 'postgres',
        host: process.env.DB_HOST || 'localhost',
        database: process.env.DB_NAME_TEST || 'egov_test',
        password: process.env.DB_PASSWORD || 'password',
        port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 5432,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
    },
    production: {
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 5432,
        max: 50,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    },
};

// انتخاب تنظیمات مناسب based on environment
const pool = new Pool(dbConfig[env]);

// Test connection once on startup
pool.connect()
    .then(client => {
        console.log(`✅ PostgreSQL connected successfully in "${env}" environment`);
        client.release();
    })
    .catch(err => {
        console.error('❌ PostgreSQL connection error:', err.stack);
        process.exit(1); // اگر اتصال موفق نبود، برنامه را متوقف می‌کنیم
    });

// مدیریت خطاهای عمومی pool
pool.on('error', (err, client) => {
    console.error('❌ Unexpected error on idle client', err);
    process.exit(-1);
});

module.exports = pool;

