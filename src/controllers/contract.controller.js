// Updated: 2025-01-10
// Fix: Handle req.files (array) instead of req.file
// Update: Pass IP & User-Agent for Consent Logging

const contractService = require('../services/contract.service');
const prisma = require('../config/prisma');
const s3Service = require('../services/s3.service');

class ContractController {
    // 1. Tạo hợp đồng mới
    async createContract(req, res, next) {
        try {
            const files = req.files;

            // Log để debug xem body đã nhận được chưa
            console.log("Body:", req.body);
            console.log("Files:", files);

            const contract = await contractService.createContract(req.body, files, req.user);

            res.status(201).json({
                success: true,
                message: 'Contract created successfully (Pending Approval)',
                data: contract
            });
        } catch (err) {
            next(err);
        }
    }

    // 2. Tenant Duyệt/Từ chối hợp đồng
    async approveContract(req, res, next) {
        try {
            const { id } = req.params;
            const { action, reason } = req.body;

            if (!['accept', 'reject'].includes(action)) {
                return res.status(400).json({
                    success: false,
                    message: 'Action must be either "accept" or "reject"'
                });
            }

            // [UPDATED] Lấy IP và User Agent để ghi log bằng chứng Consent
            const userAgent = req.headers['x-device-info'] || req.headers['user-agent'];
            const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

            const contract = await contractService.approveContract(
                parseInt(id),
                action,
                reason,
                req.user,
                ipAddress, // New param
                userAgent  // New param
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

    // 5. Cập nhật hợp đồng
    async updateContract(req, res, next) {
        try {
            const { id } = req.params;
            // FIX: Dùng req.files
            const files = req.files;

            const contract = await contractService.updateContract(
                parseInt(id),
                req.body,
                files,
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

    // 6. Yêu cầu chấm dứt hợp đồng
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

    // 7. Tenant phản hồi yêu cầu chấm dứt
    async respondToTerminationRequest(req, res, next) {
        try {
            const { id } = req.params;
            const { action } = req.body;

            if (!['approve', 'reject'].includes(action)) {
                return res.status(400).json({
                    success: false,
                    message: 'Action must be either "approve" or "reject"'
                });
            }

            // [UPDATED] Lấy IP và User Agent cho log Termination Consent
            const userAgent = req.headers['x-device-info'] || req.headers['user-agent'];
            const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

            const contract = await contractService.handleTerminationRequest(
                parseInt(id),
                action,
                req.user,
                ipAddress, // New param
                userAgent  // New param
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

    // 8. Hoàn tất giao dịch chấm dứt
    async completePendingTransaction(req, res, next) {
        try {
            const { id } = req.params;
            // final_status không còn bắt buộc phải gửi từ client vì logic auto-resolve
            // nhưng giữ lại để tương thích ngược nếu cần
            const { final_status } = req.body;

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

    // 9. Xóa vĩnh viễn hợp đồng
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

    async getPendingActionForTenant(req, res, next) {
        try {
            // req.user được giải mã từ middleware authenticate
            const userId = req.user.user_id;

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: "User context not found."
                });
            }

            const pendingContract = await contractService.findPendingActionContract(userId);

            res.json({
                success: true,
                has_pending_action: !!pendingContract,
                data: pendingContract,
                message: pendingContract
                    ? "Bạn có hợp đồng cần xử lý."
                    : "Không có yêu cầu nào."
            });
        } catch (err) {
            next(err);
        }
    }
    async forceTerminate(req, res, next) {
        try {
            const { id } = req.params;
            const { reason } = req.body;
            const files = req.files; // Được xử lý bởi multer middleware

            // Lấy thông tin audit
            const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

            const result = await contractService.forceTerminateContract(
                parseInt(id),
                reason,
                files,
                req.user, // User từ middleware auth
                ipAddress
            );

            res.json(result);
        } catch (err) {
            next(err);
        }
    }



    async downloadEvidence(req, res, next) {
        try {
            const { key } = req.query;
            console.log(`--- [DEBUG] Download Evidence Request ---`);
            console.log(`Received Key: "${key}"`); // In ra key trong dấu ngoặc kép để check khoảng trắng thừa

            if (!key) return res.status(400).json({ success: false, message: "Missing key" });

            if (req.user.role === 'TENANT') {
                return res.status(403).json({ success: false, message: "Access denied" });
            }

            const signedUrl = await s3Service.getDownloadUrl(key, 'evidence.pdf', 60);
            console.log(`Generated URL: ${signedUrl ? "YES (Hidden)" : "NO"}`);

            return res.json({
                success: true,
                url: signedUrl
            });

        } catch (err) {
            console.error("[DEBUG] Download Evidence Error:", err);
            next(err);
        }
    }
    // 13. AI Processing (Vẫn dùng single file)
    async processContractWithAI(req, res, next) {
        try {
            const file = req.file; // Route này dùng upload.single nên req.file đúng

            if (!file) return res.status(400).json({ success: false, message: 'Missing PDF file' });
            if (file.mimetype !== 'application/pdf') return res.status(400).json({ success: false, message: 'PDF only' });

            const result = await contractService.processContractWithAI(
                file.buffer,
                file.mimetype
            );

            // AI có thể trả về success: false nhưng vẫn 200 OK để frontend hiện lỗi
            res.json(result);
        } catch (err) {
            next(err);
        }
    }


    // 15. [BOT] Lấy link download hợp đồng
    // Supports multi-contract scenarios
    async getMyContractFileForBot(req, res, next) {
        try {
            const { tenant_user_id, contract_id, room_number } = req.body;
            
            if (!tenant_user_id) {
                return res.status(400).json({ success: false, message: "Missing tenant_user_id" });
            }

            const mockUser = { role: 'TENANT', user_id: parseInt(tenant_user_id) };

            // 1. Fetch ALL active/pending contracts that have files
            const contracts = await prisma.contracts.findMany({
                where: {
                    tenant_user_id: parseInt(tenant_user_id),
                    status: { in: ['active', 'pending'] },
                    deleted_at: null,
                    s3_key: { not: null } // Must have a file
                },
                include: {
                    room_history: { 
                        select: { 
                            room_number: true, 
                            building: { select: { name: true } } 
                        } 
                    }
                },
                orderBy: { created_at: 'desc' }
            });

            if (contracts.length === 0) {
                return res.json({ 
                    success: false, 
                    message: "Không tìm thấy hợp đồng nào có file đính kèm." 
                });
            }

            // 2. Identify Target Contract
            let targetContract = null;

            if (contract_id) {
                // If Bot passed a specific ID (from previous context)
                targetContract = contracts.find(c => c.contract_id === parseInt(contract_id));
            } else if (room_number) {
                // If User said "Give me contract for Room 101"
                // Normalize strings for comparison
                targetContract = contracts.find(c => 
                    c.room_history?.room_number.toString() === room_number.toString()
                );
            }

            // 3. Logic Branching
            
            // Scenario A: We found a specific target OR the tenant only has 1 contract total
            if (targetContract || contracts.length === 1) {
                const contract = targetContract || contracts[0];
                
                // Generate Link
                const downloadInfo = await contractService.downloadContract(contract.contract_id, mockUser);
                
                return res.json({
                    success: true,
                    message: `Link tải hợp đồng phòng ${contract.room_history.room_number}`,
                    data: {
                        type: "single_link", // Bot checks this type
                        contract_id: contract.contract_id,
                        room_number: contract.room_history.room_number,
                        building_name: contract.room_history.building.name,
                        file_name: downloadInfo.file_name,
                        download_url: downloadInfo.download_url
                    }
                });
            }

            // Scenario B: Ambiguity (Multiple contracts found, no specific target)
            // Bot should use this list to ask the user "Which room?"
            return res.json({
                success: true,
                message: "Tìm thấy nhiều hợp đồng. Vui lòng chỉ định phòng.",
                data: {
                    type: "multiple_choices", // Bot checks this type
                    options: contracts.map(c => ({
                        contract_id: c.contract_id,
                        room_number: c.room_history.room_number,
                        building_name: c.room_history.building.name,
                        status: c.status
                    }))
                }
            });

        } catch (err) {
            console.error("Bot Contract Download Error:", err);
            // Don't expose internal errors to Bot user, just say system error
            res.status(500).json({ success: false, message: "Lỗi hệ thống khi lấy file." });
        }
    }
}

module.exports = new ContractController();