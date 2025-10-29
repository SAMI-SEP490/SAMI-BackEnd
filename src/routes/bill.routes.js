// Updated: 2025-28-10
// by: MinhBH

const express = require('express');
const router = express.Router();
const billController = require('../controllers/bill.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const { validate, billSchema, updateBillSchema } = require('../middlewares/validation.middleware');

// All bill management routes require owner or manager role
router.use(authenticate);
router.use(requireRole(['owner', 'manager']));

// --- LISTING ---
router.get('/all', billController.getAllBills);
router.get('/draft', billController.getDraftBills);
router.get('/master', billController.getMasterBills);
router.get('/deleted', billController.getDeletedBills);
router.get('/detail/:id', billController.getBillById);                     // View Detail

// --- ACTIONS ---
router.post('/create', validate(billSchema), billController.createBill); // Create Draft or Master
router.put('/edit/:id', validate(updateBillSchema), billController.updateBill); // Edit Draft or Master
router.delete('/delete/:id', billController.deleteOrCancelBill);           // Soft Delete Draft/Master, Cancel Issued/Overdue
router.post('/restore/:id', billController.restoreBill);                 // Restore soft-deleted draft/master bill
router.post('/clone-to-master/:id', billController.cloneDraftToMaster); // Clone Draft to Master

module.exports = router;
