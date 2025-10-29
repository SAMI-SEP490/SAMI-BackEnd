// Updated: 2025-28-10
// by: MinhBH

const express = require('express');
const router = express.Router();
const scriptsController = require('../controllers/script.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');

// Protect all routes in this file
router.use(authenticate);
router.use(requireRole(['owner', 'manager']));

// Define POST routes (as these actions modify data)
router.post('/penalties', scriptsController.runPenalties);
router.post('/renew-bills', scriptsController.runRenewals);

module.exports = router;
