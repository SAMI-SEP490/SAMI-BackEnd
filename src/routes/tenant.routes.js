// Updated: 2025-17-10
// by: MinhBH

const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/tenant.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');

// Protected routes - require authentication
router.use(authenticate);

// Search only tenants (Owner and Manager)
router.get(
    '/search',
    requireRole(['owner', 'manager']),
    tenantController.searchTenantsByName
);

module.exports = router;
