// Updated: 2025-24-10
// by: MinhBH

const PaymentService = require('../services/payment.service');

class PaymentController {

    /**
     * Create a new payment and get redirect URL.
     */
    async createPayment(req, res, next) {
        try {
            const { billIds } = req.body;
            const tenantUserId = req.user.user_id;
            const ipAddr = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

            const result = await PaymentService.createPaymentUrl(tenantUserId, billIds, ipAddr); 
            
            res.status(200).json({
                success: true,
                message: 'Payment URL created successfully',
                data: result,
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Handle VNPay Return (for user's browser).
     */
    async handleVnpayReturn(req, res, next) {
        const vnpParams = req.query;
        const vnp_ResponseCode = vnpParams['vnp_ResponseCode'];
        const vnp_TxnRef = vnpParams['vnp_TxnRef'];

        if (vnp_ResponseCode === '00') {
            console.log(`[PaymentReturn] Success for Order: ${vnp_TxnRef}`);
            res.status(200).json({
                success: true,
                message: 'Payment return received (Success). Check console.',
                orderId: vnp_TxnRef
            });
        } else {
            console.log(`[PaymentReturn] Failed for Order: ${vnp_TxnRef}. (Code: ${vnp_ResponseCode})`);
            res.status(200).json({
                success: false,
                message: 'Payment return received (Failed). Check console.',
                orderId: vnp_TxnRef,
                code: vnp_ResponseCode
            });
        }
    }

    /**
     * Handle VNPay IPN (for VNPay's server).
     */
    async handleVnpayIpn(req, res, next) {
        try {
            const vnpParams = req.query;
            // Call the imported singleton directly (no 'this')
            const result = await PaymentService.handleVnpayIpn(vnpParams); 
            
            res.status(200).json(result);
        } catch (err) {
            res.status(200).json({ RspCode: '99', Message: 'Unknown error' });
        }
    }
}

module.exports = new PaymentController();
