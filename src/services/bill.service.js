// Updated: 2025-23-11
// by: MinhBH

const prisma = require('../config/prisma');
const crypto = require('crypto');

// Helper to generate unique bill number
function generateBillNumber(year, month) {
    const timestampPart = Date.now().toString();
    const randomPart = crypto.randomBytes(1).toString('hex');
    const uniqueNum = (timestampPart + randomPart).slice(-6).padStart(6, '0');
    return `B-${year}-${month}-GEN-${uniqueNum}`;
}

class BillService {

    // --- LISTING ---
    /**
     * Gets ALL visible bills (issued, paid, overdue) for a specific tenant.
     */
    async getBillsForTenant(tenantUserId) {
        return prisma.bills.findMany({
            where: {
                tenant_user_id: tenantUserId,
                // Only show actual bills, not templates or drafts
                status: { in: ['issued', 'paid', 'partially_paid', 'overdue'] },
                deleted_at: null,
            },
            orderBy: {
                billing_period_start: 'desc',
            },
            select: {
                bill_id: true,
                bill_number: true,
                billing_period_start: true,
                billing_period_end: true,
                due_date: true,
                total_amount: true,
                paid_amount: true,
                penalty_amount: true,
                status: true,
                description: true,
                // Include room info for context
                rooms: {
                    select: { room_number: true }
                }
            }
        });
    }

    /**
     * Gets only UNPAID bills for a specific tenant.
     */
    async getUnpaidBillsForTenant(tenantUserId) {
        return prisma.bills.findMany({
            where: {
                tenant_user_id: tenantUserId,
                status: { in: ['issued', 'overdue'] },
                deleted_at: null,
            },
            orderBy: {
                due_date: 'asc', // Urgent ones first
            },
            select: {
                bill_id: true,
                bill_number: true,
                billing_period_start: true,
                billing_period_end: true,
                due_date: true,
                total_amount: true,
                paid_amount: true,
                penalty_amount: true,
                status: true,
                description: true,
            }
        });
    }

    async getAllBills(filters = {}) {
        return prisma.bills.findMany({
            where: {
                status: { notIn: ['draft', 'cancelled'] },
                deleted_at: null,
                ...filters, // Allow additional filters (e.g., by tenant_id)
            },
            orderBy: { created_at: 'desc' },
            include: { // Include related data for context
                tenants: { select: { users: { select: { user_id: true, full_name: true } } } },
                users: { select: { user_id: true, full_name: true } }, // created_by user
                rooms: { select: { room_id: true, room_number: true } } // Include room info
            }
        });
    }

    async getDraftBills() {
        return prisma.bills.findMany({
            where: { status: 'draft', deleted_at: null },
            orderBy: { created_at: 'desc' },
            include: { // Include related data for context
                tenants: { select: { users: { select: { user_id: true, full_name: true } } } },
                users: { select: { user_id: true, full_name: true } }, // created_by user
                rooms: { select: { room_id: true, room_number: true } } // Include room info
            }
        });
    }
    
    async getDeletedBills() {
         return prisma.bills.findMany({
            where: { deleted_at: { not: null } },
            orderBy: { deleted_at: 'desc' },
            include: { // Include related data for context
                tenants: { select: { users: { select: { user_id: true, full_name: true } } } },
                users: { select: { user_id: true, full_name: true } }, // created_by user
                rooms: { select: { room_id: true, room_number: true } } // Include room info
            }
        });
    }

    // --- GET UNBILLED ROOMS ---
    // Passing the period_start_date in to know which room is billed
    async getUnbilledRooms(periodStartDate) {
        if (!periodStartDate || isNaN(new Date(periodStartDate).getTime())) {
             const error = new Error('Invalid billing period start date.');
             error.statusCode = 400;
             throw error;
        }
        
        return prisma.rooms.findMany({
            where: {
                is_active: true,
                bills: {
                    none: { // Find rooms that have NO bills
                        billing_period_start: new Date(periodStartDate),
                        status: { not: 'cancelled' } // Ignore cancelled bills
                    }
                }
            },
            select: { 
                room_id: true, 
                room_number: true, 
                floor: true,
                // Also show the current tenant of that room
                tenants: { 
                    select: { user_id: true, users: { select: { full_name: true } } },
                    where: { users: { role: 'TENANT' } } // Assuming tenant is linked to room
                }
            }
        });
    }

    // --- VIEW DETAIL ---
    async getBillById(billId) {
        const bill = await prisma.bills.findUnique({
            where: { bill_id: billId },
             include: {
                tenants: { select: { users: { select: { user_id: true, full_name: true, phone: true } } } },
                users: { select: { user_id: true, full_name: true } },
                bill_payments: { select: { payment_id: true, amount: true, payment_date: true, status: true, reference: true, transaction_id: true, online_type: true }},
                rooms: { select: { room_id: true, room_number: true } }
            }
        });
        if (!bill) {
            const error = new Error('Bill not found');
            error.statusCode = 404;
            throw error;
        }
        return bill;
    }

    // --- CREATE ---
    async createDraftBill(data, createdById) {
        return prisma.bills.create({
            data: {
                ...data,
                status: 'draft', // Force status
                created_by: createdById,
            }
        });
    }

    async createIssuedBill(data, createdById) {
        const periodStart = new Date(data.billing_period_start);
        
        // Check for duplicates
        const existing = await prisma.bills.findFirst({
            where: {
                room_id: data.room_id,
                billing_period_start: periodStart,
                status: { not: 'cancelled' }
            }
        });
        if (existing) {
             const error = new Error(`A bill for this room and period already exists (Bill ID: ${existing.bill_id}).`);
             error.statusCode = 409;
             throw error;
        }

        const billNumber = generateBillNumber(
            periodStart.getFullYear(),
            periodStart.getMonth() + 1
        );

        return prisma.bills.create({
            data: {
                ...data,
                status: 'issued', // Force status
                bill_number: billNumber,
                created_by: createdById,
                billing_period_start: periodStart, 
                billing_period_end: new Date(data.billing_period_end), // Ensure dates are saved as Date objects
                due_date: new Date(data.due_date),
            }
        });
    }

    // --- EDIT ---
    async updateDraftBill(billId, data) {
        // 1. Fetch the draft bill to check its current data
        const originalDraft = await prisma.bills.findUnique({
            where: { bill_id: billId },
        });

        if (!originalDraft || originalDraft.status !== 'draft') {
            const error = new Error('Only draft bills can be updated here.');
            error.statusCode = 403;
            throw error;
        }

        let updateData = { ...data, updated_at: new Date() };

        // 2. Handle "Publish" logic (converting draft to issued)
        if (data.status === 'issued') {
            // Merge new data with old data to check for completeness
            const finalData = { ...originalDraft, ...data };
            
            // Zod already checked that the *request* had all fields.
            // Now we ensure the final merged object is valid.
            // (Note: Zod validation on schema 2 already covers this, but double-check)
            if (!finalData.tenant_user_id || !finalData.room_id || !finalData.total_amount || !finalData.description ||
                !finalData.billing_period_start || !finalData.billing_period_end || !finalData.due_date) {
                const error = new Error('Cannot publish bill: missing required fields (e.g., tenant, room, amount, dates).');
                error.statusCode = 400;
                throw error;
            }
            
            // Generate bill number on publish
            const periodStart = new Date(finalData.billing_period_start);
            updateData.bill_number = generateBillNumber(
                finalData.description,
                periodStart.getFullYear(),
                periodStart.getMonth() + 1
            );
        }
        
        // 3. Convert date strings if they exist
        if (data.billing_period_start) updateData.billing_period_start = new Date(data.billing_period_start);
        if (data.billing_period_end) updateData.billing_period_end = new Date(data.billing_period_end);
        if (data.due_date) updateData.due_date = new Date(data.due_date);

        return prisma.bills.update({
            where: { bill_id: billId },
            data: updateData
        });
    }

    async updateIssuedBill(billId, data) {
        // 1. Fetch the bill to check status and payment_id
        const bill = await prisma.bills.findUnique({
            where: { bill_id: billId },
            select: { status: true, payment_id: true }
        });

        if (!bill) { /* 404 error */ }
        
        // 2. Only allow editing 'issued' bills
        if (bill.status !== 'issued') {
            const error = new Error(`Cannot edit a bill with status: ${bill.status}.`);
            error.statusCode = 403;
            throw error;
        }
        
        // 3. Safety Check for pending payment
        if (bill.payment_id) {
            const payment = await prisma.bill_payments.findUnique({
                where: { payment_id: bill.payment_id },
                select: { status: true }
            });
            if (payment && payment.status === 'pending') {
                const error = new Error('Cannot edit this bill: a payment is currently pending.');
                error.statusCode = 409;
                throw error;
            }
        }

        // 4. Prepare update data
        const updateData = { ...data, updated_at: new Date() };
        if (data.due_date) updateData.due_date = new Date(data.due_date);

        return prisma.bills.update({
            where: { bill_id: billId },
            data: updateData
        });
    }

    // --- DELETE / CANCEL ---
    async deleteOrCancelBill(billId) {
        const bill = await prisma.bills.findUnique({
            where: { bill_id: billId },
            select: { status: true, deleted_at: true }
        });

        if (!bill) {
            const error = new Error('Bill not found');
            error.statusCode = 404;
            throw error;
        }
        if (bill.deleted_at) {
             const error = new Error('Bill already deleted');
             error.statusCode = 400;
             throw error;
        }

        // Draft: Soft delete
        if (bill.status === 'draft') {
            return prisma.bills.update({
                where: { bill_id: billId },
                data: { deleted_at: new Date() }
            });
        }
        // Issued or Overdue: Cancel
        else if (bill.status === 'issued' || bill.status === 'overdue') {
             // Cannot cancel if already paid or partially paid
             if (bill.status === 'paid' || bill.status === 'partially_paid') {
                 const error = new Error('Cannot cancel a bill that has received payment.');
                 error.statusCode = 400;
                 throw error;
             }
            return prisma.bills.update({
                where: { bill_id: billId },
                data: { status: 'cancelled', updated_at: new Date(), deleted_at: new Date() }
            });
        }
        // Paid, Partially Paid, Cancelled: Cannot delete/cancel further
        else {
             const error = new Error(`Cannot delete or cancel a bill with status: ${bill.status}`);
             error.statusCode = 400;
             throw error;
        }
    }

    // --- RESTORE ---
    async restoreBill(billId) {
        const bill = await prisma.bills.findUnique({
            where: { bill_id: billId },
            select: { status: true, deleted_at: true }
        });

        if (!bill) {
            const error = new Error('Bill not found');
            error.statusCode = 404;
            throw error;
        }

        // Check if it's actually soft-deleted
        if (bill.deleted_at === null) {
            const error = new Error('Bill is not deleted.');
            error.statusCode = 400; // Bad Request
            throw error;
        }

        // Perform the restore (update deleted_at to null)
        return prisma.bills.update({
            where: { bill_id: billId },
            data: { deleted_at: null }
        });
    }
}

module.exports = new BillService();
