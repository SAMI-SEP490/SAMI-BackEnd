// Updated: 2025-28-10
// by: MinhBH

const prisma = require('../config/prisma');

class BillService {

    // --- LISTING ---
    async getAllBills(filters = {}) {
        return prisma.bills.findMany({
            where: {
                status: { notIn: ['master', 'draft', 'cancelled'] },
                deleted_at: null,
                ...filters, // Allow additional filters (e.g., by tenant_id)
            },
            orderBy: { created_at: 'desc' },
            include: { // Include related data for context
                tenants: { select: { users: { select: { user_id: true, full_name: true } } } },
                users: { select: { user_id: true, full_name: true } } // created_by user
            }
        });
    }

    async getDraftBills() {
        return prisma.bills.findMany({
            where: { status: 'draft', deleted_at: null },
            orderBy: { created_at: 'desc' },
             include: { tenants: { select: { users: { select: { user_id: true, full_name: true } } } } }
        });
    }

    async getMasterBills() {
        return prisma.bills.findMany({
            where: { status: 'master', deleted_at: null },
            orderBy: { created_at: 'desc' },
            include: { tenants: { select: { users: { select: { user_id: true, full_name: true } } } } }
        });
    }
    
    async getDeletedBills() {
         return prisma.bills.findMany({
            where: { deleted_at: { not: null } },
            orderBy: { deleted_at: 'desc' },
            include: { tenants: { select: { users: { select: { user_id: true, full_name: true } } } } }
        });
    }

    // --- VIEW DETAIL ---
    async getBillById(billId) {
        const bill = await prisma.bills.findUnique({
            where: { bill_id: billId },
             include: {
                tenants: { select: { users: { select: { user_id: true, full_name: true, phone: true } } } },
                users: { select: { user_id: true, full_name: true } },
                bill_payments: { select: { payment_id: true, amount: true, payment_date: true, status: true, reference: true, transaction_id: true, online_type: true }}
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
    async createBill(data, createdById) {
        // Ensure status is draft or master
        const status = data.status === 'master' ? 'master' : 'draft';

        return prisma.bills.create({
            data: {
                tenant_user_id: data.tenant_user_id,
                total_amount: data.total_amount,
                description: data.description,
                penalty_amount: data.penalty_amount || 0.00,
                status: status,
                is_recurring: data.is_recurring || false,
                billing_cycle: data.billing_cycle || "MONTHLY",
                created_by: createdById,
                // Dates only for non-master
                billing_period_start: null,
                billing_period_end: null,
                due_date: null,
                // Master templates don't get a bill number initially
                bill_number: null,
            }
        });
    }

    // --- EDIT ---
    async updateBill(billId, data, updatedById) {
        // 1. Fetch the bill to check its current status
        const bill = await prisma.bills.findUnique({
            where: { bill_id: billId },
            select: { status: true }
        });

        if (!bill) {
            const error = new Error('Bill not found');
            error.statusCode = 404;
            throw error;
        }

        // 2. Only allow editing 'draft' or 'master' bills
        if (bill.status !== 'draft' && bill.status !== 'master') {
            const error = new Error('Only draft or master bills can be edited.');
            error.statusCode = 403; // Forbidden
            throw error;
        }

        // 3. Prepare update data (similar logic to create)
        const updateData = {
            tenant_user_id: data.tenant_user_id,
            total_amount: data.total_amount,
            description: data.description,
            penalty_amount: data.penalty_amount,
            status: data.status || bill.status,
            is_recurring: data.is_recurring,
            billing_cycle: data.billing_cycle,
            updated_at: new Date(),
            billing_period_start: null,
            billing_period_end: null,
            due_date: null,
        };

        // Remove undefined fields to avoid accidental nulling
        Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);


        return prisma.bills.update({
            where: { bill_id: billId },
            data: updateData
        });
    }
    
    // --- CLONE DRAFT TO MASTER ---
    async cloneDraftToMaster(draftBillId, updatedById) {
        // 1. Fetch the draft bill
        const draftBill = await prisma.bills.findUnique({
            where: { bill_id: draftBillId },
        });

        // 2. Basic Check: Exists and is a draft?
        if (!draftBill || draftBill.status !== 'draft') {
            const error = new Error('Only existing draft bills can be cloned to master.');
            error.statusCode = 400;
            throw error;
        }

        // --- 3. MANUAL VALIDATION ---
        // Check if draft has minimum required fields for a master template
        if (!draftBill.tenant_user_id || !draftBill.total_amount || !draftBill.description) {
            const error = new Error('Draft bill is missing required fields (tenant_user_id, total_amount, description) to become a master template.');
            error.statusCode = 400;
            throw error;
        }
        // Since we force is_recurring=true, a cycle is mandatory
        if (!draftBill.billing_cycle) {
             const error = new Error('Draft bill is missing billing_cycle, which is required for a master template.');
             error.statusCode = 400;
             throw error;
        }
        // --- END MANUAL VALIDATION ---

        // 4. Create the new master bill (using original draftBill data)
        return prisma.bills.create({
            data: {
                tenant_user_id: draftBill.tenant_user_id,
                total_amount: draftBill.total_amount,
                description: draftBill.description,
                penalty_amount: draftBill.penalty_amount || 0.00,
                status: 'master',
                is_recurring: true,
                billing_cycle: draftBill.billing_cycle,
                created_by: updatedById,
                billing_period_start: null,
                billing_period_end: null,
                due_date: null,
                bill_number: null,
            }
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

        // Draft or Master: Soft delete
        if (bill.status === 'draft' || bill.status === 'master') {
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
                data: { status: 'cancelled', updated_at: new Date() }
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

        // Check if it was a type that *could* be soft-deleted (draft or master)
        if (bill.status !== 'draft' && bill.status !== 'master') {
             const error = new Error(`Cannot restore a bill with status '${bill.status}'. Only soft-deleted drafts or masters can be restored.`);
             error.statusCode = 400;
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
