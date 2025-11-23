// Updated: 2025-28-10
// by: MinhBH

const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const { validate, createPaymentSchema } = require('../middlewares/validation.middleware');

// --- Create Payment (Tenant) ---
router.post(
    '/create',
    authenticate,
    requireRole(['tenant']),
    validate(createPaymentSchema),
    paymentController.createPayment
);

// --- VNPay Callbacks (Public) ---
router.get(
    '/vnpay_return',
    paymentController.handleVnpayReturn
);

router.get(
    '/vnpay_ipn',
    paymentController.handleVnpayIpn
);

router.get(
    '/history',
    authenticate,
    requireRole(['tenant']),
    paymentController.getTenantPaymentHistory
);

router.get(
    '/list-all',
    authenticate,
    requireRole(['owner', 'manager']),
    paymentController.getAllPaymentHistory
);

router.get(
    '/revenue/yearly',
    authenticate,
    requireRole(['owner', 'manager']),
    paymentController.getYearlyRevenueReport
);

router.get(
    '/revenue/monthly',
    authenticate,
    requireRole(['owner', 'manager']),
    paymentController.getMonthlyRevenueDetails
);

router.get(
    '/revenue/export',
    authenticate,
    requireRole(['owner', 'manager']),
    paymentController.exportRevenue
);

// Create PayOS (Tenant)
router.post(
    '/create-payos',
    authenticate,
    requireRole(['tenant']),
    validate(createPaymentSchema),
    paymentController.createPayOS
);

// PayOS Webhook (Public)
router.post('/payos-webhook', paymentController.handlePayOSWebhook);

// Return Pages (Public)
router.get('/success', paymentController.renderSuccessPage);
router.get('/cancel', paymentController.renderCancelPage);

module.exports = router;
