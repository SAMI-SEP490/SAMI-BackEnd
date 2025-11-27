
// Updated: 2025-17-10
// By: DatNB

const contractService = require('../services/contract.service');

class ContractController {
    // Tạo hợp đồng mới với file PDF
    async createContract(req, res, next) {
        try {
            const file = req.file; // File từ multer
            const contract = await contractService.createContract(req.body, file);

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
                req.user  // Truyền thông tin user hiện tại
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
                req.user  // Truyền thông tin user hiện tại
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
            const contract = await contractService.updateContract(parseInt(id), req.body, file);

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
            const result = await contractService.deleteContract(parseInt(id));

            res.json({
                success: true,
                message: result.message
            });
        } catch (err) {
            next(err);
        }
    }

    // Xóa vĩnh viễn hợp đồng
    async hardDeleteContract(req, res, next) {
        try {
            const { id } = req.params;
            const result = await contractService.hardDeleteContract(parseInt(id));

            res.json({
                success: true,
                message: result.message
            });
        } catch (err) {
            next(err);
        }
    }

    // Khôi phục hợp đồng
    async restoreContract(req, res, next) {
        try {
            const { id } = req.params;
            const contract = await contractService.restoreContract(parseInt(id));

            res.json({
                success: true,
                message: 'Contract restored successfully',
                data: contract
            });
        } catch (err) {
            next(err);
        }
    }

    async downloadContract(req, res, next) {
        try {
            const { id } = req.params;
            const result = await contractService.downloadContract(
                parseInt(id),
                req.user  //
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

    async downloadContractDirect(req, res, next) {
        try {
            const { id } = req.params;
            const result = await contractService.downloadContractDirect(
                parseInt(id),
                req.user  //
            );
            res.setHeader('Content-Type', result.content_type);
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.file_name)}"`);
            res.send(result.buffer);
        } catch (err) {
            next(err);
        }
    }
    async uploadContractImages(req, res, next) {
        try {
            const { id } = req.params; // contract_id
            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ message: 'Không có ảnh nào được upload!' });
            }

            // Gửi toàn bộ file (buffer + thông tin) cho service
            const result = await contractService.convertAndUpload(parseInt(id), req.files);

            res.json({
                success: true,
                message: '✅ Ảnh đã được chuyển thành PDF và upload lên S3 thành công!',
                data: result,
            });
        } catch (err) {
            next(err);
        }
    }
    async processContractWithAI(req, res, next) {
        try {
            const file = req.file; // File từ multer

            if (!file) {
                return res.status(400).json({
                    success: false,
                    message: 'Vui lòng upload file PDF hợp đồng'
                });
            }

            // Validate file type
            if (file.mimetype !== 'application/pdf') {
                return res.status(400).json({
                    success: false,
                    message: 'Chỉ chấp nhận file PDF'
                });
            }

            console.log(`📄 Processing contract PDF: ${file.originalname}`);

            // Xử lý AI
            const result = await contractService.processContractWithAI(
                file.buffer,
                file.mimetype
            );

            // Nếu không tìm thấy tenant hoặc thiếu thông tin
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

            // Thành công - trả về data để admin review
            res.status(200).json({
                success: true,
                message: '✅ Xử lý AI thành công',
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
            console.error('❌ Error in processContractWithAI controller:', err);
            next(err);
        }
    }

}

module.exports = new ContractController();