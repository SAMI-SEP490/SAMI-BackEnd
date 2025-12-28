// Updated: 2025-12-28
// Refactored: Added Transactions, Room Tenants history, and Safety checks

const prisma = require('../config/prisma');
const s3Service = require('./s3.service');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const path = require('path');
const geminiService = require('./gemini.service');
const tenantService = require('./tenant.service');
const documentAIService = require('./document-ai.service');

class ContractService {
    /**
     * Helper: Tính duration_months từ start_date và end_date
     */
    calculateDurationMonths(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);

        const yearDiff = end.getFullYear() - start.getFullYear();
        const monthDiff = end.getMonth() - start.getMonth();
        const dayDiff = end.getDate() - start.getDate();

        let months = yearDiff * 12 + monthDiff;

        // Nếu ngày kết thúc nhỏ hơn ngày bắt đầu trong tháng, trừ đi 1 tháng
        if (dayDiff < 0) {
            months--;
        }

        return Math.max(1, months); // Tối thiểu 1 tháng
    }

    /**
     * Helper: Kiểm tra conflict hợp đồng trong cùng khoảng thời gian
     */
    async checkContractConflict(roomId, startDate, endDate, excludeContractId = null) {
        const where = {
            room_id: roomId,
            status: { in: ['active', 'pending', 'pending_transaction'] },
            deleted_at: null,
            OR: [
                // Hợp đồng mới bắt đầu trong khoảng hợp đồng cũ
                {
                    AND: [
                        { start_date: { lte: startDate } },
                        { end_date: { gte: startDate } }
                    ]
                },
                // Hợp đồng mới kết thúc trong khoảng hợp đồng cũ
                {
                    AND: [
                        { start_date: { lte: endDate } },
                        { end_date: { gte: endDate } }
                    ]
                },
                // Hợp đồng mới bao trùm hợp đồng cũ
                {
                    AND: [
                        { start_date: { gte: startDate } },
                        { end_date: { lte: endDate } }
                    ]
                }
            ]
        };

        if (excludeContractId) {
            where.contract_id = { not: excludeContractId };
        }

        const conflictingContract = await prisma.contracts.findFirst({ where });
        return conflictingContract;
    }

    // ============================================
    // CREATE CONTRACT
    // ============================================
    async createContract(data, file = null, currentUser = null) {
        const {
            room_id, tenant_user_id, start_date, end_date,
            rent_amount, deposit_amount, penalty_rate, status, note
        } = data;

        // 1. Validation cơ bản
        if (!room_id || !tenant_user_id || !start_date || !end_date || !rent_amount) {
            throw new Error('Missing required fields: room_id, tenant_user_id, start_date, end_date, rent_amount');
        }

        const roomId = parseInt(room_id);
        const tenantUserId = parseInt(tenant_user_id);
        const startDate = new Date(start_date);
        const endDate = new Date(end_date);

        if (startDate >= endDate) throw new Error('Start date must be before end date');

        // 2. Check Room & Permission
        const room = await prisma.rooms.findUnique({
            where: { room_id: roomId },
            include: { buildings: true }
        });

        if (!room || !room.is_active) throw new Error('Room not found or is inactive');

        if (currentUser && currentUser.role === 'MANAGER') {
            const hasAccess = await this.checkManagerBuildingAccess(currentUser.user_id, room.building_id);
            if (!hasAccess) throw new Error('You do not have permission to create contracts in this building');
        }

        // 3. Check Tenant
        const tenant = await prisma.tenants.findUnique({ where: { user_id: tenantUserId } });
        if (!tenant) throw new Error('Tenant not found');

        // 4. Check Conflict
        const conflictingContract = await this.checkContractConflict(roomId, startDate, endDate);
        if (conflictingContract) {
            throw new Error(`Room already has an active/pending contract from ${conflictingContract.start_date.toISOString().split('T')[0]} to ${conflictingContract.end_date.toISOString().split('T')[0]}`);
        }

        // 5. Upload File (Nếu có)
        let fileData = {};
        if (file) {
            const uploadResult = await s3Service.uploadFile(file.buffer, file.originalname, 'contracts');
            fileData = {
                s3_key: uploadResult.s3_key,
                file_name: uploadResult.file_name,
                checksum: uploadResult.checksum,
                uploaded_at: uploadResult.uploaded_at
            };
        }

        const durationMonths = this.calculateDurationMonths(startDate, endDate);
        const contractStatus = status || 'pending';

        // 6. TRANSACTION: Create Contract + Update Room + Update History
        const result = await prisma.$transaction(async (tx) => {
            // A. Tạo Contract
            const newContract = await tx.contracts.create({
                data: {
                    room_id: roomId,
                    tenant_user_id: tenantUserId,
                    start_date: startDate,
                    end_date: endDate,
                    duration_months: durationMonths,
                    rent_amount: parseFloat(rent_amount),
                    deposit_amount: deposit_amount ? parseFloat(deposit_amount) : 0,
                    penalty_rate: penalty_rate ? parseFloat(penalty_rate) : null,
                    status: contractStatus,
                    note,
                    ...fileData,
                    created_at: new Date(),
                    updated_at: new Date()
                },
                include: {
                    room_history: { include: { buildings: true } },
                    tenant: { include: { user: true } }
                }
            });

            // B. Nếu Active => Cập nhật Room & Room Tenants
            if (newContract.status === 'active') {
                // Update Room
                await tx.rooms.update({
                    where: { room_id: roomId },
                    data: {
                        current_contract_id: newContract.contract_id,
                        status: 'occupied'
                    }
                });

                // Add to room_tenants (Lịch sử cư trú)
                // Trước tiên, đóng các record cũ của tenant này tại phòng này (nếu có lỗi logic cũ)
                await tx.room_tenants.updateMany({
                    where: {
                        room_id: roomId,
                        tenant_user_id: tenantUserId,
                        is_current: true
                    },
                    data: { is_current: false, moved_out_at: new Date() }
                });

                // Tạo record mới
                await tx.room_tenants.create({
                    data: {
                        room_id: roomId,
                        tenant_user_id: tenantUserId,
                        tenant_type: 'primary', // Mặc định người ký hợp đồng là primary
                        moved_in_at: startDate,
                        is_current: true,
                        note: `Contract #${newContract.contract_id}`
                    }
                });
            }

            return newContract;
        });

        return this.formatContractResponse(result);
    }

    // ============================================
    // GET CONTRACT BY ID
    // ============================================
    async getContractById(contractId, currentUser) {
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId },
            include: {
                room_history: {
                    include: {
                        buildings: true
                    }
                },
                tenant: {
                    include: {
                        user: true
                    }
                },
                contract_addendums: true
            }
        });

        if (!contract || contract.deleted_at) {
            throw new Error('Contract not found');
        }

        // Auto-update expired contracts
        await this.autoUpdateExpiredStatus(contract);

        // Check permission
        await this.checkContractPermission(contract, currentUser);

        return this.formatContractResponse(contract);
    }

    // ============================================
    // GET CONTRACTS (LIST)
    // ============================================
    async getContracts(filters = {}, currentUser) {
        let {
            room_id,
            tenant_user_id,
            status,
            page = 1,
            limit = 20,
            start_date,
            end_date,
            building_id
        } = filters;

        // Convert to integers
        page = parseInt(page);
        limit = parseInt(limit);

        const skip = (page - 1) * limit;
        const where = { deleted_at: null };

        // PHÂN QUYỀN THEO ROLE
        if (currentUser.role === 'TENANT') {
            where.tenant_user_id = currentUser.user_id;
        } else if (currentUser.role === 'MANAGER') {
            const managedBuildings = await prisma.building_managers.findMany({
                where: { user_id: currentUser.user_id },
                select: { building_id: true }
            });

            if (managedBuildings.length === 0) {
                return {
                    data: [],
                    pagination: {
                        total: 0,
                        page,
                        limit,
                        pages: 0
                    }
                };
            }

            const buildingIds = managedBuildings.map(b => b.building_id);
            where.room_history = {
                building_id: { in: buildingIds }
            };
        }

        // Additional filters
        if (room_id) where.room_id = parseInt(room_id);
        if (tenant_user_id && currentUser.role !== 'TENANT') {
            where.tenant_user_id = parseInt(tenant_user_id);
        }
        if (status) where.status = status;
        if (building_id) {
            where.room_history = {
                ...where.room_history,
                building_id: parseInt(building_id)
            };
        }

        // Filter by date range
        if (start_date || end_date) {
            where.start_date = {};
            if (start_date) {
                where.start_date.gte = new Date(start_date);
            }
            if (end_date) {
                where.start_date.lte = new Date(end_date);
            }
        }

        // Auto-update expired contracts
        await this.autoUpdateExpiredContracts();

        const [contracts, total] = await Promise.all([
            prisma.contracts.findMany({
                where,
                include: {
                    room_history: {
                        select: {
                            room_id: true,
                            room_number: true,
                            building_id: true,
                            buildings: {
                                select: {
                                    building_id: true,
                                    name: true
                                }
                            }
                        }
                    },
                    tenant: {
                        include: {
                            user: {
                                select: {
                                    user_id: true,
                                    full_name: true,
                                    email: true,
                                    phone: true
                                }
                            }
                        }
                    }
                },
                skip,
                take: limit,
                orderBy: { created_at: 'desc' }
            }),
            prisma.contracts.count({ where })
        ]);

        return {
            data: contracts.map(c => this.formatContractResponse(c)),
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        };
    }

    // ============================================
    // UPDATE CONTRACT
    // ============================================
    async updateContract(contractId, data, file = null, currentUser = null) {
        const {
            room_id, tenant_user_id, start_date, end_date,
            rent_amount, deposit_amount, penalty_rate, status, note
        } = data;

        const existingContract = await prisma.contracts.findUnique({
            where: { contract_id: contractId },
            include: { room_history: { include: { buildings: true } } }
        });

        if (!existingContract || existingContract.deleted_at) throw new Error('Contract not found');
        if (currentUser) await this.checkContractPermission(existingContract, currentUser);

        // Prepare data for check conflict
        const targetRoomId = room_id ? parseInt(room_id) : existingContract.room_id;
        const targetStartDate = start_date ? new Date(start_date) : existingContract.start_date;
        const targetEndDate = end_date ? new Date(end_date) : existingContract.end_date;

        if (targetStartDate >= targetEndDate) throw new Error('Start date must be before end date');

        // Check Conflict
        const conflictingContract = await this.checkContractConflict(targetRoomId, targetStartDate, targetEndDate, contractId);
        if (conflictingContract) {
            throw new Error(`Room conflict with contract #${conflictingContract.contract_id} (${conflictingContract.start_date.toISOString().split('T')[0]} - ${conflictingContract.end_date.toISOString().split('T')[0]})`);
        }

        const updateData = { updated_at: new Date() };
        if (room_id) updateData.room_id = parseInt(room_id);
        if (tenant_user_id) updateData.tenant_user_id = parseInt(tenant_user_id);
        if (start_date) updateData.start_date = new Date(start_date);
        if (end_date) updateData.end_date = new Date(end_date);
        if (start_date || end_date) updateData.duration_months = this.calculateDurationMonths(targetStartDate, targetEndDate);
        if (rent_amount !== undefined) updateData.rent_amount = parseFloat(rent_amount);
        if (deposit_amount !== undefined) updateData.deposit_amount = parseFloat(deposit_amount);
        if (penalty_rate !== undefined) updateData.penalty_rate = penalty_rate ? parseFloat(penalty_rate) : null;
        if (note !== undefined) updateData.note = note;
        if (status) updateData.status = status;

        if (file) {
            if (existingContract.s3_key) await s3Service.deleteFile(existingContract.s3_key);
            const uploadResult = await s3Service.uploadFile(file.buffer, file.originalname, 'contracts');
            updateData.s3_key = uploadResult.s3_key;
            updateData.file_name = uploadResult.file_name;
            updateData.checksum = uploadResult.checksum;
            updateData.uploaded_at = uploadResult.uploaded_at;
        }

        const oldStatus = existingContract.status;
        const newStatus = status || oldStatus;

        // TRANSACTION
        const updatedContract = await prisma.$transaction(async (tx) => {
            // 1. Update Contract
            const contract = await tx.contracts.update({
                where: { contract_id: contractId },
                data: updateData,
                include: {
                    room_history: { include: { buildings: true } },
                    tenant: { include: { user: true } }
                }
            });

            // 2. Handle Status Changes
            if (oldStatus !== newStatus) {
                if (newStatus === 'active') {
                    // => Active: Set Room Occupied & Add RoomTenant
                    await tx.rooms.update({
                        where: { room_id: targetRoomId },
                        data: { current_contract_id: contractId, status: 'occupied' }
                    });

                    // Check if tenant already recorded
                    const existingTenant = await tx.room_tenants.findFirst({
                        where: { room_id: targetRoomId, tenant_user_id: contract.tenant_user_id, is_current: true }
                    });

                    if (!existingTenant) {
                        await tx.room_tenants.create({
                            data: {
                                room_id: targetRoomId,
                                tenant_user_id: contract.tenant_user_id,
                                tenant_type: 'primary',
                                moved_in_at: targetStartDate,
                                is_current: true,
                                note: `Contract #${contractId} activated`
                            }
                        });
                    }

                } else if (['terminated', 'expired', 'rejected'].includes(newStatus)) {
                    // => Inactive: Clear Room & Close RoomTenant
                    const room = await tx.rooms.findUnique({ where: { room_id: targetRoomId } });

                    // Chỉ clear nếu đây là hợp đồng hiện tại (để an toàn)
                    if (room && room.current_contract_id === contractId) {
                        await tx.rooms.update({
                            where: { room_id: targetRoomId },
                            data: { current_contract_id: null, status: 'available' }
                        });
                    }

                    // Close Tenant History
                    await tx.room_tenants.updateMany({
                        where: {
                            room_id: targetRoomId,
                            tenant_user_id: contract.tenant_user_id,
                            is_current: true
                        },
                        data: { is_current: false, moved_out_at: new Date() }
                    });
                }
            }

            return contract;
        });

        return this.formatContractResponse(updatedContract);
    }

    // ============================================
    // DELETE CONTRACT (SOFT)
    // ============================================
    async deleteContract(contractId, currentUser = null) {
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId },
            include: { room_history: true }
        });

        if (!contract || contract.deleted_at) throw new Error('Contract not found');
        if (currentUser) await this.checkContractPermission(contract, currentUser);

        await prisma.$transaction(async (tx) => {
            // Soft delete contract
            await tx.contracts.update({
                where: { contract_id: contractId },
                data: { deleted_at: new Date() }
            });

            // Clean up room if this was current
            const room = await tx.rooms.findUnique({ where: { room_id: contract.room_id } });
            if (room && room.current_contract_id === contractId) {
                await tx.rooms.update({
                    where: { room_id: contract.room_id },
                    data: { current_contract_id: null, status: 'available' }
                });
            }

            // Clean up tenant history
            await tx.room_tenants.updateMany({
                where: { room_id: contract.room_id, tenant_user_id: contract.tenant_user_id, is_current: true },
                data: { is_current: false, moved_out_at: new Date() }
            });
        });

        return { success: true, message: 'Contract deleted successfully' };
    }
// ============================================
    // HARD DELETE CONTRACT (FIXED)
    // ============================================
    async hardDeleteContract(contractId, currentUser = null) {
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId },
            include: { room_history: true } // Không cần include quá sâu nếu chỉ để check
        });

        if (!contract) {
            throw new Error('Contract not found');
        }

        // CHECK PERMISSION: Chỉ OWNER được hard delete
        if (currentUser && currentUser.role !== 'OWNER') {
            throw new Error('Only OWNER can permanently delete contracts');
        }

        // Thực hiện trong Transaction để đảm bảo tính toàn vẹn
        await prisma.$transaction(async (tx) => {
            // 1. Kiểm tra và Clear Room nếu hợp đồng này đang Active tại phòng đó
            const room = await tx.rooms.findUnique({
                where: { room_id: contract.room_id }
            });

            if (room && room.current_contract_id === contractId) {
                await tx.rooms.update({
                    where: { room_id: contract.room_id },
                    data: { current_contract_id: null, status: 'available' }
                });
            }

            // 2. Xóa sạch lịch sử room_tenants liên quan đến hợp đồng này (Dọn dẹp triệt để)
            // Vì đây là Hard Delete (xóa vĩnh viễn), ta nên xóa cả lịch sử cư trú sinh ra bởi nó
            // Hoặc giữ lại tùy nghiệp vụ, nhưng thường hard delete là xóa sạch dấu vết.
            // Ở đây tôi chọn phương án an toàn: Set user ra khỏi phòng.
            await tx.room_tenants.deleteMany({
                where: {
                    room_id: contract.room_id,
                    tenant_user_id: contract.tenant_user_id,
                    // Có thể filter thêm theo khoảng thời gian nếu muốn chính xác tuyệt đối,
                    // nhưng deleteMany theo tenant+room là tạm ổn cho hard delete.
                }
            });

            // 3. Delete from database
            await tx.contracts.delete({
                where: { contract_id: contractId }
            });
        });

        // 4. Delete file from S3 (Thực hiện sau khi DB thành công để tránh mất file nếu DB lỗi)
        if (contract.s3_key) {
            try {
                await s3Service.deleteFile(contract.s3_key);
            } catch (error) {
                console.error('Failed to delete S3 file:', error);
                // Không throw error ở đây vì DB đã xóa xong rồi, chỉ log lại thôi.
            }
        }

        return { success: true, message: 'Contract permanently deleted' };
    }

    // ============================================
    // RESTORE CONTRACT
    // ============================================
    async restoreContract(contractId, currentUser = null) {
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId },
            include: { room_history: { include: { buildings: true } } }
        });

        if (!contract) throw new Error('Contract not found');
        if (!contract.deleted_at) throw new Error('Contract is not deleted');

        if (currentUser && currentUser.role === 'MANAGER') {
            const hasAccess = await this.checkManagerBuildingAccess(currentUser.user_id, contract.room_history.building_id);
            if (!hasAccess) throw new Error('No permission to restore contracts in this building');
        }

        // CRITICAL FIX: Check conflict before restore
        // Nếu hợp đồng được restore là active/pending, phải xem có ai đang ở đó không
        if (['active', 'pending', 'pending_transaction'].includes(contract.status)) {
            const conflict = await this.checkContractConflict(contract.room_id, contract.start_date, contract.end_date, contractId);
            if (conflict) {
                throw new Error(`Cannot restore. Conflict with contract #${conflict.contract_id}`);
            }
        }

        const restored = await prisma.$transaction(async (tx) => {
            const restoredContract = await tx.contracts.update({
                where: { contract_id: contractId },
                data: { deleted_at: null },
                include: {
                    room_history: { include: { buildings: true } },
                    tenant: { include: { user: true } }
                }
            });

            // Nếu restore lại một hợp đồng Active, cần set lại Room
            if (restoredContract.status === 'active') {
                await tx.rooms.update({
                    where: { room_id: restoredContract.room_id },
                    data: {
                        current_contract_id: restoredContract.contract_id,
                        status: 'occupied'
                    }
                });

                // Mở lại room_tenants nếu ngày end chưa qua
                if (new Date(restoredContract.end_date) > new Date()) {
                    await tx.room_tenants.create({
                        data: {
                            room_id: restoredContract.room_id,
                            tenant_user_id: restoredContract.tenant_user_id,
                            tenant_type: 'primary',
                            moved_in_at: restoredContract.start_date,
                            is_current: true,
                            note: 'Restored contract'
                        }
                    });
                }
            }

            return restoredContract;
        });

        return this.formatContractResponse(restored);
    }

    // ============================================
    // TERMINATE CONTRACT
    // ============================================
    async terminateContract(contractId, reason = null, currentUser = null) {
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId },
            include: { room_history: { include: { buildings: true } } }
        });

        if (!contract || contract.deleted_at) throw new Error('Contract not found');
        if (contract.status === 'terminated') throw new Error('Contract is already terminated');
        if (currentUser) await this.checkContractPermission(contract, currentUser);

        const result = await prisma.$transaction(async (tx) => {
            // 1. Update Contract
            const terminated = await tx.contracts.update({
                where: { contract_id: contractId },
                data: {
                    status: 'terminated',
                    note: reason ? `${contract.note || ''}\nTermination reason: ${reason}` : contract.note,
                    updated_at: new Date()
                },
                include: {
                    room_history: { include: { buildings: true } },
                    tenant: { include: { user: true } }
                }
            });

            // 2. Clear Room (Safe Check)
            const room = await tx.rooms.findUnique({ where: { room_id: contract.room_id } });
            if (room && room.current_contract_id === contractId) {
                await tx.rooms.update({
                    where: { room_id: contract.room_id },
                    data: { current_contract_id: null, status: 'available' }
                });
            }

            // 3. Update Room Tenants (Close history)
            await tx.room_tenants.updateMany({
                where: {
                    room_id: contract.room_id,
                    tenant_user_id: contract.tenant_user_id,
                    is_current: true
                },
                data: {
                    is_current: false,
                    moved_out_at: new Date()
                }
            });

            return terminated;
        });

        return this.formatContractResponse(result);
    }

    // ============================================
    // DOWNLOAD CONTRACT
    // ============================================
    async downloadContract(contractId, currentUser) {
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId },
            include: {
                room_history: {
                    include: {
                        buildings: true
                    }
                }
            }
        });

        if (!contract || contract.deleted_at) {
            throw new Error('Contract not found');
        }

        await this.checkContractPermission(contract, currentUser);

        if (!contract.s3_key) {
            throw new Error('Contract file not found');
        }

        try {
            const downloadUrl = await s3Service.getDownloadUrl(
                contract.s3_key,
                contract.file_name || 'contract.pdf',
                3600
            );

            return {
                contract_id: contractId,
                file_name: contract.file_name,
                download_url: downloadUrl,
                expires_in: 3600
            };
        } catch (error) {
            throw new Error(`Failed to generate download URL: ${error.message}`);
        }
    }

    async downloadContractDirect(contractId, currentUser) {
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId },
            include: {
                room_history: {
                    include: {
                        buildings: true
                    }
                }
            }
        });

        if (!contract || contract.deleted_at) {
            throw new Error('Contract not found');
        }

        await this.checkContractPermission(contract, currentUser);

        if (!contract.s3_key) {
            throw new Error('Contract file not found');
        }

        try {
            const fileBuffer = await s3Service.downloadFile(contract.s3_key);

            if (contract.checksum) {
                const isValid = s3Service.verifyChecksum(fileBuffer, contract.checksum);
                if (!isValid) {
                    throw new Error('File integrity check failed');
                }
            }

            return {
                buffer: fileBuffer,
                file_name: contract.file_name || 'contract.pdf',
                content_type: 'application/pdf'
            };
        } catch (error) {
            throw new Error(`Failed to download contract file: ${error.message}`);
        }
    }

    // ============================================
    // CONVERT IMAGES TO PDF AND UPLOAD
    // ============================================
    async convertAndUpload(contractId, files, currentUser = null) {
        if (!files || files.length === 0) {
            throw new Error('No images provided for conversion');
        }

        const contract = await prisma.contracts.findUnique({
            where: { contract_id: parseInt(contractId) },
            include: {
                room_history: {
                    include: {
                        buildings: true
                    }
                }
            }
        });

        if (!contract) {
            throw new Error('Contract not found');
        }

        if (currentUser) {
            await this.checkContractPermission(contract, currentUser);
        }

        const tempDir = path.join(__dirname, '../temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

        const outputFilePath = path.join(
            tempDir,
            `contract-${contractId}-${Date.now()}.pdf`
        );

        const doc = new PDFDocument({ autoFirstPage: false });
        const output = fs.createWriteStream(outputFilePath);
        doc.pipe(output);

        for (const file of files) {
            let imgPath;
            if (file.path) {
                imgPath = file.path;
            } else {
                imgPath = path.join(tempDir, `${Date.now()}-${file.originalname}`);
                fs.writeFileSync(imgPath, file.buffer);
            }

            const img = doc.openImage(imgPath);
            doc.addPage({ size: [img.width, img.height] });
            doc.image(imgPath, 0, 0, { width: img.width, height: img.height });

            if (!file.path && fs.existsSync(imgPath)) {
                fs.unlinkSync(imgPath);
            }
        }

        doc.end();
        await new Promise((resolve) => output.on('finish', resolve));

        const fileBuffer = fs.readFileSync(outputFilePath);
        const uploadResult = await s3Service.uploadFile(
            fileBuffer,
            path.basename(outputFilePath),
            'contracts'
        );

        await prisma.contracts.update({
            where: { contract_id: parseInt(contractId) },
            data: {
                s3_key: uploadResult.s3_key,
                file_name: uploadResult.file_name,
                checksum: uploadResult.checksum,
                uploaded_at: uploadResult.uploaded_at,
                updated_at: new Date(),
            },
        });

        if (fs.existsSync(outputFilePath)) fs.unlinkSync(outputFilePath);

        return uploadResult;
    }

    // ============================================
    // PROCESS CONTRACT WITH AI
    // ============================================
    async processContractWithAI(fileBuffer, mimeType = 'application/pdf') {
        try {
            // BƯỚC 1: Trích xuất text từ PDF
            const documentAIResult = await documentAIService.processContract(fileBuffer, mimeType);

            if (!documentAIResult.success) {
                throw new Error('Document AI processing failed: ' + documentAIResult.message);
            }

            const extractedText = documentAIResult.firstPageText || documentAIResult.fullText;

            if (!extractedText || extractedText.trim().length === 0) {
                throw new Error('No text extracted from PDF');
            }

            // BƯỚC 2: Parse text thành JSON bằng Gemini
            const geminiResult = await geminiService.parseContractText(extractedText);

            if (!geminiResult.success) {
                throw new Error('Gemini parsing failed: ' + geminiResult.rawResponse);
            }

            const parsedData = geminiResult.data;

            // BƯỚC 3: Tìm tenant trong database
            const searchParams = {
                tenant_name: parsedData.tenant_name || null,
                tenant_phone: parsedData.tenant_phone || null,
                tenant_id_number: parsedData.tenant_id_number || null,
                room_number: parsedData.room_number || null
            };

            const hasSearchCriteria = Object.values(searchParams).some(val => val !== null);

            if (!hasSearchCriteria) {
                return {
                    success: false,
                    stage: 'tenant_search',
                    error: 'Không tìm thấy thông tin tenant trong hợp đồng',
                    parsed_data: parsedData,
                    extracted_text: extractedText
                };
            }

            const tenantMatch = await tenantService.findBestMatchTenant(searchParams);

            if (!tenantMatch) {
                return {
                    success: false,
                    stage: 'tenant_not_found',
                    error: 'Không tìm thấy tenant phù hợp trong hệ thống',
                    search_params: searchParams,
                    parsed_data: parsedData,
                    extracted_text: extractedText,
                    suggestion: 'Vui lòng tạo tenant mới hoặc kiểm tra lại thông tin'
                };
            }

            console.log(`✓ Found tenant: ${tenantMatch.full_name} (ID: ${tenantMatch.user_id})`);

            if (tenantMatch._match_metadata) {
                console.log(`  Match details:`, tenantMatch._match_metadata.match_details);
            }

            // BƯỚC 4: Lấy building_id từ room
            let buildingId = null;
            if (tenantMatch.room?.room_id) {
                const roomInfo = await prisma.rooms.findUnique({
                    where: { room_id: tenantMatch.room.room_id },
                    select: { building_id: true }
                });
                if (roomInfo) {
                    buildingId = roomInfo.building_id;
                }
            }

            //  Tính duration_months
            let durationMonths = null;
            if (parsedData.start_date && parsedData.end_date) {
                durationMonths = this.calculateDurationMonths(
                    parsedData.start_date,
                    parsedData.end_date
                );
            }

            // BƯỚC 5: Chuẩn bị data cho createContract
            const contractData = {
                room_id: tenantMatch.room?.room_id || null,
                tenant_user_id: tenantMatch.user_id,
                start_date: parsedData.start_date || null,
                end_date: parsedData.end_date || null,
                duration_months: durationMonths,
                rent_amount: parsedData.rent_amount || null,
                deposit_amount: parsedData.deposit_amount || null,
                penalty_rate: parsedData.penalty_rate || null,
                status: 'pending',
                note: this._buildContractNote(parsedData, tenantMatch)
            };

            // Validate dữ liệu
            const validationErrors = this._validateContractData(contractData, parsedData);

            if (validationErrors.length > 0) {
                console.warn('⚠ Validation warnings:', validationErrors);
            }

            return {
                success: true,
                contract_data: contractData,
                tenant_info: {
                    user_id: tenantMatch.user_id,
                    full_name: tenantMatch.full_name,
                    phone: tenantMatch.phone,
                    email: tenantMatch.email,
                    id_number: tenantMatch.id_number,
                    room: {
                        ...tenantMatch.room,
                        building_id: buildingId
                    },
                    match_confidence: tenantMatch._match_metadata?.confidence_score || null
                },
                parsed_data: parsedData,
                validation_warnings: validationErrors,
            };

        } catch (error) {
            console.error('✖ Error in AI contract processing:', error.message);
            throw new Error(`AI contract processing failed: ${error.message}`);
        }
    }

    // ============================================
    // PERMISSION HELPERS
    // ============================================

    /**
     * Kiểm tra Manager có quyền truy cập building không
     */
    async checkManagerBuildingAccess(userId, buildingId) {
        const managerBuilding = await prisma.building_managers.findFirst({
            where: {
                user_id: userId,
                building_id: buildingId
            }
        });

        return !!managerBuilding;
    }

    /**
     * Kiểm tra quyền truy cập hợp đồng
     */
    async checkContractPermission(contract, currentUser) {
        if (currentUser.role === 'TENANT') {
            if (contract.tenant_user_id !== currentUser.user_id) {
                throw new Error('You do not have permission to access this contract');
            }
        } else if (currentUser.role === 'MANAGER') {
            const buildingId = contract.room_history?.building_id ||
                contract.room_history?.buildings?.building_id;

            if (!buildingId) {
                throw new Error('Contract building information not found');
            }

            const hasAccess = await this.checkManagerBuildingAccess(
                currentUser.user_id,
                buildingId
            );

            if (!hasAccess) {
                throw new Error('You do not have permission to access this contract');
            }
        }
    }

    // ============================================
    // AUTO-UPDATE EXPIRED CONTRACTS
    // ============================================

    async autoUpdateExpiredStatus(contract) {
        if (!contract || contract.deleted_at || (contract.status !== 'active' && contract.status !== 'pending')) return;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endDate = new Date(contract.end_date);
        endDate.setHours(0, 0, 0, 0);

        if (endDate < today) {
            // TRANSACTION: Expire Contract + Clear Room + Close Tenant History
            await prisma.$transaction(async (tx) => {
                await tx.contracts.update({
                    where: { contract_id: contract.contract_id },
                    data: { status: 'expired', updated_at: new Date() }
                });

                const room = await tx.rooms.findUnique({ where: { room_id: contract.room_id } });
                if (room && room.current_contract_id === contract.contract_id) {
                    await tx.rooms.update({
                        where: { room_id: contract.room_id },
                        data: { current_contract_id: null, status: 'available' }
                    });
                }

                await tx.room_tenants.updateMany({
                    where: { room_id: contract.room_id, tenant_user_id: contract.tenant_user_id, is_current: true },
                    data: { is_current: false, moved_out_at: new Date() }
                });
            });
            console.log(`✓ Contract ${contract.contract_id} auto-updated to expired`);
        }
    }

    async autoUpdateExpiredContracts() {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const expiredContracts = await prisma.contracts.findMany({
                where: {
                    end_date: { lt: today },
                    status: { in: ['active', 'pending'] },
                    deleted_at: null
                }
            });

            if (expiredContracts.length === 0) return 0;

            // Run in transaction for consistency (looping inside logic)
            // Note: UpdateMany doesn't support relation updates, so we iterate
            let count = 0;
            for (const contract of expiredContracts) {
                await this.autoUpdateExpiredStatus(contract); // Reuse the transactional logic above
                count++;
            }

            return count;
        } catch (error) {
            console.error('Error auto-updating expired contracts:', error);
            return 0;
        }
    }
    // ============================================
    // PRIVATE HELPERS
    // ============================================

    /**
     * Xây dựng note cho contract từ parsed data
     */
    _buildContractNote(parsedData, tenantMatch) {
        const notes = ['🤖 Contract processed by AI'];

        if (parsedData.tenant_name) {
            notes.push(`Tên từ AI: ${parsedData.tenant_name}`);
        }
        if (parsedData.tenant_phone) {
            notes.push(`SĐT từ AI: ${parsedData.tenant_phone}`);
        }
        if (parsedData.tenant_id_number) {
            notes.push(`CMND/CCCD từ AI: ${parsedData.tenant_id_number}`);
        }
        if (parsedData.room_number) {
            notes.push(`Số phòng từ AI: ${parsedData.room_number}`);
        }

        if (tenantMatch._match_metadata) {
            const confidence = tenantMatch._match_metadata.confidence_score;
            notes.push(`Match confidence: ${confidence}/100`);

            if (confidence < 70) {
                notes.push('⚠️ Low confidence match - requires manual verification');
            }
        }

        return notes.join('\n');
    }

    /**
     * Validate contract data
     */
    _validateContractData(contractData, parsedData) {
        const errors = [];

        if (!contractData.room_id) {
            errors.push('Không tìm thấy room_id - tenant chưa có phòng hoặc số phòng không khớp');
        }

        if (!contractData.start_date) {
            errors.push('Thiếu ngày bắt đầu hợp đồng');
        }

        if (!contractData.end_date) {
            errors.push('Thiếu ngày kết thúc hợp đồng');
        }

        if (!contractData.rent_amount || contractData.rent_amount <= 0) {
            errors.push('Thiếu hoặc không hợp lệ giá thuê');
        }

        // Validate date logic
        if (contractData.start_date && contractData.end_date) {
            const start = new Date(contractData.start_date);
            const end = new Date(contractData.end_date);

            if (start >= end) {
                errors.push('Ngày bắt đầu phải trước ngày kết thúc');
            }

            // Check if start date is too far in the past
            const monthsAgo = new Date();
            monthsAgo.setMonth(monthsAgo.getMonth() - 6);

            if (start < monthsAgo) {
                errors.push(`Cảnh báo: Ngày bắt đầu quá xa trong quá khứ (${contractData.start_date})`);
            }
        }

        return errors;
    }

    // ============================================
    // FORMAT RESPONSE
    // ============================================

    formatContractResponse(contract) {
        // Handle nested relations
        const room = contract.room_history || contract.rooms;
        const building = room?.buildings || room?.building;
        const tenant = contract.tenant || contract.tenants;
        const user = tenant?.user || tenant?.users;

        return {
            contract_id: contract.contract_id,
            building_id: building?.building_id || room?.building_id || null,
            building_name: building?.name || null,
            room_id: contract.room_id,
            room_number: room?.room_number || null,
            tenant_user_id: contract.tenant_user_id,
            tenant_name: user?.full_name || null,
            tenant_email: user?.email || null,
            tenant_phone: user?.phone || null,
            start_date: contract.start_date,
            end_date: contract.end_date,
            duration_months: contract.duration_months,
            rent_amount: contract.rent_amount,
            deposit_amount: contract.deposit_amount,
            penalty_rate: contract.penalty_rate,
            status: contract.status,
            s3_key: contract.s3_key,
            file_name: contract.file_name,
            checksum: contract.checksum,
            uploaded_at: contract.uploaded_at,
            has_file: !!contract.s3_key,
            note: contract.note,
            created_at: contract.created_at,
            updated_at: contract.updated_at,
            deleted_at: contract.deleted_at
        };
    }
}

module.exports = new ContractService();