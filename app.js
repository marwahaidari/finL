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

// Routers
const authRouter = require('./routes/auth');
const indexRouter = require('./routes/index');
const orderRouter = require('./routes/orderRoutes');
const assignmentRoutes = require('./routes/assignmentRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
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
    let mountPath = null;
    let router = null;

    if (maybeRouter === undefined) {
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
app.set('views', path.join(__dirname, 'view')); // فولدر view درست است

// ===========================
// Body parser
// ===========================
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());

// simple request logger — temporary for debugging
app.use((req, res, next) => {
    console.log('>>> HTTP', req.method, req.originalUrl, 'body=', req.body, 'cookies=', req.headers.cookie || '');
    next();
});

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

// Connect-flash بعد از session
app.use(flash());

// Make flash messages available in all views
app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    next();
});

// ===========================
// Enable 2FA Route
// ===========================
app.use('/egov', require('./routes/enable2fa'));


// Make flash messages available in all views
app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    next();
});

// ===========================
// Rate limiting
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
// Routes
// ===========================
app.use('/', indexRouter);
app.use('/', authRouter);
app.use('/', dashboardRoutes);
app.use('/orders', orderRouter);            // path اصلاح شد
app.use('/assignments', assignmentRoutes);
app.use('/requests', requestsRouter);
app.use('/notifications', notificationRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api', backupRoutes);
app.use('/api/payments', paymentRoutes);
app.use("/api", uploadRoutes);

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

// dev error handler
app.use((err, req, res, next) => {
    console.error('💥 Unhandled error:', err);
    if (!res.headersSent) {
        res.status(500).send('Internal Server Error');
    }
});

// فقط برای تست صفحه 2FA بدون Notification
app.get('/egov/2fa-test', async (req, res) => {
    try {
        // یک کاربر mock برای تست
        const user = {
            id: 1,
            username: 'testuser',
            email: 'test@example.com',
            twoFA: {} // بدون secret یا backup code
        };

        res.render('enable2fa', {
            qrDataUrl: undefined,
            secret: undefined,
            backupCodes: [],
            success_msg: '',
            error_msg: '',
            user
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('خطا در بارگذاری صفحه تست 2FA');
    }
});

// ===========================
// Start server
// ===========================
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
