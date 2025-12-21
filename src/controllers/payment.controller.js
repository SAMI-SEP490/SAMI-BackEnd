// Updated: 2025-28-10
// by: MinhBH

const PaymentService = require('../services/payment.service');
const excelJS = require('exceljs');
const fastcsv = require('fast-csv');
const fs = require('fs');
const prisma = require('../config/prisma');

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

    async createPayOS(req, res, next) {
        try {
            const { billIds } = req.body;
            const tenantUserId = req.user.user_id;
            const result = await PaymentService.createPayOSLink(tenantUserId, billIds);
            res.status(200).json({ success: true, data: result });
        } catch (err) { next(err); }
    }

    async handlePayOSWebhook(req, res, next) {
        try {
            await PaymentService.handlePayOSWebhook(req.body);
            res.status(200).json({ success: true });
        } catch (err) {
            console.error("PayOS Webhook Error:", err);
            res.status(200).json({ success: false }); // Return 200 to stop retries on logic errors
        }
    }

    // --- HTML Pages for Browser Flow ---
    /**
     * Serve a dynamic HTML success page
     */
    async renderSuccessPage(req, res) {
        try {
            // 1. Extract data from PayOS params
            const { orderCode } = req.query;

            // 2. Fetch details from DB (Optional, but looks professional)
            // We use orderCode because we mapped it to payment_id
            let amountDisplay = "";
            let refDisplay = orderCode;
            
            if (orderCode) {
                // Re-add prefix to find in DB
                const dbReference = `PAYOS-${orderCode}`;
                const payment = await prisma.bill_payments.findFirst({
                    where: { reference: dbReference }
                });
                if (payment) {
                    amountDisplay = Number(payment.amount).toLocaleString('vi-VN') + " VND";
                }
            }

            // DEEP LINK: sami://dashboard
            // Ensure you configured 'scheme': 'sami' in your app.json
            const deepLink = "sami://dashboard";

            const html = `
                <html>
                    <head>
                        <title>Thanh toán thành công</title>
                        <meta name="viewport" content="width=device-width, initial-scale=1">
                        <style>
                            body { font-family: -apple-system, system-ui, sans-serif; background-color: #f0f2f5; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                            .card { background: white; padding: 40px 30px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 400px; width: 90%; }
                            .icon { font-size: 64px; margin-bottom: 20px; display: block; }
                            h1 { color: #28a745; margin: 0 0 10px; font-size: 24px; }
                            p { color: #6c757d; font-size: 16px; margin: 10px 0; }
                            .details { background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: left; }
                            .details-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
                            .label { color: #6c757d; }
                            .value { font-weight: 600; color: #343a40; }
                            
                            /* Button Style */
                            .btn { 
                                display: block; 
                                background: #28a745; 
                                color: white; 
                                padding: 14px; 
                                border-radius: 12px; 
                                text-decoration: none; 
                                font-weight: 700; 
                                margin-top: 20px; 
                                text-align: center;
                                font-size: 16px;
                                box-shadow: 0 4px 6px rgba(40, 167, 69, 0.2);
                            }
                            .btn:hover { background: #218838; }
                        </style>
                    </head>
                    <body>
                        <div class="card">
                            <span class="icon">🎉</span>
                            <h1>Thanh toán thành công!</h1>
                            <p>Cảm ơn bạn. Giao dịch của bạn đã được hệ thống ghi nhận.</p>
                            
                            <div class="details">
                                <div class="details-row">
                                    <span class="label">Mã đơn:</span>
                                    <span class="value">#${refDisplay}</span>
                                </div>
                                ${amountDisplay ? `
                                <div class="details-row">
                                    <span class="label">Số tiền:</span>
                                    <span class="value">${amountDisplay}</span>
                                </div>
                                ` : ''}
                            </div>

                            <a href="${deepLink}" class="btn">Quay lại Ứng dụng</a>
                            
                            <p style="font-size: 12px; margin-top: 15px; color: #999">
                                Nếu ứng dụng không tự mở, hãy nhấn nút trên.
                            </p>
                        </div>
                        <script>
                            // Auto-redirect after 1 second
                            setTimeout(function() {
                                window.location.href = "${deepLink}";
                            }, 1000);
                        </script>
                    </body>
                </html>
            `;
            res.send(html);
        } catch (err) {
            console.error(err);
            res.send("<h1>Payment Successful</h1>"); // Fallback
        }
    }

    /**
     * Serve a dynamic HTML cancel page
     */
    async renderCancelPage(req, res) {
        const { orderCode } = req.query;
        const dbReference = `PAYOS-${orderCode}`;
        const deepLink = "sami://dashboard";

        const html = `
            <html>
                <head>
                    <title>Đã hủy thanh toán</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <style>
                        body { font-family: -apple-system, system-ui, sans-serif; background-color: #f0f2f5; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                        .card { background: white; padding: 40px 30px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 400px; width: 90%; }
                        .icon { font-size: 64px; margin-bottom: 20px; display: block; }
                        h1 { color: #dc3545; margin: 0 0 10px; font-size: 24px; }
                        p { color: #6c757d; font-size: 16px; margin: 10px 0; }
                        
                        /* Button Style */
                        .btn { 
                            display: block; 
                            background: #6c757d; 
                            color: white; 
                            padding: 14px; 
                            border-radius: 12px; 
                            text-decoration: none; 
                            font-weight: 700; 
                            margin-top: 20px; 
                            text-align: center;
                            font-size: 16px;
                        }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <span class="icon">❌</span>
                        <h1>Thanh toán đã hủy</h1>
                        <p>Giao dịch chưa hoàn tất.</p>
                        
                        <a href="${deepLink}" class="btn">Quay lại Ứng dụng</a>
                    </div>
                </body>
            </html>
        `;
        res.send(html);
    }

    /**
     * Bot creates a PayOS Link
     */
    async createPayOSLinkByBot(req, res, next) {
        try {
            // 1. Get data from Bot request
            // Note: Dify might send bill_id as a single number or string
            const { tenant_user_id, bill_id } = req.body;

            if (!tenant_user_id || !bill_id) {
                return res.status(400).json({ success: false, message: "Missing required fields" });
            }

            // 2. Ensure billIds is an array (Bot might send just one ID)
            const billIds = Array.isArray(bill_id) ? bill_id : [parseInt(bill_id)];

            // 3. Call the existing service
            const result = await PaymentService.createPayOSLink(tenant_user_id, billIds);

            // 4. Return URL
            res.json({
                success: true,
                data: {
                    checkoutUrl: result.checkoutUrl,
                    message: "Payment link created successfully."
                }
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Paid as cash
     */
    async createCashPayment(req, res, next) {
        try {
            const { bill_ids, note } = req.body;

            if (!bill_ids || !Array.isArray(bill_ids) || bill_ids.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Please provide a list of bill_ids to pay.'
                });
            }

            // req.user.user_id is the Manager/Owner calling the API
            const result = await PaymentService.createCashPayment(
                req.user.user_id, 
                bill_ids, 
                note
            );
            
            // Optional: Send Push Notification to Tenant
            const NotificationService = require('../services/notification.service');
            await NotificationService.sendPaymentSuccessNotification(result);

            res.status(201).json({
                success: true,
                message: 'Cash payment recorded successfully',
                data: result
            });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new PaymentController();
