require('dotenv').config();

module.exports = {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    baseUrl: process.env.BASE_URL || '/',

    jwt: {
        accessSecret: process.env.JWT_ACCESS_SECRET,
        refreshSecret: process.env.JWT_REFRESH_SECRET,
        accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
        refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
    },
    email: {
        gmailUser: process.env.GMAIL_USER,
        gmailAppPassword: process.env.GMAIL_APP_PASSWORD,
        fromName: process.env.EMAIL_FROM_NAME
    },
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        db: process.env.REDIS_DB || 0
    },
    s3: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION || 'ap-southeast-1',
        bucketName: process.env.AWS_S3_BUCKET_NAME
    },
    googleCloud: {
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
    },
    documentai: {
        location: process.env.DOCUMENTAI_LOCATION || 'us',
        processorId: process.env.DOCUMENTAI_PROCESSOR_ID,
        apiEndpoint: `${process.env.DOCUMENTAI_LOCATION || 'us'}-documentai.googleapis.com`
    },
    frontend: {
        url: process.env.FRONTEND_URL || 'http://localhost:3001'
    },

    rateLimit: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
    },

    tokens: {
        passwordResetExpires: parseInt(process.env.PASSWORD_RESET_EXPIRES) || 1,
        emailVerificationExpires: parseInt(process.env.EMAIL_VERIFICATION_EXPIRES) || 24,
    },
    gemini: {
        apiKey: process.env.GEMINI_API_KEY,
        modelName: process.env.GEMINI_MODEL || 'gemini-1.5-flash'
    },
    cors: {
        origins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3001']
    }
};