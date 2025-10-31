// Updated: 2024-28-10
// by: DatNB & MinhBH


const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cron = require('node-cron');
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
const scriptRoutes = require('./routes/script.routes');
const billRoutes = require('./routes/bill.routes');
const buildingRoutes = require('./routes/building.routes');
const maintenanceRoutes = require('./routes/maintenance.routes');
const { errorHandler, notFound } = require('./middlewares/error.middleware');
const { applyOverduePenalties, generateRecurringBills } = require('./scripts/dailyBillRunner');

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

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/contract', contractRoutes);
app.use('/api/tenant', tenantRoutes);
app.use('/api/guest', guestRoutes);
app.use('/api/addendum', addendumRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/script', scriptRoutes);
app.use('/api/bill', billRoutes);
app.use('/api/building', buildingRoutes);

// Schedule the Daily Task
cron.schedule('1 0 * * *', async () => {
    console.log('⏰ Running daily bill generation and penalty check...');
    try {
        // It's better if these functions handle their own Prisma client
        // or you pass one in.
        await applyOverduePenalties();
        await generateRecurringBills();
        console.log('✅ Daily tasks completed successfully.');
    } catch (error) {
        console.error('❌ Error running daily tasks:', error);
    }
}, {
    scheduled: true,
    timezone: "Asia/Ho_Chi_Minh"
});

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