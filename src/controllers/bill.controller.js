// Updated: 2025-23-11
// by: MinhBH

const BillService = require('../services/bill.service');
const { billSchema } = require('../middlewares/validation.middleware'); // Assuming schema is imported

class BillController {

    // --- LISTING ---
    async getMyBills(req, res, next) {
        try {
            const tenantUserId = req.user.user_id;
            const bills = await BillService.getBillsForTenant(tenantUserId);
            res.status(200).json({ success: true, data: bills });
        } catch (err) { next(err); }
    }

    async getMyUnpaidBills(req, res, next) {
        try {
            const tenantUserId = req.user.user_id;
            const bills = await BillService.getUnpaidBillsForTenant(tenantUserId);
            res.status(200).json({ success: true, data: bills });
        } catch (err) { next(err); }
    }

    async getAllBills(req, res, next) {
        try {
            // Optional: Add filtering from query params if needed later
            const bills = await BillService.getAllBills();
            res.status(200).json({ success: true, data: bills });
        } catch (err) { next(err); }
    }
    async getDraftBills(req, res, next) {
        try {
            const bills = await BillService.getDraftBills();
            res.status(200).json({ success: true, data: bills });
        } catch (err) { next(err); }
    }
     async getDeletedBills(req, res, next) {
        try {
            const bills = await BillService.getDeletedBills();
            res.status(200).json({ success: true, data: bills });
        } catch (err) { next(err); }
    }


    // --- VIEW DETAIL ---
    async getBillById(req, res, next) {
        try {
            const billId = parseInt(req.params.id, 10);
            if (isNaN(billId)) return res.status(400).json({ success: false, message: "Invalid Bill ID" });
            const bill = await BillService.getBillById(billId);
            res.status(200).json({ success: true, data: bill });
        } catch (err) { next(err); }
    }

    // --- CREATE ---
    async createDraftBill(req, res, next) {
        try {
            const createdById = req.user.user_id;
            const newBill = await BillService.createDraftBill(req.body, createdById);
            res.status(201).json({ success: true, message: "Draft bill saved", data: newBill });
        } catch (err) { next(err); }
    }
    
    async createIssuedBill(req, res, next) {
        try {
            const createdById = req.user.user_id;
            const newBill = await BillService.createIssuedBill(req.body, createdById);
            res.status(201).json({ success: true, message: "Bill created and issued", data: newBill });
        } catch (err) { next(err); }
    }

    // --- EDIT ---
    async updateDraftBill(req, res, next) {
        try {
            const billId = parseInt(req.params.id, 10);
            if (isNaN(billId)) return res.status(400).json({ success: false, message: "Invalid Bill ID" });
            
            const updatedBill = await BillService.updateDraftBill(billId, req.body);
            const message = req.body.status === 'issued' ? "Bill published successfully" : "Draft bill updated";
            res.status(200).json({ success: true, message: message, data: updatedBill });
        } catch (err) { next(err); }
    }
    
    async updateIssuedBill(req, res, next) {
        try {
            const billId = parseInt(req.params.id, 10);
            if (isNaN(billId)) return res.status(400).json({ success: false, message: "Invalid Bill ID" });
            
            const updatedBill = await BillService.updateIssuedBill(billId, req.body);
            res.status(200).json({ success: true, message: "Issued bill updated", data: updatedBill });
        } catch (err) { next(err); }
    }

    // --- GET UNBILLED ROOMS ---
    async getUnbilledRooms(req, res, next) {
        try {
            const { period_start } = req.query; // e.g., ?period_start=2025-11-01
            if (!period_start) {
                 return res.status(400).json({ success: false, message: "Query parameter 'period_start' (YYYY-MM-DD) is required." });
            }
            const rooms = await BillService.getUnbilledRooms(period_start);
            res.status(200).json({ success: true, data: rooms });
        } catch (err) { next(err); }
    }

    // --- DELETE / CANCEL ---
    async deleteOrCancelBill(req, res, next) {
        try {
            const billId = parseInt(req.params.id, 10);
            if (isNaN(billId)) return res.status(400).json({ success: false, message: "Invalid Bill ID" });
            const result = await BillService.deleteOrCancelBill(billId);
            const message = result.deleted_at ? "Bill soft-deleted successfully" : "Bill cancelled successfully";
            res.status(200).json({ success: true, message: message, data: { bill_id: billId, status: result.status, deleted_at: result.deleted_at } });
        } catch (err) { next(err); }
    }

    // --- RESTORE ---
    async restoreBill(req, res, next) {
        try {
            const billId = parseInt(req.params.id, 10);
            if (isNaN(billId)) return res.status(400).json({ success: false, message: "Invalid Bill ID" });

            const restoredBill = await BillService.restoreBill(billId);
            res.status(200).json({ success: true, message: "Bill restored successfully", data: restoredBill });
        } catch (err) { next(err); }
    }

    // Manual trigger to scan for overdue bills
    async refreshBillStatuses(req, res, next) {
        try {
            const count = await BillService.scanAndMarkOverdueBills();
            res.status(200).json({ 
                success: true, 
                message: `Scan complete. ${count} bills marked as Overdue.`,
                data: { updated_count: count }
            });
        } catch (err) { next(err); }
    }
}

module.exports = new BillController();
