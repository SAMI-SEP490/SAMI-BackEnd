// middlewares/bot.middleware.js
// Middleware xác thực API key cho bot

const crypto = require('crypto');

/**
 * Validate Bot API Key
 * Kiểm tra API key trong header request
 */
const validateBotApiKey = (req, res, next) => {
    try {
        const apiKey = req.headers['x-bot-api-key'];

        // Kiểm tra API key có tồn tại
        if (!apiKey) {
            return res.status(401).json({
                success: false,
                message: 'Bot API key is required',
                error: 'Missing X-Bot-API-Key header'
            });
        }

        // Kiểm tra API key hợp lệ
        const validApiKey = process.env.BOT_API_KEY;

        if (!validApiKey) {
            console.error('BOT_API_KEY not configured in environment');
            return res.status(500).json({
                success: false,
                message: 'Bot service not configured'
            });
        }

        // So sánh API key an toàn (tránh timing attack)
        const isValid = crypto.timingSafeEqual(
            Buffer.from(apiKey),
            Buffer.from(validApiKey)
        );

        if (!isValid) {
            return res.status(401).json({
                success: false,
                message: 'Invalid bot API key'
            });
        }

        // Attach bot identity vào request
        req.bot = {
            type: 'service_bot',
            name: 'Maintenance Bot',
            permissions: ['create_maintenance_on_behalf'],
            authenticated_at: new Date()
        };

        // Log bot activity (optional)
        console.log(`[BOT] Authenticated request from bot at ${new Date().toISOString()}`);

        next();
    } catch (error) {
        console.error('Bot authentication error:', error);
        return res.status(500).json({
            success: false,
            message: 'Bot authentication failed',
            error: error.message
        });
    }
};

/**
 * Rate limiting cho bot (tùy chọn)
 * Giới hạn số request từ bot trong khoảng thời gian
 */
const botRateLimit = (() => {
    const requestCounts = new Map();
    const WINDOW_MS = 60000; // 1 phút
    const MAX_REQUESTS = 100; // 100 requests/phút

    return (req, res, next) => {
        const now = Date.now();
        const windowStart = now - WINDOW_MS;

        // Lấy lịch sử request
        let requests = requestCounts.get('bot') || [];

        // Lọc request trong window time
        requests = requests.filter(timestamp => timestamp > windowStart);

        // Kiểm tra vượt giới hạn
        if (requests.length >= MAX_REQUESTS) {
            return res.status(429).json({
                success: false,
                message: 'Too many requests from bot',
                retry_after: Math.ceil((requests[0] + WINDOW_MS - now) / 1000)
            });
        }

        // Thêm request mới
        requests.push(now);
        requestCounts.set('bot', requests);

        next();
    };
})();

module.exports = {
    validateBotApiKey,
    botRateLimit
};