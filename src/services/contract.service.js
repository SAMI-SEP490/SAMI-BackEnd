// Updated: 2025-22-12
// by: DatNB
// Fixed: Manager permission - only access contracts in their managed buildings

const prisma = require('../config/prisma');
const s3Service = require('./s3.service');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const path = require('path');
const geminiService = require('./gemini.service');
const tenantService = require('./tenant.service');
const documentAIService = require('./document-ai.service');

class ContractService {
    // CREATE - Tạo hợp đồng mới với file PDF
    async createContract(data, file = null, currentUser = null) {
        const { room_id, tenant_user_id, start_date, end_date, rent_amount, deposit_amount, status, note } = data;

        // Validate required fields
        if (!room_id || !tenant_user_id || !start_date || !end_date) {
            throw new Error('Missing required fields: room_id, tenant_user_id, start_date, end_date');
        }

        // Parse IDs to integers
        const roomId = parseInt(room_id);
        const tenantUserId = parseInt(tenant_user_id);

        if (isNaN(roomId) || isNaN(tenantUserId)) {
            throw new Error('room_id and tenant_user_id must be valid numbers');
        }

        // Check if room exists and is active
        const room = await prisma.rooms.findUnique({
            where: { room_id: roomId },
            include: { buildings: true }
        });

        if (!room || !room.is_active) {
            throw new Error('Room not found or is inactive');
        }

        // ✅ CHECK PERMISSION: Manager chỉ tạo hợp đồng trong tòa nhà họ quản lý
        if (currentUser && currentUser.role === 'MANAGER') {
            const hasAccess = await this.checkManagerBuildingAccess(
                currentUser.user_id,
                room.building_id
            );

            if (!hasAccess) {
                throw new Error('You do not have permission to create contracts in this building');
            }
        }

        // Check if tenant exists
        const tenant = await prisma.tenants.findUnique({
            where: { user_id: tenantUserId }
        });

        if (!tenant) {
            throw new Error('Tenant not found');
        }

        // Check if tenant already has active contract in this room
        const existingContract = await prisma.contracts.findFirst({
            where: {
                room_id: roomId,
                tenant_user_id: tenantUserId,
                status: { in: ['active', 'pending'] },
                deleted_at: null
            }
        });

        if (existingContract) {
            throw new Error('Tenant already has an active contract for this room');
        }

        // Validate dates
        const startDate = new Date(start_date);
        const endDate = new Date(end_date);

        if (startDate >= endDate) {
            throw new Error('Start date must be before end date');
        }

        // Upload file to S3 if provided
        let fileData = {};
        if (file) {
            try {
                const uploadResult = await s3Service.uploadFile(
                    file.buffer,
                    file.originalname,
                    'contracts'
                );

                fileData = {
                    s3_key: uploadResult.s3_key,
                    file_name: uploadResult.file_name,
                    checksum: uploadResult.checksum,
                    uploaded_at: uploadResult.uploaded_at
                };
            } catch (error) {
                throw new Error(`Failed to upload contract file: ${error.message}`);
            }
        }

        // Create contract
        const contract = await prisma.contracts.create({
            data: {
                room_id: roomId,
                tenant_user_id: tenantUserId,
                start_date: startDate,
                end_date: endDate,
                rent_amount: rent_amount ? parseFloat(rent_amount) : null,
                deposit_amount: deposit_amount ? parseFloat(deposit_amount) : null,
                status: status || 'pending',
                note,
                ...fileData,
                created_at: new Date(),
                updated_at: new Date()
            },
            include: {
                rooms: true,
                tenants: {
                    include: {
                        users: true
                    }
                }
            }
        });

        return this.formatContractResponse(contract);
    }

    async getContractById(contractId, currentUser) {
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId },
            include: {
                rooms: {
                    include: {
                        buildings: true
                    }
                },
                tenants: {
                    include: {
                        users: true
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

    // READ - Lấy danh sách hợp đồng (có phân trang và filter)
    async getContracts(filters = {}, currentUser) {
        const {
            room_id,
            tenant_user_id,
            status,
            page = 1,
            limit = 20,
            start_date,
            end_date
        } = filters;

        const skip = (page - 1) * limit;
        const where = { deleted_at: null };

        // PHÂN QUYỀN THEO ROLE
        if (currentUser.role === 'TENANT') {
            // Tenant chỉ xem hợp đồng của mình
            where.tenant_user_id = currentUser.user_id;
        } else if (currentUser.role === 'MANAGER') {
            // Manager chỉ xem hợp đồng trong tòa nhà mình quản lý
            const managedBuildings = await prisma.building_managers.findMany({
                where: { user_id: currentUser.user_id },
                select: { building_id: true }
            });

            if (managedBuildings.length === 0) {
                // Manager không quản lý tòa nhà nào
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

            // Filter contracts by rooms in managed buildings
            where.rooms = {
                building_id: { in: buildingIds }
            };
        }
        // OWNER xem được tất cả (không thêm điều kiện gì)

        // Additional filters
        if (room_id) where.room_id = parseInt(room_id);
        if (tenant_user_id && currentUser.role !== 'TENANT') {
            where.tenant_user_id = parseInt(tenant_user_id);
        }
        if (status) where.status = status;

        // Filter by date range if provided
        if (start_date || end_date) {
            where.start_date = {};
            if (start_date) {
                where.start_date.gte = new Date(start_date);
            }
            if (end_date) {
                where.start_date.lte = new Date(end_date);
            }
        }

        // Tự động cập nhật status của các hợp đồng hết hạn
        await this.autoUpdateExpiredContracts();

        const [contracts, total] = await Promise.all([
            prisma.contracts.findMany({
                where,
                include: {
                    rooms: {
                        select: {
                            room_number: true,
                            building_id: true,
                            buildings: {
                                select: {
                                    name: true
                                }
                            }
                        }
                    },
                    tenants: {
                        include: {
                            users: {
                                select: {
                                    full_name: true,
                                    email: true
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

    // UPDATE - Cập nhật hợp đồng
    async updateContract(contractId, data, file = null, currentUser = null) {
        const { start_date, end_date, rent_amount, deposit_amount, status, note } = data;

        // Verify contract exists
        const existingContract = await prisma.contracts.findUnique({
            where: { contract_id: contractId },
            include: {
                rooms: {
                    include: {
                        buildings: true
                    }
                }
            }
        });

        if (!existingContract || existingContract.deleted_at) {
            throw new Error('Contract not found');
        }

        // Check permission if currentUser provided
        if (currentUser) {
            await this.checkContractPermission(existingContract, currentUser);
        }

        // Validate dates if provided
        if (start_date || end_date) {
            const startDate = start_date ? new Date(start_date) : existingContract.start_date;
            const endDate = end_date ? new Date(end_date) : existingContract.end_date;

            if (startDate >= endDate) {
                throw new Error('Start date must be before end date');
            }
        }

        // Prepare update data
        const updateData = {
            updated_at: new Date()
        };

        if (start_date) updateData.start_date = new Date(start_date);
        if (end_date) updateData.end_date = new Date(end_date);
        if (rent_amount !== undefined) updateData.rent_amount = rent_amount ? parseFloat(rent_amount) : null;
        if (deposit_amount !== undefined) updateData.deposit_amount = deposit_amount ? parseFloat(deposit_amount) : null;
        if (status) updateData.status = status;
        if (note !== undefined) updateData.note = note;

        // Upload new file to S3 if provided
        if (file) {
            try {
                // Delete old file if exists
                if (existingContract.s3_key) {
                    await s3Service.deleteFile(existingContract.s3_key);
                }

                // Upload new file
                const uploadResult = await s3Service.uploadFile(
                    file.buffer,
                    file.originalname,
                    'contracts'
                );

                updateData.s3_key = uploadResult.s3_key;
                updateData.file_name = uploadResult.file_name;
                updateData.checksum = uploadResult.checksum;
                updateData.uploaded_at = uploadResult.uploaded_at;
            } catch (error) {
                throw new Error(`Failed to upload contract file: ${error.message}`);
            }
        }

        const contract = await prisma.contracts.update({
            where: { contract_id: contractId },
            data: updateData,
            include: {
                rooms: true,
                tenants: { include: { users: true } },
                contract_addendums: true
            }
        });

        return this.formatContractResponse(contract);
    }

    // DELETE - Xóa mềm hợp đồng (không xóa file trên S3)
    async deleteContract(contractId, currentUser = null) {
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId },
            include: {
                rooms: {
                    include: {
                        buildings: true
                    }
                }
            }
        });

        if (!contract || contract.deleted_at) {
            throw new Error('Contract not found');
        }

        // Check permission if currentUser provided
        if (currentUser) {
            await this.checkContractPermission(contract, currentUser);
        }

        // Soft delete (không xóa file trên S3)
        await prisma.contracts.update({
            where: { contract_id: contractId },
            data: {
                deleted_at: new Date(),
                updated_at: new Date()
            }
        });

        return { success: true, message: 'Contract deleted successfully' };
    }

    // HARD DELETE - Xóa vĩnh viễn hợp đồng và file trên S3
    async hardDeleteContract(contractId, currentUser = null) {
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId },
            include: {
                rooms: {
                    include: {
                        buildings: true
                    }
                }
            }
        });

        if (!contract) {
            throw new Error('Contract not found');
        }

        // ✅ CHECK PERMISSION: Chỉ OWNER được hard delete
        if (currentUser && currentUser.role !== 'OWNER') {
            throw new Error('Only OWNER can permanently delete contracts');
        }

        // Delete file from S3 if exists
        if (contract.s3_key) {
            try {
                await s3Service.deleteFile(contract.s3_key);
            } catch (error) {
                console.error('Failed to delete S3 file:', error);
                // Continue with database deletion even if S3 deletion fails
            }
        }

        // Delete from database
        await prisma.contracts.delete({
            where: { contract_id: contractId }
        });

        return { success: true, message: 'Contract permanently deleted' };
    }

    // RESTORE - Khôi phục hợp đồng đã xóa
    async restoreContract(contractId, currentUser = null) {
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId },
            include: {
                rooms: {
                    include: {
                        buildings: true
                    }
                }
            }
        });

        if (!contract) {
            throw new Error('Contract not found');
        }

        if (!contract.deleted_at) {
            throw new Error('Contract is not deleted');
        }

        // ✅ CHECK PERMISSION: Manager chỉ restore hợp đồng trong tòa nhà họ quản lý
        if (currentUser && currentUser.role === 'MANAGER') {
            const hasAccess = await this.checkManagerBuildingAccess(
                currentUser.user_id,
                contract.rooms.building_id
            );

            if (!hasAccess) {
                throw new Error('You do not have permission to restore contracts in this building');
            }
        }

        const restored = await prisma.contracts.update({
            where: { contract_id: contractId },
            data: { deleted_at: null },
            include: {
                rooms: true,
                tenants: { include: { users: true } }
            }
        });

        return this.formatContractResponse(restored);
    }

    // TERMINATE - Kết thúc hợp đồng
    async terminateContract(contractId, reason = null, currentUser = null) {
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId },
            include: {
                rooms: {
                    include: {
                        buildings: true
                    }
                }
            }
        });

        if (!contract || contract.deleted_at) {
            throw new Error('Contract not found');
        }

        if (contract.status === 'terminated') {
            throw new Error('Contract is already terminated');
        }

        // ✅ CHECK PERMISSION
        if (currentUser) {
            await this.checkContractPermission(contract, currentUser);
        }

        const terminated = await prisma.contracts.update({
            where: { contract_id: contractId },
            data: {
                status: 'terminated',
                note: reason ? `${contract.note || ''}\nTermination reason: ${reason}` : contract.note,
                updated_at: new Date()
            },
            include: {
                rooms: true,
                tenants: { include: { users: true } }
            }
        });

        return this.formatContractResponse(terminated);
    }

    // DOWNLOAD - Tải xuống file hợp đồng
    async downloadContract(contractId, currentUser) {
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId },
            include: {
                rooms: {
                    include: {
                        buildings: true
                    }
                }
            }
        });

        if (!contract || contract.deleted_at) {
            throw new Error('Contract not found');
        }

        // Check permission
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
                rooms: {
                    include: {
                        buildings: true
                    }
                }
            }
        });

        if (!contract || contract.deleted_at) {
            throw new Error('Contract not found');
        }

        // Check permission
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

    async convertAndUpload(contractId, files, currentUser = null) {
        if (!files || files.length === 0) {
            throw new Error('Không có ảnh nào để chuyển đổi.');
        }

        // ✅ Verify contract exists và check permission
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: parseInt(contractId) },
            include: {
                rooms: {
                    include: {
                        buildings: true
                    }
                }
            }
        });

        if (!contract) {
            throw new Error('Contract not found');
        }

        // Check permission
        if (currentUser) {
            await this.checkContractPermission(contract, currentUser);
        }

        // Tạo thư mục tạm
        const tempDir = path.join(__dirname, '../temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

        // Đường dẫn file PDF tạm
        const outputFilePath = path.join(
            tempDir,
            `contract-${contractId}-${Date.now()}.pdf`
        );

        const doc = new PDFDocument({ autoFirstPage: false });
        const output = fs.createWriteStream(outputFilePath);
        doc.pipe(output);

        // Ghi từng ảnh vào PDF
        for (const file of files) {
            // Nếu dùng memoryStorage => phải tạo file tạm
            let imgPath;
            if (file.path) {
                imgPath = file.path; // Có sẵn khi dùng diskStorage
            } else {
                imgPath = path.join(tempDir, `${Date.now()}-${file.originalname}`);
                fs.writeFileSync(imgPath, file.buffer);
            }

            // Đọc và thêm ảnh vào PDF
            const img = doc.openImage(imgPath);
            doc.addPage({ size: [img.width, img.height] });
            doc.image(imgPath, 0, 0, { width: img.width, height: img.height });

            // Xóa ảnh tạm (nếu có)
            if (!file.path && fs.existsSync(imgPath)) {
                fs.unlinkSync(imgPath);
            }
        }

        // Hoàn tất PDF
        doc.end();
        await new Promise((resolve) => output.on('finish', resolve));

        // Upload PDF lên S3
        const fileBuffer = fs.readFileSync(outputFilePath);
        const uploadResult = await s3Service.uploadFile(
            fileBuffer,
            path.basename(outputFilePath),
            'contracts'
        );

        // Cập nhật contract trong DB
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

        // Xóa file PDF tạm
        if (fs.existsSync(outputFilePath)) fs.unlinkSync(outputFilePath);

        return uploadResult;
    }

    async processContractWithAI(fileBuffer, mimeType = 'application/pdf') {
        try {
            console.log('=== BẮT ĐẦU XỬ LÝ HỢP ĐỒNG BẰNG AI ===');

            // BƯỚC 1: Trích xuất text từ PDF bằng Document AI
            console.log('Step 1: Extracting text from PDF using Document AI...');
            const documentAIResult = await documentAIService.processContract(fileBuffer, mimeType);

            if (!documentAIResult.success) {
                throw new Error('Document AI processing failed: ' + documentAIResult.message);
            }

            const extractedText = documentAIResult.firstPageText || documentAIResult.fullText;

            if (!extractedText || extractedText.trim().length === 0) {
                throw new Error('No text extracted from PDF');
            }

            console.log(`✓ Extracted ${extractedText.length} characters from document`);
            console.log(`  Total pages: ${documentAIResult.totalPages}`);

            // BƯỚC 2: Parse text thành JSON bằng Gemini
            console.log('Step 2: Parsing contract text with Gemini...');
            const geminiResult = await geminiService.parseContractText(extractedText);

            if (!geminiResult.success) {
                throw new Error('Gemini parsing failed: ' + geminiResult.rawResponse);
            }

            const parsedData = geminiResult.data;
            console.log('✓ Gemini parsed data:', JSON.stringify(parsedData, null, 2));

            // BƯỚC 3: Tìm tenant trong database
            console.log('Step 3: Searching for tenant in database...');
            const searchParams = {
                tenant_name: parsedData.tenant_name || null,
                tenant_phone: parsedData.tenant_phone || null,
                tenant_id_number: parsedData.tenant_id_number || null,
                room_number: parsedData.room_number || null
            };

            // Kiểm tra có đủ thông tin để tìm kiếm không
            const hasSearchCriteria = Object.values(searchParams).some(val => val !== null);

            if (!hasSearchCriteria) {
                console.warn('⚠ No search criteria available from parsed data');
                return {
                    success: false,
                    stage: 'tenant_search',
                    error: 'Không tìm thấy thông tin tenant trong hợp đồng (tên, SĐT, CMND, hoặc số phòng)',
                    parsed_data: parsedData,
                    extracted_text: extractedText
                };
            }

            const tenantMatch = await tenantService.findBestMatchTenant(searchParams);

            if (!tenantMatch) {
                console.warn('⚠ No matching tenant found in database');
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
                console.log(`  Confidence score: ${tenantMatch._match_metadata.confidence_score}/100`);
                console.log(`  Match details:`, tenantMatch._match_metadata.match_details);
            }

            // BƯỚC 4: Chuẩn bị data cho createContract
            console.log('Step 4: Preparing data for contract creation...');

            const contractData = {
                room_id: tenantMatch.room?.room_id || null,
                tenant_user_id: tenantMatch.user_id,
                start_date: parsedData.start_date || null,
                end_date: parsedData.end_date || null,
                rent_amount: parsedData.rent_amount || null,
                deposit_amount: parsedData.deposit_amount || null,
                status: 'pending', // Mặc định pending, admin sẽ review
                note: this._buildContractNote(parsedData, tenantMatch)
            };

            // Validate dữ liệu quan trọng
            const validationErrors = this._validateContractData(contractData, parsedData);

            if (validationErrors.length > 0) {
                console.warn('⚠ Validation warnings:', validationErrors);
            }

            console.log('=== HOÀN TẤT XỬ LÝ AI ===');

            return {
                success: true,
                contract_data: contractData,
                tenant_info: {
                    user_id: tenantMatch.user_id,
                    full_name: tenantMatch.full_name,
                    phone: tenantMatch.phone,
                    email: tenantMatch.email,
                    id_number: tenantMatch.id_number,
                    room: tenantMatch.room,
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

    /**
     * ✅ [NEW] Kiểm tra Manager có quyền truy cập building không
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
            // Tenant chỉ xem được hợp đồng của mình
            if (contract.tenant_user_id !== currentUser.user_id) {
                throw new Error('You do not have permission to access this contract');
            }
        } else if (currentUser.role === 'MANAGER') {
            // Manager chỉ xem được hợp đồng trong tòa nhà mình quản lý
            const hasAccess = await this.checkManagerBuildingAccess(
                currentUser.user_id,
                contract.rooms.building_id
            );

            if (!hasAccess) {
                throw new Error('You do not have permission to access this contract');
            }
        }
        // OWNER có quyền xem tất cả - không cần check gì thêm
    }

    /**
     * Tự động cập nhật status của 1 hợp đồng nếu đã hết hạn
     */
    async autoUpdateExpiredStatus(contract) {
        if (!contract || contract.deleted_at) {
            return;
        }

        // Chỉ update những hợp đồng đang active hoặc pending
        if (contract.status !== 'active' && contract.status !== 'pending') {
            return;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const endDate = new Date(contract.end_date);
        endDate.setHours(0, 0, 0, 0);

        // Nếu end_date < today => đổi status thành expired
        if (endDate < today) {
            await prisma.contracts.update({
                where: { contract_id: contract.contract_id },
                data: {
                    status: 'expired',
                    updated_at: new Date()
                }
            });

            console.log(`✓ Contract ${contract.contract_id} auto-updated to expired`);
        }
    }

    /**
     * Tự động cập nhật tất cả hợp đồng hết hạn
     */
    async autoUpdateExpiredContracts() {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // Tìm tất cả hợp đồng active/pending mà end_date < today
            const expiredContracts = await prisma.contracts.updateMany({
                where: {
                    end_date: {
                        lt: today
                    },
                    status: {
                        in: ['active', 'pending']
                    },
                    deleted_at: null
                },
                data: {
                    status: 'expired',
                    updated_at: new Date()
                }
            });

            if (expiredContracts.count > 0) {
                console.log(`✓ Auto-updated ${expiredContracts.count} expired contracts`);
            }

            return expiredContracts.count;
        } catch (error) {
            console.error('Error auto-updating expired contracts:', error);
            return 0;
        }
    }

    /**
     * [Private] Xây dựng note cho contract từ parsed data
     */
    _buildContractNote(parsedData, tenantMatch) {
        const notes = ['🤖 Contract processed by AI'];

        // Thêm thông tin từ AI parsing
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

        // Thêm thông tin match confidence
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
     * [Private] Validate contract data
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


    // Helper function - Format response
    formatContractResponse(contract) {
        return {
            contract_id: contract.contract_id,
            room_id: contract.room_id,
            room_number: contract.rooms?.room_number,
            tenant_user_id: contract.tenant_user_id,
            tenant_name: contract.tenants?.users?.full_name,
            tenant_email: contract.tenants?.users?.email,
            start_date: contract.start_date,
            end_date: contract.end_date,
            rent_amount: contract.rent_amount,
            deposit_amount: contract.deposit_amount,
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