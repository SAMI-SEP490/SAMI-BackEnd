// Updated: 2025-17-10
// by: DatNB & MinhBH

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

// Get all users (only for Owner and Manager)
router.get(
    '/list-users', 
    requireRole(['owner', 'manager']), 
    userController.getAllUsers);

// Get a single user by ID (Owner and Manager)
router.get(
    '/get-user/:id',
    requireRole(['owner', 'manager']),
    userController.getUserById
);

// Search all users (Owner and Manager)
router.get(
    '/search',
    requireRole(['owner', 'manager']),
    userController.searchUsersByName
);

// Soft-delete a user by ID (Owner and Manager)
router.delete(
    '/delete/:id',
    requireRole(['owner', 'manager']),
    userController.softDeleteUser
);

// Restore a user by ID (Owner only)
router.post(
    '/restore/:id',
    requireRole(['owner']),
    userController.restoreUser
);

// Get all deleted users (Owner only)
router.get(
    '/get-deleted',
    requireRole(['owner']),
    userController.getDeletedUsers
);

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