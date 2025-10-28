// Updated: 2025-28-10
// by: MinhBH

const prisma = require('../config/prisma');
const { generateVnpayUrl, verifyVnpaySignature } = require('../utils/vnpay');

// Helper function to mark VNPay payment as completed
async function _markVnpayPaymentAsCompleted(paymentId, amount, transactionId) {
    return prisma.$transaction(async (tx) => {
        await tx.bill_payments.update({
            where: { payment_id: paymentId },
            data: {
                status: 'completed',
                payment_date: new Date(),
                transaction_id: transactionId, // <-- Use renamed field
                online_type: 'VNPAY',      // <-- Add payment type
            },
        });

        // Update associated bills (no change needed here)
        await tx.bills.updateMany({
            where: { payment_id: paymentId },
            data: {
                status: 'paid',
                paid_amount: amount, 
            },
        });
    });
}

// Helper function to mark any payment as failed
async function _markPaymentAsFailed(paymentId) {
    return prisma.$transaction(async (tx) => {
        // Update payment
        await tx.bill_payments.update({
            where: { payment_id: paymentId },
            data: { status: 'failed' },
        });
        
        // Reset associated bills
        await tx.bills.updateMany({
            where: { payment_id: paymentId },
            data: {
                status: 'issued',
                payment_id: null,
            },
        });
    });
}

class PaymentService {
    /**
     * Creates a payment record and generates a VNPay URL.
     */
    async createPaymentUrl(tenantUserId, billIds, ipAddr) {
        // 1. Verify and sum bills in a transaction
        const { bills, totalAmount } = await prisma.$transaction(async (tx) => {
            const bills = await tx.bills.findMany({
                where: {
                    bill_id: { in: billIds },
                    tenant_user_id: tenantUserId,
                    status: { in: ['issued', 'overdue'] },
                },
                select: {
                        bill_id: true,
                        total_amount: true,
                        penalty_amount: true,
                        tenant_user_id: true,
                        status: true,
                    }
                });

            if (bills.length === 0) {
                const error = new Error('No payable bills found.');
                error.statusCode = 404;
                throw error;
            }
            if (bills.length !== billIds.length) {
                const error = new Error('Some bills are not payable or do not belong to you.');
                error.statusCode = 403;
                throw error;
            }

            const totalAmount = bills.reduce((sum, bill) => {
                const billTotal = Number(bill.total_amount || 0);
                // Count penalty if status is "overdue"
                let billPenalty = 0;
                if (bill.status === 'overdue') {
                billPenalty = Number(bill.penalty_amount || 0);}
                return sum + billTotal + billPenalty;}, 0);

            return { bills, totalAmount };
        });

        // 2. Create ONE payment record (the "cart")
        const newPayment = await prisma.bill_payments.create({
            data: {
                amount: totalAmount,
                method: 'online',
                status: 'pending',
                paid_by: tenantUserId,
                reference: `ORDER-${Date.now()}`, // This will be vnp_TxnRef
            },
        });

        // 3. Link all selected bills to this new payment
        await prisma.bills.updateMany({
            where: {
                bill_id: { in: billIds },
            },
            data: {
                payment_id: newPayment.payment_id,
                // Optionally update status to 'pending'
                // status: 'pending' 
            },
        });

        // 4. Generate VNPay URL
        const paymentUrl = generateVnpayUrl(
            ipAddr,
            totalAmount,
            newPayment.reference, // vnp_TxnRef
            `SAMI`
        );

        return { paymentUrl, orderId: newPayment.reference };
    }

    /**
     * Handles the trusted VNPay IPN callback.
     */
    async handleVnpayIpn(vnpParams) {
        // 1. Verify signature
        if (!verifyVnpaySignature(vnpParams)) {
            // Signature is invalid, this is a fraudulent request
            return { RspCode: '97', Message: 'Invalid Checksum' };
        }
        
        const vnp_TxnRef = vnpParams['vnp_TxnRef'];
        const vnp_ResponseCode = vnpParams['vnp_ResponseCode'];
        const vnp_Amount = Number(vnpParams['vnp_Amount']) / 100;
        const vnp_TransactionNo = vnpParams['vnp_TransactionNo'];

        // 2. Find our payment record
        const payment = await prisma.bill_payments.findFirst({
            where: { reference: vnp_TxnRef },
        });

        if (!payment) {
            return { RspCode: '01', Message: 'Order not found' };
        }

        // 3. Check if payment is already completed
        if (payment.status === 'completed') {
            return { RspCode: '02', Message: 'Order already confirmed' };
        }
        
        // 4. Check amount
        if (payment.amount != vnp_Amount) {
            return { RspCode: '04', Message: 'Invalid amount' };
        }

        // 5. Update based on VNPay's response
        if (vnp_ResponseCode === '00') {
            // SUCCESS
            await _markVnpayPaymentAsCompleted(
                payment.payment_id, 
                payment.amount, 
                vnp_TransactionNo 
            );
            return { RspCode: '00', Message: 'Confirm Success' };

        } else {
            // FAILED
            await _markPaymentAsFailed(payment.payment_id);
            return { RspCode: '00', Message: 'Confirm Success' };
        }
    }
}

module.exports = new PaymentService();
