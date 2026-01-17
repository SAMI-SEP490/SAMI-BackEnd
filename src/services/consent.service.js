const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const { getCloudWatchLogger } = require('../utils/cloudwatch-logger');

const prisma = new PrismaClient();

class ConsentService {
    /**
     * Tạo hash SHA256 cho data integrity
     */
    createDataHash(data, content) {
        const hashInput = JSON.stringify({
            ...data,
            content,
            timestamp: new Date().toISOString(),
        });
        return crypto.createHash('sha256').update(hashInput).digest('hex');
    }

    /**
     * Lấy version hiện tại của consent type
     */
    async getActiveVersion(consentType) {
        return await prisma.consent_versions.findFirst({
            where: {
                consent_type: consentType,
                is_active: true,
            },
        });
    }

    /**
     * Tạo version mới cho Terms/Policy
     */
    async createConsentVersion(consentType, versionNumber, content) {
        const contentHash = crypto
            .createHash('sha256')
            .update(content)
            .digest('hex');

        // Deactivate các version cũ
        await prisma.consent_versions.updateMany({
            where: {
                consent_type: consentType,
                is_active: true,
            },
            data: {
                is_active: false,
            },
        });

        // Tạo version mới
        return await prisma.consent_versions.create({
            data: {
                consent_type: consentType,
                version_number: versionNumber,
                content,
                content_hash: contentHash,
                is_active: true,
            },
        });
    }

    /**
     * Ghi nhận consent log khi tenant đồng ý/từ chối điều khoản
     */
    async logConsent(data) {
        try {
            const { userId, consentType, contractId, addendumId, action, ipAddress, deviceInfo, sessionId } = data;

            // 1. Lấy version hiện tại
            const activeVersion = await this.getActiveVersion(consentType);
            if (!activeVersion) {
                throw new Error(`No active version found for ${consentType}`);
            }

            // [MỚI] 2. Lấy trạng thái gần nhất của user với version/hợp đồng này
            const latestLog = await prisma.consent_logs.findFirst({
                where: {
                    user_id: userId,
                    version_id: activeVersion.version_id,
                    contract_id: contractId || null, // Quan trọng: check đúng ngữ cảnh hợp đồng
                },
                orderBy: {
                    created_at: 'desc',
                },
            });

            const currentStatus = latestLog ? latestLog.action : null;

            // --- KIỂM TRA LOGIC NGHIỆP VỤ ---

            // LOGIC A: Idempotency (Chặn trùng)
            // Nếu trạng thái mới Y HỆT trạng thái cũ -> Bỏ qua, coi như thành công
            if (currentStatus === action) {
                return {
                    success: true,
                    message: `Consent is already ${action}. No changes made.`,
                    logId: latestLog.log_id // Trả về logId cũ
                };
            }

            // LOGIC B: Irreversibility (Một chiều)
            // Nếu đã ACCEPTED thì không được phép REVOKED nữa
            if (currentStatus === 'ACCEPTED' && action === 'REVOKED') {
                throw new Error('Cannot revoke consent once accepted. Please use the formal termination process.');
            }

            // ---------------------------------

            // 3. Tạo data hash (như cũ)
            const dataHash = this.createDataHash(data, activeVersion.content);

            // 4. Lưu vào database (như cũ)
            const consentLog = await prisma.consent_logs.create({
                data: {
                    user_id: userId,
                    contract_id: contractId || null,
                    addendum_id: addendumId || null,
                    version_id: activeVersion.version_id,
                    action: action,
                    ip_address: ipAddress,
                    device_info: deviceInfo,
                    data_hash: dataHash,
                    session_id: sessionId || null,
                },
                include: {
                    user: { select: { user_id: true, full_name: true, email: true, phone: true } },
                    version: { select: { consent_type: true, version_number: true } },
                    contract: { select: { contract_number: true, room_id: true } },
                },
            });

            // 5. Gửi log lên CloudWatch (như cũ)
            this.sendToCloudWatch(consentLog, activeVersion).catch(err => {
                console.error('Failed to send log to CloudWatch:', err.message);
            });

            return {
                success: true,
                logId: consentLog.log_id,
                message: 'Consent logged successfully'
            };
        } catch (error) {
            console.error('❌ Error logging consent:', error);
            throw error; // Controller sẽ catch lỗi này và trả về 500/400
        }
    }

    /**
     * Gửi log lên CloudWatch (internal method)
     */
    async sendToCloudWatch(consentLog, activeVersion) {
        try {
            const cloudWatch = getCloudWatchLogger();

            await cloudWatch.log('CONSENT_ACTION', {
                logId: consentLog.log_id,
                userId: consentLog.user_id,
                userName: consentLog.user.full_name,
                userEmail: consentLog.user.email,
                userPhone: consentLog.user.phone,
                consentType: activeVersion.consent_type,
                versionNumber: activeVersion.version_number,
                action: consentLog.action,
                contractNumber: consentLog.contract?.contract_number,
                roomId: consentLog.contract?.room_id,
                ipAddress: consentLog.ip_address,
                deviceInfo: consentLog.device_info,
                sessionId: consentLog.session_id,
                dataHash: consentLog.data_hash,
                timestamp: consentLog.created_at,
            });

            console.log(`✅ Consent log ${consentLog.log_id} sent to CloudWatch`);
        } catch (error) {
            // Log error nhưng không throw để không ảnh hưởng đến flow chính
            console.error('Failed to send to CloudWatch:', error.message);
        }
    }

    /**
     * Lấy lịch sử consent của user
     */
    async getUserConsentHistory(userId) {
        return await prisma.consent_logs.findMany({
            where: { user_id: userId },
            include: {
                version: {
                    select: {
                        consent_type: true,
                        version_number: true,
                    },
                },
                contract: {
                    select: {
                        contract_number: true,
                    },
                },
            },
            orderBy: {
                created_at: 'desc',
            },
        });
    }

    /**
     * Kiểm tra user đã đồng ý consent chưa
     */
    async hasUserAcceptedConsent(userId, consentType) {
        const activeVersion = await this.getActiveVersion(consentType);

        if (!activeVersion) return false;

        const latestLog = await prisma.consent_logs.findFirst({
            where: {
                user_id: userId,
                version_id: activeVersion.version_id,
            },
            orderBy: {
                created_at: 'desc',
            },
        });

        return latestLog?.action === 'ACCEPTED';
    }

    /**
     * Lấy tất cả consent versions
     */
    async getAllVersions(consentType) {
        return await prisma.consent_versions.findMany({
            where: consentType ? { consent_type: consentType } : {},
            orderBy: {
                created_at: 'desc',
            },
        });
    }

    async getVersionById(versionId) {
        return await prisma.consent_versions.findUnique({
            where: { version_id: parseInt(versionId) }
        });
    }

    /**
     * [C] Create Draft: Tạo bản nháp mới (Chưa active)
     */
    async draftConsentVersion(consentType, versionNumber, content) {
        const contentHash = crypto
            .createHash('sha256')
            .update(content)
            .digest('hex');

        // Chỉ tạo, không set is_active = true
        return await prisma.consent_versions.create({
            data: {
                consent_type: consentType,
                version_number: versionNumber,
                content: content,
                content_hash: contentHash,
                is_active: false, // Mặc định là bản nháp
            },
        });
    }

    /**
     * [U] Update Draft: Sửa nội dung bản nháp
     * Chỉ cho phép sửa khi chưa Active và chưa có ai ký
     */
    async updateConsentVersion(versionId, newContent, newVersionNumber) {
        const id = parseInt(versionId);

        // 1. Kiểm tra tồn tại và trạng thái
        const version = await prisma.consent_versions.findUnique({
            where: { version_id: id }
        });

        if (!version) {
            throw new Error('Version not found');
        }

        // BLOCK: Không cho sửa bản đang chạy
        if (version.is_active) {
            throw new Error('Cannot update an ACTIVE version. Please draft a new version instead.');
        }

        // BLOCK: Không cho sửa bản đã có người ký (an toàn dữ liệu)
        const hasLogs = await prisma.consent_logs.findFirst({
            where: { version_id: id }
        });
        if (hasLogs) {
            throw new Error('Cannot update this version because users have already signed/interacted with it.');
        }

        // 2. Chuẩn bị data update
        const updateData = {};
        if (newContent) {
            updateData.content = newContent;
            updateData.content_hash = crypto.createHash('sha256').update(newContent).digest('hex');
        }
        if (newVersionNumber) {
            updateData.version_number = newVersionNumber;
        }

        // 3. Thực hiện update
        return await prisma.consent_versions.update({
            where: { version_id: id },
            data: updateData
        });
    }

    /**
     * [Action] Publish: Công bố bản nháp thành bản chính thức
     */
    async publishConsentVersion(versionId) {
        const id = parseInt(versionId);

        // 1. Lấy thông tin version cần publish
        const versionToPublish = await prisma.consent_versions.findUnique({
            where: { version_id: id }
        });

        if (!versionToPublish) {
            throw new Error('Version not found');
        }

        if (versionToPublish.is_active) {
            return versionToPublish; // Đã active rồi thì thôi
        }

        // 2. Sử dụng transaction để đảm bảo tính nhất quán
        // - Tắt tất cả version cũ cùng loại
        // - Bật version mới
        return await prisma.$transaction(async (tx) => {
            // Deactivate old versions
            await tx.consent_versions.updateMany({
                where: {
                    consent_type: versionToPublish.consent_type,
                    is_active: true
                },
                data: { is_active: false }
            });

            // Activate new version
            return await tx.consent_versions.update({
                where: { version_id: id },
                data: { is_active: true }
            });
        });
    }

}

module.exports = new ConsentService();