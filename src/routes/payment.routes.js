// /routes/payment.routes.js
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

module.exports = router;
