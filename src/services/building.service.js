// Updated: 2025-31-10
// by: DatNB

const prisma = require('../config/prisma');

class BuildingService {
    // CREATE - Tạo tòa nhà mới
    async createBuilding(data) {
        const { name, address, number_of_floors, total_area } = data;

        // Validate required fields
        if (!name) {
            throw new Error('Missing required field: name');
        }

        // Kiểm tra tên tòa nhà đã tồn tại chưa
        const existingBuilding = await prisma.buildings.findFirst({
            where: {
                name: name.trim(),
                is_active: true
            }
        });

        if (existingBuilding) {
            throw new Error('Building with this name already exists');
        }

        // Validate number_of_floors
        if (number_of_floors !== undefined && number_of_floors !== null) {
            const floors = parseInt(number_of_floors);
            if (isNaN(floors) || floors <= 0) {
                throw new Error('number_of_floors must be a positive number');
            }
        }

        // Validate total_area
        if (total_area !== undefined && total_area !== null) {
            const area = parseFloat(total_area);
            if (isNaN(area) || area <= 0) {
                throw new Error('total_area must be a positive number');
            }
        }

        const building = await prisma.buildings.create({
            data: {
                name: name.trim(),
                address: address?.trim() || null,
                number_of_floors: number_of_floors ? parseInt(number_of_floors) : null,
                total_area: total_area ? parseFloat(total_area) : null,
                is_active: true,
                created_at: new Date(),
                updated_at: new Date()
            }
        });

        return this.formatBuildingResponse(building);
    }

    // READ - Lấy thông tin tòa nhà theo ID
    async getBuildingById(buildingId) {
        const building = await prisma.buildings.findUnique({
            where: { building_id: buildingId },
            include: {
                building_managers: {
                    include: {
                        users: {
                            select: {
                                user_id: true,
                                full_name: true,
                                email: true,
                                phone: true
                            }
                        }
                    }
                },
                rooms: {
                    where: { is_active: true },
                    select: {
                        room_id: true,
                        room_number: true,
                        floor: true,
                        size: true,
                        is_active: true
                    }
                },
                regulations: {
                    where: { status: 'published' },
                    select: {
                        regulation_id: true,
                        title: true,
                        effective_date: true,
                        version: true
                    }
                },
                floor_plans: {
                    where: { is_published: true },
                    select: {
                        plan_id: true,
                        name: true,
                        floor_number: true,
                        version: true
                    }
                }
            }
        });

        if (!building) {
            throw new Error('Building not found');
        }

        return this.formatBuildingDetailResponse(building);
    }

    // READ - Lấy danh sách tòa nhà (có phân trang và filter)
    async getBuildings(filters = {}) {
        const {
            name,
            address,
            is_active,
            page = 1,
            limit = 20
        } = filters;

        const skip = (page - 1) * limit;
        const where = {};

        if (name) {
            where.name = {
                contains: name,
                mode: 'insensitive'
            };
        }

        if (address) {
            where.address = {
                contains: address,
                mode: 'insensitive'
            };
        }

        if (is_active !== undefined) {
            where.is_active = is_active === 'true' || is_active === true;
        }

        const [buildings, total] = await Promise.all([
            prisma.buildings.findMany({
                where,
                include: {
                    building_managers: {
                        include: {
                            users: {
                                select: {
                                    user_id: true,
                                    full_name: true,
                                    email: true
                                }
                            }
                        }
                    },
                    _count: {
                        select: {
                            rooms: { where: { is_active: true } },
                            regulations: true,
                            floor_plans: true
                        }
                    }
                },
                skip,
                take: limit,
                orderBy: { created_at: 'desc' }
            }),
            prisma.buildings.count({ where })
        ]);

        return {
            data: buildings.map(b => this.formatBuildingListResponse(b)),
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        };
    }

    // UPDATE - Cập nhật thông tin tòa nhà
    async updateBuilding(buildingId, data) {
        const { name, address, number_of_floors, total_area, is_active } = data;

        // Verify building exists
        const existingBuilding = await prisma.buildings.findUnique({
            where: { building_id: buildingId }
        });

        if (!existingBuilding) {
            throw new Error('Building not found');
        }

        // Kiểm tra tên tòa nhà trùng (nếu thay đổi tên)
        if (name && name.trim() !== existingBuilding.name) {
            const duplicateName = await prisma.buildings.findFirst({
                where: {
                    name: name.trim(),
                    building_id: { not: buildingId },
                    is_active: true
                }
            });

            if (duplicateName) {
                throw new Error('Building with this name already exists');
            }
        }

        // Prepare update data
        const updateData = {
            updated_at: new Date()
        };

        if (name !== undefined) updateData.name = name.trim();
        if (address !== undefined) updateData.address = address?.trim() || null;

        if (number_of_floors !== undefined) {
            if (number_of_floors === null || number_of_floors === '') {
                updateData.number_of_floors = null;
            } else {
                const floors = parseInt(number_of_floors);
                if (isNaN(floors) || floors <= 0) {
                    throw new Error('number_of_floors must be a positive number');
                }
                updateData.number_of_floors = floors;
            }
        }

        if (total_area !== undefined) {
            if (total_area === null || total_area === '') {
                updateData.total_area = null;
            } else {
                const area = parseFloat(total_area);
                if (isNaN(area) || area <= 0) {
                    throw new Error('total_area must be a positive number');
                }
                updateData.total_area = area;
            }
        }

        if (is_active !== undefined) {
            updateData.is_active = is_active === 'true' || is_active === true;
        }

        const building = await prisma.buildings.update({
            where: { building_id: buildingId },
            data: updateData,
            include: {
                building_managers: {
                    include: {
                        users: {
                            select: {
                                user_id: true,
                                full_name: true,
                                email: true
                            }
                        }
                    }
                }
            }
        });

        return this.formatBuildingResponse(building);
    }

    // DELETE - Vô hiệu hóa tòa nhà (soft delete)
    async deactivateBuilding(buildingId) {
        const building = await prisma.buildings.findUnique({
            where: { building_id: buildingId }
        });

        if (!building) {
            throw new Error('Building not found');
        }

        if (!building.is_active) {
            throw new Error('Building is already inactive');
        }

        // Kiểm tra có phòng đang hoạt động không
        const activeRooms = await prisma.rooms.count({
            where: {
                building_id: buildingId,
                is_active: true
            }
        });

        if (activeRooms > 0) {
            throw new Error('Cannot deactivate building with active rooms');
        }

        await prisma.buildings.update({
            where: { building_id: buildingId },
            data: {
                is_active: false,
                updated_at: new Date()
            }
        });

        return { success: true, message: 'Building deactivated successfully' };
    }

    // ACTIVATE - Kích hoạt lại tòa nhà
    async activateBuilding(buildingId) {
        const building = await prisma.buildings.findUnique({
            where: { building_id: buildingId }
        });

        if (!building) {
            throw new Error('Building not found');
        }

        if (building.is_active) {
            throw new Error('Building is already active');
        }

        const activated = await prisma.buildings.update({
            where: { building_id: buildingId },
            data: {
                is_active: true,
                updated_at: new Date()
            }
        });

        return this.formatBuildingResponse(activated);
    }

    // DELETE - Xóa vĩnh viễn tòa nhà
    async hardDeleteBuilding(buildingId) {
        const building = await prisma.buildings.findUnique({
            where: { building_id: buildingId },
            include: {
                rooms: true,
                building_managers: true,
                regulations: true,
                floor_plans: true
            }
        });

        if (!building) {
            throw new Error('Building not found');
        }

        // Kiểm tra có dữ liệu liên quan không
        if (building.rooms.length > 0) {
            throw new Error('Cannot delete building with existing rooms');
        }

        if (building.regulations.length > 0) {
            throw new Error('Cannot delete building with existing regulations');
        }

        if (building.floor_plans.length > 0) {
            throw new Error('Cannot delete building with existing floor plans');
        }

        // Xóa building managers trước (nếu có)
        if (building.building_managers.length > 0) {
            await prisma.building_managers.deleteMany({
                where: { building_id: buildingId }
            });
        }

        // Xóa building
        await prisma.buildings.delete({
            where: { building_id: buildingId }
        });

        return { success: true, message: 'Building permanently deleted' };
    }

    // GET MANAGERS - Lấy danh sách building managers
    async getBuildingManagers(buildingId, filters = {}) {
        const { page = 1, limit = 20, is_active } = filters;

        // Verify building exists
        const building = await prisma.buildings.findUnique({
            where: { building_id: buildingId }
        });

        if (!building) {
            throw new Error('Building not found');
        }

        const skip = (page - 1) * limit;
        const where = { building_id: buildingId };

        // Filter by active status (assigned_to is null or in future)
        if (is_active !== undefined) {
            const isActiveFilter = is_active === 'true' || is_active === true;
            if (isActiveFilter) {
                where.OR = [
                    { assigned_to: null },
                    { assigned_to: { gte: new Date() } }
                ];
            } else {
                where.assigned_to = { lt: new Date() };
            }
        }

        const [managers, total] = await Promise.all([
            prisma.building_managers.findMany({
                where,
                include: {
                    users: {
                        select: {
                            user_id: true,
                            full_name: true,
                            email: true,
                            phone: true,
                            avatar_url: true,
                            status: true,
                            role: true
                        }
                    }
                },
                skip,
                take: limit,
                orderBy: { assigned_from: 'desc' }
            }),
            prisma.building_managers.count({ where })
        ]);

        return {
            data: managers.map(m => this.formatManagerResponse(m)),
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        };
    }

    // ASSIGN MANAGER - Gán manager cho tòa nhà
    async assignManager(buildingId, data) {
        const { user_id, assigned_from, assigned_to, note } = data;

        // Validate required fields
        if (!user_id) {
            throw new Error('Missing required field: user_id');
        }

        const userId = parseInt(user_id);
        if (isNaN(userId)) {
            throw new Error('user_id must be a valid number');
        }

        // Verify building exists
        const building = await prisma.buildings.findUnique({
            where: { building_id: buildingId }
        });

        if (!building) {
            throw new Error('Building not found');
        }

        // Verify user exists and has MANAGER role
        const user = await prisma.users.findUnique({
            where: { user_id: userId }
        });

        if (!user) {
            throw new Error('User not found');
        }

        if (user.role !== 'MANAGER') {
            throw new Error('User must have MANAGER role');
        }

        if (user.status !== 'Active') {
            throw new Error('User is not active');
        }

        // Check if manager already assigned to this building
        const existingAssignment = await prisma.building_managers.findUnique({
            where: { user_id: userId }
        });

        if (existingAssignment) {
            if (existingAssignment.building_id === buildingId) {
                throw new Error('Manager already assigned to this building');
            } else {
                throw new Error('Manager is already assigned to another building');
            }
        }

        // Validate dates
        let assignedFromDate = assigned_from ? new Date(assigned_from) : new Date();
        let assignedToDate = assigned_to ? new Date(assigned_to) : null;

        if (assigned_from && isNaN(assignedFromDate.getTime())) {
            throw new Error('assigned_from is not a valid date');
        }

        if (assigned_to) {
            if (isNaN(assignedToDate.getTime())) {
                throw new Error('assigned_to is not a valid date');
            }

            if (assignedToDate <= assignedFromDate) {
                throw new Error('assigned_to must be after assigned_from');
            }
        }

        // Create assignment
        const assignment = await prisma.building_managers.create({
            data: {
                user_id: userId,
                building_id: buildingId,
                assigned_from: assignedFromDate,
                assigned_to: assignedToDate,
                note: note || null
            },
            include: {
                users: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true,
                        phone: true,
                        avatar_url: true,
                        status: true,
                        role: true
                    }
                },
                buildings: {
                    select: {
                        building_id: true,
                        name: true,
                        address: true
                    }
                }
            }
        });

        return this.formatManagerAssignmentResponse(assignment);
    }

    // UPDATE MANAGER ASSIGNMENT - Cập nhật thông tin assignment
    async updateManagerAssignment(buildingId, userId, data) {
        const { assigned_from, assigned_to, note } = data;

        const userIdInt = parseInt(userId);
        if (isNaN(userIdInt)) {
            throw new Error('user_id must be a valid number');
        }

        // Verify assignment exists
        const existingAssignment = await prisma.building_managers.findUnique({
            where: { user_id: userIdInt }
        });

        if (!existingAssignment) {
            throw new Error('Manager assignment not found');
        }

        if (existingAssignment.building_id !== buildingId) {
            throw new Error('Manager is not assigned to this building');
        }

        // Prepare update data
        const updateData = {};

        if (assigned_from !== undefined) {
            if (assigned_from === null || assigned_from === '') {
                throw new Error('assigned_from cannot be null');
            }
            const assignedFromDate = new Date(assigned_from);
            if (isNaN(assignedFromDate.getTime())) {
                throw new Error('assigned_from is not a valid date');
            }
            updateData.assigned_from = assignedFromDate;
        }

        if (assigned_to !== undefined) {
            if (assigned_to === null || assigned_to === '') {
                updateData.assigned_to = null;
            } else {
                const assignedToDate = new Date(assigned_to);
                if (isNaN(assignedToDate.getTime())) {
                    throw new Error('assigned_to is not a valid date');
                }

                const fromDate = assigned_from ? new Date(assigned_from) : existingAssignment.assigned_from;
                if (assignedToDate <= fromDate) {
                    throw new Error('assigned_to must be after assigned_from');
                }
                updateData.assigned_to = assignedToDate;
            }
        }

        if (note !== undefined) {
            updateData.note = note || null;
        }

        // Update assignment
        const updated = await prisma.building_managers.update({
            where: { user_id: userIdInt },
            data: updateData,
            include: {
                users: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true,
                        phone: true,
                        avatar_url: true,
                        status: true,
                        role: true
                    }
                },
                buildings: {
                    select: {
                        building_id: true,
                        name: true,
                        address: true
                    }
                }
            }
        });

        return this.formatManagerAssignmentResponse(updated);
    }

    // REMOVE MANAGER - Xóa manager khỏi tòa nhà
    async removeManager(buildingId, userId) {
        const userIdInt = parseInt(userId);
        if (isNaN(userIdInt)) {
            throw new Error('user_id must be a valid number');
        }

        // Verify assignment exists
        const assignment = await prisma.building_managers.findUnique({
            where: { user_id: userIdInt }
        });

        if (!assignment) {
            throw new Error('Manager assignment not found');
        }

        if (assignment.building_id !== buildingId) {
            throw new Error('Manager is not assigned to this building');
        }

        // Delete assignment
        await prisma.building_managers.delete({
            where: { user_id: userIdInt }
        });

        return {
            success: true,
            message: 'Manager removed from building successfully'
        };
    }

    // STATISTICS - Thống kê tòa nhà
    async getBuildingStatistics(buildingId) {
        const building = await prisma.buildings.findUnique({
            where: { building_id: buildingId }
        });

        if (!building) {
            throw new Error('Building not found');
        }

        const [totalRooms, activeRooms, occupiedRooms, totalManagers, activeContracts, pendingMaintenance] = await Promise.all([
            prisma.rooms.count({
                where: { building_id: buildingId }
            }),
            prisma.rooms.count({
                where: {
                    building_id: buildingId,
                    is_active: true
                }
            }),
            prisma.rooms.count({
                where: {
                    building_id: buildingId,
                    is_active: true,
                    tenants: {
                        some: {}
                    }
                }
            }),
            prisma.building_managers.count({
                where: { building_id: buildingId }
            }),
            prisma.contracts.count({
                where: {
                    rooms: {
                        building_id: buildingId
                    },
                    status: 'active',
                    deleted_at: null
                }
            }),
            prisma.maintenance_requests.count({
                where: {
                    rooms: {
                        building_id: buildingId
                    },
                    status: 'pending'
                }
            })
        ]);

        return {
            building_id: buildingId,
            building_name: building.name,
            total_rooms: totalRooms,
            active_rooms: activeRooms,
            occupied_rooms: occupiedRooms,
            vacant_rooms: activeRooms - occupiedRooms,
            occupancy_rate: activeRooms > 0 ? ((occupiedRooms / activeRooms) * 100).toFixed(2) : 0,
            total_managers: totalManagers,
            active_contracts: activeContracts,
            pending_maintenance: pendingMaintenance
        };
    }

    // Helper function - Format response
    formatBuildingResponse(building) {
        return {
            building_id: building.building_id,
            name: building.name,
            address: building.address,
            number_of_floors: building.number_of_floors,
            total_area: building.total_area,
            is_active: building.is_active,
            managers: building.building_managers?.map(m => ({
                user_id: m.user_id,
                full_name: m.users?.full_name,
                email: m.users?.email,
                assigned_from: m.assigned_from,
                assigned_to: m.assigned_to
            })) || [],
            created_at: building.created_at,
            updated_at: building.updated_at
        };
    }

    formatBuildingListResponse(building) {
        return {
            building_id: building.building_id,
            name: building.name,
            address: building.address,
            number_of_floors: building.number_of_floors,
            total_area: building.total_area,
            is_active: building.is_active,
            total_rooms: building._count?.rooms || 0,
            total_regulations: building._count?.regulations || 0,
            total_floor_plans: building._count?.floor_plans || 0,
            managers: building.building_managers?.map(m => ({
                user_id: m.user_id,
                full_name: m.users?.full_name
            })) || [],
            created_at: building.created_at,
            updated_at: building.updated_at
        };
    }

    formatBuildingDetailResponse(building) {
        return {
            building_id: building.building_id,
            name: building.name,
            address: building.address,
            number_of_floors: building.number_of_floors,
            total_area: building.total_area,
            is_active: building.is_active,
            managers: building.building_managers?.map(m => ({
                user_id: m.user_id,
                full_name: m.users?.full_name,
                email: m.users?.email,
                phone: m.users?.phone,
                assigned_from: m.assigned_from,
                assigned_to: m.assigned_to,
                note: m.note
            })) || [],
            rooms: building.rooms?.map(r => ({
                room_id: r.room_id,
                room_number: r.room_number,
                floor: r.floor,
                size: r.size
            })) || [],
            regulations: building.regulations?.map(r => ({
                regulation_id: r.regulation_id,
                title: r.title,
                effective_date: r.effective_date,
                version: r.version
            })) || [],
            floor_plans: building.floor_plans?.map(f => ({
                plan_id: f.plan_id,
                name: f.name,
                floor_number: f.floor_number,
                version: f.version
            })) || [],
            created_at: building.created_at,
            updated_at: building.updated_at
        };
    }

    formatManagerResponse(manager) {
        const now = new Date();
        const isActive = !manager.assigned_to || manager.assigned_to >= now;

        return {
            user_id: manager.user_id,
            building_id: manager.building_id,
            full_name: manager.users?.full_name,
            email: manager.users?.email,
            phone: manager.users?.phone,
            avatar_url: manager.users?.avatar_url,
            user_status: manager.users?.status,
            role: manager.users?.role,
            assigned_from: manager.assigned_from,
            assigned_to: manager.assigned_to,
            is_active: isActive,
            note: manager.note
        };
    }

    formatManagerAssignmentResponse(assignment) {
        const now = new Date();
        const isActive = !assignment.assigned_to || assignment.assigned_to >= now;

        return {
            user_id: assignment.user_id,
            building_id: assignment.building_id,
            building_name: assignment.buildings?.name,
            building_address: assignment.buildings?.address,
            manager_info: {
                full_name: assignment.users?.full_name,
                email: assignment.users?.email,
                phone: assignment.users?.phone,
                avatar_url: assignment.users?.avatar_url,
                status: assignment.users?.status,
                role: assignment.users?.role
            },
            assigned_from: assignment.assigned_from,
            assigned_to: assignment.assigned_to,
            is_active: isActive,
            note: assignment.note
        };
    }
}

module.exports = new BuildingService();