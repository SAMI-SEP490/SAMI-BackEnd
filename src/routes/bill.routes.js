// Updated: 2025-23-11
// by: MinhBH

const express = require('express');
const router = express.Router();
const billController = require('../controllers/bill.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const { 
    validate, 
    createDraftBillSchema, 
    createIssuedBillSchema, 
    updateDraftBillSchema,
    updateIssuedBillSchema 
} = require('../middlewares/validation.middleware');

// We need authentication for everyone (Tenants AND Managers)
router.use(authenticate);

// Only Tenants can access these
router.get(
    '/list', 
    requireRole(['tenant']), 
    billController.getMyBills
);

router.get(
    '/list/unpaid', 
    requireRole(['tenant']), 
    billController.getMyUnpaidBills
);

// All bill management routes require owner or manager role
router.use(requireRole(['owner', 'manager']));

// --- LISTING ---
router.get('/all', billController.getAllBills);
router.get('/draft', billController.getDraftBills);
router.get('/deleted', billController.getDeletedBills);
router.get('/detail/:id', billController.getBillById);                     // View Detail
router.get('/unbilled-rooms', billController.getUnbilledRooms);            // Get unbilled rooms

// --- ACTIONS ---
router.post('/create/draft', validate(createDraftBillSchema), billController.createDraftBill); // Create Draft Bills
router.post('/create/issue', validate(createIssuedBillSchema), billController.createIssuedBill); // Create Bills
router.put('/edit/draft/:id', validate(updateDraftBillSchema), billController.updateDraftBill); // Edit Bills
router.put('/edit/issue/:id', validate(updateIssuedBillSchema), billController.updateIssuedBill); //Edit Issued Bills
router.delete('/delete/:id', billController.deleteOrCancelBill);           // Soft Delete Draft/Master, Cancel Issued/Overdue
router.post('/restore/:id', billController.restoreBill);                 // Restore soft-deleted draft/master bill
router.post('/refresh-status', billController.refreshBillStatuses);      // Trigger Overdue Scan

module.exports = router;
