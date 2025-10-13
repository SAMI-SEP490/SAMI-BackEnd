// Updated: 2024-13-10
// by: DatNB


const prisma = require('../config/prisma');
const redis = require('../config/redis');
const { hashPassword, comparePassword } = require('../utils/password');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { generateRandomToken } = require('../utils/tokens');
const { sendVerificationEmail, sendPasswordResetEmail, sendWelcomeEmail, sendOTPEmail } = require('../utils/email');
const config = require('../config');

class AuthService {
    async register(data) {
        const { email, password, phone, full_name, gender, birthday } = data;
        const existingUser = await prisma.users.findFirst({
            where: {
                OR: [
                    { email }
                ]
            }
        });

        if (existingUser) {
            throw new Error('User with this email or phone already exists');
        }

        // Hash password
        const hashedPassword = await hashPassword(password);

        // Create user
        const user = await prisma.users.create({
            data: {
                email,
                password_hash: hashedPassword,
                phone,
                full_name,
                gender,
                birthday: birthday ? new Date(birthday) : null,
                status: 'Active',
                is_verified: false // New field to track if user has completed first login OTP
            }
        });

        return {
            id: user.user_id,
            email: user.email,
            phone: user.phone,
            full_name: user.full_name,
            status: user.status
        };
    }

    async login(email, password, ipAddress, userAgent, deviceId) {
        // Find user by email or phone
        const user = await prisma.users.findFirst({
            where: {
                OR: [
                    { email },
                    { phone: email } // Allow login with phone number too
                ],
                deleted_at: null
            }
        });

        if (!user) {
            throw new Error('Invalid credentials');
        }

        // Check if account is active
        if (user.status !== 'Active') {
            throw new Error('Account is deactivated');
        }

        // Verify password
        const isValidPassword = await comparePassword(password, user.password_hash);

        if (!isValidPassword) {
            throw new Error('Invalid credentials');
        }

        // Check if this is first login (user not verified yet)
        if (!user.is_verified) {
            // Generate OTP
            const otp = this.generateOTP();

            // Store OTP in Redis with 10 minutes expiry
            const otpKey = `otp:${user.user_id}`;
            await redis.setex(otpKey, 600, otp); // 600 seconds = 10 minutes

            // Send OTP to email
            await sendOTPEmail(user.email, otp, user.full_name);

            return {
                requiresOTP: true,
                userId: user.user_id,
                email: user.email,
                message: 'OTP has been sent to your email'
            };
        }

        // User is already verified, proceed with normal login
        return this.generateLoginResponse(user);
    }

    async verifyOTP(userId, otp) {
        // Get OTP from Redis
        const otpKey = `otp:${userId}`;
        const storedOTP = await redis.get(otpKey);

        if (!storedOTP) {
            throw new Error('OTP has expired or does not exist');
        }

        if (storedOTP !== otp) {
            throw new Error('Invalid OTP');
        }

        // OTP is valid, delete it from Redis
        await redis.del(otpKey);

        // Mark user as verified
        const user = await prisma.users.update({
            where: { user_id: userId },
            data: {
                is_verified: true,
                updated_at: new Date()
            }
        });

        // Generate tokens and return login response
        return this.generateLoginResponse(user);
    }

    async resendOTP(userId) {
        const user = await prisma.users.findUnique({
            where: { user_id: userId }
        });

        if (!user) {
            throw new Error('User not found');
        }

        if (user.is_verified) {
            throw new Error('User is already verified');
        }

        // Check if there's a cooldown (prevent spam)
        const cooldownKey = `otp_cooldown:${userId}`;
        const cooldown = await redis.get(cooldownKey);

        if (cooldown) {
            throw new Error('Please wait before requesting another OTP');
        }

        // Generate new OTP
        const otp = this.generateOTP();

        // Store OTP in Redis with 10 minutes expiry
        const otpKey = `otp:${userId}`;
        await redis.setex(otpKey, 600, otp);

        // Set cooldown (60 seconds)
        await redis.setex(cooldownKey, 60, '1');

        // Send OTP to email
        await sendOTPEmail(user.email, otp, user.full_name);

        return {
            message: 'OTP has been resent to your email'
        };
    }

    generateOTP() {
        // Generate 6-digit OTP
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    generateLoginResponse(user) {
        // Generate tokens
        const accessToken = generateAccessToken(user.user_id);
        const refreshToken = generateRefreshToken(user.user_id);

        return {
            accessToken,
            refreshToken,
            user: {
                id: user.user_id,
                email: user.email,
                phone: user.phone,
                full_name: user.full_name,
                gender: user.gender,
                birthday: user.birthday,
                avatar_url: user.avatar_url,
                status: user.status
            }
        };
    }

    async refreshAccessToken(refreshToken) {
        // Verify refresh token
        const decoded = verifyRefreshToken(refreshToken);

        if (!decoded) {
            throw new Error('Invalid refresh token');
        }

        // Note: Without refresh_tokens table, we can't validate stored tokens
        // We'll just verify the JWT signature and generate new access token

        // Find user
        const user = await prisma.users.findUnique({
            where: { user_id: decoded.userId }
        });

        if (!user || user.deleted_at) {
            throw new Error('User not found');
        }

        // Check if user is active
        if (user.status !== 'Active') {
            throw new Error('Account is deactivated');
        }

        // Generate new access token
        const accessToken = generateAccessToken(user.user_id);

        return {
            accessToken,
            user: {
                id: user.user_id,
                email: user.email,
                phone: user.phone,
                full_name: user.full_name,
                status: user.status
            }
        };
    }

    async logout(refreshToken) {
        // Note: Without refresh_tokens table, we can't invalidate tokens
        // Tokens will remain valid until they expire
        return true;
    }


    async changePassword(userId, currentPassword, newPassword) {
        const user = await prisma.users.findUnique({
            where: { user_id: userId }
        });

        if (!user) {
            throw new Error('User not found');
        }

        // Verify current password
        const isValidPassword = await comparePassword(currentPassword, user.password_hash);

        if (!isValidPassword) {
            throw new Error('Current password is incorrect');
        }

        // Hash new password
        const hashedPassword = await hashPassword(newPassword);

        // Update password
        await prisma.users.update({
            where: { user_id: userId },
            data: {
                password_hash: hashedPassword,
                updated_at: new Date()
            }
        });

        return true;
    }

    async forgotPassword(email) {
        const user = await prisma.users.findFirst({
            where: {
                OR: [
                    { email },
                    { phone: email }
                ],
                deleted_at: null
            }
        });

        if (!user) {
            // Don't reveal if user exists
            return true;
        }

        // Note: Password reset would require adding password_resets table to schema
        // For now, we'll just return true

        // TODO: Create reset token and send email when password_resets table is added

        return true;
    }

    async resetPassword(token, newPassword) {
        // Note: This requires password_resets table in schema
        throw new Error('Password reset functionality requires database schema update');
    }

    async getUserProfile(userId) {
        const user = await prisma.users.findUnique({
            where: { user_id: userId },
            select: {
                user_id: true,
                email: true,
                phone: true,
                full_name: true,
                gender: true,
                birthday: true,
                avatar_url: true,
                status: true,
                created_at: true,
                updated_at: true
            }
        });

        if (!user || user.deleted_at) {
            throw new Error('User not found');
        }

        return user;
    }

    async updateProfile(userId, data) {
        const { full_name, gender, birthday, avatar_url } = data;

        const user = await prisma.users.update({
            where: { user_id: userId },
            data: {
                full_name,
                gender,
                birthday: birthday ? new Date(birthday) : undefined,
                avatar_url,
                updated_at: new Date()
            },
            select: {
                user_id: true,
                email: true,
                phone: true,
                full_name: true,
                gender: true,
                birthday: true,
                avatar_url: true,
                status: true
            }
        });

        return user;
    }

}

module.exports = new AuthService();