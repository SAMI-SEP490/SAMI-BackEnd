// Updated: 2024-13-10
// by: DatNB

const nodemailer = require('nodemailer');
const config = require('../config');

const transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.port === 465,
    auth: {
        user: config.email.user,
        pass: config.email.password
    }
});

const sendEmail = async (to, subject, html) => {
    try {
        await transporter.sendMail({
            from: config.email.from,
            to,
            subject,
            html
        });
        return true;
    } catch (err) {
        console.error('Email sending error:', err);
        return false;
    }
};

const sendVerificationEmail = async (email, token) => {
    const verificationUrl = `${config.frontend.url}/verify-email?token=${token}`;

    const html = `
    <h1>Verify Your Email</h1>
    <p>Click the link below to verify your email address:</p>
    <a href="${verificationUrl}">${verificationUrl}</a>
    <p>This link will expire in ${config.tokens.emailVerificationExpires} hours.</p>
    <p>If you didn't create an account, please ignore this email.</p>
  `;

    return sendEmail(email, 'Verify Your Email', html);
};

const sendPasswordResetEmail = async (email, token) => {
    const resetUrl = `${config.frontend.url}/reset-password?token=${token}`;

    const html = `
    <h1>Reset Your Password</h1>
    <p>Click the link below to reset your password:</p>
    <a href="${resetUrl}">${resetUrl}</a>
    <p>This link will expire in ${config.tokens.passwordResetExpires} hour(s).</p>
    <p>If you didn't request a password reset, please ignore this email.</p>
  `;

    return sendEmail(email, 'Reset Your Password', html);
};

const sendWelcomeEmail = async (email, firstName) => {
    const html = `
    <h1>Welcome ${firstName}!</h1>
    <p>Thank you for joining us. We're excited to have you on board!</p>
    <p>Get started by exploring our features.</p>
  `;

    return sendEmail(email, 'Welcome!', html);
};
async function sendOTPEmail(email, otp, fullName) {
    const subject = 'Your OTP Code for Login';
    const html = `
        <h2>Hello ${fullName},</h2>
        <p>Your OTP code for login is:</p>
        <h1 style="color: #4CAF50; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
        <p>This code will expire in 10 minutes.</p>
        <p>If you didn't request this code, please ignore this email.</p>
    `;
    return sendEmail(email, subject, html);
}
module.exports = {
    sendEmail,
    sendVerificationEmail,
    sendPasswordResetEmail,
    sendWelcomeEmail,
    sendOTPEmail
};