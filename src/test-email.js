
import nodemailer from "nodemailer";

async function sendOtpEmail(toEmail, otp) {
    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: "datchthk22@gmail.com", // Gmail của bạn
            pass: "ddur vlrj olxd mqqn",   // App Password (không phải mật khẩu Gmail)
        },
    });

    const mailOptions = {
        from: '"YourApp" <youremail@gmail.com>',
        to: toEmail,
        subject: "Mã OTP của bạn",
        text: `Mã OTP của bạn là: ${otp}. Mã có hiệu lực trong 5 phút.`,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log("✅ OTP đã được gửi đến:", toEmail);
    } catch (error) {
        console.error("❌ Lỗi khi gửi email:", error);
    }
}

// Ví dụ test
sendOtpEmail("datvip01htv@gmail.com", Math.floor(100000 + Math.random() * 900000));
