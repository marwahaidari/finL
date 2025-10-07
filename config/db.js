// config/db.js (or ./db.js)
const { Pool } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

const env = process.env.NODE_ENV || 'development';

const baseConfig = {
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || (env === 'development' ? 'egov_development' : 'postgres'),
  password: process.env.DB_PASSWORD || '',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
  max: parseInt(process.env.DB_MAX_POOL || '20', 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONN_TIMEOUT || '2000', 10),
};

const pool = new Pool(baseConfig);

// Test connection but DON'T crash the process — just log the error.
// This allows nodemon to continue and you can fix credentials without hard crash.
(async function testConnection() {
  try {
    const client = await pool.connect();
    client.release();
    console.log(`✅ PostgreSQL pool connected (${baseConfig.host}:${baseConfig.port}/${baseConfig.database})`);
  } catch (err) {
    console.error('❌ PostgreSQL connection test failed:', err.message || err);
    console.warn('The app will continue running; fix DB credentials or start Postgres and it will reconnect on next query.');
    // optional: you may implement retry logic here, but avoid process.exit()
  }
})();

pool.on('error', (err) => {
  console.error('❌ Unexpected idle client error on pg pool', err);
  // don't process.exit here either; log and let the app handle queries failing
});

module.exports = pool;
