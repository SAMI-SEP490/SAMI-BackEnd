// Updated: 2025-07-11
// by: MinhBH

const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const { validate, sendNotificationSchema, registerDeviceSchema, sendBroadcastSchema } = require('../middlewares/validation.middleware');

// --- Routes for ALL authenticated users (Tenant, Manager, Owner) ---
router.use(authenticate);

// Get my notification inbox
router.get('/', notificationController.getMyNotifications);

// Register my device token
router.post(
    '/register-device',
    validate(registerDeviceSchema),
    notificationController.registerDevice
);

// Unregister my device token
router.post('/unregister-device', notificationController.unregisterDevice);

// Mark a notification as read
router.post('/:id/read', notificationController.markAsRead);

// --- Routes for Manager/Owner only ---

// Send a new notification
router.post(
    '/send',
    requireRole(['owner', 'manager']),
    validate(sendNotificationSchema),
    notificationController.sendNotification
);

// Send a broadcast to all tenants
router.post(
    '/broadcast',
    requireRole(['owner', 'manager']),
    validate(sendBroadcastSchema),
    notificationController.sendBroadcast
);

// Send a broadcast to a specific building
router.post(
    '/broadcast/building/:id', // <-- :id is the buildingId
    requireRole(['owner', 'manager']),
    validate(sendBroadcastSchema),
    notificationController.sendBuildingBroadcast
);

// Get list of sent notifications (Outbox)
router.get(
    '/sent',
    requireRole(['owner', 'manager']),
    notificationController.getSentNotifications
);

module.exports = router;
