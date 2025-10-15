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
    sendPasswordResetEmail
};