// Updated: 2024-14-10
// by: DatNB


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
const { errorHandler, notFound } = require('./middlewares/error.middleware');

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