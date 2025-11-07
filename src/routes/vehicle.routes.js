// Updated: 2025-11-06
// by: DatNB

const express = require('express');
const router = express.Router();
const vehicleRegistrationController = require('../controllers/vehicle.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const {
    createVehicleRegistrationSchema,
    updateVehicleRegistrationSchema,
    cancelVehicleRegistrationSchema,
    validate
} = require('../middlewares/vehicle.middleware');

// All routes require authentication
router.use(authenticate);

// Vehicle Registration Routes

// Tenant routes - Registration management
router.post(
    '/registrations',
    requireRole(['TENANT']),
    validate(createVehicleRegistrationSchema),
    vehicleRegistrationController.createVehicleRegistration
);

router.put(
    '/registrations/:id',
    requireRole(['TENANT']),
    validate(updateVehicleRegistrationSchema),
    vehicleRegistrationController.updateVehicleRegistration
);

router.delete(
    '/registrations/:id',
    requireRole(['TENANT']),
    vehicleRegistrationController.deleteVehicleRegistration
);

// Manager/Owner routes - Approval management
router.post(
    '/registrations/:id/approve',
    requireRole(['MANAGER', 'OWNER']),
    vehicleRegistrationController.approveVehicleRegistration
);

router.post(
    '/registrations/:id/reject',
    requireRole(['MANAGER', 'OWNER']),
    vehicleRegistrationController.rejectVehicleRegistration
);

// Shared routes - View registrations
router.get(
    '/registrations',
    vehicleRegistrationController.getVehicleRegistrations
);

router.get(
    '/registrations/stats',
    vehicleRegistrationController.getVehicleRegistrationStats
);

router.get(
    '/registrations/:id',
    vehicleRegistrationController.getVehicleRegistrationById
);

router.post(
    '/registrations/:id/cancel',
    validate(cancelVehicleRegistrationSchema),
    vehicleRegistrationController.cancelVehicleRegistration
);

// Vehicle Routes - View only (vehicles are created automatically on approval)

router.get(
    '/',
    vehicleRegistrationController.getVehicles
);

router.get(
    '/:id',
    vehicleRegistrationController.getVehicleById
);

module.exports = router;