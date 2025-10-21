// Updated: 2025-18-10
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
    '/bills',
    requireRole(['tenant']),
    tenantController.getAllTenantBills
);

router.get(
    '/bills-unpaid',
    requireRole(['tenant']),
    tenantController.getAllUnpaidTenantBills
);

module.exports = router;
