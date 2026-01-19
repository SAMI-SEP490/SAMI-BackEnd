// Updated: 2024-28-10
// by: DatNB & MinhBH


const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const redisClient = require('./config/redis');
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const contractRoutes = require('./routes/contract.routes');
const tenantRoutes = require('./routes/tenant.routes');
const guestRoutes = require('./routes/guest.routes');
const addendumRoutes = require('./routes/addendum.routes');
const paymentRoutes = require('./routes/payment.routes.js');
const billRoutes = require('./routes/bill.routes');
const buildingRoutes = require('./routes/building.routes');
const maintenanceRoutes = require('./routes/maintenance.routes');
const roomRoutes = require('./routes/room.routes');
const floorPlanRoutes = require('./routes/floor-plan.routes');
const regulationRoutes = require('./routes/regulation.routes');
const vehicleRoutes = require('./routes/vehicle.routes');
const notificationRoutes = require('./routes/notification.routes');
const botRoutes = require('./routes/bot.routes');
const chatbotRoutes = require('./routes/chatbot.routes.js');
const parkingSlotRoutes = require('./routes/parking-slot.routes.js');
const consentRoutes = require('./routes/consent.routes');
const appRoutes = require('./routes/app.routes');
const { errorHandler, notFound } = require('./middlewares/error.middleware');
const cron = require('node-cron');
const BillService = require('./services/bill.service');
const utilityRoutes = require('./routes/utility.routes');
const { getCloudWatchLogger } = require('./utils/cloudwatch-logger');
const VehicleService = require('./services/vehicle.service');
const app = express();

// Security middleware
app.use(helmet());

// CORS
app.use(cors({
    origin: config.cors.origins,
    credentials: true
}));

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression
app.use(compression());

app.set('trust proxy', 1);

// Logging
if (config.nodeEnv === 'development') {
    app.use(morgan('dev'));
} else {
    app.use(morgan('combined'));
}

// Rate limiting
const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    message: {
        success: false,
        message: 'Too many requests, please try again later'
    },
    standardHeaders: true,
    legacyHeaders: false
});

app.use('/api/', limiter);

// Initialize Redis connection
async function initializeRedis() {
    try {
        await redisClient.connect();
        console.log('Redis initialized successfully');
    } catch (error) {
        console.error('Failed to initialize Redis:', error.message);
        console.warn('⚠️  OTP functionality will not work without Redis');
        // You can choose to continue without Redis or exit
        // process.exit(1); // Uncomment to exit if Redis is critical
    }
}

// Health check
app.get('/health', async (req, res) => {
    const redisStatus = await redisClient.ping();
    res.json({
        success: true,
        message: 'Server is running',
        timestamp: new Date().toISOString(),
        services: {
            redis: redisStatus ? 'connected' : 'disconnected'
        }
    });
});

// ==========================================
// 🕒 CRON JOBS (Scheduled Tasks)
// ==========================================
cron.schedule('0 0 0 * * *', async () => {
    console.log('🧹 [CRON] Cleaning expired vehicles...');
    try {
        const deletedCount = await VehicleService.cleanupExpiredVehicles();
        console.log(`✅ [CRON] Deleted ${deletedCount} expired vehicles`);
    } catch (error) {
        console.error('❌ [CRON] Vehicle cleanup failed:', error);
    }
}, {
    scheduled: true,
    timezone: "Asia/Ho_Chi_Minh"
});
// Schedule: Runs at 00:00:00 every day
// Format: Seconds(optional) Minutes Hours DayOfMonth Month DayOfWeek
cron.schedule('0 0 0 * * *', async () => {
    console.log('🌙 [CRON] Starting daily billing tasks...');
    try {
        // 1. Scan for Overdue Bills
        const overdueCount = await BillService.scanAndMarkOverdueBills();
        if (overdueCount > 0) {
            console.log(`✅ [CRON] Marked ${overdueCount} bills as OVERDUE.`);
            // TODO: Send push notification to users here
        }

        // 2. Auto-Create Monthly Bills (Rent + Utility)
        const created = await BillService.autoCreateMonthlyBills();
        if (created.rent_created > 0 || created.utility_created > 0) {
            console.log(`✨ [CRON] Created ${created.rent_created} Rent Bills and ${created.utility_created} Utility Batches.`);
            // TODO: Send "New Bill" notification to users here
        } else {
            console.log('💤 [CRON] No new bills created today.');
        }

    } catch (error) {
        console.error('❌ [CRON] Error during daily billing tasks:', error);
    }
}, {
    scheduled: true,
    timezone: "Asia/Ho_Chi_Minh" // Critical: Runs at VN Midnight
});

// Overdue Reminder - Run every day at 17:30 (5:30 PM)
// Format: Minute Hour Day Month DayOfWeek
cron.schedule('30 17 * * *', async () => {
    try {
        console.log('🔔 Running Bill Reminder Scan...');
        const result = await BillService.scanAndSendReminders();
        console.log(`🔔 Reminders sent: ${result.sent}/${result.found}`);
    } catch (e) {
        console.error('Error in Bill Reminder Cron:', e);
    }
}, {
    scheduled: true,
    timezone: "Asia/Ho_Chi_Minh" // Critical: Runs at VN Midnight
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/contract', contractRoutes);
app.use('/api/tenant', tenantRoutes);
app.use('/api/guest', guestRoutes);
app.use('/api/addendum', addendumRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/bill', billRoutes);
app.use('/api/building', buildingRoutes);
app.use('/api/room', roomRoutes);
app.use('/api/floor-plan', floorPlanRoutes);
app.use('/api/regulation', regulationRoutes);
app.use('/api/vehicle', vehicleRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/bot', botRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/parking-slots', parkingSlotRoutes);
app.use('/api/utility', utilityRoutes);
app.use('/api/consent', consentRoutes);
app.use('/api/app', appRoutes);

// 404 handler
app.use(notFound);

// Error handler
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully...');
    await redisClient.disconnect();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, shutting down gracefully...');
    await redisClient.disconnect();
    process.exit(0);
});

// Start server
const PORT = config.port;

async function startServer() {
    try {
        // Initialize Redis first
        await initializeRedis();

        const cloudWatch = getCloudWatchLogger();
        await cloudWatch.initialize();
        console.log('✅ CloudWatch Logger initialized');

        // Start Express server
        app.listen(PORT, () => {
            console.log(`Server running in ${config.nodeEnv} mode on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    console.error('Unhandled Promise Rejection:', err);
    process.exit(1);
});

module.exports = app;