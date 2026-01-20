// Updated: 2025-01-20
// Refactored: Added Validations from Contract Service (Financials, Dates, Penalty)

const prisma = require('../config/prisma');
const s3Service = require('./s3.service');
const consentService = require("./consent.service"); // Giả sử bạn có import này dựa trên file gốc
const emailService = require("../utils/email"); // Import email service

// Base URL frontend (như contract service)
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

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
            include: { room_history: true }
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
            throw new Error(error.message || 'Invalid changes format');
        }

        // [NEW] Validate Logic sâu (Tài chính, Date, Penalty)
        this._validateDeepLogic(contract, parsedChanges);

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

        // FILE PROCESSING
        let fileData = {};
        if (files && files.length > 0) {
            fileData = await this._processUploadFiles(files);
        }

        // Create addendum
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
                ...fileData
            },
            include: {
                contract: {
                    include: {
                        room_history: true,
                        tenant: { include: { user: true } }
                    }
                },
                creator: {
                    select: { user_id: true, full_name: true, email: true }
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

        // GỬI EMAIL THÔNG BÁO CHO TENANT
        try {
            const tenantUser = addendum.contract.tenant?.user;
            if (tenantUser?.email) {
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
                        tenant: { include: { user: true } }
                    }
                },
                creator: {
                    select: { user_id: true, full_name: true, email: true }
                }
            }
        });

        if (!addendum) throw new Error('Addendum not found');

        // Check permission
        if (currentUser.role === 'TENANT' &&
            addendum.contract.tenant_user_id !== currentUser.user_id) {
            throw new Error('You do not have permission to view this addendum');
        }

        addendum = await this._checkAndProcessExpiration(addendum);

        if (addendum.contract.room_history) {
            const building = await prisma.buildings.findUnique({
                where: { building_id: addendum.contract.room_history.building_id }
            });
            addendum.contract.room_history.building = building;
        }

        return this.formatAddendumResponse(addendum);
    }

    // READ - Lấy danh sách phụ lục
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

        addendums = await Promise.all(addendums.map(ad => this._checkAndProcessExpiration(ad)));
        const total = await prisma.contract_addendums.count({ where });

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
        const contract = await prisma.contracts.findUnique({ where: { contract_id: contractId } });
        if (!contract || contract.deleted_at) throw new Error('Contract not found');

        if (currentUser.role === 'TENANT' && contract.tenant_user_id !== currentUser.user_id) {
            throw new Error('You do not have permission to view addendums for this contract');
        }

        let addendums = await prisma.contract_addendums.findMany({
            where: { contract_id: contractId },
            include: {
                creator: { select: { user_id: true, full_name: true, email: true } },
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

    // APPROVE - Tenant duyệt phụ lục
    async approveAddendum(addendumId, currentUser, ipAddress = null, userAgent = null) {
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

        if (!addendum) throw new Error('Addendum not found');

        if (addendum.contract.room_history?.building_id) {
            const building = await prisma.buildings.findUnique({
                where: { building_id: addendum.contract.room_history.building_id }
            });
            addendum.contract.room_history.building = building;
        }

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
                addendumId: addendum.addendum_id,
                consentType: 'CONTRACT_ADDENDUM',
                action: 'ACCEPTED',
                ipAddress: ipAddress || "unknown",
                deviceInfo: userAgent || "unknown",
            });
        } catch (error) {
            console.error("Failed to log consent:", error.message);
            throw new Error(`Cannot approve addendum: Failed to log consent - ${error.message}`);
        }

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

        const previousState = {};
        const updateContractData = { updated_at: new Date() };

        // Helper map logic
        const mapField = (changeField, contractField, parseFunc = (v) => v) => {
            if (changesData[changeField] !== undefined) {
                previousState[contractField] = addendum.contract[contractField];
            }
        };
        // Just building previousState map logic here is implicit in the loop below or can be explicit.
        // We will stick to the provided file logic which manually mapped fields.

        // Re-construct logic to grab previous state properly
        if(changesData.rent_amount !== undefined) previousState.rent_amount = addendum.contract.rent_amount;
        if(changesData.deposit_amount !== undefined) previousState.deposit_amount = addendum.contract.deposit_amount;
        if(changesData.end_date !== undefined) previousState.end_date = addendum.contract.end_date;
        if(changesData.penalty_rate !== undefined) previousState.penalty_rate = addendum.contract.penalty_rate;
        if(changesData.payment_cycle_months !== undefined) previousState.payment_cycle_months = addendum.contract.payment_cycle_months;
        if(changesData.start_date !== undefined) previousState.start_date = addendum.contract.start_date;


        // Update Contract Data Prep
        if (changesData.rent_amount !== undefined) updateContractData.rent_amount = parseFloat(changesData.rent_amount);
        if (changesData.deposit_amount !== undefined) updateContractData.deposit_amount = parseFloat(changesData.deposit_amount);
        if (changesData.end_date !== undefined) updateContractData.end_date = new Date(changesData.end_date);
        if (changesData.penalty_rate !== undefined) updateContractData.penalty_rate = parseFloat(changesData.penalty_rate);
        if (changesData.payment_cycle_months !== undefined) updateContractData.payment_cycle_months = parseInt(changesData.payment_cycle_months);
        if (changesData.start_date !== undefined) updateContractData.start_date = new Date(changesData.start_date);

        const updatedSnapshot = {
            ...changesData,
            previous_values: previousState
        };

        const result = await prisma.$transaction(async (tx) => {
            // Update Contract
            const updatedContract = await tx.contracts.update({
                where: { contract_id: addendum.contract_id },
                data: updateContractData,
                include: {
                    room_history: true,
                    tenant: { include: { user: true } }
                }
            });

            if (updatedContract.room_history?.building_id) {
                const building = await tx.buildings.findUnique({
                    where: { building_id: updatedContract.room_history.building_id }
                });
                updatedContract.room_history.building = building;
            }

            // Update Addendum
            const approvedAddendum = await tx.contract_addendums.update({
                where: { addendum_id: addendumId },
                data: {
                    status: 'approved',
                    changes_snapshot: updatedSnapshot, // Save with previous values
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
                    creator: { select: { user_id: true, full_name: true, email: true } }
                }
            });

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
        const addendum = await prisma.contract_addendums.findUnique({
            where: { addendum_id: addendumId },
            include: { contract: true }
        });

        if (!addendum) throw new Error('Addendum not found');

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
                action: 'REVOKED',
                ipAddress: ipAddress || "unknown",
                deviceInfo: userAgent || "unknown",
            });
        } catch (error) {
            console.error("Failed to log rejection consent:", error.message);
        }

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
                creator: { select: { user_id: true, full_name: true, email: true } }
            }
        });

        if (rejectedAddendum.contract.room_history?.building_id) {
            const building = await prisma.buildings.findUnique({
                where: { building_id: rejectedAddendum.contract.room_history.building_id }
            });
            rejectedAddendum.contract.room_history.building = building;
        }

        return this.formatAddendumResponse(rejectedAddendum);
    }

    // UPDATE - Cập nhật phụ lục
    async updateAddendum(addendumId, data, files = null, currentUser) {
        const { addendum_type, changes, effective_from, effective_to, note } = data;

        const existingAddendum = await prisma.contract_addendums.findUnique({
            where: { addendum_id: addendumId },
            include: { contract: true }
        });

        if (!existingAddendum) throw new Error('Addendum not found');

        const allowedStatuses = ['pending_approval', 'rejected'];
        if (!allowedStatuses.includes(existingAddendum.status)) {
            throw new Error(`Cannot update addendum. Status is '${existingAddendum.status}', but must be 'pending_approval' or 'rejected'.`);
        }

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

        // Validate Type Match
        if (newType && newChanges) {
            this._validateAddendumTypeAndChanges(newType, newChanges);
        }

        // [NEW] Validate Logic sâu với giá trị mới (Tài chính, Date, Penalty)
        if (newChanges) {
            this._validateDeepLogic(existingAddendum.contract, newChanges);
        }

        // Validate Overlap
        await this._validateOverlap(
            existingAddendum.contract,
            newType,
            newChanges,
            newStart,
            newEnd,
            addendumId
        );

        const updateData = { updated_at: new Date() };

        if (existingAddendum.status === 'rejected') {
            updateData.status = 'pending_approval';
        }

        if (addendum_type) updateData.addendum_type = addendum_type;
        if (effective_from) updateData.effective_from = new Date(effective_from);
        if (effective_to) updateData.effective_to = new Date(effective_to);
        if (note !== undefined) updateData.note = note;
        if (changes !== undefined) {
            updateData.changes_snapshot = newChanges;
        }

        // FILE PROCESSING
        if (files && files.length > 0) {
            if (existingAddendum.s3_key) {
                try { await s3Service.deleteFile(existingAddendum.s3_key); } catch (e) { console.warn("Could not delete old file", e); }
            }
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
                        tenant: { include: { user: true } }
                    }
                },
                creator: { select: { user_id: true, full_name: true, email: true } }
            }
        });

        if (addendum.contract.room_history?.building_id) {
            const building = await prisma.buildings.findUnique({
                where: { building_id: addendum.contract.room_history.building_id }
            });
            addendum.contract.room_history.building = building;
        }

        return this.formatAddendumResponse(addendum);
    }

    // DELETE - Xóa phụ lục
    async deleteAddendum(addendumId, currentUser) {
        const addendum = await prisma.contract_addendums.findUnique({ where: { addendum_id: addendumId } });
        if (!addendum) throw new Error('Addendum not found');

        if (currentUser.role !== 'OWNER') throw new Error('Only OWNER can delete addendums');

        if (!['pending_approval', 'rejected'].includes(addendum.status)) {
            throw new Error('Only pending or rejected addendums can be deleted');
        }

        if (addendum.s3_key) {
            try { await s3Service.deleteFile(addendum.s3_key); } catch (error) { console.error('Failed to delete S3 file:', error); }
        }

        await prisma.contract_addendums.delete({ where: { addendum_id: addendumId } });

        return { success: true, message: 'Addendum deleted successfully' };
    }

    // DOWNLOAD
    async downloadAddendum(addendumId, currentUser) {
        const addendum = await prisma.contract_addendums.findUnique({
            where: { addendum_id: addendumId },
            include: { contract: { include: { room_history: true } } }
        });

        if (!addendum) throw new Error('Addendum not found');

        if (currentUser.role === 'TENANT' && addendum.contract.tenant_user_id !== currentUser.user_id) {
            throw new Error('You do not have permission to download this addendum');
        }
        if (!addendum.s3_key) throw new Error('Addendum file not found');

        try {
            const downloadUrl = await s3Service.getDownloadUrl(addendum.s3_key, addendum.file_name || 'addendum.pdf', 3600);
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

    async downloadAddendumDirect(addendumId, currentUser) {
        const addendum = await prisma.contract_addendums.findUnique({
            where: { addendum_id: addendumId },
            include: { contract: { include: { room_history: true } } }
        });

        if (!addendum) throw new Error('Addendum not found');
        if (currentUser.role === 'TENANT' && addendum.contract.tenant_user_id !== currentUser.user_id) {
            throw new Error('You do not have permission to download this addendum');
        }
        if (!addendum.s3_key) throw new Error('Addendum file not found');

        try {
            const fileBuffer = await s3Service.downloadFile(addendum.s3_key);
            if (addendum.checksum) {
                const isValid = s3Service.verifyChecksum(fileBuffer, addendum.checksum);
                if (!isValid) throw new Error('File integrity check failed');
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

    // STATISTICS
    async getAddendumStatistics(contractId = null) {
        const where = contractId ? { contract_id: parseInt(contractId) } : {};
        const stats = await prisma.contract_addendums.groupBy({
            by: ['addendum_type'],
            where,
            _count: { addendum_id: true }
        });
        return stats.map(stat => ({ type: stat.addendum_type, count: stat._count.addendum_id }));
    }

    // ============================================
    // PRIVATE HELPERS
    // ============================================

    // ... (Keep existing helpers: _checkAndProcessExpiration, _expireAddendum, _processUploadFiles, _convertImagesToPdf, _validateAddendumTypeAndChanges)

    async _checkAndProcessExpiration(addendum) {
        if (addendum.status === 'approved' && addendum.effective_to) {
            const now = new Date();
            const effectiveTo = new Date(addendum.effective_to);
            if (now > effectiveTo) {
                try {
                    console.log(`Auto expiring addendum ${addendum.addendum_id}...`);
                    return await this._expireAddendum(addendum);
                } catch (error) {
                    console.error(`Failed to auto-expire addendum ${addendum.addendum_id}:`, error);
                    return addendum;
                }
            }
        }
        return addendum;
    }

    async _expireAddendum(addendum) {
        let snapshot = addendum.changes_snapshot;
        if (typeof snapshot === 'string') snapshot = JSON.parse(snapshot);
        const previousValues = snapshot?.previous_values;

        if (!previousValues) {
            console.warn(`Addendum ${addendum.addendum_id} has no previous_values to revert.`);
            return await prisma.contract_addendums.update({
                where: { addendum_id: addendum.addendum_id },
                data: { status: 'expired', updated_at: new Date() },
                include: { contract: { include: { room_history: true, tenant: { include: { user: true } } } }, creator: true }
            });
        }

        const result = await prisma.$transaction(async (tx) => {
            await tx.contracts.update({
                where: { contract_id: addendum.contract_id },
                data: { ...previousValues, updated_at: new Date() }
            });
            const expiredAddendum = await tx.contract_addendums.update({
                where: { addendum_id: addendum.addendum_id },
                data: {
                    status: 'expired',
                    updated_at: new Date(),
                    note: addendum.note ? `${addendum.note}\n[SYSTEM] Auto-expired & Reverted on ${new Date().toISOString()}` : `[SYSTEM] Auto-expired on ${new Date().toISOString()}`
                },
                include: { contract: { include: { room_history: true, tenant: { include: { user: true } } } }, creator: true }
            });
            return expiredAddendum;
        });
        return result;
    }

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
            } catch (error) { reject(error); }
        });
    }

    _validateAddendumTypeAndChanges(type, changes) {
        const keys = Object.keys(changes);
        if (type === 'general_amendment') return;
        switch (type) {
            case 'extension':
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
                const validKeys = ['payment_cycle_months', 'penalty_rate'];
                const hasValidKey = keys.some(k => validKeys.includes(k));
                if (!hasValidKey) throw new Error('Payment terms change must include cycle or penalty rate');
                break;
        }
    }

    async _validateOverlap(contract, newType, newChanges, newStart, newEnd, excludeId = null) {
        const newKeys = Object.keys(newChanges || {});
        if (newKeys.length === 0) return;
        const range1Start = newStart ? new Date(newStart).getTime() : new Date().getTime();
        const range1End = newEnd ? new Date(newEnd).getTime() : new Date(contract.end_date).getTime();
        if (range1Start > range1End) throw new Error('Effective From date cannot be after Effective To date');

        const existingAddendums = await prisma.contract_addendums.findMany({
            where: {
                contract_id: contract.contract_id,
                status: { in: ['approved', 'pending_approval'] },
                addendum_id: excludeId ? { not: excludeId } : undefined
            }
        });

        for (const existing of existingAddendums) {
            const existingStart = existing.effective_from ? existing.effective_from.getTime() : 0;
            const existingEnd = existing.effective_to ? existing.effective_to.getTime() : new Date(contract.end_date).getTime();
            const isDateOverlap = (range1Start <= existingEnd) && (range1End >= existingStart);
            if (isDateOverlap) {
                let existingChanges = existing.changes_snapshot;
                if (typeof existingChanges === 'string') {
                    try { existingChanges = JSON.parse(existingChanges); } catch (e) {}
                }
                const existingKeys = Object.keys(existingChanges || {});
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

    // ============================================
    // NEW VALIDATION HELPERS (Ported from ContractService)
    // ============================================

    /**
     * Validate logic sâu: Kết hợp dữ liệu cũ của HĐ và dữ liệu mới trong Changes
     * để đảm bảo tính đúng đắn (ví dụ: Tiền cọc mới có vượt quá Tiền thuê cũ x 12 không?)
     */
    _validateDeepLogic(contract, changes) {
        if (!changes) return;

        // 1. Chuẩn bị dữ liệu để validate (Merge Change vào Contract hiện tại)
        // Nếu trường đó có trong changes -> Lấy giá trị mới
        // Nếu không -> Lấy giá trị cũ từ contract
        const rentAmount = changes.rent_amount !== undefined
            ? parseFloat(changes.rent_amount)
            : parseFloat(contract.rent_amount);

        const depositAmount = changes.deposit_amount !== undefined
            ? parseFloat(changes.deposit_amount)
            : parseFloat(contract.deposit_amount);

        const penaltyRate = changes.penalty_rate !== undefined
            ? parseFloat(changes.penalty_rate)
            : parseFloat(contract.penalty_rate);

        // Lưu ý: Đối với Date, cần cẩn thận vì JSON.parse ra string
        const startDate = changes.start_date
            ? new Date(changes.start_date)
            : new Date(contract.start_date);

        const endDate = changes.end_date
            ? new Date(changes.end_date)
            : new Date(contract.end_date);

        // 2. Validate Financials (Nếu có thay đổi về tiền)
        // Ta vẫn validate cả khi chỉ 1 trong 2 thay đổi, vì chúng liên quan nhau (Cọc <= 12 tháng Thuê)
        if (changes.rent_amount !== undefined || changes.deposit_amount !== undefined) {
            this._validateFinancials(rentAmount, depositAmount);
        }

        // 3. Validate Penalty (Nếu có thay đổi phạt)
        if (changes.penalty_rate !== undefined) {
            this._validatePenalty(penaltyRate);
        }

        // 4. Validate Dates (Nếu có thay đổi ngày)
        // Chỉ check khi có thay đổi start hoặc end date
        if (changes.start_date || changes.end_date) {
            this._validateDates(startDate, endDate);
        }
    }

    /**
     * Logic validate tài chính (copy từ contract.service.js)
     */
    _validateFinancials(rentAmount, depositAmount) {
        // 1. Validate RENT
        if (isNaN(rentAmount) || rentAmount <= 0) {
            throw new Error("Tiền thuê (sau khi đổi) phải là số dương lớn hơn 0.");
        }
        if (rentAmount > 1000000000) {
            throw new Error("Tiền thuê quá lớn bất thường (giới hạn 1 tỷ).");
        }

        // 2. Validate DEPOSIT
        if (isNaN(depositAmount) || depositAmount < 0) {
            throw new Error("Tiền cọc không được là số âm.");
        }

        // 3. Logic Chéo: Cọc không quá 12 tháng tiền nhà
        if (depositAmount > rentAmount * 12) {
            throw new Error("Tiền cọc (sau khi đổi) quá cao (vượt quá 1 năm tiền nhà).");
        }
    }

    /**
     * Logic validate penalty (copy từ contract.service.js)
     */
    _validatePenalty(rate) {
        if (isNaN(rate) || rate < 0.01 || rate > 1) {
            throw new Error("Tỉ lệ phạt phải từ 0.01% đến 1% (0.01 - 1).");
        }
    }

    /**
     * Logic validate ngày tháng (tương tự contract.service.js)
     */
    _validateDates(startDate, endDate) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 1. End Date phải sau Start Date
        if (startDate >= endDate) {
            throw new Error("Ngày kết thúc phải sau ngày bắt đầu.");
        }

        // 2. End Date phải ở tương lai (trừ trường hợp sửa lỗi data cũ, nhưng logic chung là vậy)
        if (endDate <= today) {
            throw new Error("Ngày kết thúc hợp đồng (sau khi điều chỉnh) phải sau thời điểm hiện tại.");
        }

        // 3. (Optional) Check duration nếu cần thiết
        // const months = (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth());
        // if (months > 60) throw new Error("Thời hạn hợp đồng không được quá 5 năm.");
    }

    formatAddendumResponse(addendum) {
        // ... (Keep existing formatting logic)
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

        if (addendum.contract) {
            const contract = addendum.contract;
            const room = contract.room_history;
            const building = room?.building;
            const tenant = contract.tenant;
            const user = tenant?.user;

            response.contract = {
                contract_id: contract.contract_id,
                contract_number: contract.contract_number,
                status: contract.status,
                start_date: contract.start_date,
                end_date: contract.end_date,
                rent_amount: contract.rent_amount,
                deposit_amount: contract.deposit_amount,
                duration_months: contract.duration_months,
                payment_cycle_months: contract.payment_cycle_months,
                penalty_rate: contract.penalty_rate,
                room_number: room?.room_number || null,
                building_id: building?.building_id || null,
                building_name: building?.name || null,
                tenant_name: user?.full_name || null,
                tenant_email: user?.email || null,
                tenant_phone: user?.phone || null,
                tenant: user ? { full_name: user.full_name, phone: user.phone } : null
            };
        }

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