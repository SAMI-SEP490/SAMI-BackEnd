// Updated: 2025-12-28
// By: DatNB & Gemini Refactor

const contractService = require('../services/contract.service');

class ContractController {
    // Tạo hợp đồng mới với file PDF
    async createContract(req, res, next) {
        try {
            const file = req.file; // File từ multer
            const contract = await contractService.createContract(req.body, file, req.user);

            res.status(201).json({
                success: true,
                message: 'Contract created successfully',
                data: contract
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy thông tin hợp đồng theo ID
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

    // Lấy danh sách hợp đồng
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

    // Cập nhật hợp đồng
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

    // Xóa mềm hợp đồng
    async deleteContract(req, res, next) {
        try {
            const { id } = req.params;
            const result = await contractService.deleteContract(
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

    // Xóa vĩnh viễn hợp đồng (chỉ OWNER)
    async hardDeleteContract(req, res, next) {
        try {
            const { id } = req.params;


            if (req.user.role !== 'OWNER') {
                return res.status(403).json({
                    success: false,
                    message: 'Only OWNER can permanently delete contracts'
                });
            }


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

    // Khôi phục hợp đồng (chỉ OWNER/MANAGER)
    async restoreContract(req, res, next) {
        try {
            const { id } = req.params;

            if (req.user.role === 'TENANT') {
                return res.status(403).json({
                    success: false,
                    message: 'You do not have permission to restore contracts'
                });
            }


            const contract = await contractService.restoreContract(
                parseInt(id),
                req.user
            );

            res.json({
                success: true,
                message: 'Contract restored successfully',
                data: contract
            });
        } catch (err) {
            next(err);
        }
    }

    // Terminate hợp đồng (chỉ OWNER/MANAGER)
    async terminateContract(req, res, next) {
        try {
            const { id } = req.params;
            const { reason } = req.body;

            if (req.user.role === 'TENANT') {
                return res.status(403).json({
                    success: false,
                    message: 'You do not have permission to terminate contracts'
                });
            }


            const contract = await contractService.terminateContract(
                parseInt(id),
                reason,
                req.user
            );

            res.json({
                success: true,
                message: 'Contract terminated successfully',
                data: contract
            });
        } catch (err) {
            next(err);
        }
    }

    // Download contract - Trả về URL presigned
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

    // Download contract trực tiếp - Stream file
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

    // Upload ảnh và chuyển thành PDF
    async uploadContractImages(req, res, next) {
        try {
            const { id } = req.params; // contract_id

            if (!req.files || req.files.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Không có ảnh nào được upload!'
                });
            }

            if (req.user.role === 'TENANT') {
                return res.status(403).json({
                    success: false,
                    message: 'You do not have permission to upload contract files'
                });
            }


            const result = await contractService.convertAndUpload(
                parseInt(id),
                req.files,
                req.user
            );

            res.json({
                success: true,
                message: ' Ảnh đã được chuyển thành PDF và upload lên S3 thành công!',
                data: result,
            });
        } catch (err) {
            next(err);
        }
    }

    // Xử lý hợp đồng bằng AI
    async processContractWithAI(req, res, next) {
        try {
            const file = req.file; // File từ multer

            if (!file) {
                return res.status(400).json({
                    success: false,
                    message: 'Vui lòng upload file PDF hợp đồng'
                });
            }

            if (file.mimetype !== 'application/pdf') {
                return res.status(400).json({
                    success: false,
                    message: 'Chỉ chấp nhận file PDF'
                });
            }

            if (req.user.role === 'TENANT') {
                return res.status(403).json({
                    success: false,
                    message: 'You do not have permission to use AI processing'
                });
            }

            console.log(`📄 Processing contract PDF: ${file.originalname}`);

            // Xử lý AI (Logic này không cần check DB permission sâu nên không cần req.user)
            const result = await contractService.processContractWithAI(
                file.buffer,
                file.mimetype
            );

            if (!result.success) {
                return res.status(200).json({
                    success: false,
                    stage: result.stage,
                    message: result.error,
                    data: {
                        parsed_data: result.parsed_data,
                        search_params: result.search_params,
                        suggestion: result.suggestion
                    }
                });
            }

            res.status(200).json({
                success: true,
                message: ' Xử lý AI thành công',
                data: {
                    contract_data: result.contract_data,
                    tenant_info: result.tenant_info,
                    parsed_data: result.parsed_data,
                    validation_warnings: result.validation_warnings,
                    processing_summary: result.processing_summary
                },
                next_steps: result.validation_warnings.length > 0
                    ? 'Review và sửa data trước khi tạo contract'
                    : 'Data đầy đủ, có thể tạo contract ngay'
            });

        } catch (err) {
            console.error(' Error in processContractWithAI controller:', err);
            next(err);
        }
    }

    // Endpoint để force update tất cả hợp đồng hết hạn
    async updateExpiredContracts(req, res, next) {
        try {
            if (req.user.role === 'TENANT') {
                return res.status(403).json({
                    success: false,
                    message: 'You do not have permission to update expired contracts'
                });
            }

            const count = await contractService.autoUpdateExpiredContracts();

            res.json({
                success: true,
                message: `Updated ${count} expired contracts`,
                data: { updated_count: count }
            });
        } catch (err) {
            next(err);
        }
    }

    // [BOT] Lấy link download hợp đồng cho Chatbot
    async getMyContractFileForBot(req, res, next) {
        try {
            const { tenant_user_id } = req.body;

            if (!tenant_user_id) {
                return res.json({ url: null, message: "Lỗi: Không tìm thấy ID người dùng." });
            }

            // 1. Giả lập user object để reuse service logic
            // NOTE: Cẩn thận bảo mật ở route này (nên có IP whitelist hoặc API Key riêng cho Bot)
            const mockUser = { role: 'TENANT', user_id: parseInt(tenant_user_id) };

            // 2. Tìm hợp đồng đang Active
            const result = await contractService.getContracts({
                status: 'active',
                page: 1,
                limit: 1
            }, mockUser);

            const activeContract = result.data?.[0];

            // 3. Kiểm tra file
            if (!activeContract || !activeContract.s3_key) {
                // Fallback: Thử tìm hợp đồng Pending
                const pendingResult = await contractService.getContracts({
                    status: 'pending',
                    page: 1,
                    limit: 1
                }, mockUser);

                const pendingContract = pendingResult.data?.[0];

                if (pendingContract && pendingContract.s3_key) {
                    const downloadData = await contractService.downloadContract(pendingContract.contract_id, mockUser);
                    return res.json({
                        url: downloadData.download_url,
                        message: "Đây là bản nháp hợp đồng đang chờ duyệt (Link hết hạn trong 1 giờ)."
                    });
                }

                return res.json({
                    url: null,
                    message: "Hiện chưa có bản mềm hợp đồng (PDF) trên hệ thống."
                });
            }

            // 4. Generate URL
            const downloadData = await contractService.downloadContract(activeContract.contract_id, mockUser);

            return res.json({
                url: downloadData.download_url,
                message: "Đây là link tải hợp đồng của bạn (Link hết hạn trong 1 giờ)."
            });

        } catch (err) {
            console.error("Bot Contract Download Error:", err.message);
            res.json({
                url: null,
                message: "Không thể lấy file hợp đồng lúc này. Vui lòng thử lại sau."
            });
        }
    }
}

module.exports = new ContractController();