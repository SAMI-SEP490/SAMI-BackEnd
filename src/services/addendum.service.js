// Updated: 2025-24-10
// by: DatNB

const prisma = require('../config/prisma');

class ContractAddendumService {
    // CREATE - Tạo phụ lục hợp đồng mới
    async createAddendum(data, currentUser) {
        const {
            contract_id,
            type,
            summary,
            changes,
            effective_date,
            note
        } = data;

        // Validate required fields
        if (!contract_id || !type || !summary || !effective_date) {
            throw new Error('Missing required fields: contract_id, type, summary, effective_date');
        }

        const contractId = parseInt(contract_id);
        if (isNaN(contractId)) {
            throw new Error('contract_id must be a valid number');
        }

        // Check if contract exists and is active
        const contract = await prisma.contracts.findUnique({
            where: { contract_id: contractId },
            include: {
                tenants: true
            }
        });

        if (!contract || contract.deleted_at) {
            throw new Error('Contract not found or has been deleted');
        }

        if (contract.status === 'terminated' || contract.status === 'expired') {
            throw new Error('Cannot create addendum for terminated or expired contract');
        }

        // Validate effective date
        const effectiveDate = new Date(effective_date);
        if (effectiveDate < contract.start_date) {
            throw new Error('Effective date cannot be before contract start date');
        }

        // Get the next version number
        const latestAddendum = await prisma.contract_addendums.findFirst({
            where: { contract_id: contractId },
            orderBy: { version: 'desc' }
        });

        const nextVersion = latestAddendum ? latestAddendum.version + 1 : 1;

        // Validate and parse changes if provided
        let parsedChanges = null;
        if (changes) {
            try {
                parsedChanges = typeof changes === 'string' ? JSON.parse(changes) : changes;
            } catch (error) {
                throw new Error('Invalid changes format. Must be valid JSON');
            }
        }

        // Create addendum
        const addendum = await prisma.contract_addendums.create({
            data: {
                contract_id: contractId,
                type,
                version: nextVersion,
                summary,
                changes: parsedChanges,
                effective_date: effectiveDate,
                created_by: currentUser.user_id,
                note,
                created_at: new Date()
            },
            include: {
                contracts: {
                    include: {
                        rooms: true,
                        tenants: {
                            include: {
                                users: true
                            }
                        }
                    }
                },
                users: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true
                    }
                }
            }
        });

        return this.formatAddendumResponse(addendum);
    }

    // READ - Lấy thông tin phụ lục theo ID
    async getAddendumById(addendumId, currentUser) {
        const addendum = await prisma.contract_addendums.findUnique({
            where: { addendum_id: addendumId },
            include: {
                contracts: {
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
                        }
                    }
                },
                users: {
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
            addendum.contracts.tenant_user_id !== currentUser.user_id) {
            throw new Error('You do not have permission to view this addendum');
        }

        return this.formatAddendumResponse(addendum);
    }

    // READ - Lấy danh sách phụ lục (có phân trang và filter)
    async getAddendums(filters = {}, currentUser) {
        const {
            contract_id,
            type,
            page = 1,
            limit = 20,
            effective_date_from,
            effective_date_to
        } = filters;

        const skip = (page - 1) * limit;
        const where = {};

        // Nếu là tenant, chỉ lấy phụ lục của hợp đồng mình
        if (currentUser.role === 'TENANT') {
            const tenantContracts = await prisma.contracts.findMany({
                where: {
                    tenant_user_id: currentUser.user_id,
                    deleted_at: null
                },
                select: { contract_id: true }
            });

            where.contract_id = {
                in: tenantContracts.map(c => c.contract_id)
            };
        }

        // Apply filters
        if (contract_id) {
            where.contract_id = parseInt(contract_id);
        }

        if (type) {
            where.type = type;
        }

        // Filter by effective date range
        if (effective_date_from || effective_date_to) {
            where.effective_date = {};
            if (effective_date_from) {
                where.effective_date.gte = new Date(effective_date_from);
            }
            if (effective_date_to) {
                where.effective_date.lte = new Date(effective_date_to);
            }
        }

        const [addendums, total] = await Promise.all([
            prisma.contract_addendums.findMany({
                where,
                include: {
                    contracts: {
                        select: {
                            contract_id: true,
                            room_id: true,
                            tenant_user_id: true,
                            status: true,
                            rooms: {
                                select: {
                                    room_number: true,
                                    building_id: true
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
                        }
                    },
                    users: {
                        select: {
                            user_id: true,
                            full_name: true,
                            email: true
                        }
                    }
                },
                skip,
                take: limit,
                orderBy: [
                    { contract_id: 'desc' },
                    { version: 'desc' }
                ]
            }),
            prisma.contract_addendums.count({ where })
        ]);

        return {
            data: addendums.map(a => this.formatAddendumResponse(a)),
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
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

        const addendums = await prisma.contract_addendums.findMany({
            where: { contract_id: contractId },
            include: {
                users: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true
                    }
                }
            },
            orderBy: { version: 'desc' }
        });

        return addendums.map(a => this.formatAddendumResponse(a));
    }

    // UPDATE - Cập nhật phụ lục
    async updateAddendum(addendumId, data, currentUser) {
        const { type, summary, changes, effective_date, note } = data;

        // Verify addendum exists
        const existingAddendum = await prisma.contract_addendums.findUnique({
            where: { addendum_id: addendumId },
            include: {
                contracts: true
            }
        });

        if (!existingAddendum) {
            throw new Error('Addendum not found');
        }

        // Check if contract is still active
        if (existingAddendum.contracts.status === 'terminated' ||
            existingAddendum.contracts.status === 'expired') {
            throw new Error('Cannot update addendum for terminated or expired contract');
        }

        // Validate effective date if provided
        if (effective_date) {
            const effectiveDate = new Date(effective_date);
            if (effectiveDate < existingAddendum.contracts.start_date) {
                throw new Error('Effective date cannot be before contract start date');
            }
        }

        // Prepare update data
        const updateData = {};

        if (type) updateData.type = type;
        if (summary) updateData.summary = summary;
        if (effective_date) updateData.effective_date = new Date(effective_date);
        if (note !== undefined) updateData.note = note;

        // Validate and parse changes if provided
        if (changes !== undefined) {
            if (changes === null) {
                updateData.changes = null;
            } else {
                try {
                    updateData.changes = typeof changes === 'string' ?
                        JSON.parse(changes) : changes;
                } catch (error) {
                    throw new Error('Invalid changes format. Must be valid JSON');
                }
            }
        }

        const addendum = await prisma.contract_addendums.update({
            where: { addendum_id: addendumId },
            data: updateData,
            include: {
                contracts: {
                    include: {
                        rooms: true,
                        tenants: {
                            include: {
                                users: true
                            }
                        }
                    }
                },
                users: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true
                    }
                }
            }
        });

        return this.formatAddendumResponse(addendum);
    }

    // DELETE - Xóa phụ lục
    async deleteAddendum(addendumId) {
        const addendum = await prisma.contract_addendums.findUnique({
            where: { addendum_id: addendumId }
        });

        if (!addendum) {
            throw new Error('Addendum not found');
        }

        await prisma.contract_addendums.delete({
            where: { addendum_id: addendumId }
        });

        return { success: true, message: 'Addendum deleted successfully' };
    }

    // STATISTICS - Thống kê phụ lục theo loại
    async getAddendumStatistics(contractId = null) {
        const where = contractId ? { contract_id: parseInt(contractId) } : {};

        const stats = await prisma.contract_addendums.groupBy({
            by: ['type'],
            where,
            _count: {
                addendum_id: true
            }
        });

        return stats.map(stat => ({
            type: stat.type,
            count: stat._count.addendum_id
        }));
    }

    // Helper function - Format response
    formatAddendumResponse(addendum) {
        const response = {
            addendum_id: addendum.addendum_id,
            contract_id: addendum.contract_id,
            type: addendum.type,
            version: addendum.version,
            summary: addendum.summary,
            changes: addendum.changes,
            effective_date: addendum.effective_date,
            created_by: addendum.created_by,
            created_at: addendum.created_at,
            note: addendum.note
        };

        // Include contract info if available
        if (addendum.contracts) {
            response.contract_info = {
                contract_id: addendum.contracts.contract_id,
                status: addendum.contracts.status,
                start_date: addendum.contracts.start_date,
                end_date: addendum.contracts.end_date
            };

            if (addendum.contracts.rooms) {
                response.contract_info.room_number = addendum.contracts.rooms.room_number;
                response.contract_info.building_id = addendum.contracts.rooms.building_id;
            }

            if (addendum.contracts.tenants?.users) {
                response.contract_info.tenant_name = addendum.contracts.tenants.users.full_name;
                response.contract_info.tenant_email = addendum.contracts.tenants.users.email;
            }
        }

        // Include creator info if available
        if (addendum.users) {
            response.creator = {
                user_id: addendum.users.user_id,
                full_name: addendum.users.full_name,
                email: addendum.users.email
            };
        }

        return response;
    }
}

module.exports = new ContractAddendumService();