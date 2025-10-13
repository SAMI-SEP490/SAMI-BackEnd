// Updated: 2024-13-10
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
                message: 'Login successful',
                data: result
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



    async forgotPassword(req, res, next) {
        try {
            const { email } = req.body;

            await authService.forgotPassword(email);

            res.json({
                success: true,
                message: 'If an account exists with this email or phone, a password reset link has been sent'
            });
        } catch (err) {
            next(err);
        }
    }

    async resetPassword(req, res, next) {
        try {
            const { token, password } = req.body;

            await authService.resetPassword(token, password);

            res.json({
                success: true,
                message: 'Password reset successfully'
            });
        } catch (err) {
            next(err);
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
            const updatedUser = await authService.updateProfile(req.user.user_id, req.body);

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