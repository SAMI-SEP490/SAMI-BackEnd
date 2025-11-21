// routes/bot.routes.js
// Routes riêng cho Bot API

const express = require('express');
const router = express.Router();
const maintenanceController = require('../controllers/maintenance.controller');
const { validateBotApiKey, botRateLimit } = require('../middlewares/bot.middleware');
const {
    validateBotMaintenanceRequest,
    validateBotMaintenanceUpdate,
    validateBotMaintenanceDelete
} = require('../middlewares/bot.validation');

// Tất cả routes đều yêu cầu bot authentication
router.use(validateBotApiKey);
router.use(botRateLimit);

/**
 * POST /api/bot/maintenance/create
 * Tạo maintenance request mới thay mặt tenant
 */
router.post('/maintenance/create',
    validateBotMaintenanceRequest,
    maintenanceController.createMaintenanceRequestByBot
);

/**
 * PUT /api/bot/maintenance/:id
 * Cập nhật maintenance request thay mặt tenant
 */
router.put('/maintenance/:id',
    validateBotMaintenanceUpdate,
    maintenanceController.updateMaintenanceRequestByBot
);

/**
 * DELETE /api/bot/maintenance/:id
 * Xóa maintenance request thay mặt tenant
 */
router.delete('/maintenance/:id',
    validateBotMaintenanceDelete,
    maintenanceController.deleteMaintenanceRequestByBot
);

/**
 * GET /api/bot/maintenance/:id
 * Lấy thông tin maintenance request
 */
router.get('/maintenance/:id',
    maintenanceController.getMaintenanceRequestByBot
);

/**
 * GET /api/bot/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
    res.json({
        success: true,
        message: 'Bot API is healthy',
        bot: req.bot,
        timestamp: new Date().toISOString()
    });
});

module.exports = router;