// Updated: 2025-23-11
// by: MinhBH

const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/tenant.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');

// Protected routes - require authentication
router.use(authenticate);

// Get all tenants (Owner and Manager)
router.get(
    '/all',
    requireRole(['owner', 'manager']),
    tenantController.getAllTenants
);

// Search only tenants (Owner and Manager)
router.get(
    '/search',
    requireRole(['owner', 'manager']),
    tenantController.searchTenantsByName
);
router.get(
    '/room/:roomId',
    requireRole(['owner', 'manager']),
    tenantController.getTenantsByRoomId
);
router.get(
    '/moor/:roomId',
    requireRole(['owner', 'manager']),
    tenantController.getTenantsByRoomId2
);
router.get(
    '/analytics/occupancy',
    requireRole(['owner', 'manager']),
    tenantController.getOccupancyAnalytics
);

router.get(
    '/analytics/gender',
    requireRole(['owner', 'manager']),
    tenantController.getTenantGenderDistribution
);

router.get(
    '/analytics/age',
    requireRole(['owner', 'manager']),
    tenantController.getTenantAgeDistribution
);

router.get(
    '/analytics/expiring',
    requireRole(['owner', 'manager']),
    tenantController.getExpiringContracts
);

router.get(
    '/ai-context',
    requireRole(['tenant']),
    tenantController.getTenantChatbotContext
);
router.post('/search',
    requireRole(['owner', 'manager']),
    tenantController.searchTenant);

// GET /api/tenants/lookup?q=0905123456
router.get(
    '/lookup',
    requireRole(['owner', 'manager']),
    tenantController.lookupTenant
);

module.exports = router;
