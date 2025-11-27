// routes/bot.routes.js
// Routes riêng cho Bot API

const express = require('express');
const router = express.Router();
const maintenanceController = require('../controllers/maintenance.controller');
const vehicleController = require('../controllers/vehicle.controller');
const regulationController = require('../controllers/regulation.controller');
const tenantController = require('../controllers/tenant.controller');
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
 * GET /api/bot/maintenance/:id
 * Lấy thông tin maintenance request
 */
router.get('/maintenance/:id',
    maintenanceController.getMaintenanceRequestByBot
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
 * DELETE /api/bot/vehicle-registration/:id
 * Xóa vehicle registration thay mặt tenant
 */
router.delete('/vehicle-registration/:id',
    validateBotVehicleDelete,
    vehicleController.deleteVehicleRegistrationByBot
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
 * GET /api/bot/vehicle-registration/:id
 * Lấy thông tin vehicle registration
 */
router.get('/vehicle-registration/:id',
    vehicleController.getVehicleRegistrationByBot
);

/**
 * GET /api/bot/vehicle-registrations
 * Lấy danh sách vehicle registrations của tenant
 */
router.get('/vehicle-registrations',
    vehicleController.getVehicleRegistrationsByBot
);

/**
 * GET /api/bot/vehicles
 * Lấy danh sách vehicles của tenant
 */
router.get('/vehicles',
    vehicleController.getVehiclesByBot
);

/**
 * GET /api/bot/vehicle/:id
 * Lấy thông tin chi tiết vehicle
 */
router.get('/vehicle/:id',
    vehicleController.getVehicleByBot
);

/**
 * GET /api/bot/vehicle-stats
 * Lấy thống kê vehicle registration của tenant
 */
router.get('/vehicle-stats',
    vehicleController.getVehicleStatsByBot
);

/**
 * GET /api/bot/regulation/:id
 * Lấy thông tin chi tiết regulation
 */
router.get('/regulation/:id',
    regulationController.getRegulationByBot
);

/**
 * GET /api/bot/regulations
 * Lấy danh sách regulations (có filter)
 */
router.get('/regulations',
    regulationController.getRegulationsByBot
);

/**
 * GET /api/bot/regulations/building/:buildingId
 * Lấy regulations theo building
 */
router.get('/regulations/building/:buildingId',
    regulationController.getRegulationsByBuildingForBot
);


/**
 * POST /api/bot/regulation/:id/feedback
 * Thêm feedback cho regulation thay mặt tenant
 */
router.post('/regulation/:id/feedback',
    validateBotRegulationFeedback,
    regulationController.addRegulationFeedbackByBot
);

/**
 * GET /api/bot/regulation/:id/feedbacks
 * Lấy danh sách feedbacks của regulation
 */
router.get('/regulation/:id/feedbacks',
    regulationController.getRegulationFeedbacksByBot
);

/**
 * GET /api/bot/regulation/versions/:title
 * Lấy tất cả versions của regulation theo title
 */
router.get('/regulation/versions/:title',
    regulationController.getRegulationVersionsByBot
);

/**
 * GET /api/bot/context
 * Lấy ngữ cảnh tenant cho Chatbot
 */
router.get('/context', 
    tenantController.getTenantContextByBot
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