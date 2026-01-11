// Updated: 2025-01-06
// by: DatNB
// Refactored: Approval Workflow + File Upload for Contract Addendums

const prisma = require('../config/prisma');
const s3Service = require('./s3.service');

class ContractAddendumService {
    // CREATE - Tạo phụ lục hợp đồng mới (Pending Approval)
    async createAddendum(data, files = null, currentUser) {
        const {
            contract_id,
            addendum_type,
            changes,
            effective_from,
            effective_to,
            note
        } = data;

        // Validate required fields
        if (!contract_id || !addendum_type || !changes) {
            throw new Error('Missing required fields: contract_id, addendum_type, changes');
        }

        const contractId = parseInt(contract_id);
        if (isNaN(contractId)) {
            throw new Error('contract_id must be a valid number');
        }

        // Check if contract exists and is active
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId },
            include: { room_history: true } // Load building logic omitted for brevity
        });

        if (!contract || contract.deleted_at) {
            throw new Error('Contract not found or has been deleted');
        }

        if (contract.status !== 'active') {
            throw new Error(`Cannot create addendum. Contract status is '${contract.status}', but must be 'active'.`);
        }

        // Load building separately
        if (contract.room_history?.building_id) {
            const building = await prisma.buildings.findUnique({
                where: { building_id: contract.room_history.building_id }
            });
            contract.room_history.building = building;
        }

        // Validate and parse changes
        let parsedChanges = null;
        try {
            parsedChanges = typeof changes === 'string' ? JSON.parse(changes) : changes;
            if (typeof parsedChanges !== 'object' || parsedChanges === null) {
                throw new Error('Changes must be a valid JSON object');
            }
            this._validateAddendumTypeAndChanges(addendum_type, parsedChanges);
        } catch (error) {
            throw new Error('Invalid changes format. Must be valid JSON object');
        }

        await this._validateOverlap(
            contract,
            addendum_type,
            parsedChanges,
            effective_from,
            effective_to
        );

        // Get the next addendum number
        const latestAddendum = await prisma.contract_addendums.findFirst({
            where: { contract_id: contractId },
            orderBy: { addendum_number: 'desc' }
        });

        const nextAddendumNumber = latestAddendum ? latestAddendum.addendum_number + 1 : 1;

        // FILE PROCESSING (Similar to contract)
        let fileData = {};
        if (files && files.length > 0) {
            fileData = await this._processUploadFiles(files);
        }

        // Create addendum with pending_approval status
        const addendum = await prisma.contract_addendums.create({
            data: {
                contract_id: contractId,
                addendum_number: nextAddendumNumber,
                addendum_type,
                status: 'pending_approval',
                changes_snapshot: parsedChanges,
                effective_from: effective_from ? new Date(effective_from) : null,
                effective_to: effective_to ? new Date(effective_to) : null,
                created_by: currentUser.user_id,
                note,
                created_at: new Date(),
                updated_at: new Date(),
                ...fileData // Add file info (s3_key, file_name, checksum, etc.)
            },
            include: {
                contract: {
                    include: {
                        room_history: true,
                        tenant: { include: { user: true } }
                    }
                },
                creator: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true
                    }
                }
            }
        });

        // Load building for created addendum
        if (addendum.contract.room_history?.building_id) {
            const building = await prisma.buildings.findUnique({
                where: { building_id: addendum.contract.room_history.building_id }
            });
            addendum.contract.room_history.building = building;
        }

        // [NEW] GỬI EMAIL THÔNG BÁO CHO TENANT
        try {
            const tenantUser = addendum.contract.tenant?.user;
            if (tenantUser?.email) {
                // Link deep link hoặc web link
                const actionUrl = `${FRONTEND_URL}/contracts/${contractId}/addendums/${addendum.addendum_id}`;

                await emailService.sendAddendumApprovalEmail(
                    tenantUser.email,
                    tenantUser.full_name,
                    {
                        type: addendum.addendum_type,
                        contractNumber: addendum.contract.contract_number,
                        effectiveDate: addendum.effective_from || new Date()
                    },
                    actionUrl
                );
                console.log(`📧 Addendum approval email sent to ${tenantUser.email}`);
            }
        } catch (emailError) {
            console.error("❌ Failed to send addendum email:", emailError.message);
            // Không throw error để tránh revert transaction tạo addendum
        }

        return this.formatAddendumResponse(addendum);
    }

    // READ - Lấy thông tin phụ lục theo ID
    async getAddendumById(addendumId, currentUser) {
        let addendum = await prisma.contract_addendums.findUnique({
            where: { addendum_id: addendumId },
            include: {
                contract: {
                    include: {
                        room_history: true,
                        tenant: {
                            include: {
                                user: true
                            }
                        }
                    }
                },
                creator: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true
                    }
                }
            }
        });

        if (!addendum) {
            throw new Error('Addendum not found');
        }

        // Check permission: Tenant chỉ xem được phụ lục của hợp đồng mình
        if (currentUser.role === 'TENANT' &&
            addendum.contract.tenant_user_id !== currentUser.user_id) {
            throw new Error('You do not have permission to view this addendum');
        }

        addendum = await this._checkAndProcessExpiration(addendum);

        // Load building info separately
        if (addendum.contract.room_history) {
            const building = await prisma.buildings.findUnique({
                where: { building_id: addendum.contract.room_history.building_id }
            });
            addendum.contract.room_history.building = building;
        }

        return this.formatAddendumResponse(addendum);
    }

    // READ - Lấy danh sách phụ lục (có phân trang và filter)
    async getAddendums(filters = {}, currentUser) {
        const { contract_id, type, status, page = 1, limit = 20, effective_date_from, effective_date_to } = filters;
        const skip = (page - 1) * limit;
        const where = {};

        if (currentUser.role === 'TENANT') {
            const tenantContracts = await prisma.contracts.findMany({
                where: { tenant_user_id: currentUser.user_id, deleted_at: null },
                select: { contract_id: true }
            });
            where.contract_id = { in: tenantContracts.map(c => c.contract_id) };
        }

        if (contract_id) where.contract_id = parseInt(contract_id);
        if (type) where.addendum_type = type;
        if (status) where.status = status;
        if (effective_date_from || effective_date_to) {
            where.effective_from = {};
            if (effective_date_from) where.effective_from.gte = new Date(effective_date_from);
            if (effective_date_to) where.effective_from.lte = new Date(effective_date_to);
        }

        let addendums = await prisma.contract_addendums.findMany({
            where,
            include: {
                contract: {
                    include: {
                        room_history: true,
                        tenant: { include: { user: true } }
                    }
                },
                creator: true
            },
            skip,
            take: limit,
            orderBy: [{ contract_id: 'desc' }, { addendum_number: 'desc' }]
        });

        // --- NEW: Check Expiration for List ---
        // Xử lý song song để đảm bảo performance
        addendums = await Promise.all(addendums.map(ad => this._checkAndProcessExpiration(ad)));
        // --------------------------------------

        const total = await prisma.contract_addendums.count({ where });

        // Load building info (giữ nguyên logic cũ)
        for (const addendum of addendums) {
            if (addendum.contract.room_history?.building_id) {
                const building = await prisma.buildings.findUnique({
                    where: { building_id: addendum.contract.room_history.building_id },
                    select: { name: true }
                });
                addendum.contract.room_history.building = building;
            }
        }

        return {
            data: addendums.map(a => this.formatAddendumResponse(a)),
            pagination: { total, page, limit, pages: Math.ceil(total / limit) }
        };
    }

    // READ - Lấy tất cả phụ lục của một hợp đồng
    async getAddendumsByContract(contractId, currentUser) {
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId }
        });

        if (!contract || contract.deleted_at) {
            throw new Error('Contract not found');
        }

        // Check permission
        if (currentUser.role === 'TENANT' &&
            contract.tenant_user_id !== currentUser.user_id) {
            throw new Error('You do not have permission to view addendums for this contract');
        }

        let addendums = await prisma.contract_addendums.findMany({
            where: { contract_id: contractId },
            include: {
                creator: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true
                    }
                },
                contract: {
                    include: {
                        room_history: true,
                        tenant: { include: { user: true } }
                    }
                }
            },
            orderBy: { addendum_number: 'desc' }
        });
        addendums = await Promise.all(addendums.map(ad => this._checkAndProcessExpiration(ad)));
        // Load buildings for each addendum
        for (const addendum of addendums) {
            if (addendum.contract.room_history?.building_id) {
                const building = await prisma.buildings.findUnique({
                    where: { building_id: addendum.contract.room_history.building_id }
                });
                addendum.contract.room_history.building = building;
            }
        }

        return addendums.map(a => this.formatAddendumResponse(a));
    }

    // APPROVE - Tenant duyệt phụ lục (Apply changes to contract)
    async approveAddendum(addendumId, currentUser, ipAddress = null, userAgent = null) {
        // Validate addendum exists and is pending_approval
        const addendum = await prisma.contract_addendums.findUnique({
            where: { addendum_id: addendumId },
            include: {
                contract: {
                    include: {
                        room_history: true,
                        tenant: { include: { user: true } }
                    }
                }
            }
        });

        if (!addendum) {
            throw new Error('Addendum not found');
        }

        // Load building separately
        if (addendum.contract.room_history?.building_id) {
            const building = await prisma.buildings.findUnique({
                where: { building_id: addendum.contract.room_history.building_id }
            });
            addendum.contract.room_history.building = building;
        }

        // CHECK PERMISSION: Chỉ TENANT (chủ hợp đồng) mới được approve
        if (currentUser.role === 'TENANT') {
            if (addendum.contract.tenant_user_id !== currentUser.user_id) {
                throw new Error('You do not have permission to approve this addendum');
            }
        }

        if (addendum.status !== 'pending_approval') {
            throw new Error(`Addendum cannot be approved. Current status: ${addendum.status}`);
        }
        try {
            await consentService.logConsent({
                userId: currentUser.user_id,
                contractId: addendum.contract_id,
                addendumId: addendum.addendum_id, // Link to specific addendum
                consentType: 'CONTRACT_ADDENDUM', // Enum ConsentType
                action: 'ACCEPTED',               // Enum ConsentAction
                ipAddress: ipAddress || "unknown",
                deviceInfo: userAgent || "unknown",
            });
        } catch (error) {
            console.error("Failed to log consent:", error.message);
            // Tùy chọn: throw error nếu yêu cầu bắt buộc phải log thành công mới cho duyệt
            throw new Error(`Cannot approve addendum: Failed to log consent - ${error.message}`);
        }
        // Parse changes_snapshot
        let changesData = {};
        if (addendum.changes_snapshot) {
            try {
                changesData = typeof addendum.changes_snapshot === 'string'
                    ? JSON.parse(addendum.changes_snapshot)
                    : addendum.changes_snapshot;
            } catch (error) {
                throw new Error('Invalid changes data in addendum');
            }
        }
        const updateContractData = { updated_at: new Date() };
        const previousState = {}; // Object để lưu giá trị cũ của hợp đồng

        // Helper để map field và lưu giá trị cũ
        const mapField = (changeField, contractField, parseFunc = (v) => v) => {
            if (changesData[changeField] !== undefined) {
                // Lưu giá trị cũ hiện tại của contract
                previousState[contractField] = addendum.contract[contractField];
                // Set giá trị mới cho update data
                updateContractData[contractField] = parseFunc(changesData[changeField]);
            }
        };

        mapField('rent_amount', 'rent_amount', (v) => String(v));
        mapField('deposit_amount', 'deposit_amount', (v) => String(v));
        mapField('end_date', 'end_date', (v) => new Date(v));
        mapField('penalty_rate', 'penalty_rate', parseFloat);
        mapField('payment_cycle_months', 'payment_cycle_months', parseInt);
        mapField('start_date', 'start_date', (v) => new Date(v));

        // Cập nhật snapshot với cả New Values và Previous Values
        // Structure mới: { ...changes, previous_values: { ... } }
        const updatedSnapshot = {
            ...changesData,
            previous_values: previousState // Lưu cái này để sau này Revert
        };
        // Use transaction to atomically update both addendum and contract
        const result = await prisma.$transaction(async (tx) => {
            // 1. Parse changes and update parent contract
            const updateContractData = { updated_at: new Date() };

            // Map changes_snapshot fields to contract fields
            if (changesData.rent_amount !== undefined) {
                updateContractData.rent_amount = parseFloat(changesData.rent_amount);
            }
            if (changesData.deposit_amount !== undefined) {
                updateContractData.deposit_amount = parseFloat(changesData.deposit_amount);
            }
            if (changesData.end_date !== undefined) {
                updateContractData.end_date = new Date(changesData.end_date);
            }
            if (changesData.penalty_rate !== undefined) {
                updateContractData.penalty_rate = parseFloat(changesData.penalty_rate);
            }
            if (changesData.payment_cycle_months !== undefined) {
                updateContractData.payment_cycle_months = parseInt(changesData.payment_cycle_months);
            }
            if (changesData.start_date !== undefined) {
                updateContractData.start_date = new Date(changesData.start_date);
            }

            // 2. Update the contract with parsed changes
            const updatedContract = await tx.contracts.update({
                where: { contract_id: addendum.contract_id },
                data: updateContractData,
                include: {
                    room_history: true,
                    tenant: { include: { user: true } }
                }
            });

            // Load building for updated contract
            if (updatedContract.room_history?.building_id) {
                const building = await tx.buildings.findUnique({
                    where: { building_id: updatedContract.room_history.building_id }
                });
                updatedContract.room_history.building = building;
            }

            // 3. Update addendum status to approved
            const approvedAddendum = await tx.contract_addendums.update({
                where: { addendum_id: addendumId },
                data: {
                    status: 'approved',
                    tenant_accepted_at: new Date(),
                    updated_at: new Date()
                },
                include: {
                    contract: {
                        include: {
                            room_history: true,
                            tenant: { include: { user: true } }
                        }
                    },
                    creator: {
                        select: {
                            user_id: true,
                            full_name: true,
                            email: true
                        }
                    }
                }
            });

            // Load building for approved addendum
            if (approvedAddendum.contract.room_history?.building_id) {
                const building = await tx.buildings.findUnique({
                    where: { building_id: approvedAddendum.contract.room_history.building_id }
                });
                approvedAddendum.contract.room_history.building = building;
            }

            return {
                addendum: this.formatAddendumResponse(approvedAddendum),
                contract: updatedContract
            };
        });

        return result;
    }

    // REJECT - Tenant từ chối phụ lục
    async rejectAddendum(addendumId, reason = '', currentUser, ipAddress = null, userAgent = null) {
        // Validate addendum exists and is pending_approval
        const addendum = await prisma.contract_addendums.findUnique({
            where: { addendum_id: addendumId },
            include: {
                contract: true
            }
        });

        if (!addendum) {
            throw new Error('Addendum not found');
        }

        // CHECK PERMISSION: Chỉ TENANT (chủ hợp đồng) mới được reject
        if (currentUser.role === 'TENANT') {
            if (addendum.contract.tenant_user_id !== currentUser.user_id) {
                throw new Error('You do not have permission to reject this addendum');
            }
        }

        if (addendum.status !== 'pending_approval') {
            throw new Error(`Addendum cannot be rejected. Current status: ${addendum.status}`);
        }
        try {
            await consentService.logConsent({
                userId: currentUser.user_id,
                contractId: addendum.contract_id,
                addendumId: addendum.addendum_id,
                consentType: 'CONTRACT_ADDENDUM',
                action: 'REVOKED', // Dùng REVOKED để biểu thị việc từ chối ký
                ipAddress: ipAddress || "unknown",
                deviceInfo: userAgent || "unknown",
            });
        } catch (error) {
            console.error("Failed to log rejection consent:", error.message);
        }
        // Update addendum status to rejected (do NOT update contract)
        const rejectedAddendum = await prisma.contract_addendums.update({
            where: { addendum_id: addendumId },
            data: {
                status: 'rejected',
                note: reason ? `${addendum.note || ''}\n[REJECTED] ${reason}`.trim() : addendum.note,
                updated_at: new Date()
            },
            include: {
                contract: {
                    include: {
                        room_history: true,
                        tenant: { include: { user: true } }
                    }
                },
                creator: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true
                    }
                }
            }
        });

        // Load building separately
        if (rejectedAddendum.contract.room_history?.building_id) {
            const building = await prisma.buildings.findUnique({
                where: { building_id: rejectedAddendum.contract.room_history.building_id }
            });
            rejectedAddendum.contract.room_history.building = building;
        }

        return this.formatAddendumResponse(rejectedAddendum);
    }

    // UPDATE - Cập nhật phụ lục (cho phép khi Pending hoặc Rejected)
    async updateAddendum(addendumId, data, files = null, currentUser) {
        const { addendum_type, changes, effective_from, effective_to, note } = data;

        // Verify addendum exists
        const existingAddendum = await prisma.contract_addendums.findUnique({
            where: { addendum_id: addendumId },
            include: {
                contract: true
            }
        });

        if (!existingAddendum) {
            throw new Error('Addendum not found');
        }

        // --- SỬA ĐỔI: Cho phép update cả khi 'pending_approval' HOẶC 'rejected' ---
        const allowedStatuses = ['pending_approval', 'rejected'];
        if (!allowedStatuses.includes(existingAddendum.status)) {
            throw new Error(`Cannot update addendum. Status is '${existingAddendum.status}', but must be 'pending_approval' or 'rejected'.`);
        }
        // -------------------------------------------------------------------------

        // Check if contract is still active
        if (existingAddendum.contract.status !== 'active') {
            throw new Error('Cannot update addendum for non-active contract');
        }

        const newType = addendum_type || existingAddendum.addendum_type;
        const newStart = effective_from || existingAddendum.effective_from;
        const newEnd = effective_to || existingAddendum.effective_to;

        let newChanges = existingAddendum.changes_snapshot;
        if (changes !== undefined) {
            if (changes === null) newChanges = null;
            else {
                try {
                    newChanges = typeof changes === 'string' ? JSON.parse(changes) : changes;
                } catch (error) { throw new Error('Invalid changes format'); }
            }
        }

        // [QUAN TRỌNG] Validate Logic & Overlap với giá trị mới tính toán được
        if (newType && newChanges) {
            this._validateAddendumTypeAndChanges(newType, newChanges);
        }

        // Gọi validate overlap (trừ chính nó ra - excludeId)
        await this._validateOverlap(
            existingAddendum.contract,
            newType,
            newChanges,
            newStart,
            newEnd,
            addendumId
        );

        // Prepare update data
        const updateData = { updated_at: new Date() };

        // --- SỬA ĐỔI: Nếu đang là Rejected mà sửa lại -> Tự động chuyển về Pending để duyệt lại ---
        if (existingAddendum.status === 'rejected') {
            updateData.status = 'pending_approval';
            // Có thể xóa note từ chối cũ nếu muốn, hoặc giữ lại lịch sử
            // updateData.note = note; // Nếu user gửi note mới thì ghi đè
        }
        // ---------------------------------------------------------------------------------------

        if (addendum_type) updateData.addendum_type = addendum_type;
        if (effective_from) updateData.effective_from = new Date(effective_from);
        if (effective_to) updateData.effective_to = new Date(effective_to);
        if (note !== undefined) updateData.note = note;

        // Validate and parse changes if provided
        if (changes !== undefined) {
            if (changes === null) {
                updateData.changes_snapshot = null;
            } else {
                try {
                    updateData.changes_snapshot = typeof changes === 'string' ?
                        JSON.parse(changes) : changes;
                } catch (error) {
                    throw new Error('Invalid changes format. Must be valid JSON');
                }
            }
        }
        if (addendum_type || changes) {
            this._validateAddendumTypeAndChanges(newType, newChanges);
        }
        // FILE PROCESSING - Replace old file if new file uploaded
        if (files && files.length > 0) {
            // Delete old file if exists
            if (existingAddendum.s3_key) {
                try {
                    await s3Service.deleteFile(existingAddendum.s3_key);
                } catch (e) {
                    console.warn("Could not delete old file from S3", e);
                }
            }
            // Upload new files
            const uploadResult = await this._processUploadFiles(files);
            Object.assign(updateData, uploadResult);
        }

        const addendum = await prisma.contract_addendums.update({
            where: { addendum_id: addendumId },
            data: updateData,
            include: {
                contract: {
                    include: {
                        room_history: true,
                        tenant: {
                            include: {
                                user: true
                            }
                        }
                    }
                },
                creator: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true
                    }
                }
            }
        });

        // Load building separately
        if (addendum.contract.room_history?.building_id) {
            const building = await prisma.buildings.findUnique({
                where: { building_id: addendum.contract.room_history.building_id }
            });
            addendum.contract.room_history.building = building;
        }

        return this.formatAddendumResponse(addendum);
    }

    // DELETE - Xóa phụ lục (chỉ owner và chỉ khi pending hoặc rejected)
    async deleteAddendum(addendumId, currentUser) {
        const addendum = await prisma.contract_addendums.findUnique({
            where: { addendum_id: addendumId }
        });

        if (!addendum) {
            throw new Error('Addendum not found');
        }

        // Chỉ owner mới được xóa
        if (currentUser.role !== 'OWNER') {
            throw new Error('Only OWNER can delete addendums');
        }

        // Chỉ xóa được khi pending hoặc rejected
        if (!['pending_approval', 'rejected'].includes(addendum.status)) {
            throw new Error('Only pending or rejected addendums can be deleted');
        }

        // Delete file if exists
        if (addendum.s3_key) {
            try {
                await s3Service.deleteFile(addendum.s3_key);
            } catch (error) {
                console.error('Failed to delete S3 file:', error);
            }
        }

        await prisma.contract_addendums.delete({
            where: { addendum_id: addendumId }
        });

        return { success: true, message: 'Addendum deleted successfully' };
    }

    // DOWNLOAD - Get download URL
    async downloadAddendum(addendumId, currentUser) {
        const addendum = await prisma.contract_addendums.findUnique({
            where: { addendum_id: addendumId },
            include: {
                contract: {
                    include: {
                        room_history: true
                    }
                }
            }
        });

        if (!addendum) {
            throw new Error('Addendum not found');
        }

        // Check permission
        if (currentUser.role === 'TENANT') {
            if (addendum.contract.tenant_user_id !== currentUser.user_id) {
                throw new Error('You do not have permission to download this addendum');
            }
        }

        if (!addendum.s3_key) {
            throw new Error('Addendum file not found');
        }

        try {
            const downloadUrl = await s3Service.getDownloadUrl(
                addendum.s3_key,
                addendum.file_name || 'addendum.pdf',
                3600
            );

            return {
                addendum_id: addendumId,
                file_name: addendum.file_name,
                download_url: downloadUrl,
                expires_in: 3600
            };
        } catch (error) {
            throw new Error(`Failed to generate download URL: ${error.message}`);
        }
    }

    // DOWNLOAD - Direct stream
    async downloadAddendumDirect(addendumId, currentUser) {
        const addendum = await prisma.contract_addendums.findUnique({
            where: { addendum_id: addendumId },
            include: {
                contract: {
                    include: {
                        room_history: true
                    }
                }
            }
        });

        if (!addendum) {
            throw new Error('Addendum not found');
        }

        // Check permission
        if (currentUser.role === 'TENANT') {
            if (addendum.contract.tenant_user_id !== currentUser.user_id) {
                throw new Error('You do not have permission to download this addendum');
            }
        }

        if (!addendum.s3_key) {
            throw new Error('Addendum file not found');
        }

        try {
            const fileBuffer = await s3Service.downloadFile(addendum.s3_key);

            if (addendum.checksum) {
                const isValid = s3Service.verifyChecksum(fileBuffer, addendum.checksum);
                if (!isValid) {
                    throw new Error('File integrity check failed');
                }
            }

            return {
                buffer: fileBuffer,
                file_name: addendum.file_name || 'addendum.pdf',
                content_type: 'application/pdf'
            };
        } catch (error) {
            throw new Error(`Failed to download addendum file: ${error.message}`);
        }
    }

    // STATISTICS - Thống kê phụ lục theo loại
    async getAddendumStatistics(contractId = null) {
        const where = contractId ? { contract_id: parseInt(contractId) } : {};

        const stats = await prisma.contract_addendums.groupBy({
            by: ['addendum_type'],
            where,
            _count: {
                addendum_id: true
            }
        });

        return stats.map(stat => ({
            type: stat.addendum_type,
            count: stat._count.addendum_id
        }));
    }

    // ============================================
    // PRIVATE HELPERS
    // ============================================
    /**
     * Kiểm tra và xử lý hết hạn phụ lục
     * Nếu effective_to < now và đang active -> Expire và Revert
     */
    async _checkAndProcessExpiration(addendum) {
        // Chỉ xử lý nếu trạng thái là 'approved' và có ngày kết thúc
        if (addendum.status === 'approved' && addendum.effective_to) {
            const now = new Date();
            const effectiveTo = new Date(addendum.effective_to);

            // Kiểm tra xem đã hết hạn chưa (Ngày hiện tại > ngày effective_to)
            // Lưu ý: So sánh ngày tùy thuộc business logic (cuối ngày hay đầu ngày).
            // Ở đây giả sử effective_to là timestamp, so sánh trực tiếp.
            if (now > effectiveTo) {
                try {
                    console.log(`Auto expiring addendum ${addendum.addendum_id}...`);
                    return await this._expireAddendum(addendum);
                } catch (error) {
                    console.error(`Failed to auto-expire addendum ${addendum.addendum_id}:`, error);
                    // Nếu lỗi, trả về addendum gốc để không crash API, nhưng log lại
                    return addendum;
                }
            }
        }
        return addendum;
    }

    /**
     * Logic thực hiện Revert contract và set status expired
     */
    async _expireAddendum(addendum) {
        // Parse snapshot để lấy previous_values
        let snapshot = addendum.changes_snapshot;
        if (typeof snapshot === 'string') snapshot = JSON.parse(snapshot);

        const previousValues = snapshot?.previous_values;

        if (!previousValues) {
            console.warn(`Addendum ${addendum.addendum_id} has no previous_values to revert.`);
            // Vẫn set expired nhưng không revert được contract
            const expired = await prisma.contract_addendums.update({
                where: { addendum_id: addendum.addendum_id },
                data: { status: 'expired', updated_at: new Date() },
                include: { contract: { include: { room_history: true, tenant: { include: { user: true } } } }, creator: true }
            });
            return expired;
        }

        // Transaction: Revert Contract + Set Addendum Expired
        const result = await prisma.$transaction(async (tx) => {
            // 1. Revert Contract
            await tx.contracts.update({
                where: { contract_id: addendum.contract_id },
                data: {
                    ...previousValues, // Restore old values (rent, end_date, etc.)
                    updated_at: new Date()
                }
            });

            // 2. Set Addendum Expired
            const expiredAddendum = await tx.contract_addendums.update({
                where: { addendum_id: addendum.addendum_id },
                data: {
                    status: 'expired',
                    updated_at: new Date(),
                    note: addendum.note ? `${addendum.note}\n[SYSTEM] Auto-expired & Reverted on ${new Date().toISOString()}` : `[SYSTEM] Auto-expired on ${new Date().toISOString()}`
                },
                include: {
                    contract: {
                        include: {
                            room_history: true,
                            tenant: { include: { user: true } }
                        }
                    },
                    creator: true
                }
            });

            return expiredAddendum;
        });

        return result;
    }
    /**
     * Process uploaded files (PDF or Images)
     * Reuse logic from contract.service.js
     */
    async _processUploadFiles(fileOrFiles) {
        if (!fileOrFiles) return null;

        const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
        if (files.length === 0) return null;

        let bufferToUpload;
        let originalName = files[0].originalname;

        const isPdf = files[0].mimetype === 'application/pdf';
        const isImage = files[0].mimetype.startsWith('image/');

        if (isPdf) {
            bufferToUpload = files[0].buffer;
        } else if (isImage) {
            try {
                bufferToUpload = await this._convertImagesToPdf(files);
                originalName = originalName.replace(/\.[^/.]+$/, "") + ".pdf";
            } catch (err) {
                throw new Error('Failed to convert images to PDF: ' + err.message);
            }
        } else {
            throw new Error('Unsupported file type');
        }

        const uploadResult = await s3Service.uploadFile(bufferToUpload, originalName, 'addendums');
        return {
            s3_key: uploadResult.s3_key,
            file_name: uploadResult.file_name,
            checksum: uploadResult.checksum,
            uploaded_at: uploadResult.uploaded_at
        };
    }

    /**
     * Convert multiple images to single PDF
     */
    async _convertImagesToPdf(files) {
        const PDFDocument = require('pdfkit');

        return new Promise((resolve, reject) => {
            try {
                const doc = new PDFDocument({ autoFirstPage: false });
                const chunks = [];

                doc.on('data', chunk => chunks.push(chunk));
                doc.on('end', () => resolve(Buffer.concat(chunks)));
                doc.on('error', err => reject(err));

                for (const file of files) {
                    const img = doc.openImage(file.buffer);
                    doc.addPage({ size: [img.width, img.height] });
                    doc.image(file.buffer, 0, 0);
                }

                doc.end();
            } catch (error) {
                reject(error);
            }
        });
    }
    // Thêm hàm này xuống dưới cùng (khu vực PRIVATE HELPERS)
    _validateAddendumTypeAndChanges(type, changes) {
        const keys = Object.keys(changes);

        // Nếu là sửa hỗn hợp, cho phép mọi trường
        if (type === 'general_amendment') return;

        // Logic validate cho từng loại đơn lẻ
        switch (type) {
            case 'extension':
                // Phải có end_date, không được có rent_amount...
                if (!keys.includes('end_date')) throw new Error('Extension addendum must include "end_date"');
                if (keys.includes('rent_amount')) throw new Error('Extension type cannot change rent_amount. Use "general_amendment" instead.');
                break;

            case 'rent_adjustment':
                if (!keys.includes('rent_amount')) throw new Error('Rent adjustment must include "rent_amount"');
                if (keys.includes('end_date')) throw new Error('Rent adjustment cannot change end_date. Use "general_amendment" instead.');
                break;

            case 'deposit_adjustment':
                if (!keys.includes('deposit_amount')) throw new Error('Deposit adjustment must include "deposit_amount"');
                break;

            case 'payment_terms_change':
                // Kiểm tra xem có đổi chu kỳ hoặc phạt không
                const validKeys = ['payment_cycle_months', 'penalty_rate'];
                const hasValidKey = keys.some(k => validKeys.includes(k));
                if (!hasValidKey) throw new Error('Payment terms change must include cycle or penalty rate');
                break;


        }
    }
    async _validateOverlap(contract, newType, newChanges, newStart, newEnd, excludeId = null) {
        const newKeys = Object.keys(newChanges || {});
        if (newKeys.length === 0) return;

        // 1. Xác định thời gian của Addendum mới
        // Nếu không có effective_from -> Default là contract start (hoặc now)
        // Nếu không có effective_to -> Default là contract end date (Áp dụng đến hết HĐ)
        const range1Start = newStart ? new Date(newStart).getTime() : new Date().getTime();
        const range1End = newEnd ? new Date(newEnd).getTime() : new Date(contract.end_date).getTime();

        if (range1Start > range1End) {
            throw new Error('Effective From date cannot be after Effective To date');
        }

        // 2. Lấy danh sách addendum có thể conflict
        const existingAddendums = await prisma.contract_addendums.findMany({
            where: {
                contract_id: contract.contract_id,
                status: { in: ['approved', 'pending_approval'] },
                addendum_id: excludeId ? { not: excludeId } : undefined
            }
        });

        for (const existing of existingAddendums) {
            // 3. Xác định thời gian của Addendum cũ
            const existingStart = existing.effective_from ? existing.effective_from.getTime() : 0;
            // Nếu existing không có effective_to -> Nó kéo dài đến hết hợp đồng
            const existingEnd = existing.effective_to ? existing.effective_to.getTime() : new Date(contract.end_date).getTime();

            // 4. Kiểm tra trùng ngày (Date Overlap Check)
            // Công thức: (StartA <= EndB) và (EndA >= StartB)
            const isDateOverlap = (range1Start <= existingEnd) && (range1End >= existingStart);

            if (isDateOverlap) {
                // 5. Nếu trùng ngày -> Mới check nội dung bên trong
                let existingChanges = existing.changes_snapshot;
                if (typeof existingChanges === 'string') {
                    try { existingChanges = JSON.parse(existingChanges); } catch (e) {}
                }

                const existingKeys = Object.keys(existingChanges || {});

                // Tìm key bị trùng
                const conflictKeys = newKeys.filter(key => existingKeys.includes(key));

                if (conflictKeys.length > 0) {
                    const startDateStr = new Date(existingStart).toLocaleDateString('vi-VN');
                    const endDateStr = new Date(existingEnd).toLocaleDateString('vi-VN');

                    throw new Error(
                        `Conflict detected: You are modifying [${conflictKeys.join(', ')}] ` +
                        `which is already modified by Addendum #${existing.addendum_number} ` +
                        `in the overlapping period (${startDateStr} - ${endDateStr}).`
                    );
                }
            }
        }
    }
    formatAddendumResponse(addendum) {
        const response = {
            addendum_id: addendum.addendum_id,
            contract_id: addendum.contract_id,
            addendum_number: addendum.addendum_number,
            addendum_type: addendum.addendum_type,
            status: addendum.status,
            changes_snapshot: addendum.changes_snapshot,
            effective_from: addendum.effective_from,
            effective_to: addendum.effective_to,
            s3_key: addendum.s3_key,
            file_name: addendum.file_name,
            checksum: addendum.checksum,
            uploaded_at: addendum.uploaded_at,
            has_file: !!addendum.s3_key,
            created_by: addendum.created_by,
            created_at: addendum.created_at,
            updated_at: addendum.updated_at,
            tenant_accepted_at: addendum.tenant_accepted_at,
            note: addendum.note
        };

        // Include contract info if available
        if (addendum.contract) {
            const contract = addendum.contract;
            const room = contract.room_history;
            const building = room?.building;
            const tenant = contract.tenant;
            const user = tenant?.user;

            // SỬA: Đổi key từ 'contract_info' thành 'contract'
            // Điều này giúp Frontend gọi item.contract.contract_number sẽ có dữ liệu
            response.contract = {
                contract_id: contract.contract_id,
                contract_number: contract.contract_number,
                status: contract.status,
                start_date: contract.start_date,
                end_date: contract.end_date,
                rent_amount: contract.rent_amount,
                deposit_amount: contract.deposit_amount,
                duration_months: contract.duration_months,             // <-- Thêm dòng này [cite: 39]
                payment_cycle_months: contract.payment_cycle_months,   // <-- Thêm dòng này [cite: 41]
                penalty_rate: contract.penalty_rate,
                // Flat data cho dễ lấy
                room_number: room?.room_number || null,
                building_id: building?.building_id || null,
                building_name: building?.name || null,
                tenant_name: user?.full_name || null,
                tenant_email: user?.email || null,
                tenant_phone: user?.phone || null,

                // Support legacy structure if needed (Optional)
                tenant: user ? {
                    full_name: user.full_name,
                    phone: user.phone
                } : null
            };
        }

        // Include creator info if available
        if (addendum.creator) {
            response.creator = {
                user_id: addendum.creator.user_id,
                full_name: addendum.creator.full_name,
                email: addendum.creator.email
            };
        }

        return response;
    }
}

module.exports = new ContractAddendumService();