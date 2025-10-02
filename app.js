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
const uploadRoutes = require("./routes/uploadRoutes");
const dashboardRoutes = require('./routes/dashboard');

// Middlewares
const { apiLimiter, authLimiter, uploadLimiter, adminLimiter } = require('./middlewares/rateLimiter');

// Backup utility
const Backup = require('./utils/Backup');

// ===========================
// App & Server
// ===========================
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ===========================
// View engine
// ===========================
app.set('view engine', 'ejs');
// مسیر درست فولدر view
app.set('views', path.join(__dirname, 'view'));

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
// Rate limiting
// ===========================
app.use('/api', apiLimiter);
app.use(['/login'], authLimiter);
app.use('/upload', uploadLimiter);
app.use('/admin', adminLimiter);

// ===========================
// Routes
// ===========================
// ترتیب روت‌ها مهمه
app.use('/', indexRouter);
app.use('/', authRouter);
app.use('/', dashboardRoutes);
app.use('/orderRoutes', orderRouter);
app.use('/assignments', assignmentRoutes);
app.use('/requests', requestsRouter);
app.use('/notifications', notificationRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api', backupRoutes);
app.use('/api/payments', paymentRoutes);
app.use("/api", uploadRoutes);

// ===========================
// Socket.IO
// ===========================
io.on('connection', (socket) => {
    console.log('✅ User connected to socket');
    socket.on('disconnect', () => {
        console.log('❌ User disconnected');
    });
});
app.set('io', io);

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
