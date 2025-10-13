// Updated: 2024-12-10
// by: DatNB

const prisma = require('../config/prisma');
const { hashPassword, comparePassword } = require('../utils/password');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { generateRandomToken } = require('../utils/tokens');
const { sendVerificationEmail, sendPasswordResetEmail, sendWelcomeEmail } = require('../utils/email');
const config = require('../config');

class AuthService {
    async register(data) {
        const { email, password, phone, full_name, gender, birthday } = data;
        const existingUser = await prisma.users.findFirst({
            where: {
                OR: [
                    { email },
                    { phone }
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
                status: 'Active'
            }
        });

        // Note: Email verification would require adding email_verifications table to schema
        // For now, we'll skip verification token creation

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

        // Generate tokens
        const accessToken = generateAccessToken(user.user_id);
        const refreshToken = generateRefreshToken(user.user_id);

        // Note: Refresh token storage would require adding refresh_tokens table to schema
        // For now, we'll just return the tokens

        // Update user timestamps
        await prisma.users.update({
            where: { user_id: user.user_id },
            data: { updated_at: new Date() }
        });

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

    async logoutAll(userId) {
        // Note: Without refresh_tokens table, we can't invalidate all tokens
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

    async deactivateAccount(userId) {
        await prisma.users.update({
            where: { user_id: userId },
            data: {
                status: 'Inactive',
                updated_at: new Date()
            }
        });

        return true;
    }

    async deleteAccount(userId) {
        await prisma.users.update({
            where: { user_id: userId },
            data: {
                deleted_at: new Date(),
                status: 'Deleted'
            }
        });

        return true;
    }
}

module.exports = new AuthService();