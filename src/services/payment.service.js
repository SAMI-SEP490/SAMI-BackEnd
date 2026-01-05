// src/services/payment.service.js
// Updated: 2026-01-05
// Features: Supports new schema (bill_payment_details), PayOS, Cash

const prisma = require('../config/prisma');
const config = require('../config');
const { PayOS } = require("@payos/node");
const NotificationService = require('./notification.service');

// --- SAFE INITIALIZATION (PayOS) ---
// (Keep your existing initialization code here - it is correct)
let payos = null;
if (config.payos?.clientId) {
    try { payos = new PayOS(config.payos.clientId, config.payos.apiKey, config.payos.checksumKey); }
    catch (e) { console.warn('⚠️ PayOS init error:', e.message); }
}

// --- HELPERS ---

async function _completePayment(paymentId, transactionId, onlineType) {
    return prisma.$transaction(async (tx) => {
        // 1. Mark Payment as Completed
        const payment = await tx.bill_payments.update({
            where: { payment_id: paymentId },
            data: {
                status: 'completed',
                payment_date: new Date(),
                transaction_id: transactionId,
                online_type: onlineType
            },
            include: { payment_details: true } // Get bills linked to this payment
        });

        // 2. Mark Linked Bills as Paid
        // With new schema, we iterate through details to update specific bills
        for (const detail of payment.payment_details) {
            const bill = await tx.bills.findUnique({ where: { bill_id: detail.bill_id } });

            // Calculate new paid amount (Old paid + Current payment)
            // Ideally, 'amount' in detail is what was paid for THIS bill
            const newPaidAmount = Number(bill.paid_amount || 0) + Number(detail.amount);

            // Determine status
            const totalDue = Number(bill.total_amount) + Number(bill.penalty_amount || 0);
            const newStatus = newPaidAmount >= totalDue ? 'paid' : 'partially_paid';

            await tx.bills.update({
                where: { bill_id: detail.bill_id },
                data: {
                    status: newStatus,
                    paid_amount: newPaidAmount,
                    // Link payment_id for reference (showing last payment)
                    // Note: If multiple payments exist, this shows the latest one.
                    payment_details: {
                        create: {
                            payment_id: paymentId,
                            amount: detail.amount
                        }
                    }
                }
            });
        }

        return payment;
    });
}

async function _failPayment(paymentId) {
    await prisma.bill_payments.update({
        where: { payment_id: paymentId },
        data: { status: 'failed' }
    });
}

class PaymentService {

    /**
     * Create PayOS Payment Link
     */
    async createPayOSLink(tenantUserId, billIds) {
        if (!payos) throw new Error("PayOS not configured");

        // 1. Calculate Total & Validate
        const { totalAmount, validBills } = await this._validateBills(tenantUserId, billIds);

        // 2. Create Pending Payment
        const orderCode = Number(Date.now()); // Unique numeric ID
        const dbRef = `PAYOS-${orderCode}`;

        const payment = await prisma.bill_payments.create({
            data: {
                amount: totalAmount,
                method: 'online',
                online_type: 'PAYOS',
                status: 'pending',
                paid_by: tenantUserId,
                reference: dbRef,
                // Create details linking to bills immediately
                payment_details: {
                    create: validBills.map(b => ({
                        bill_id: b.bill_id,
                        amount: Number(b.total_amount) + Number(b.penalty_amount || 0)
                    }))
                }
            }
        });

        // 3. Request Link from PayOS
        const paymentLink = await payos.paymentRequests.create({
            orderCode: orderCode,
            amount: totalAmount,
            description: `Thanh toan HD ${validBills.map(b => b.bill_number).join(',').substring(0, 20)}...`,
            cancelUrl: config.payos.cancelUrl,
            returnUrl: config.payos.returnUrl
        });

        return { checkoutUrl: paymentLink.checkoutUrl };
    }

    /**
     * Handle PayOS Webhook
     */
    async handlePayOSWebhook(webhookData) {
        if (!payos) return null;

        try { await payos.webhooks.verify(webhookData); }
        catch (e) { console.warn("PayOS Verify Failed", e.message); return null; }

        const { orderCode, code, reference } = webhookData.data;
        const dbRef = `PAYOS-${orderCode}`;

        const payment = await prisma.bill_payments.findFirst({
            where: { reference: dbRef }
        });

        if (!payment || payment.status === 'completed') return;

        if (code === '00') {
            await _completePayment(payment.payment_id, reference, 'PAYOS');
            // Notification logic here
        } else {
            await _failPayment(payment.payment_id);
        }

        return webhookData.data;
    }

    /**
     * Create Cash Payment (Manager Only)
     */
    async createCashPayment(collectedByUserId, billIds, note) {
        // 1. Validate (Manager can collect for any tenant)
        // Find bills regardless of tenant (assuming manager verified identity)
        const bills = await prisma.bills.findMany({
            where: {
                bill_id: { in: billIds },
                status: { in: ['issued', 'overdue', 'partially_paid'] }
            }
        });

        if (bills.length !== billIds.length) throw new Error("Invalid bills selected");

        const totalAmount = bills.reduce((sum, b) =>
            sum + Number(b.total_amount) + Number(b.penalty_amount || 0) - Number(b.paid_amount || 0), 0
        );

        // 2. Transaction
        return prisma.$transaction(async (tx) => {
            // Create Payment
            const payment = await tx.bill_payments.create({
                data: {
                    amount: totalAmount,
                    method: 'cash',
                    status: 'completed',
                    payment_date: new Date(),
                    paid_by: bills[0].tenant_user_id, // Assign to first bill's tenant
                    note: note || `Collected by Manager ${collectedByUserId}`,
                    reference: `CASH-${Date.now()}`
                }
            });

            // Update Bills & Create Details
            for (const bill of bills) {
                const amountDue = Number(bill.total_amount) + Number(bill.penalty_amount || 0) - Number(bill.paid_amount || 0);

                // Link detail
                await tx.bill_payment_details.create({
                    data: {
                        bill_id: bill.bill_id,
                        payment_id: payment.payment_id,
                        amount: amountDue
                    }
                });

                // Close Bill
                await tx.bills.update({
                    where: { bill_id: bill.bill_id },
                    data: {
                        status: 'paid',
                        paid_amount: Number(bill.total_amount) + Number(bill.penalty_amount || 0)
                    }
                });
            }
            return payment;
        });
    }

    // --- PRIVATE HELPERS ---

    async _validateBills(userId, billIds) {
        const bills = await prisma.bills.findMany({
            where: {
                bill_id: { in: billIds },
                tenant_user_id: userId,
                status: { in: ['issued', 'overdue', 'partially_paid'] }
            }
        });

        if (bills.length !== billIds.length) throw new Error("Invalid or unpaid bills selected");

        const totalAmount = bills.reduce((sum, bill) => {
            const total = Number(bill.total_amount) + Number(bill.penalty_amount || 0);
            const paid = Number(bill.paid_amount || 0);
            return sum + (total - paid);
        }, 0);

        return { totalAmount, validBills: bills };
    }

    // --- REPORTING (Keep existing logic, update queries if needed) ---
    async getTenantPaymentHistory(userId) {
        return prisma.bill_payments.findMany({
            where: { paid_by: userId },
            include: { payment_details: { include: { bill: true } } },
            orderBy: { payment_date: 'desc' }
        });
    }

    /**
     * Get Tenant Payment History
     * Shows what they paid and which bills were covered.
     */
    async getTenantPaymentHistory(tenantUserId) {
        return prisma.bill_payments.findMany({
            where: {
                paid_by: tenantUserId,
                status: { in: ['completed', 'failed', 'refunded'] }
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
                // [UPDATED] Use payment_details to get bill info
                payment_details: {
                    select: {
                        amount: true, // How much of this payment went to this bill
                        bill: {
                            select: {
                                bill_id: true,
                                bill_number: true,
                                description: true,
                                billing_period_start: true,
                                billing_period_end: true
                            }
                        }
                    }
                }
            }
        });
    }

    /**
     * Get Year Revenue Report (Chart Data)
     * Groups completed payments by month.
     */
    async getYearlyRevenueReport(year) {
        // Raw query is still efficient here
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

        // Initialize empty 12-month array
        const yearMap = Array.from({ length: 12 }, (_, i) => ({
            month: i + 1,
            total_revenue: 0
        }));

        // Fill in data
        monthlyRevenue.forEach(row => {
            const monthIndex = row.month - 1;
            if (monthIndex >= 0 && monthIndex < 12) {
                yearMap[monthIndex].total_revenue = Number(row.total_revenue);
            }
        });

        return yearMap;
    }

    /**
     * Get Month Revenue Details (List View)
     * Lists all payments in a specific month.
     */
    async getMonthlyRevenueDetails(year, month) {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59, 999);

        return prisma.bill_payments.findMany({
            where: {
                status: 'completed',
                payment_date: {
                    gte: startDate,
                    lte: endDate,
                }
            },
            orderBy: { payment_date: 'desc' },
            select: {
                payment_id: true,
                amount: true,
                payment_date: true,
                method: true,
                reference: true,
                transaction_id: true,
                online_type: true,
                // [UPDATED] Include User info via 'payer' relation (see schema: relation("PaymentPaidBy"))
                payer: {
                    select: { user_id: true, full_name: true, phone: true }
                },
                // [UPDATED] Include which bills were paid
                payment_details: {
                    select: {
                        bill: { select: { bill_number: true } }
                    }
                }
            }
        });
    }

    /**
     * Export Revenue (CSV/Excel Data)
     * Flattens the data for easy export.
     */
    async exportRevenueData(year, month = null) {
        let payments;

        // Define Date Range
        const startDate = month
            ? new Date(year, month - 1, 1)
            : new Date(year, 0, 1);

        const endDate = month
            ? new Date(year, month, 0, 23, 59, 59, 999)
            : new Date(year, 11, 31, 23, 59, 59, 999);

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
                payer: { select: { user_id: true, full_name: true } },
                // Get bill numbers for reference
                payment_details: {
                    select: { bill: { select: { bill_number: true } } }
                }
            }
        });

        // Flatten for Export
        return payments.map(p => ({
            "ID": p.payment_id,
            "Ngày thanh toán": p.payment_date ? p.payment_date.toISOString().split('T')[0] : '',
            "Số tiền": Number(p.amount),
            "Phương thức": p.method === 'online' ? p.online_type : 'Tiền mặt',
            "Người trả": p.payer?.full_name || 'N/A',
            "Mã tham chiếu": p.reference,
            "Mã giao dịch": p.transaction_id || '-',
            // Join bill numbers: "B-RNT-001, B-UTL-002"
            "Hóa đơn": p.payment_details.map(d => d.bill?.bill_number).join(', ')
        }));
    }

    /**
     * Get All Payment History (Manager View)
     * Comprehensive list of everything.
     */
    async getAllPaymentHistory(filters = {}) {
        return prisma.bill_payments.findMany({
            where: {
                // Default: Show everything relevant (modify based on filters if needed)
                status: { in: ['completed', 'failed', 'refunded', 'pending'] }
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
                payer: {
                    select: {
                        user_id: true,
                        full_name: true,
                        phone: true
                    }
                },
                payment_details: {
                    select: {
                        amount: true,
                        bill: {
                            select: {
                                bill_id: true,
                                bill_number: true,
                                bill_type: true
                            }
                        }
                    }
                }
            }
        });
    }
}

module.exports = new PaymentService();
