// Updated: 2025-11-06
// by: DatNB

const express = require('express');
const router = express.Router();
const vehicleController = require('../controllers/vehicle.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const {
    registerVehicleSchema,
    updateVehicleSchema,
    validate
} = require('../middlewares/vehicle.middleware');

// All routes require authentication
router.use(authenticate);

// Tenant routes
router.post(
    '/',
    requireRole(['TENANT']),
    validate(registerVehicleSchema),
    vehicleController.registerVehicle
);

router.put(
    '/:id',
    requireRole(['TENANT']),
    validate(updateVehicleSchema),
    vehicleController.updateVehicle
);

router.delete(
    '/:id',
    requireRole(['TENANT']),
    vehicleController.deleteVehicle
);

// Manager/Owner routes
router.post(
    '/:id/approve',
    requireRole(['MANAGER', 'OWNER']),
    vehicleController.approveVehicle
);

router.post(
    '/:id/reject',
    requireRole(['MANAGER', 'OWNER']),
    vehicleController.rejectVehicle
);

router.post(
    '/:id/deactivate',
    requireRole(['MANAGER', 'OWNER']),
    vehicleController.deactivateVehicle
);

// Shared routes (all authenticated users)
router.get('/', vehicleController.getVehicles);
router.get('/stats', vehicleController.getVehicleStats);
router.get('/:id', vehicleController.getVehicleById);

module.exports = router;