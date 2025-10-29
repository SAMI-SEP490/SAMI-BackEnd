// Updated: 2025-28-10
// by: MinhBH

const PaymentService = require('../services/payment.service');
const excelJS = require('exceljs');
const fastcsv = require('fast-csv');
const fs = require('fs');

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

    // --- TENANT HISTORY ---
    async getTenantPaymentHistory(req, res, next) {
        try {
            const tenantUserId = req.user.user_id;
            const history = await PaymentService.getTenantPaymentHistory(tenantUserId);
            res.status(200).json({ success: true, data: history });
        } catch (err) { next(err); }
    }

    // --- OWNER/MANAGER REVENUE REPORTING ---
    async getYearlyRevenueReport(req, res, next) {
        try {
            const year = parseInt(req.query.year, 10);
            if (isNaN(year) || year < 2000 || year > 2100) {
                 return res.status(400).json({ success: false, message: "Valid 'year' query parameter is required." });
            }
            const report = await PaymentService.getYearlyRevenueReport(year);
            res.status(200).json({ success: true, data: report });
        } catch (err) { next(err); }
    }

    async getMonthlyRevenueDetails(req, res, next) {
         try {
             const year = parseInt(req.query.year, 10);
             const month = parseInt(req.query.month, 10);
             if (isNaN(year) || year < 2000 || year > 2100 || isNaN(month) || month < 1 || month > 12) {
                  return res.status(400).json({ success: false, message: "Valid 'year' and 'month' query parameters are required." });
             }
            const details = await PaymentService.getMonthlyRevenueDetails(year, month);
            res.status(200).json({ success: true, data: details });
         } catch (err) { next(err); }
    }
    
    // --- REVENUE EXPORT ---
    async exportRevenue(req, res, next) {
         try {
            const year = parseInt(req.query.year, 10);
            const month = req.query.month ? parseInt(req.query.month, 10) : null;
            const format = req.query.format || 'csv'; // Default to CSV

            if (isNaN(year) || year < 2000 || year > 2100) {
                 return res.status(400).json({ success: false, message: "Valid 'year' query parameter is required." });
            }
            if (month && (isNaN(month) || month < 1 || month > 12)) {
                 return res.status(400).json({ success: false, message: "Invalid 'month' query parameter." });
            }
            if (format !== 'csv' && format !== 'xlsx') {
                 return res.status(400).json({ success: false, message: "Invalid 'format' query parameter. Use 'csv' or 'xlsx'." });
            }

            const data = await PaymentService.exportRevenueData(year, month);
            
            let filename = `revenue-${year}`;
            if (month) filename += `-${String(month).padStart(2, '0')}`;

            if (format === 'xlsx') {
                 filename += '.xlsx';
                 const workbook = new excelJS.Workbook();
                 const worksheet = workbook.addWorksheet('Revenue');
                 
                 // Define columns based on exportData keys
                 worksheet.columns = Object.keys(data[0] || {}).map(key => ({ header: key, key: key, width: 20 }));
                 
                 // Add rows
                 worksheet.addRows(data);

                 res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                 res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
                 
                 await workbook.xlsx.write(res);
                 res.end();

            } else { // CSV
                 filename += '.csv';
                 res.setHeader('Content-Type', 'text/csv');
                 res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

                 fastcsv.write(data, { headers: true })
                    .pipe(res);
            }

         } catch (err) { next(err); }
    }

    /**
     * Get all payment history (for Manager/Owner).
     */
    async getAllPaymentHistory(req, res, next) {
        try {
            // Optional: Add filtering based on req.query later
            const history = await PaymentService.getAllPaymentHistory();
            res.status(200).json({ success: true, data: history });
        } catch (err) { next(err); }
    }
}

module.exports = new PaymentController();
