// Updated: 2025-28-10
// by: MinhBH

const BillService = require('../services/bill.service');
const { billSchema } = require('../middlewares/validation.middleware'); // Assuming schema is imported

class BillController {

    // --- LISTING ---
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
    async getMasterBills(req, res, next) {
        try {
            const bills = await BillService.getMasterBills();
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
    async createBill(req, res, next) {
        try {
            // Validation is handled by middleware
            const createdById = req.user.user_id;
            const newBill = await BillService.createBill(req.body, createdById);
            res.status(201).json({ success: true, message: "Bill created successfully", data: newBill });
        } catch (err) { next(err); }
    }

    // --- EDIT ---
    async updateBill(req, res, next) {
        try {
            const billId = parseInt(req.params.id, 10);
            if (isNaN(billId)) return res.status(400).json({ success: false, message: "Invalid Bill ID" });
            
            // Validation handled by middleware
            const updatedById = req.user.user_id;
            const updatedBill = await BillService.updateBill(billId, req.body, updatedById);
            res.status(200).json({ success: true, message: "Bill updated successfully", data: updatedBill });
        } catch (err) { next(err); }
    }
    
    // --- CLONE DRAFT TO MASTER ---
     async cloneDraftToMaster(req, res, next) {
        try {
            const draftBillId = parseInt(req.params.id, 10);
             if (isNaN(draftBillId)) return res.status(400).json({ success: false, message: "Invalid Draft Bill ID" });
             
             const updatedById = req.user.user_id;
             const newMasterBill = await BillService.cloneDraftToMaster(draftBillId, updatedById);
             res.status(201).json({ success: true, message: "Draft bill cloned to master successfully", data: newMasterBill });
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
}

module.exports = new BillController();
