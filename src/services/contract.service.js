
// Updated: 2025-16-10
// By: DatNB
const prisma = require('../config/prisma');

class ContractService {
    // CREATE - Tạo hợp đồng mới
    async createContract(data) {
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
                bill_payments: true,
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
    async updateContract(contractId, data) {
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

    // DELETE - Xóa mềm hợp đồng
    async deleteContract(contractId) {
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId }
        });

        if (!contract || contract.deleted_at) {
            throw new Error('Contract not found');
        }

        // Soft delete
        const deletedContract = await prisma.contracts.update({
            where: { contract_id: contractId },
            data: {
                deleted_at: new Date(),
                updated_at: new Date()
            }
        });

        return { success: true, message: 'Contract deleted successfully' };
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

    // TERMINATE - Kết thúc hợp đồng
    async terminateContract(contractId, reason = null) {
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId }
        });

        if (!contract || contract.deleted_at) {
            throw new Error('Contract not found');
        }

        if (contract.status === 'terminated') {
            throw new Error('Contract is already terminated');
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
            note: contract.note,
            created_at: contract.created_at,
            updated_at: contract.updated_at,
            deleted_at: contract.deleted_at
        };
    }
}

module.exports = new ContractService();
