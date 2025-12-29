// Updated: 2025-12-29
// Refactored: Compatible with latest schema.prisma (Manager time-based assignment & Relations)

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
     * Helper: Tính End Date từ Start Date và Duration (months)
     * Logic: start + months = end
     */
    calculateEndDate(startDate, durationMonths) {
        if (!startDate || !durationMonths) return null;

        const start = new Date(startDate);
        const end = new Date(start);

        // Cộng thêm số tháng
        end.setMonth(end.getMonth() + parseInt(durationMonths));

        // Xử lý edge case: Ví dụ 31/1 + 1 tháng -> Javascript sẽ thành 2/3 hoặc 3/3 tùy năm
        // Thông thường trong hợp đồng, nếu bắt đầu ngày X thì kết thúc ngày X của tháng sau
        // Tuy nhiên logic Javascript `setMonth` tự động xử lý tràn ngày (overflow)

        return end;
    }

    /**
     * Helper: (Legacy/AI Support) Tính duration từ start và end
     * Dùng khi AI chỉ đọc được ngày kết thúc mà không có text "12 tháng"
     */
    calculateDurationFromDates(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);

        let months = (end.getFullYear() - start.getFullYear()) * 12;
        months -= start.getMonth();
        months += end.getMonth();

        // Điều chỉnh nếu ngày chưa tròn tháng
        if (end.getDate() < start.getDate()) {
            months--;
        }

        return Math.max(1, months); // Tối thiểu 1 tháng
    }

    /**
     * Helper: Kiểm tra conflict hợp đồng
     */
    async checkContractConflict(roomId, startDate, endDate, excludeContractId = null) {
        const where = {
            room_id: roomId,
            status: { in: ['active', 'pending', 'pending_transaction'] },
            deleted_at: null,
            OR: [
                { AND: [{ start_date: { lte: startDate } }, { end_date: { gte: startDate } }] },
                { AND: [{ start_date: { lte: endDate } }, { end_date: { gte: endDate } }] },
                { AND: [{ start_date: { gte: startDate } }, { end_date: { lte: endDate } }] }
            ]
        };

        if (excludeContractId) {
            where.contract_id = { not: excludeContractId };
        }

        return await prisma.contracts.findFirst({ where });
    }

    // ============================================
    // CREATE CONTRACT
    // ============================================
    async createContract(data, file = null, currentUser = null) {
        const {
            room_id, tenant_user_id, start_date,
            duration_months, // <--- BẮT BUỘC
            rent_amount, deposit_amount, penalty_rate,
            payment_cycle_months,
            status, note
        } = data;

        // 1. Validation cơ bản (Bỏ check end_date, thêm check duration_months)
        if (!room_id || !tenant_user_id || !start_date || !duration_months || !rent_amount) {
            throw new Error('Missing required fields: room_id, tenant_user_id, start_date, duration_months, rent_amount');
        }

        const roomId = parseInt(room_id);
        const tenantUserId = parseInt(tenant_user_id);
        const startDate = new Date(start_date);
        const duration = parseInt(duration_months);

        if (duration < 1) throw new Error('Duration must be at least 1 month');

        // 2. TÍNH TOÁN END DATE
        const endDate = this.calculateEndDate(startDate, duration);

        // Logic check ngày (phòng hờ)
        if (startDate >= endDate) throw new Error('Calculated end date is invalid (must be after start date)');

        // 3. Check Room & Permission
        const room = await prisma.rooms.findUnique({
            where: { room_id: roomId },
            include: { building: true }
        });

        if (!room || !room.is_active) throw new Error('Room not found or is inactive');

        if (currentUser && currentUser.role === 'MANAGER') {
            const hasAccess = await this.checkManagerBuildingAccess(currentUser.user_id, room.building_id);
            if (!hasAccess) throw new Error('You do not have permission to create contracts in this building at this time');
        }

        // 4. Check Tenant
        const tenant = await prisma.tenants.findUnique({ where: { user_id: tenantUserId } });
        if (!tenant) throw new Error('Tenant not found');

        // 5. Check Conflict
        const conflictingContract = await this.checkContractConflict(roomId, startDate, endDate);
        if (conflictingContract) {
            throw new Error(`Room conflict: Existing contract from ${conflictingContract.start_date.toISOString().split('T')[0]} to ${conflictingContract.end_date.toISOString().split('T')[0]}`);
        }

        // 6. Upload File
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

        const contractStatus = status || 'pending';

        // 7. TRANSACTION
        const result = await prisma.$transaction(async (tx) => {
            const newContract = await tx.contracts.create({
                data: {
                    room_id: roomId,
                    tenant_user_id: tenantUserId,
                    start_date: startDate,
                    end_date: endDate,      // <--- Calculated
                    duration_months: duration, // <--- Source of truth
                    rent_amount: parseFloat(rent_amount),
                    deposit_amount: deposit_amount ? parseFloat(deposit_amount) : 0,
                    penalty_rate: penalty_rate ? parseFloat(penalty_rate) : null,
                    payment_cycle_months: payment_cycle_months ? parseInt(payment_cycle_months) : 1,
                    status: contractStatus,
                    note,
                    ...fileData,
                    created_at: new Date(),
                    updated_at: new Date()
                },
                include: {
                    room_history: { include: { building: true } },
                    tenant: { include: { user: true } }
                }
            });

            if (newContract.status === 'active') {
                await tx.rooms.update({
                    where: { room_id: roomId },
                    data: { current_contract_id: newContract.contract_id, status: 'occupied' }
                });

                await tx.room_tenants.updateMany({
                    where: { room_id: roomId, tenant_user_id: tenantUserId, is_current: true },
                    data: { is_current: false, moved_out_at: new Date() }
                });

                await tx.room_tenants.create({
                    data: {
                        room_id: roomId,
                        tenant_user_id: tenantUserId,
                        tenant_type: 'primary',
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
                room_history: { include: { building: true } },
                tenant: { include: { user: true } },
                contract_addendums: true
            }
        });

        if (!contract || contract.deleted_at) {
            throw new Error('Contract not found');
        }

        await this.autoUpdateExpiredStatus(contract);
        await this.checkContractPermission(contract, currentUser);

        return this.formatContractResponse(contract);
    }

    // ============================================
    // GET CONTRACTS (LIST)
    // ============================================
    async getContracts(filters = {}, currentUser) {
        let {
            room_id, tenant_user_id, status, page = 1, limit = 20,
            start_date, end_date, building_id
        } = filters;

        page = parseInt(page);
        limit = parseInt(limit);
        const skip = (page - 1) * limit;
        const where = { deleted_at: null };

        // ROLE FILTER
        if (currentUser.role === 'TENANT') {
            where.tenant_user_id = currentUser.user_id;
        } else if (currentUser.role === 'MANAGER') {
            const today = new Date();
            const managedBuildings = await prisma.building_managers.findMany({
                where: {
                    user_id: currentUser.user_id,
                    assigned_from: { lte: today },
                    OR: [{ assigned_to: null }, { assigned_to: { gte: today } }]
                },
                select: { building_id: true }
            });

            if (managedBuildings.length === 0) {
                return { data: [], pagination: { total: 0, page, limit, pages: 0 } };
            }

            const buildingIds = managedBuildings.map(b => b.building_id);
            where.room_history = { building_id: { in: buildingIds } };
        }

        // OTHER FILTERS
        if (room_id) where.room_id = parseInt(room_id);
        if (tenant_user_id && currentUser.role !== 'TENANT') {
            where.tenant_user_id = parseInt(tenant_user_id);
        }
        if (status) where.status = status;

        if (building_id) {
            const bId = parseInt(building_id);
            if (where.room_history) {
                where.room_history = { ...where.room_history, building_id: bId };
            } else {
                where.room_history = { building_id: bId };
            }
        }

        if (start_date || end_date) {
            where.start_date = {};
            if (start_date) where.start_date.gte = new Date(start_date);
            if (end_date) where.start_date.lte = new Date(end_date);
        }

        await this.autoUpdateExpiredContracts();

        const [contracts, total] = await Promise.all([
            prisma.contracts.findMany({
                where,
                include: {
                    room_history: {
                        select: {
                            room_id: true, room_number: true, building_id: true,
                            building: { select: { building_id: true, name: true } }
                        }
                    },
                    tenant: {
                        include: {
                            user: {
                                select: { user_id: true, full_name: true, email: true, phone: true }
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
            pagination: { total, page, limit, pages: Math.ceil(total / limit) }
        };
    }


    // ============================================
    // DELETE CONTRACT (SOFT)
    // ============================================
    async deleteContract(contractId, currentUser = null) {
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId },
            include: { room_history: { include: { building: true } } }
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
    // HARD DELETE CONTRACT
    // ============================================
    async hardDeleteContract(contractId, currentUser = null) {
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId }
        });

        if (!contract) {
            throw new Error('Contract not found');
        }

        // CHECK PERMISSION: Chỉ OWNER được hard delete
        if (currentUser && currentUser.role !== 'OWNER') {
            throw new Error('Only OWNER can permanently delete contracts');
        }

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

            // 2. Xóa sạch lịch sử room_tenants
            await tx.room_tenants.deleteMany({
                where: {
                    room_id: contract.room_id,
                    tenant_user_id: contract.tenant_user_id,
                }
            });

            // 3. Delete from database
            await tx.contracts.delete({
                where: { contract_id: contractId }
            });
        });

        // 4. Delete file from S3
        if (contract.s3_key) {
            try {
                await s3Service.deleteFile(contract.s3_key);
            } catch (error) {
                console.error('Failed to delete S3 file:', error);
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
            include: { room_history: { include: { building: true } } }
        });

        if (!contract) throw new Error('Contract not found');
        if (!contract.deleted_at) throw new Error('Contract is not deleted');

        // Check Permission (Including time-based manager access)
        if (currentUser && currentUser.role === 'MANAGER') {
            const hasAccess = await this.checkManagerBuildingAccess(currentUser.user_id, contract.room_history.building_id);
            if (!hasAccess) throw new Error('No permission to restore contracts in this building at this time');
        }

        // Check conflict before restore
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
                    room_history: { include: { building: true } },
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
            include: { room_history: { include: { building: true } } }
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
                    room_history: { include: { building: true } },
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
                    include: { building: true }
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
                    include: { building: true }
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
                room_history: { include: { building: true } }
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
            const documentAIResult = await documentAIService.processContract(fileBuffer, mimeType);
            if (!documentAIResult.success) throw new Error('Document AI failed: ' + documentAIResult.message);
            const extractedText = documentAIResult.firstPageText || documentAIResult.fullText;
            if (!extractedText?.trim()) throw new Error('No text extracted');

            const geminiResult = await geminiService.parseContractText(extractedText);
            if (!geminiResult.success) throw new Error('Gemini failed: ' + geminiResult.rawResponse);

            const parsedData = geminiResult.data;
            const searchParams = {
                tenant_name: parsedData.tenant_name || null,
                tenant_phone: parsedData.tenant_phone || null,
                tenant_id_number: parsedData.tenant_id_number || null,
                room_number: parsedData.room_number || null
            };

            if (!Object.values(searchParams).some(v => v !== null)) {
                return { success: false, stage: 'tenant_search', error: 'No tenant info found in doc', parsed_data: parsedData, extracted_text: extractedText };
            }

            const tenantMatch = await tenantService.findBestMatchTenant(searchParams);
            if (!tenantMatch) {
                return { success: false, stage: 'tenant_not_found', error: 'No tenant matched in DB', search_params: searchParams, parsed_data: parsedData, extracted_text: extractedText };
            }

            console.log(`✓ Found tenant: ${tenantMatch.full_name} (ID: ${tenantMatch.user_id})`);

            let buildingId = null;
            if (tenantMatch.room?.room_id) {
                const roomInfo = await prisma.rooms.findUnique({ where: { room_id: tenantMatch.room.room_id }, select: { building_id: true } });
                if (roomInfo) buildingId = roomInfo.building_id;
            }

            // LOGIC QUAN TRỌNG: Ưu tiên Duration, nếu thiếu thì tính từ Start/End
            let durationMonths = null;
            if (parsedData.duration_months) {
                durationMonths = parseInt(parsedData.duration_months);
            } else if (parsedData.start_date && parsedData.end_date) {
                // Nếu AI không đọc được "X tháng", ta tính toán ngược lại
                durationMonths = this.calculateDurationFromDates(parsedData.start_date, parsedData.end_date);
            }

            // End Date sẽ được hàm createContract tính toán lại,
            // nhưng ta gửi xuống client để họ review (client có thể thấy End Date dự kiến)
            const estimatedEndDate = this.calculateEndDate(parsedData.start_date, durationMonths);

            const contractData = {
                room_id: tenantMatch.room?.room_id || null,
                tenant_user_id: tenantMatch.user_id,
                start_date: parsedData.start_date || null,
                end_date: estimatedEndDate ? estimatedEndDate.toISOString().split('T')[0] : null, // Info only for client view
                duration_months: durationMonths,
                rent_amount: parsedData.rent_amount || null,
                deposit_amount: parsedData.deposit_amount || null,
                penalty_rate: parsedData.penalty_rate || null,
                payment_cycle_months: parsedData.payment_cycle_months || 1,
                status: 'pending',
                note: this._buildContractNote(parsedData, tenantMatch)
            };

            const validationErrors = this._validateContractData(contractData, parsedData);
            if (validationErrors.length > 0) console.warn('⚠ Validation warnings:', validationErrors);

            return {
                success: true,
                contract_data: contractData,
                tenant_info: {
                    user_id: tenantMatch.user_id, full_name: tenantMatch.full_name, phone: tenantMatch.phone,
                    email: tenantMatch.email, id_number: tenantMatch.id_number,
                    room: { ...tenantMatch.room, building_id: buildingId },
                    match_confidence: tenantMatch._match_metadata?.confidence_score || null
                },
                parsed_data: parsedData,
                validation_warnings: validationErrors,
            };

        } catch (error) {
            console.error('✖ AI process error:', error.message);
            throw new Error(`AI processing failed: ${error.message}`);
        }
    }

    // ============================================
    // PERMISSION HELPERS
    // ============================================

    /**
     * Kiểm tra Manager có quyền truy cập building không
     * UPDATED: Kiểm tra thêm thời hạn phân công (assigned_from/to)
     */
    async checkManagerBuildingAccess(userId, buildingId) {
        const today = new Date();
        const managerBuilding = await prisma.building_managers.findFirst({
            where: {
                user_id: userId,
                building_id: buildingId,
                assigned_from: { lte: today }, // Đã bắt đầu
                OR: [
                    { assigned_to: null }, // Vô thời hạn
                    { assigned_to: { gte: today } } // Chưa kết thúc
                ]
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
            // Relation in Schema: contract -> room_history -> building
            const buildingId = contract.room_history?.building_id ||
                contract.room_history?.building?.building_id;

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

            let count = 0;
            for (const contract of expiredContracts) {
                await this.autoUpdateExpiredStatus(contract);
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
        if (parsedData.tenant_name) notes.push(`AI Name: ${parsedData.tenant_name}`);
        if (parsedData.tenant_phone) notes.push(`AI Phone: ${parsedData.tenant_phone}`);
        if (parsedData.tenant_id_number) notes.push(`AI ID: ${parsedData.tenant_id_number}`);
        if (parsedData.room_number) notes.push(`AI Room: ${parsedData.room_number}`);
        if (tenantMatch._match_metadata) {
            const conf = tenantMatch._match_metadata.confidence_score;
            notes.push(`Match conf: ${conf}/100`);
            if (conf < 70) notes.push('⚠️ Low confidence match');
        }
        return notes.join('\n');
    }

    /**
     * Validate contract data
     */
    _validateContractData(contractData, parsedData) {
        const errors = [];
        if (!contractData.room_id) errors.push('Missing room_id');
        if (!contractData.start_date) errors.push('Missing start_date');
        if (!contractData.duration_months) errors.push('Missing duration_months');

        if (!contractData.rent_amount || contractData.rent_amount <= 0) errors.push('Invalid rent_amount');
        return errors;
    }
    // ============================================
    // FORMAT RESPONSE
    // ============================================

    formatContractResponse(contract) {
        // Handle nested relations compatible with new Schema
        const room = contract.room_history || contract.rooms;
        const building = room?.building || room?.buildings;
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
            payment_cycle_months: contract.payment_cycle_months,
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