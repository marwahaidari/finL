// app.js
const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const path = require('path');
const session = require('express-session');
const flash = require('connect-flash');
const http = require('http');
const { Server } = require('socket.io');

// Load env
dotenv.config();

// Database pool
const pool = require('./db');

// Routers (may throw if paths are wrong)
const authRouter = require('./routes/auth');
const indexRouter = require('./routes/index');
const orderRouter = require('./routes/orderRoutes');
const assignmentRoutes = require('./routes/assignmentRoutes');
// const notificationRoutes = require('./routes/notificationRoutes');
const requestsRouter = require('./routes/request');
const paymentRoutes = require('./routes/paymentRoutes');
const settingsRoutes = require('./routes/settings');
const backupRoutes = require('./routes/backupRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const dashboardRoutes = require('./routes/dashboard');

// Middlewares
const { apiLimiter, authLimiter, uploadLimiter, adminLimiter } = require('./middlewares/rateLimiter');

// Backup utility
const Backup = require('./utils/Backup');

// ===========================
// Helper to safely mount routers/middlewares
// ===========================
function isMiddleware(fn) {
    return typeof fn === 'function'
        || (fn && (typeof fn.use === 'function' || typeof fn.handle === 'function' || Array.isArray(fn)));
}

function mount(name, pathOrRouter, maybeRouter) {
    // mount(name, path, router) OR mount(name, router) for root mount
    let mountPath = null;
    let router = null;

    if (maybeRouter === undefined) {
        // mount(name, router)
        router = pathOrRouter;
        mountPath = typeof name === 'string' ? name : '/';
    } else {
        mountPath = pathOrRouter;
        router = maybeRouter;
    }

    if (!isMiddleware(router)) {
        console.error(`❌ Cannot mount ${mountPath} — "${name}" is not a valid middleware/router. Value:`, router);
        return;
    }
    app.use(mountPath, router);
    console.log(`✅ Mounted ${mountPath}`);
}

// ===========================
// App & Server
// ===========================
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// expose io to routes if needed
app.set('io', io);

// ===========================
// View engine
// ===========================
app.set('view engine', 'ejs');
// If your views folder is named "views" use 'views'. You had 'view' originally — update if necessary.
app.set('views', path.join(__dirname, 'view')); // change 'view' -> 'views' if your folder is named views

// ===========================
// Body parser
// ===========================
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());

// ===========================
// Static files
// ===========================
app.use(express.static(path.join(__dirname, 'public')));

// ===========================
// Session & Flash
// ===========================
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret-key',
    resave: false,
    saveUninitialized: true,
}));

app.use(flash());

// Make flash messages available in all views
app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    next();
});

// ===========================
// Rate limiting (validate middlewares)
// ===========================
if (isMiddleware(apiLimiter)) {
    app.use('/api', apiLimiter);
} else {
    console.warn('⚠️  apiLimiter is not a valid middleware — skipping mount. Value:', apiLimiter);
}
if (isMiddleware(authLimiter)) {
    app.use(['/login'], authLimiter);
} else {
    console.warn('⚠️  authLimiter is not a valid middleware — skipping mount. Value:', authLimiter);
}
if (isMiddleware(uploadLimiter)) {
    app.use('/upload', uploadLimiter);
} else {
    console.warn('⚠️  uploadLimiter is not a valid middleware — skipping mount. Value:', uploadLimiter);
}
if (isMiddleware(adminLimiter)) {
    app.use('/admin', adminLimiter);
} else {
    console.warn('⚠️  adminLimiter is not a valid middleware — skipping mount. Value:', adminLimiter);
}

// ===========================
// Routes (safe mounting)
// ===========================
// Order matters as you noted. mount() will log an error instead of crashing.
mount('/', indexRouter);
mount('/', authRouter);
mount('/', dashboardRoutes);
mount('/orderRoutes', orderRouter);
mount('/assignments', assignmentRoutes);
mount('/requests', requestsRouter);
// mount('/notifications', notificationRoutes);
mount('/api/settings', settingsRoutes);
mount('/api', backupRoutes);
mount('/api/payments', paymentRoutes);
mount('/api', uploadRoutes);

// ===========================
// Socket.IO events
// ===========================
io.on('connection', (socket) => {
    console.log('✅ User connected to socket');
    socket.on('disconnect', () => {
        console.log('❌ User disconnected');
    });
});

// ===========================
// Initial backup + scheduled backup
// ===========================
async function initBackup() {
    try {
        console.log('🔹 Running initial backup...');
        await Backup.backupDatabase(null, { encrypt: true, s3: true });
        await Backup.scheduledBackup();
        console.log('✅ Backup initialized and scheduled.');
    } catch (err) {
        console.error('❌ Initial backup error:', err);
    }
}
initBackup();

// ===========================
// Start server
// ===========================
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
