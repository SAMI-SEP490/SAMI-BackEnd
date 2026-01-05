// Updated: 2026-01-05
// by: MinhBH

const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const { validate, createPaymentSchema } = require('../middlewares/validation.middleware');

// --- TENANT ROUTES ---

// 1. Get History
router.get(
    '/history',
    authenticate,
    requireRole(['tenant']),
    paymentController.getTenantPaymentHistory
);

// 2. Create PayOS Link
router.post(
    '/create-payos',
    authenticate,
    requireRole(['tenant']),
    validate(createPaymentSchema),
    paymentController.createPayOS
);

// --- PUBLIC CALLBACKS (No Auth) ---

router.post('/payos-webhook', paymentController.handlePayOSWebhook);
router.get('/success', paymentController.renderSuccessPage);
router.get('/cancel', paymentController.renderCancelPage);

// --- MANAGER/OWNER ROUTES ---

router.use(authenticate);
router.use(requireRole(['owner', 'manager']));

// 1. Manual Cash Payment
router.post(
    '/cash', 
    paymentController.createCashPayment
);

// 2. Reporting
router.get('/list-all', paymentController.getAllPaymentHistory);
router.get('/revenue/yearly', paymentController.getYearlyRevenueReport);
router.get('/revenue/monthly', paymentController.getMonthlyRevenueDetails);
router.get('/revenue/export', paymentController.exportRevenue);

module.exports = router;
