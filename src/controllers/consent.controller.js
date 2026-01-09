const consentService = require('../services/consent.service');

class ConsentController {
    /**
     * Tenant đồng ý điều khoản
     * POST /api/consent/accept
     */
    async acceptConsent(req, res) {
        try {
            const { userId, consentType, contractId, addendumId } = req.body;

            // Validate required fields
            if (!userId || !consentType) {
                return res.status(400).json({
                    success: false,
                    message: 'userId and consentType are required'
                });
            }

            // Get request metadata
            const ipAddress = req.headers['x-forwarded-for']?.split(',')[0] ||
                req.socket.remoteAddress ||
                'unknown';
            const deviceInfo = req.headers['user-agent'] || 'unknown';
            const sessionId = req.headers['x-session-id'] || req.session?.id;

            const result = await consentService.logConsent({
                userId,
                consentType,
                contractId,
                addendumId,
                action: 'ACCEPTED',
                ipAddress,
                deviceInfo,
                sessionId,
            });

            res.json(result);
        } catch (error) {
            console.error('Error accepting consent:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to accept consent'
            });
        }
    }

    /**
     * Tenant thu hồi sự đồng ý
     * POST /api/consent/revoke
     */
    async revokeConsent(req, res) {
        try {
            const { userId, consentType } = req.body;

            if (!userId || !consentType) {
                return res.status(400).json({
                    success: false,
                    message: 'userId and consentType are required'
                });
            }

            const ipAddress = req.headers['x-forwarded-for']?.split(',')[0] ||
                req.socket.remoteAddress ||
                'unknown';
            const deviceInfo = req.headers['user-agent'] || 'unknown';
            const sessionId = req.headers['x-session-id'] || req.session?.id;

            const result = await consentService.logConsent({
                userId,
                consentType,
                action: 'REVOKED',
                ipAddress,
                deviceInfo,
                sessionId,
            });

            res.json(result);
        } catch (error) {
            console.error('Error revoking consent:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to revoke consent'
            });
        }
    }

    /**
     * Lấy lịch sử consent của user
     * GET /api/consent/history/:userId
     */
    async getHistory(req, res) {
        try {
            const userId = parseInt(req.params.userId);

            if (isNaN(userId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid userId'
                });
            }

            const history = await consentService.getUserConsentHistory(userId);

            res.json({
                success: true,
                data: history
            });
        } catch (error) {
            console.error('Error getting consent history:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to get consent history'
            });
        }
    }

    /**
     * Kiểm tra user đã đồng ý chưa
     * GET /api/consent/check/:userId/:consentType
     */
    async checkConsent(req, res) {
        try {
            const userId = parseInt(req.params.userId);
            const { consentType } = req.params;

            if (isNaN(userId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid userId'
                });
            }

            const hasAccepted = await consentService.hasUserAcceptedConsent(userId, consentType);

            res.json({
                success: true,
                hasAccepted
            });
        } catch (error) {
            console.error('Error checking consent:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to check consent'
            });
        }
    }

    /**
     * Lấy version hiện tại của consent
     * GET /api/consent/version/:consentType
     */
    async getActiveVersion(req, res) {
        try {
            const { consentType } = req.params;

            const version = await consentService.getActiveVersion(consentType);

            if (!version) {
                return res.status(404).json({
                    success: false,
                    message: 'No active version found'
                });
            }

            res.json({
                success: true,
                data: version
            });
        } catch (error) {
            console.error('Error getting consent version:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to get consent version'
            });
        }
    }

    /**
     * Tạo version mới (Admin only)
     * POST /api/consent/version
     */
    async createVersion(req, res) {
        try {
            const { consentType, versionNumber, content } = req.body;

            if (!consentType || !versionNumber || !content) {
                return res.status(400).json({
                    success: false,
                    message: 'consentType, versionNumber, and content are required'
                });
            }

            const version = await consentService.createConsentVersion(
                consentType,
                versionNumber,
                content
            );

            res.json({
                success: true,
                data: version,
                message: 'Consent version created successfully'
            });
        } catch (error) {
            console.error('Error creating consent version:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to create consent version'
            });
        }
    }

    /**
     * Lấy tất cả versions
     * GET /api/consent/versions
     */
    async getAllVersions(req, res) {
        try {
            const { consentType } = req.query;

            const versions = await consentService.getAllVersions(consentType);

            res.json({
                success: true,
                data: versions
            });
        } catch (error) {
            console.error('Error getting consent versions:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to get consent versions'
            });
        }
    }
}

module.exports = new ConsentController();