// Updated: 2025-12-29
// By: DatNB & Gemini Refactor
// Status: Synced with contract.service.js

const contractService = require('../services/contract.service');

class ContractController {
    // 1. Tạo hợp đồng mới
    async createContract(req, res, next) {
        try {
            const file = req.file;
            const contract = await contractService.createContract(req.body, file, req.user);

            res.status(201).json({
                success: true,
                message: 'Contract created successfully (Pending Approval)',
                data: contract
            });
        } catch (err) {
            next(err);
        }
    }

    // 2. Tenant Duyệt/Từ chối hợp đồng (MỚI)
    async approveContract(req, res, next) {
        try {
            const { id } = req.params;
            const { action, reason } = req.body; // action: 'accept' | 'reject'

            if (!['accept', 'reject'].includes(action)) {
                return res.status(400).json({
                    success: false,
                    message: 'Action must be either "accept" or "reject"'
                });
            }

            const contract = await contractService.approveContract(
                parseInt(id),
                action,
                reason,
                req.user
            );

            res.json({
                success: true,
                message: `Contract ${action}ed successfully`,
                data: contract
            });
        } catch (err) {
            next(err);
        }
    }

    // 3. Lấy thông tin hợp đồng theo ID
    async getContractById(req, res, next) {
        try {
            const { id } = req.params;
            const contract = await contractService.getContractById(
                parseInt(id),
                req.user
            );

            res.json({
                success: true,
                data: contract
            });
        } catch (err) {
            next(err);
        }
    }

    // 4. Lấy danh sách hợp đồng
    async getContracts(req, res, next) {
        try {
            const contracts = await contractService.getContracts(
                req.query,
                req.user
            );

            res.json({
                success: true,
                data: contracts.data,
                pagination: contracts.pagination
            });
        } catch (err) {
            next(err);
        }
    }

    // 5. Cập nhật hợp đồng (Chỉ khi Pending/Rejected)
    async updateContract(req, res, next) {
        try {
            const { id } = req.params;
            const file = req.file;
            const contract = await contractService.updateContract(
                parseInt(id),
                req.body,
                file,
                req.user
            );

            res.json({
                success: true,
                message: 'Contract updated successfully',
                data: contract
            });
        } catch (err) {
            next(err);
        }
    }

    // 6. Yêu cầu chấm dứt hợp đồng (Manager/Owner gửi request) (MỚI)
    async requestTermination(req, res, next) {
        try {
            const { id } = req.params;
            const { reason } = req.body;

            const contract = await contractService.requestTermination(
                parseInt(id),
                reason,
                req.user
            );

            res.json({
                success: true,
                message: 'Termination requested successfully',
                data: contract
            });
        } catch (err) {
            next(err);
        }
    }

    // 7. Tenant phản hồi yêu cầu chấm dứt (MỚI)
    async respondToTerminationRequest(req, res, next) {
        try {
            const { id } = req.params;
            const { action } = req.body; // 'approve' | 'reject'

            if (!['approve', 'reject'].includes(action)) {
                return res.status(400).json({
                    success: false,
                    message: 'Action must be either "approve" or "reject"'
                });
            }

            const contract = await contractService.handleTerminationRequest(
                parseInt(id),
                action,
                req.user
            );

            res.json({
                success: true,
                message: `Termination request ${action}ed`,
                data: contract
            });
        } catch (err) {
            next(err);
        }
    }

    // 8. Hoàn tất giao dịch chấm dứt (Sau khi thanh toán hóa đơn) (MỚI)
    async completePendingTransaction(req, res, next) {
        try {
            const { id } = req.params;
            const { final_status } = req.body; // 'terminated' | 'expired'

            const contract = await contractService.completePendingTransaction(
                parseInt(id),
                final_status,
                req.user
            );

            res.json({
                success: true,
                message: 'Transaction completed. Contract closed.',
                data: contract
            });
        } catch (err) {
            next(err);
        }
    }

    // 9. Xóa vĩnh viễn hợp đồng (Chỉ OWNER)
    async hardDeleteContract(req, res, next) {
        try {
            const { id } = req.params;

            const result = await contractService.hardDeleteContract(
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

    // 10. Download contract - URL Presigned
    async downloadContract(req, res, next) {
        try {
            const { id } = req.params;
            const result = await contractService.downloadContract(
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

    // 11. Download contract - Stream
    async downloadContractDirect(req, res, next) {
        try {
            const { id } = req.params;
            const result = await contractService.downloadContractDirect(
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


    // 13. AI Processing
    async processContractWithAI(req, res, next) {
        try {
            const file = req.file;

            if (!file) return res.status(400).json({ success: false, message: 'Missing PDF file' });
            if (file.mimetype !== 'application/pdf') return res.status(400).json({ success: false, message: 'PDF only' });

            const result = await contractService.processContractWithAI(
                file.buffer,
                file.mimetype
            );

            if (!result.success) {
                return res.status(200).json(result); // Return 200 with error data for frontend handling
            }

            res.json(result);
        } catch (err) {
            next(err);
        }
    }


    // 15. [BOT] Lấy link download cho Bot
    async getMyContractFileForBot(req, res, next) {
        try {
            const { tenant_user_id } = req.body;
            if (!tenant_user_id) return res.json({ url: null, message: "Lỗi: Thiếu ID." });

            const mockUser = { role: 'TENANT', user_id: parseInt(tenant_user_id) };

            // Tìm hợp đồng active
            let result = await contractService.getContracts({ status: 'active', page: 1, limit: 1 }, mockUser);
            let contract = result.data?.[0];

            // Nếu không có active, tìm pending
            if (!contract || !contract.s3_key) {
                result = await contractService.getContracts({ status: 'pending', page: 1, limit: 1 }, mockUser);
                contract = result.data?.[0];
            }

            if (!contract || !contract.s3_key) {
                return res.json({ url: null, message: "Chưa có file hợp đồng." });
            }

            const dl = await contractService.downloadContract(contract.contract_id, mockUser);
            res.json({ url: dl.download_url, message: "Link tải hợp đồng (1h):" });

        } catch (err) {
            console.error(err);
            res.json({ url: null, message: "Lỗi hệ thống." });
        }
    }
}

module.exports = new ContractController();