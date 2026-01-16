// routes/bot.routes.js
// Routes riêng cho Bot API

const express = require('express');
const router = express.Router();
const maintenanceController = require('../controllers/maintenance.controller');
const vehicleController = require('../controllers/vehicle.controller');
const regulationController = require('../controllers/regulation.controller');
const tenantController = require('../controllers/tenant.controller');
const paymentController = require('../controllers/payment.controller');
const contractController = require('../controllers/contract.controller');
const { validateBotApiKey, botRateLimit } = require('../middlewares/bot.middleware');
const {
    validateBotMaintenanceRequest,
    validateBotMaintenanceUpdate,
    validateBotMaintenanceDelete,
    validateBotVehicleRegistration,
    validateBotVehicleUpdate,
    validateBotVehicleDelete,
    validateBotVehicleCancel,
    validateBotRegulationFeedback
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
 * POST /api/bot/vehicle-registration/create
 * Tạo vehicle registration request mới thay mặt tenant
 */
router.post('/vehicle-registration/create',
    validateBotVehicleRegistration,
    vehicleController.createVehicleRegistrationByBot
);

/**
 * PUT /api/bot/vehicle-registration/:id
 * Cập nhật vehicle registration thay mặt tenant
 */
router.put('/vehicle-registration/:id',
    validateBotVehicleUpdate,
    vehicleController.updateVehicleRegistrationByBot
);

/**
 * POST /api/bot/vehicle-registration/:id/cancel
 * Cancel vehicle registration thay mặt tenant
 */
router.post('/vehicle-registration/:id/cancel',
    validateBotVehicleCancel,
    vehicleController.cancelVehicleRegistrationByBot
);

/**
 * REGULATION ROUTES
 * GET /api/bot/regulations?tenant_user_id=123
 */
router.get('/regulations',
    regulationController.getRegulationsByBot
);

/**
 * GET /api/bot/context
 * Lấy ngữ cảnh tenant cho Chatbot
 */
router.get('/context', 
    tenantController.getTenantContextByBot
);

/**
 * POST /api/bot/create-payment
 * Bot tạo link thanh toán PayOS
 */
router.post('/create-payment', 
    paymentController.createPayOSLinkByBot
);

/**
 * POST /api/bot/contract/download
 * Contract Download for Bot
 */
router.post('/contract/download', 
    contractController.getMyContractFileForBot
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