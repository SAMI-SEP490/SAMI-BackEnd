// Updated: 2025-28-10
// by: MinhBH

const prisma = require('../config/prisma');
const { generateVnpayUrl, verifyVnpaySignature } = require('../utils/vnpay');
const excelJS = require('exceljs');
const fastcsv = require('fast-csv');

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

    /**
     * Get Tenant Transactions
     */
    async getTenantPaymentHistory(tenantUserId) {
        return prisma.bill_payments.findMany({
            where: {
                paid_by: tenantUserId,
                status: { in: ['completed', 'failed', 'refunded'] } // Show settled payments
            },
            orderBy: { payment_date: 'desc' },
            select: {
                payment_id: true,
                amount: true,
                payment_date: true,
                method: true,
                status: true,
                reference: true,
                transaction_id: true,
                online_type: true,
                note: true,
                // Include related bills
                bills: {
                    select: {
                        bill_id: true,
                        bill_number: true,
                        description: true,
                        billing_period_start: true,
                         billing_period_end: true
                    }
                }
            }
        });
    }

    /**
     * Get Year Revenue Report
     */
    async getYearlyRevenueReport(year) {
        const monthlyRevenue = await prisma.$queryRaw`
            SELECT 
                EXTRACT(MONTH FROM "payment_date")::integer as month,
                SUM("amount") as total_revenue
            FROM "bill_payments"
            WHERE 
                "status" = 'completed' AND
                EXTRACT(YEAR FROM "payment_date") = ${year}
            GROUP BY month
            ORDER BY month ASC;
        `;
        // Convert BigInt to Number/String and create a full year map
        const yearMap = Array.from({length: 12}, (_, i) => ({ month: i + 1, total_revenue: '0.00' }));
        monthlyRevenue.forEach(row => {
            const monthIndex = yearMap.findIndex(m => m.month === row.month);
            if (monthIndex !== -1) {
                // Ensure revenue is formatted as string to avoid precision issues
                 yearMap[monthIndex].total_revenue = parseFloat(row.total_revenue).toFixed(2);
            }
        });
        return yearMap;
    }

    /**
     * Get Month Revenue Report
     */
    async getMonthlyRevenueDetails(year, month) {
        // Prisma query to get individual payments for the month
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59, 999); // Last moment of the month

        return prisma.bill_payments.findMany({
            where: {
                status: 'completed',
                payment_date: {
                    gte: startDate,
                    lte: endDate,
                }
            },
            orderBy: { payment_date: 'asc' },
            select: {
                payment_id: true,
                amount: true,
                payment_date: true,
                method: true,
                reference: true,
                transaction_id: true,
                online_type: true,
                users: { select: { user_id: true, full_name: true } }
            }
        });
    }

    /**
     * Export Revenue
     */
     async exportRevenueData(year, month = null) {
        let payments;
        let filenameBase = `revenue-${year}`;

        if (month) {
            // Get specific month data
            payments = await this.getMonthlyRevenueDetails(year, month);
            filenameBase += `-${String(month).padStart(2, '0')}`;
        } else {
            // Get full year data (similar to monthly but for the whole year)
            const startDate = new Date(year, 0, 1); // Jan 1st
            const endDate = new Date(year, 11, 31, 23, 59, 59, 999); // Dec 31st
             payments = await prisma.bill_payments.findMany({
                where: {
                    status: 'completed',
                    payment_date: { gte: startDate, lte: endDate }
                },
                orderBy: { payment_date: 'asc' },
                select: {
                    payment_id: true,
                    amount: true,
                    payment_date: true,
                    method: true,
                    reference: true,
                    transaction_id: true,
                    online_type: true,
                    users: { select: { user_id: true, full_name: true } }
                }
            });
        }

        // Prepare data for export (flatten user info)
        const exportData = payments.map(p => ({
            payment_id: p.payment_id,
            amount: parseFloat(p.amount), // Convert Decimal to number for export
            payment_date: p.payment_date ? p.payment_date.toISOString() : '',
            method: p.method || '',
            paid_by_user_id: p.users?.user_id || '',
            paid_by_name: p.users?.full_name || '',
            reference: p.reference || '',
            transaction_id: p.transaction_id || '',
            online_type: p.online_type || '',
        }));

        return exportData;
    }

    /**
     * Gets all payment transactions (for Manager/Owner).
     */
    async getAllPaymentHistory(filters = {}) {
        return prisma.bill_payments.findMany({
            where: {
                status: { in: ['completed', 'failed', 'refunded', 'pending'] } // Show all settled and pending
            },
            orderBy: { payment_date: 'desc' }, // Show most recent first
            select: {
                payment_id: true,
                amount: true,
                payment_date: true,
                method: true,
                status: true,
                reference: true,
                transaction_id: true,
                online_type: true,
                note: true,
                // Include who paid
                users: {
                    select: {
                        user_id: true,
                        full_name: true,
                        phone: true // Add phone for easier identification
                    }
                },
                // Optionally include related bills
                bills: {
                    select: {
                        bill_id: true,
                        bill_number: true,
                        description: true,
                    }
                }
            }
        });
    }
}

module.exports = new PaymentService();
