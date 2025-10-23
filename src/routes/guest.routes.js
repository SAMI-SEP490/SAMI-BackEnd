// Updated: 2025-10-24
// by: DatNB


const express = require('express');
const router = express.Router();
const guestController = require('../controllers/guest.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const {
    createGuestRegistrationSchema,
    updateGuestRegistrationSchema,
    cancelGuestRegistrationSchema,
    validate
} = require('../middlewares/guest.middleware');

// All routes require authentication
router.use(authenticate);

// Tenant routes
router.post(
    '/',
    requireRole(['TENANT']),
    validate(createGuestRegistrationSchema),
    guestController.createGuestRegistration
);

router.put(
    '/:id',
    requireRole(['TENANT']),
    validate(updateGuestRegistrationSchema),
    guestController.updateGuestRegistration
);

router.delete(
    '/:id',
    requireRole(['TENANT']),
    guestController.deleteGuestRegistration
);

// Manager/Owner routes
router.post(
    '/:id/approve',
    requireRole(['MANAGER', 'OWNER']),
    guestController.approveGuestRegistration
);

router.post(
    '/:id/reject',
    requireRole(['MANAGER', 'OWNER']),
    guestController.rejectGuestRegistration
);

// Shared routes (all authenticated users)
router.get('/', guestController.getGuestRegistrations);
router.get('/stats', guestController.getGuestRegistrationStats);
router.get('/:id', guestController.getGuestRegistrationById);

router.post(
    '/:id/cancel',
    validate(cancelGuestRegistrationSchema),
    guestController.cancelGuestRegistration
);

module.exports = router;