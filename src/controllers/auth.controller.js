// Updated: 2025-15-10
// by: DatNB


const authService = require('../services/auth.service');

class AuthController {
    async register(req, res, next) {
        try {
            const user = await authService.register(req.body);

            res.status(201).json({
                success: true,
                message: 'Registration successful.',
                data: { user }
            });
        } catch (err) {
            next(err);
        }
    }

    async login(req, res, next) {
        try {
            const { email, password } = req.body;
            const ipAddress = req.ip || req.connection.remoteAddress;
            const userAgent = req.headers['user-agent'];
            const deviceId = req.headers['x-device-id'];

            const result = await authService.login(email, password, ipAddress, userAgent, deviceId);

            res.json({
                success: true,
                message: result.requiresOTP ? 'OTP sent to your email' : 'Login successful',
                data: result
            });
        } catch (err) {
            next(err);
        }
    }

    async verifyOTP(req, res, next) {
        try {
            const { userId, otp } = req.body;

            const result = await authService.verifyOTP(userId, otp);

            res.json({
                success: true,
                message: 'OTP verified successfully',
                data: result
            });
        } catch (err) {
            next(err);
        }
    }

    async resendOTP(req, res, next) {
        try {
            const { userId } = req.body;

            const result = await authService.resendOTP(userId);

            res.json({
                success: true,
                message: result.message
            });
        } catch (err) {
            next(err);
        }
    }

    async refreshToken(req, res, next) {
        try {
            const { refreshToken } = req.body;

            const result = await authService.refreshAccessToken(refreshToken);

            res.json({
                success: true,
                message: 'Token refreshed successfully',
                data: result
            });
        } catch (err) {
            next(err);
        }
    }

    async logout(req, res, next) {
        try {
            const { refreshToken } = req.body;

            await authService.logout(refreshToken);

            res.json({
                success: true,
                message: 'Logout successful'
            });
        } catch (err) {
            next(err);
        }
    }



    async forgotPassword(req, res) {
        try {
            const { email } = req.body;

            const result = await authService.forgotPassword(email);

            return res.status(200).json({
                success: true,
                message: result.message,
                email: result.email || email,
                userID: result.userID
            });
        } catch (error) {
            console.error('Forgot password error:', error);
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }
    }

    async verifyPasswordResetOTP(req, res) {
        try {
            const { userId, otp } = req.body;

            const result = await authService.verifyPasswordResetOTP(userId, otp);

            return res.status(200).json({
                success: true,
                message: result.message,
                resetToken: result.resetToken,
                userId: result.userId
            });
        } catch (error) {
            console.error('Verify OTP error:', error);
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }
    }

    async resetPassword(req, res) {
        try {
            const { userId, resetToken, newPassword } = req.body;

            const result = await authService.resetPassword(userId, resetToken, newPassword);

            return res.status(200).json({
                success: true,
                message: result.message
            });
        } catch (error) {
            console.error('Reset password error:', error);
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }
    }
    async resendPasswordResetOTP(req, res) {
        try {
            const { userId } = req.body;

            const result = await authService.resendPasswordResetOTP(userId);

            return res.status(200).json({
                success: true,
                message: result.message
            });
        } catch (error) {
            console.error('Resend OTP error:', error);
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }
    }

    async changePassword(req, res, next) {
        try {
            const { currentPassword, newPassword } = req.body;

            await authService.changePassword(req.user.user_id, currentPassword, newPassword);

            res.json({
                success: true,
                message: 'Password changed successfully'
            });
        } catch (err) {
            next(err);
        }
    }

    async getProfile(req, res, next) {
        try {
            const user = await authService.getUserProfile(req.user.user_id);

            res.json({
                success: true,
                data: { user }
            });
        } catch (err) {
            next(err);
        }
    }

    async updateProfile(req, res, next) {
        try {
            // Lấy file avatar từ request (nếu có)
            const avatarFile = req.file || null;

            // Validate file type nếu có upload
            if (avatarFile) {
                const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
                if (!allowedMimeTypes.includes(avatarFile.mimetype)) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid file type. Only JPEG, PNG, and WebP images are allowed.'
                    });
                }

                // Validate file size (max 5MB)
                const maxSize = 5 * 1024 * 1024; // 5MB
                if (avatarFile.size > maxSize) {
                    return res.status(400).json({
                        success: false,
                        message: 'File size too large. Maximum size is 5MB.'
                    });
                }
            }

            const updatedUser = await authService.updateProfile(
                req.user.user_id,
                req.body,
                avatarFile
            );

            res.json({
                success: true,
                message: 'Profile updated successfully',
                data: { user: updatedUser }
            });
        } catch (err) {
            next(err);
        }
    }


}

module.exports = new AuthController();