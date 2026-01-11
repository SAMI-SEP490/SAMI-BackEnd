// Updated: 2025-01-06
// By: DatNB
// Refactored: File handling + Tenant approval workflow

const contractAddendumService = require('../services/addendum.service');

class ContractAddendumController {
    // Tạo phụ lục hợp đồng mới (với file upload)
    async createAddendum(req, res, next) {
        try {
            const files = req.files; // Hỗ trợ multi-file upload

            console.log("Body:", req.body);
            console.log("Files:", files);

            const addendum = await contractAddendumService.createAddendum(
                req.body,
                files,
                req.user
            );

            res.status(201).json({
                success: true,
                message: 'Contract addendum created successfully (Pending Tenant Approval)',
                data: addendum
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy thông tin phụ lục theo ID
    async getAddendumById(req, res, next) {
        try {
            const { id } = req.params;
            const addendum = await contractAddendumService.getAddendumById(
                parseInt(id),
                req.user
            );

            res.json({
                success: true,
                data: addendum
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy danh sách phụ lục
    async getAddendums(req, res, next) {
        try {
            const addendums = await contractAddendumService.getAddendums(
                req.query,
                req.user
            );

            res.json({
                success: true,
                data: addendums.data,
                pagination: addendums.pagination
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy tất cả phụ lục của một hợp đồng
    async getAddendumsByContract(req, res, next) {
        try {
            const { contract_id } = req.params;
            const addendums = await contractAddendumService.getAddendumsByContract(
                parseInt(contract_id),
                req.user
            );

            res.json({
                success: true,
                data: addendums
            });
        } catch (err) {
            next(err);
        }
    }

    // Tenant duyệt phụ lục (Apply changes to contract)
    async approveAddendum(req, res, next) {
        try {
            const { id } = req.params;

            // [UPDATED] Lấy IP và User Agent để ghi log bằng chứng Consent
            const userAgent = req.headers['x-device-info'] || req.headers['user-agent'];
            const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

            const result = await contractAddendumService.approveAddendum(
                parseInt(id),
                req.user,
                ipAddress,
                userAgent
            );

            res.json({
                success: true,
                message: 'Contract addendum approved successfully. Changes applied to contract.',
                data: result
            });
        } catch (err) {
            next(err);
        }
    }

    // Tenant từ chối phụ lục
    async rejectAddendum(req, res, next) {
        try {
            const { id } = req.params;
            const { reason } = req.body;

            const userAgent = req.headers['x-device-info'] || req.headers['user-agent'];
            const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

            const addendum = await contractAddendumService.rejectAddendum(
                parseInt(id),
                reason || '',
                req.user,
                ipAddress,
                userAgent
            );

            res.json({
                success: true,
                message: 'Contract addendum rejected. No changes applied to contract.',
                data: addendum
            });
        } catch (err) {
            next(err);
        }
    }

    // Cập nhật phụ lục (có thể thay đổi file)
    async updateAddendum(req, res, next) {
        try {
            const { id } = req.params;
            const files = req.files; // Hỗ trợ thay đổi file

            const addendum = await contractAddendumService.updateAddendum(
                parseInt(id),
                req.body,
                files,
                req.user
            );

            res.json({
                success: true,
                message: 'Contract addendum updated successfully',
                data: addendum
            });
        } catch (err) {
            next(err);
        }
    }

    // Xóa phụ lục
    async deleteAddendum(req, res, next) {
        try {
            const { id } = req.params;
            const result = await contractAddendumService.deleteAddendum(
                parseInt(id),
                req.user
            );

            res.json({
                success: true,
                message: result.message
            });
        } catch (err) {
            next(err);
        }
    }

    // Download addendum - Presigned URL
    async downloadAddendum(req, res, next) {
        try {
            const { id } = req.params;
            const result = await contractAddendumService.downloadAddendum(
                parseInt(id),
                req.user
            );

            res.json({
                success: true,
                message: 'Download URL generated successfully',
                data: result
            });
        } catch (err) {
            next(err);
        }
    }

    // Download addendum - Direct stream
    async downloadAddendumDirect(req, res, next) {
        try {
            const { id } = req.params;
            const result = await contractAddendumService.downloadAddendumDirect(
                parseInt(id),
                req.user
            );

            res.setHeader('Content-Type', result.content_type);
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.file_name)}"`);
            res.send(result.buffer);
        } catch (err) {
            next(err);
        }
    }

    // Thống kê phụ lục
    async getAddendumStatistics(req, res, next) {
        try {
            const { contract_id } = req.query;
            const stats = await contractAddendumService.getAddendumStatistics(
                contract_id ? parseInt(contract_id) : null
            );

            res.json({
                success: true,
                data: stats
            });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new ContractAddendumController();