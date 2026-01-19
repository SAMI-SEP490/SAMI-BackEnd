require('dotenv').config();
const path = require('path');

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
    cloudWatch: {
        region: process.env.AWS_REGION || 'ap-southeast-1',
        logGroupName: process.env.CLOUDWATCH_LOG_GROUP || '/rental-management/consent-logs',
        logStreamPrefix: process.env.CLOUDWATCH_LOG_STREAM_PREFIX || 'consent'
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
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    },

    tokens: {
        passwordResetExpires: parseInt(process.env.PASSWORD_RESET_EXPIRES) || 1,
        emailVerificationExpires: parseInt(process.env.EMAIL_VERIFICATION_EXPIRES) || 24,
    },
    gemini: {
        apiKey: process.env.GEMINI_API_KEY,
        modelName: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
    },
    dify: {
        apiKey: process.env.DIFY_API_KEY,
        apiUrl: process.env.DIFY_API_URL
    },
    payos: {
        clientId: process.env.PAYOS_CLIENT_ID,
        apiKey: process.env.PAYOS_API_KEY,
        checksumKey: process.env.PAYOS_CHECKSUM_KEY,
        returnUrl: process.env.PAYOS_RETURN_URL,
        cancelUrl: process.env.PAYOS_CANCEL_URL
    },
    firebase: {
        // Resolves to root_folder/firebase-adminsdk.json by default
        serviceAccountPath: path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_PATH
            || 'firebase-adminsdk.json')
    },
    cors: {
        origins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3001']
    },
    app: {
        backendUrl: process.env.BACKEND_URL || 'http://localhost:3000',
        deepLinkScheme: process.env.DEEP_LINK_SCHEME || 'sami://'
    }
};