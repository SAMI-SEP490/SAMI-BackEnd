// Updated: 2025-28-10
// by: MinhBH

const prisma = require('../config/prisma');
const { generateVnpayUrl, verifyVnpaySignature } = require('../utils/vnpay');
const excelJS = require('exceljs');
const fastcsv = require('fast-csv');
const { PayOS } = require("@payos/node");

// Initialize PayOS
// --- SAFE INITIALIZATION ---
let payos = null;

if (process.env.PAYOS_CLIENT_ID && process.env.PAYOS_API_KEY && process.env.PAYOS_CHECKSUM_KEY) {
    try {
        payos = new PayOS(
            process.env.PAYOS_CLIENT_ID,
            process.env.PAYOS_API_KEY,
            process.env.PAYOS_CHECKSUM_KEY
        );
        console.log('✅ PayOS initialized.');
    } catch (e) {
        console.warn('⚠️ PayOS init error:', e.message);
    }
} else {
    console.warn('⚠️ PayOS credentials missing in .env. Payments will be disabled.');
}

// --- SAFE INITIALIZATION: VNPay ---
// Check if all required VNPay variables exist
const isVnpayConfigured = 
    process.env.VNP_TMNCODE && 
    process.env.VNP_HASHSECRET && 
    process.env.VNP_URL && 
    process.env.VNP_RETURN_URL;

if (!isVnpayConfigured) {
    console.warn('⚠️ VNPay credentials missing. VNPay features disabled.');
} else {
    console.log('✅ VNPay configured.');
}

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

// Helper function to mark PayOS payment as completed
async function _markPayOSPaymentAsCompleted(payment, payosReference) {
    return prisma.$transaction(async (tx) => {
        // 1. Update the Payment Record
        await tx.bill_payments.update({
            where: { payment_id: payment.payment_id },
            data: {
                status: 'completed',
                payment_date: new Date(),
                transaction_id: payosReference, // Save PayOS reference as proof
                online_type: 'PAYOS',
            },
        });
        
        // 2. Update the Linked Bills
        await tx.bills.updateMany({
            where: { payment_id: payment.payment_id },
            data: {
                status: 'paid',
                paid_amount: payment.amount, // Assumes full payment
            },
        });
    });

    // 3. Send Notifications (Optional but recommended)
    // await NotificationService.sendPaymentSuccessNotification(payment);
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
        // --- SAFETY CHECK ---
        if (!isVnpayConfigured) {
            throw new Error("VNPay service is not configured on this server.");
        }

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
        // --- SAFETY CHECK ---
        if (!isVnpayConfigured) {
            console.warn("Received VNPay IPN but service is disabled.");
            return { RspCode: '99', Message: 'Service Disabled' };
        }

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

    /**
     * Create a PayOS Payment Link
     */
    async createPayOSLink(tenantUserId, billIds) {
        if (!payos) {
            throw new Error("PayOS service is not configured on this server.");
        }

        // 1. Verify and sum bills
        const { bills, totalAmountDue } = await prisma.$transaction(async (tx) => {
            const bills = await tx.bills.findMany({
                where: {
                    bill_id: { in: billIds },
                    tenant_user_id: tenantUserId,
                    status: { in: ['issued', 'overdue'] },
                },
                select: { bill_id: true, total_amount: true, penalty_amount: true, status: true, description: true }
            });
            
            if (bills.length === 0 || bills.length !== billIds.length) throw new Error("Invalid bills");

            const total = bills.reduce((sum, bill) => {
                const billTotal = Number(bill.total_amount || 0);
                let billPenalty = 0;
                if (bill.status === 'overdue') billPenalty = Number(bill.penalty_amount || 0);
                return sum + billTotal + billPenalty;
            }, 0);

            return { bills, totalAmountDue: total };
        });

        if (totalAmountDue <= 0) throw new Error("Invalid amount");

        // 2. Generate Unique Numeric Order Code (Timestamp)
        const orderCode = Number(Date.now());
        const dbReference = `PAYOS-${orderCode}`; // <-- ADD PREFIX FOR DB

        // 3. Create Payment Record
        const newPayment = await prisma.bill_payments.create({
            data: {
                amount: totalAmountDue,
                method: 'online',
                online_type: 'PAYOS',
                status: 'pending',
                users: { connect: { user_id: tenantUserId } },
                reference: dbReference, // Store with prefix in DB
                created_at: new Date(),
            },
        });

        // 4. Link bills
        await prisma.bills.updateMany({
            where: { bill_id: { in: billIds } },
            data: { payment_id: newPayment.payment_id },
        });

        // 5. Create PayOS Link
        const description = `SAMI Bill ${newPayment.payment_id}`;

        const paymentData = {
            orderCode: orderCode, // Send PURE NUMBER to PayOS
            amount: Number(totalAmountDue),
            description: description,
            cancelUrl: process.env.PAYOS_CANCEL_URL,
            returnUrl: process.env.PAYOS_RETURN_URL
        };

        const paymentLinkResponse = await payos.paymentRequests.create(paymentData);

        return { 
            checkoutUrl: paymentLinkResponse.checkoutUrl 
        };
    }

    /**
     * Handle PayOS Webhook (Secure)
     */
    async handlePayOSWebhook(webhookData) {
        if (!payos) {
            console.warn("Received PayOS webhook but service is disabled.");
            return null;
        }

        // 1. Verify Signature (Wrapped in try/catch)
        try {
             // This line throws an error if data is fake/tampered
             await payos.webhooks.verify(webhookData); 
        } catch (e) {
             // LOG THE ATTEMPT, BUT DO NOT CRASH
             console.warn("⚠️ Webhook signature verification failed. Possible fake data received.");
             console.error("Error details:", e.message);
             
             // Return null to signal "Invalid Request" to the controller
             return null; 
        }
        
        // 2. Extract Data (Safe to proceed now)
        // We use webhookData.data because verify succeeded
        const { orderCode, amount, code, reference } = webhookData.data;

        if (!orderCode) {
             console.error("Error: orderCode is missing from webhook data.");
             return null;
        }

        // 3. Find Payment
        // PayOS sends back the number (e.g., 173...). 
        // We must re-add the prefix to find it in our DB.
        const dbReference = `PAYOS-${orderCode}`;

        const payment = await prisma.bill_payments.findFirst({
            where: { reference: dbReference }
        });

        if (!payment) {
            console.log(`Webhook ignored: Payment with Ref ${dbReference} not found.`);
            return null;
        }

        // Idempotency check
        if (payment.status === 'completed') {
            return { message: "Already completed" };
        }

        // 4. Update DB
        if (code === '00') {
             console.log(`Payment ${payment.payment_id} (Ref: ${dbReference}) success.`);
            await _markPayOSPaymentAsCompleted(payment, reference);
        } else {
            await _markPaymentAsFailed(payment.payment_id);
        }
        
        return webhookData.data;
    }
}

module.exports = new PaymentService();
