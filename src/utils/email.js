// Updated: 2025-15-10
// by: DatNB


const nodemailer = require('nodemailer');
const config = require('../config');

// Create reusable transporter object using Gmail SMTP
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: config.email.gmailUser || process.env.GMAIL_USER,     // your Gmail address
        pass: config.email.gmailAppPassword || process.env.GMAIL_APP_PASSWORD  // Gmail App Password (not regular password)
    }
});

async function sendEmail(toEmail, subject, htmlContent) {
    const mailOptions = {
        from: {
            name: config.email.fromName || process.env.EMAIL_FROM_NAME || 'SAMI Support',
            address:  process.env.EMAIL_FROM || config.email.gmailUser
        },
        to: toEmail,
        subject: subject,
        html: htmlContent
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Email sent successfully:', info.messageId);
        console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
        return info;
    } catch (err) {
        console.error('❌ Failed to send email:', err.message);
        console.error('Error code:', err.code);
        console.error('Error response:', err.response);
        console.error('Full error object:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
        throw err;
    }
}

async function sendOTPEmail(email, otp, fullName) {
    const subject = '🔐 Your OTP Code for Login';
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                    line-height: 1.6;
                    color: #333;
                    margin: 0;
                    padding: 0;
                    background-color: #f4f4f4;
                }
                .container {
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                }
                .content {
                    background-color: white;
                    padding: 40px;
                    border-radius: 10px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }
                .header {
                    text-align: center;
                    margin-bottom: 30px;
                }
                .header h1 {
                    color: #2c3e50;
                    margin: 0;
                    font-size: 24px;
                }
                .otp-box {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    font-size: 36px;
                    font-weight: bold;
                    letter-spacing: 10px;
                    text-align: center;
                    padding: 25px;
                    margin: 30px 0;
                    border-radius: 8px;
                    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
                }
                .info {
                    background-color: #f8f9fa;
                    padding: 15px;
                    border-radius: 5px;
                    margin: 20px 0;
                    border-left: 4px solid #667eea;
                }
                .warning {
                    background-color: #fff3cd;
                    color: #856404;
                    padding: 15px;
                    border-radius: 5px;
                    margin: 20px 0;
                    border-left: 4px solid #ffc107;
                }
                .footer {
                    text-align: center;
                    margin-top: 30px;
                    padding-top: 20px;
                    border-top: 1px solid #e0e0e0;
                    color: #666;
                    font-size: 14px;
                }
                @media only screen and (max-width: 600px) {
                    .content {
                        padding: 20px;
                    }
                    .otp-box {
                        font-size: 28px;
                        letter-spacing: 8px;
                    }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="content">
                    <div class="header">
                        <h1>🔐 Login Verification</h1>
                    </div>
                    
                    <p>Hello <strong>${fullName || 'User'}</strong>,</p>
                    
                    <p>Thank you for logging in! To complete the login process and secure your account, please use the following One-Time Password (OTP):</p>
                    
                    <div class="otp-box">${otp}</div>
                    
                    <div class="info">
                        <strong>⏱️ Important:</strong> This code will expire in <strong>10 minutes</strong>.
                    </div>
                    
                    <p>Enter this code in the verification screen to continue to your account.</p>
                    
                    <div class="warning">
                        <strong>⚠️ Security Notice</strong><br>
                        If you didn't attempt to log in, please ignore this email and ensure your account password is secure. Never share this code with anyone.
                    </div>
                    
                    <div class="footer">
                        <p>This is an automated message, please do not reply to this email.</p>
                        <p style="color: #999; font-size: 12px;">&copy; ${new Date().getFullYear()} Your Company. All rights reserved.</p>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;

    return sendEmail(email, subject, html);
}

async function sendPasswordResetEmail(email, otp, fullName) {
    const subject = '🔐 Your OTP Code for Forget Password';
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                    line-height: 1.6;
                    color: #333;
                    margin: 0;
                    padding: 0;
                    background-color: #f4f4f4;
                }
                .container {
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                }
                .content {
                    background-color: white;
                    padding: 40px;
                    border-radius: 10px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }
                .header {
                    text-align: center;
                    margin-bottom: 30px;
                }
                .header h1 {
                    color: #2c3e50;
                    margin: 0;
                    font-size: 24px;
                }
                .otp-box {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    font-size: 36px;
                    font-weight: bold;
                    letter-spacing: 10px;
                    text-align: center;
                    padding: 25px;
                    margin: 30px 0;
                    border-radius: 8px;
                    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
                }
                .info {
                    background-color: #f8f9fa;
                    padding: 15px;
                    border-radius: 5px;
                    margin: 20px 0;
                    border-left: 4px solid #667eea;
                }
                .warning {
                    background-color: #fff3cd;
                    color: #856404;
                    padding: 15px;
                    border-radius: 5px;
                    margin: 20px 0;
                    border-left: 4px solid #ffc107;
                }
                .footer {
                    text-align: center;
                    margin-top: 30px;
                    padding-top: 20px;
                    border-top: 1px solid #e0e0e0;
                    color: #666;
                    font-size: 14px;
                }
                @media only screen and (max-width: 600px) {
                    .content {
                        padding: 20px;
                    }
                    .otp-box {
                        font-size: 28px;
                        letter-spacing: 8px;
                    }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="content">
                    <div class="header">
                        <h1>🔐 Reset Password Request</h1>
                    </div>
                    
                    <p>Hello <strong>${fullName || 'User'}</strong>,</p>
                    
                    <p>We received a request to reset the password associated with your account. If you made this request, please use the following One-Time Password (OTP):</p>
                    
                    <div class="otp-box">${otp}</div>
                    
                    <div class="info">
                        <strong>⏱️ Important:</strong> This code will expire in <strong>10 minutes</strong>.
                    </div>
                    
                    <p>Enter this code in the verification screen to continue to your account.</p>
                    
                    <div class="warning">
                        <strong>⚠️ Security Notice</strong><br>
                        If you didn't attempt to log in, please ignore this email and ensure your account password is secure. Never share this code with anyone.
                    </div>
                    
                    <div class="footer">
                        <p>This is an automated message, please do not reply to this email.</p>
                        <p style="color: #999; font-size: 12px;">&copy; ${new Date().getFullYear()} Your Company. All rights reserved.</p>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;

    return sendEmail(email, subject, html);
}
/**
 * Gửi email yêu cầu phê duyệt Hợp đồng thuê
 * @param {string} email - Email người nhận
 * @param {string} fullName - Tên người nhận
 * @param {object} contractData - Thông tin hợp đồng (contractNumber, roomNumber, startDate, endDate)
 * @param {string} actionUrl - Link deep link hoặc web link để mở hợp đồng
 */
async function sendContractApprovalEmail(email, fullName, contractData, actionUrl = '#') {
    const subject = `📄 Yêu cầu ký Hợp đồng thuê nhà - Phòng ${contractData.roomNumber}`;

    // Format ngày tháng cho đẹp (nếu có)
    const formatDate = (date) => date ? new Date(date).toLocaleDateString('vi-VN') : 'N/A';

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; margin: 0; padding: 0; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .content { background-color: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
                .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #f0f0f0; padding-bottom: 20px; }
                .header h1 { color: #2c3e50; margin: 0; font-size: 24px; }
                .details-box { background-color: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px; margin: 20px 0; }
                .details-row { display: flex; justify-content: space-between; margin-bottom: 10px; border-bottom: 1px dashed #e0e0e0; padding-bottom: 5px; }
                .details-row:last-child { border-bottom: none; margin-bottom: 0; }
                .label { color: #666; font-weight: 500; }
                .value { color: #2c3e50; font-weight: bold; }
                .btn-container { text-align: center; margin: 30px 0; }
                .btn { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white !important; padding: 12px 30px; text-decoration: none; border-radius: 50px; font-weight: bold; display: inline-block; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4); transition: transform 0.2s; }
                .btn:hover { transform: translateY(-2px); }
                .footer { text-align: center; margin-top: 30px; font-size: 12px; color: #999; border-top: 1px solid #e0e0e0; padding-top: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="content">
                    <div class="header">
                        <h1>📝 Hợp đồng mới cần phê duyệt</h1>
                    </div>
                    
                    <p>Xin chào <strong>${fullName || 'Quý khách'}</strong>,</p>
                    
                    <p>Bạn vừa nhận được một yêu cầu ký hợp đồng thuê nhà mới. Vui lòng kiểm tra thông tin chi tiết và thực hiện xác nhận trong ứng dụng.</p>
                    
                    <div class="details-box">
                        <div class="details-row">
                            <span class="label">Mã hợp đồng:</span>
                            <span class="value">${contractData.contractNumber}</span>
                        </div>
                        <div class="details-row">
                            <span class="label">Phòng:</span>
                            <span class="value">${contractData.roomNumber}</span>
                        </div>
                        <div class="details-row">
                            <span class="label">Ngày bắt đầu:</span>
                            <span class="value">${formatDate(contractData.startDate)}</span>
                        </div>
                        <div class="details-row">
                            <span class="label">Thời hạn:</span>
                            <span class="value">${contractData.duration} tháng</span>
                        </div>
                    </div>

                    <div class="btn-container">
                        <a href="${actionUrl}" class="btn">Xem và Ký Hợp đồng</a>
                    </div>
                    
                    <p style="font-size: 14px; color: #666;">
                        <em>* Nếu nút bấm không hoạt động, vui lòng mở ứng dụng của bạn và kiểm tra mục "Hợp đồng".</em>
                    </p>

                    <div class="footer">
                        <p>Đây là email tự động, vui lòng không trả lời email này.</p>
                        <p>&copy; ${new Date().getFullYear()} SAMI Management System.</p>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;

    return sendEmail(email, subject, html);
}

/**
 * Gửi email yêu cầu phê duyệt Phụ lục hợp đồng (Gia hạn, chấm dứt, thay đổi...)
 * @param {string} email - Email người nhận
 * @param {string} fullName - Tên người nhận
 * @param {object} addendumData - Thông tin phụ lục (type, contractNumber, effectiveDate)
 * @param {string} actionUrl - Link deep link hoặc web link
 */
async function sendAddendumApprovalEmail(email, fullName, addendumData, actionUrl = '#') {
    // Mapping loại phụ lục sang tiếng Việt cho tiêu đề dễ hiểu
    const typeMap = {
        'extension': 'Gia hạn hợp đồng',
        'early_termination': 'Chấm dứt trước hạn',
        'rent_adjustment': 'Điều chỉnh giá thuê',
        'general_amendment': 'Điều chỉnh điều khoản',
        'default': 'Phụ lục hợp đồng'
    };
    const typeText = typeMap[addendumData.type] || typeMap['default'];

    const subject = `⚠️ Yêu cầu phê duyệt: ${typeText} - HĐ #${addendumData.contractNumber}`;
    const formatDate = (date) => date ? new Date(date).toLocaleDateString('vi-VN') : 'N/A';

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; margin: 0; padding: 0; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .content { background-color: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
                .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #f0f0f0; padding-bottom: 20px; }
                .header h1 { color: #d35400; margin: 0; font-size: 24px; } /* Màu cam cho cảnh báo/thay đổi */
                .details-box { background-color: #fff8f0; border: 1px solid #ffe0b2; border-radius: 8px; padding: 20px; margin: 20px 0; }
                .details-row { display: flex; justify-content: space-between; margin-bottom: 10px; border-bottom: 1px dashed #ffe0b2; padding-bottom: 5px; }
                .details-row:last-child { border-bottom: none; margin-bottom: 0; }
                .label { color: #666; font-weight: 500; }
                .value { color: #d35400; font-weight: bold; }
                .btn-container { text-align: center; margin: 30px 0; }
                .btn { background: linear-gradient(135deg, #e67e22 0%, #d35400 100%); color: white !important; padding: 12px 30px; text-decoration: none; border-radius: 50px; font-weight: bold; display: inline-block; box-shadow: 0 4px 15px rgba(230, 126, 34, 0.4); transition: transform 0.2s; }
                .btn:hover { transform: translateY(-2px); }
                .footer { text-align: center; margin-top: 30px; font-size: 12px; color: #999; border-top: 1px solid #e0e0e0; padding-top: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="content">
                    <div class="header">
                        <h1>📑 Phê duyệt Phụ lục Hợp đồng</h1>
                    </div>
                    
                    <p>Xin chào <strong>${fullName || 'Quý khách'}</strong>,</p>
                    
                    <p>Có một thay đổi liên quan đến hợp đồng thuê hiện tại của bạn. Vui lòng xem xét và xác nhận phụ lục dưới đây:</p>
                    
                    <div class="details-box">
                        <div class="details-row">
                            <span class="label">Loại phụ lục:</span>
                            <span class="value" style="text-transform: uppercase;">${typeText}</span>
                        </div>
                        <div class="details-row">
                            <span class="label">Mã hợp đồng gốc:</span>
                            <span class="value">${addendumData.contractNumber}</span>
                        </div>
                         <div class="details-row">
                            <span class="label">Ngày hiệu lực:</span>
                            <span class="value">${formatDate(addendumData.effectiveDate)}</span>
                        </div>
                    </div>

                    <div class="btn-container">
                        <a href="${actionUrl}" class="btn">Xem chi tiết & Xác nhận</a>
                    </div>

                    <div class="footer">
                        <p>Đây là email tự động, vui lòng không trả lời email này.</p>
                        <p>&copy; ${new Date().getFullYear()} SAMI Management System.</p>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;

    return sendEmail(email, subject, html);
}
/**
 * Gửi hóa đơn thanh toán thành công
 * @param {string} email - Email người nhận
 * @param {string} fullName - Tên người nhận
 * @param {object} payment - Object payment từ DB (bao gồm relation payment_details.bill)
 */
async function sendPaymentReceiptEmail(email, fullName, payment) {
    const subject = `✅ Xác nhận thanh toán thành công #${payment.transaction_id || payment.reference}`;
    
    // Format helpers
    const fmtMoney = (n) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(n));
    const fmtDate = (d) => new Date(d).toLocaleDateString('vi-VN', { hour: '2-digit', minute: '2-digit' });

    // Payment Method Label
    let methodLabel = "Online";
    if (payment.method === 'cash') methodLabel = "Tiền mặt";
    else if (payment.online_type) methodLabel = `${payment.online_type}`;

    // Build Bill List Rows
    const billRows = payment.payment_details.map(detail => {
        const billNum = detail.bill?.bill_number || "Unknown Bill";
        const type = detail.bill?.bill_type || "Fee";
        const amount = fmtMoney(detail.amount);
        return `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 10px 0; color: #555;">${billNum} <small>(${type})</small></td>
                <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #333;">${amount}</td>
            </tr>
        `;
    }).join('');

    // Use Config + Trampoline logic
    const backendUrl = config.app.backendUrl;
    const trampolineLink = `${backendUrl}/api/app/open?path=dashboard`;

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                /* ... (Keep styles same as before) ... */
                body { font-family: Helvetica, Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .receipt-card { background-color: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
                .header { text-align: center; border-bottom: 2px dashed #eee; padding-bottom: 20px; margin-bottom: 20px; }
                .success-icon { font-size: 48px; margin-bottom: 10px; display: block; }
                .total-amount { font-size: 32px; color: #27ae60; font-weight: 800; margin: 10px 0; }
                .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px; font-size: 14px; }
                .label { color: #888; display: block; margin-bottom: 4px; }
                .value { font-weight: 600; color: #333; }
                .bill-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px; }
                .footer { text-align: center; margin-top: 30px; font-size: 12px; color: #999; }
                
                /* Button Style */
                .btn-app {
                    background: #333; 
                    color: white; 
                    padding: 12px 24px; 
                    text-decoration: none; 
                    border-radius: 6px; 
                    font-weight: bold;
                    display: inline-block;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="receipt-card">
                    <div class="header">
                        <span class="success-icon">✅</span>
                        <h2 style="margin:0; color:#333;">Thanh toán thành công</h2>
                        <div class="total-amount">${fmtMoney(payment.amount)}</div>
                        <p style="color:#777; margin:5px 0;">Mã GD: ${payment.transaction_id || payment.reference}</p>
                    </div>

                    <div class="info-grid">
                        <div>
                            <span class="label">Người thanh toán</span>
                            <span class="value">${fullName}</span>
                        </div>
                        <div style="text-align:right;">
                            <span class="label">Thời gian</span>
                            <span class="value">${fmtDate(payment.payment_date)}</span>
                        </div>
                        <div>
                            <span class="label">Phương thức</span>
                            <span class="value">${methodLabel}</span>
                        </div>
                        <div style="text-align:right;">
                            <span class="label">Trạng thái</span>
                            <span class="value" style="color:#27ae60;">Hoàn thành</span>
                        </div>
                    </div>

                    <h3 style="font-size: 16px; border-bottom: 2px solid #333; padding-bottom: 10px; margin-top: 30px;">Chi tiết hóa đơn</h3>
                    <table class="bill-table">
                        ${billRows}
                    </table>
                    
                    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; text-align: center;">
                        <a href="${trampolineLink}" class="btn-app">Mở ứng dụng</a>
                        
                        <p style="font-size: 11px; color: #aaa; margin-top: 10px;">
                            Nếu nút không hoạt động, vui lòng mở ứng dụng SAMI trên điện thoại của bạn.
                        </p>
                    </div>
                </div>
                <div class="footer">
                    <p>Cảm ơn bạn đã sử dụng dịch vụ của SAMI.</p>
                </div>
            </div>
        </body>
        </html>
    `;

    return sendEmail(email, subject, html);
}
// Test email configuration
async function testEmailConnection() {
    try {
        if (!config.email.gmailUser || !config.email.gmailAppPassword) {
            throw new Error('Gmail credentials not configured. Please set GMAIL_USER and GMAIL_APP_PASSWORD');
        }

        // Verify transporter configuration
        await transporter.verify();
        console.log('✅ Gmail SMTP server is ready to send emails');
        console.log('Configured sender:', config.email.gmailUser);
        return true;
    } catch (error) {
        console.error('❌ Gmail email service error:');
        console.error('Error message:', error.message);
        console.error('Error code:', error.code);

        if (error.code === 'EAUTH') {
            console.error('Authentication failed. Make sure you are using a Gmail App Password, not your regular password.');
            console.error('To create an App Password:');
            console.error('1. Go to https://myaccount.google.com/security');
            console.error('2. Enable 2-Step Verification if not already enabled');
            console.error('3. Go to App Passwords and create a new one');
        }

        console.error('Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
        return false;
    }
}

module.exports = {
    sendEmail,
    sendOTPEmail,
    testEmailConnection,
    sendPasswordResetEmail,
    sendContractApprovalEmail,
    sendAddendumApprovalEmail,
    sendPaymentReceiptEmail
};