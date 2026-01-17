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

    async getVersionDetail(req, res) {
        try {
            const { versionId } = req.params;
            const version = await consentService.getVersionById(versionId);

            if (!version) {
                return res.status(404).json({ success: false, message: 'Version not found' });
            }

            res.json({ success: true, data: version });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Tạo bản nháp (Draft)
     * POST /api/consent/version/draft
     */
    async draftVersion(req, res) {
        try {
            const { consentType, versionNumber, content } = req.body;

            // Validate cơ bản
            if (!consentType || !versionNumber || !content) {
                return res.status(400).json({
                    success: false,
                    message: 'consentType, versionNumber, and content are required'
                });
            }

            const version = await consentService.draftConsentVersion(
                consentType,
                versionNumber,
                content
            );

            res.json({
                success: true,
                data: version,
                message: 'Draft version created successfully. Not yet active.'
            });
        } catch (error) {
            console.error('Error drafting version:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Cập nhật bản nháp
     * PUT /api/consent/version/:versionId
     */
    async updateVersion(req, res) {
        try {
            const { versionId } = req.params;
            const { content, versionNumber } = req.body;

            const updatedVersion = await consentService.updateConsentVersion(
                versionId,
                content,
                versionNumber
            );

            res.json({
                success: true,
                data: updatedVersion,
                message: 'Version updated successfully'
            });
        } catch (error) {
            console.error('Error updating version:', error);
            // Check lỗi nghiệp vụ để trả về 400 thay vì 500
            if (error.message.includes('Cannot update')) {
                return res.status(400).json({ success: false, message: error.message });
            }
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Công bố (Publish) một version
     * POST /api/consent/version/:versionId/publish
     */
    async publishVersion(req, res) {
        try {
            const {versionId} = req.params;

            const publishedVersion = await consentService.publishConsentVersion(versionId);

            res.json({
                success: true,
                data: publishedVersion,
                message: 'Version published and is now ACTIVE.'
            });
        } catch (error) {
            console.error('Error publishing version:', error);
            res.status(500).json({success: false, message: error.message});
        }
    }

    async checkPending(req, res) {
        try {
            // Giả sử userId lấy từ token (middleware auth)
            // Nếu chưa có middleware, bạn có thể test bằng query param ?userId=...
            const userId = req.user ? req.user.user_id : parseInt(req.query.userId);

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const pendingList = await consentService.getPendingConsents(userId);

            // Client sẽ dựa vào mảng này:
            // - Nếu mảng rỗng [] => Login thẳng vào Dashboard
            // - Nếu có phần tử => Hiện Modal yêu cầu ký
            res.json({
                success: true,
                data: pendingList
            });
        } catch (error) {
            console.error('Error checking pending consents:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

}

module.exports = new ConsentController();