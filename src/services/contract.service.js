
// Updated: 2025-17-10
// By: DatNB - Added S3 integration

const prisma = require('../config/prisma');
const s3Service = require('./s3.service');

class ContractService {
    // CREATE - Tạo hợp đồng mới với file PDF
    async createContract(data, file = null) {
        const { room_id, tenant_user_id, start_date, end_date, rent_amount, deposit_amount, status, note } = data;

        // Validate required fields
        if (!room_id || !tenant_user_id || !start_date || !end_date) {
            throw new Error('Missing required fields: room_id, tenant_user_id, start_date, end_date');
        }

        // Check if room exists and is active
        const room = await prisma.rooms.findUnique({
            where: { room_id }
        });

        if (!room || !room.is_active) {
            throw new Error('Room not found or is inactive');
        }

        // Check if tenant exists
        const tenant = await prisma.tenants.findUnique({
            where: { user_id: tenant_user_id }
        });

        if (!tenant) {
            throw new Error('Tenant not found');
        }

        // Check if tenant already has active contract in this room
        const existingContract = await prisma.contracts.findFirst({
            where: {
                room_id,
                tenant_user_id,
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
                room_id,
                tenant_user_id,
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

    // READ - Lấy hợp đồng theo ID
    async getContractById(contractId) {
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

        return this.formatContractResponse(contract);
    }

    // READ - Lấy danh sách hợp đồng (có phân trang và filter)
    async getContracts(filters = {}) {
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

        if (room_id) where.room_id = parseInt(room_id);
        if (tenant_user_id) where.tenant_user_id = parseInt(tenant_user_id);
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

        const [contracts, total] = await Promise.all([
            prisma.contracts.findMany({
                where,
                include: {
                    rooms: { select: { room_number: true, building_id: true } },
                    tenants: { include: { users: { select: { full_name: true, email: true } } } }
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
    async updateContract(contractId, data, file = null) {
        const { start_date, end_date, rent_amount, deposit_amount, status, note } = data;

        // Verify contract exists
        const existingContract = await prisma.contracts.findUnique({
            where: { contract_id: contractId }
        });

        if (!existingContract || existingContract.deleted_at) {
            throw new Error('Contract not found');
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
    async deleteContract(contractId) {
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId }
        });

        if (!contract || contract.deleted_at) {
            throw new Error('Contract not found');
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
    async hardDeleteContract(contractId) {
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId }
        });

        if (!contract) {
            throw new Error('Contract not found');
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
    async restoreContract(contractId) {
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId }
        });

        if (!contract) {
            throw new Error('Contract not found');
        }

        if (!contract.deleted_at) {
            throw new Error('Contract is not deleted');
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


    // DOWNLOAD - Tải xuống file hợp đồng
    async downloadContract(contractId) {
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId }
        });

        if (!contract || contract.deleted_at) {
            throw new Error('Contract not found');
        }

        if (!contract.s3_key) {
            throw new Error('Contract file not found');
        }

        try {
            // Generate presigned URL (expires in 1 hour)
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

    // DOWNLOAD DIRECT - Tải xuống file trực tiếp (trả về buffer)
    async downloadContractDirect(contractId) {
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId }
        });

        if (!contract || contract.deleted_at) {
            throw new Error('Contract not found');
        }

        if (!contract.s3_key) {
            throw new Error('Contract file not found');
        }

        try {
            const fileBuffer = await s3Service.downloadFile(contract.s3_key);

            // Verify checksum if available
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