// Updated: 2025-16-10
// by: DatNB

const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const {
    validate,
    changeToTenantSchema,
    changeToManagerSchema
} = require('../middlewares/validation.middleware');

// Protected routes - require authentication
router.use(authenticate);

// Admin and Manager can change user roles
router.post(
    '/change-to-tenant',
    requireRole(['owner', 'manager']),
    validate(changeToTenantSchema),
    userController.changeToTenant
);

router.post(
    '/change-to-manager',
    requireRole(['owner']),
    validate(changeToManagerSchema),
    userController.changeToManager
);



module.exports = router;