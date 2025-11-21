// routes/bot.routes.js
// Routes riêng cho Bot API

const express = require('express');
const router = express.Router();
const maintenanceController = require('../controllers/maintenance.controller');
const vehicleController = require('../controllers/vehicle.controller');
const { validateBotApiKey, botRateLimit } = require('../middlewares/bot.middleware');
const {
    validateBotMaintenanceRequest,
    validateBotMaintenanceUpdate,
    validateBotMaintenanceDelete,
    validateBotVehicleRegistration,
    validateBotVehicleUpdate,
    validateBotVehicleDelete,
    validateBotVehicleCancel
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