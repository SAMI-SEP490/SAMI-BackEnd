// Updated: 2025-12-12
// by: DatNB
// Added: Role-based access control for manager and owner

const prisma = require('../config/prisma');

class RoomService {
    // Helper: Kiểm tra quyền truy cập building
    async checkBuildingAccess(buildingId, userRole, userId) {
        if (userRole === 'owner') {
            return true; // Owner có toàn quyền
        }

        if (userRole === 'manager') {
            // Kiểm tra manager có quản lý building này không
            const manager = await prisma.building_managers.findFirst({
                where: {
                    user_id: userId,
                    building_id: buildingId,
                    is_active: true
                }
            });

            if (!manager) {
                throw new Error('You do not have permission to access this building');
            }

            return true;
        }

        throw new Error('Unauthorized access');
    }

    // Helper: Lấy danh sách building_ids mà manager quản lý
    async getManagedBuildingIds(userId) {
        const managedBuildings = await prisma.building_managers.findMany({
            where: {
                user_id: userId,
                is_active: true
            },
            select: {
                building_id: true
            }
        });

        return managedBuildings.map(mb => mb.building_id);
    }

    // CREATE - Tạo phòng mới
    async createRoom(data, userRole, userId) {
        const { building_id, room_number, floor, size, description, status } = data;

        // Validate required fields
        if (!building_id || !room_number) {
            throw new Error('Missing required fields: building_id, room_number');
        }

        const buildingId = parseInt(building_id);
        if (isNaN(buildingId)) {
            throw new Error('building_id must be a valid number');
        }

        // Kiểm tra quyền truy cập
        await this.checkBuildingAccess(buildingId, userRole, userId);

        // Kiểm tra building có tồn tại không
        const building = await prisma.buildings.findUnique({
            where: { building_id: buildingId }
        });

        if (!building) {
            throw new Error('Building not found');
        }

        if (!building.is_active) {
            throw new Error('Cannot create room in inactive building');
        }

        // Kiểm tra room_number đã tồn tại trong building chưa
        const existingRoom = await prisma.rooms.findFirst({
            where: {
                building_id: buildingId,
                room_number: room_number.trim(),
                is_active: true
            }
        });

        if (existingRoom) {
            throw new Error('Room number already exists in this building');
        }

        // Validate floor nếu có
        if (floor !== undefined && floor !== null) {
            const floorNum = parseInt(floor);
            if (isNaN(floorNum)) {
                throw new Error('floor must be a valid number');
            }

            if (building.number_of_floors && floorNum > building.number_of_floors) {
                throw new Error(`Floor ${floorNum} exceeds building's number of floors (${building.number_of_floors})`);
            }
        }

        const room = await prisma.rooms.create({
            data: {
                building_id: buildingId,
                room_number: room_number.trim(),
                floor: floor ? parseInt(floor) : null,
                size: size?.trim() || null,
                description: description?.trim() || null,
                status: status || 'available',
                is_active: true,
                created_at: new Date(),
                updated_at: new Date()
            },
            include: {
                buildings: {
                    select: {
                        building_id: true,
                        name: true,
                        address: true
                    }
                }
            }
        });

        return this.formatRoomResponse(room);
    }

    // READ - Lấy thông tin phòng theo ID
    async getRoomById(roomId, userRole, userId) {
        const room = await prisma.rooms.findUnique({
            where: { room_id: roomId },
            include: {
                buildings: {
                    select: {
                        building_id: true,
                        name: true,
                        address: true,
                        number_of_floors: true
                    }
                },
                tenants: {
                    include: {
                        users: {
                            select: {
                                user_id: true,
                                full_name: true,
                                email: true,
                                phone: true,
                                avatar_url: true
                            }
                        }
                    }
                },
                contracts: {
                    where: {
                        status: 'active',
                        deleted_at: null
                    },
                    select: {
                        contract_id: true,
                        start_date: true,
                        end_date: true,
                        rent_amount: true,
                        status: true
                    }
                },
                maintenance_requests: {
                    where: {
                        status: {
                            in: ['pending', 'in_progress']
                        }
                    },
                    select: {
                        request_id: true,
                        title: true,
                        category: true,
                        priority: true,
                        status: true,
                        created_at: true
                    },
                    orderBy: { created_at: 'desc' },
                    take: 5
                }
            }
        });

        if (!room) {
            throw new Error('Room not found');
        }

        // Kiểm tra quyền truy cập
        await this.checkBuildingAccess(room.building_id, userRole, userId);

        return this.formatRoomDetailResponse(room);
    }

    // READ - Lấy danh sách phòng (có phân trang và filter)
    async getRooms(filters = {}, userRole, userId) {
        const {
            building_id,
            room_number,
            floor,
            status,
            is_active,
            page = 1,
            limit = 20
        } = filters;

        const skip = (page - 1) * limit;
        const where = {};

        // Nếu là manager, chỉ lấy phòng của building họ quản lý
        if (userRole === 'manager') {
            const managedBuildingIds = await this.getManagedBuildingIds(userId);

            if (managedBuildingIds.length === 0) {
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

            // Nếu có building_id filter, kiểm tra quyền
            if (building_id) {
                const buildingIdInt = parseInt(building_id);
                if (!managedBuildingIds.includes(buildingIdInt)) {
                    throw new Error('You do not have permission to access this building');
                }
                where.building_id = buildingIdInt;
            } else {
                where.building_id = { in: managedBuildingIds };
            }
        } else if (userRole === 'owner') {
            // Owner có thể xem tất cả hoặc filter theo building_id
            if (building_id) {
                const buildingIdInt = parseInt(building_id);
                if (!isNaN(buildingIdInt)) {
                    where.building_id = buildingIdInt;
                }
            }
        }

        if (room_number) {
            where.room_number = {
                contains: room_number,
                mode: 'insensitive'
            };
        }

        if (floor !== undefined && floor !== null) {
            const floorNum = parseInt(floor);
            if (!isNaN(floorNum)) {
                where.floor = floorNum;
            }
        }

        if (status) {
            where.status = status;
        }

        if (is_active !== undefined) {
            where.is_active = is_active === 'true' || is_active === true;
        }

        const [rooms, total] = await Promise.all([
            prisma.rooms.findMany({
                where,
                include: {
                    buildings: {
                        select: {
                            building_id: true,
                            name: true,
                            address: true
                        }
                    },
                    tenants: {
                        include: {
                            users: {
                                select: {
                                    user_id: true,
                                    full_name: true,
                                    phone: true
                                }
                            }
                        }
                    },
                    _count: {
                        select: {
                            contracts: {
                                where: {
                                    status: 'active',
                                    deleted_at: null
                                }
                            },
                            maintenance_requests: {
                                where: {
                                    status: {
                                        in: ['pending', 'in_progress']
                                    }
                                }
                            }
                        }
                    }
                },
                skip,
                take: limit,
                orderBy: [
                    { building_id: 'asc' },
                    { floor: 'asc' },
                    { room_number: 'asc' }
                ]
            }),
            prisma.rooms.count({ where })
        ]);

        return {
            data: rooms.map(r => this.formatRoomListResponse(r)),
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        };
    }

    // UPDATE - Cập nhật thông tin phòng
    async updateRoom(roomId, data, userRole, userId) {
        const { room_number, floor, size, description, status, is_active } = data;

        // Verify room exists
        const existingRoom = await prisma.rooms.findUnique({
            where: { room_id: roomId },
            include: {
                buildings: true,
                tenants: true
            }
        });

        if (!existingRoom) {
            throw new Error('Room not found');
        }

        // Kiểm tra quyền truy cập
        await this.checkBuildingAccess(existingRoom.building_id, userRole, userId);

        // Kiểm tra room_number trùng (nếu thay đổi)
        if (room_number && room_number.trim() !== existingRoom.room_number) {
            const duplicateRoom = await prisma.rooms.findFirst({
                where: {
                    building_id: existingRoom.building_id,
                    room_number: room_number.trim(),
                    room_id: { not: roomId },
                    is_active: true
                }
            });

            if (duplicateRoom) {
                throw new Error('Room number already exists in this building');
            }
        }

        // Validate floor nếu thay đổi
        if (floor !== undefined && floor !== null) {
            const floorNum = parseInt(floor);
            if (isNaN(floorNum)) {
                throw new Error('floor must be a valid number');
            }

            if (existingRoom.buildings.number_of_floors && floorNum > existingRoom.buildings.number_of_floors) {
                throw new Error(`Floor ${floorNum} exceeds building's number of floors (${existingRoom.buildings.number_of_floors})`);
            }
        }

        // Kiểm tra nếu thay đổi status sang maintenance/unavailable khi có tenant
        if (status && status !== existingRoom.status) {
            if ((status === 'maintenance' || status === 'available') && existingRoom.tenants.length > 0) {
                console.log(`Warning: Changing status of occupied room ${roomId} to ${status}`);
            }
        }

        // Prepare update data
        const updateData = {
            updated_at: new Date()
        };

        if (room_number !== undefined) updateData.room_number = room_number.trim();
        if (floor !== undefined) {
            updateData.floor = floor === null || floor === '' ? null : parseInt(floor);
        }
        if (size !== undefined) updateData.size = size?.trim() || null;
        if (description !== undefined) updateData.description = description?.trim() || null;
        if (status !== undefined) updateData.status = status;
        if (is_active !== undefined) {
            updateData.is_active = is_active === 'true' || is_active === true;
        }

        const room = await prisma.rooms.update({
            where: { room_id: roomId },
            data: updateData,
            include: {
                buildings: {
                    select: {
                        building_id: true,
                        name: true,
                        address: true
                    }
                },
                tenants: {
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
                }
            }
        });

        return this.formatRoomResponse(room);
    }

    // DELETE - Vô hiệu hóa phòng (soft delete)
    async deactivateRoom(roomId, userRole, userId) {
        const room = await prisma.rooms.findUnique({
            where: { room_id: roomId },
            include: {
                tenants: true,
                contracts: {
                    where: {
                        status: 'active',
                        deleted_at: null
                    }
                }
            }
        });

        if (!room) {
            throw new Error('Room not found');
        }

        // Kiểm tra quyền truy cập
        await this.checkBuildingAccess(room.building_id, userRole, userId);

        if (!room.is_active) {
            throw new Error('Room is already inactive');
        }

        // Kiểm tra có tenant hoặc contract đang active
        if (room.tenants.length > 0) {
            throw new Error('Cannot deactivate room with active tenants');
        }

        if (room.contracts.length > 0) {
            throw new Error('Cannot deactivate room with active contracts');
        }

        await prisma.rooms.update({
            where: { room_id: roomId },
            data: {
                is_active: false,
                status: 'available',
                updated_at: new Date()
            }
        });

        return { success: true, message: 'Room deactivated successfully' };
    }

    // ACTIVATE - Kích hoạt lại phòng
    async activateRoom(roomId, userRole, userId) {
        const room = await prisma.rooms.findUnique({
            where: { room_id: roomId },
            include: {
                buildings: true
            }
        });

        if (!room) {
            throw new Error('Room not found');
        }

        // Kiểm tra quyền truy cập
        await this.checkBuildingAccess(room.building_id, userRole, userId);

        if (room.is_active) {
            throw new Error('Room is already active');
        }

        if (!room.buildings.is_active) {
            throw new Error('Cannot activate room in inactive building');
        }

        const activated = await prisma.rooms.update({
            where: { room_id: roomId },
            data: {
                is_active: true,
                updated_at: new Date()
            },
            include: {
                buildings: {
                    select: {
                        building_id: true,
                        name: true,
                        address: true
                    }
                }
            }
        });

        return this.formatRoomResponse(activated);
    }

    // DELETE - Xóa vĩnh viễn phòng
    async hardDeleteRoom(roomId, userRole, userId) {
        const room = await prisma.rooms.findUnique({
            where: { room_id: roomId },
            include: {
                tenants: true,
                contracts: true,
                maintenance_requests: true,
                guest_registrations: true
            }
        });

        if (!room) {
            throw new Error('Room not found');
        }

        // Kiểm tra quyền truy cập
        await this.checkBuildingAccess(room.building_id, userRole, userId);

        // Kiểm tra có dữ liệu liên quan không
        if (room.tenants.length > 0) {
            throw new Error('Cannot delete room with existing tenants');
        }

        if (room.contracts.length > 0) {
            throw new Error('Cannot delete room with existing contracts');
        }

        if (room.maintenance_requests.length > 0) {
            throw new Error('Cannot delete room with existing maintenance requests');
        }

        if (room.guest_registrations.length > 0) {
            throw new Error('Cannot delete room with existing guest registrations');
        }

        // Xóa room
        await prisma.rooms.delete({
            where: { room_id: roomId }
        });

        return { success: true, message: 'Room permanently deleted' };
    }

    // READ - Tìm phòng theo user_id (tenant)
    async getRoomsByUserId(userId) {
        const userIdInt = parseInt(userId);
        if (isNaN(userIdInt)) {
            throw new Error('user_id must be a valid number');
        }

        // Kiểm tra user có tồn tại không
        const user = await prisma.users.findUnique({
            where: { user_id: userIdInt }
        });

        if (!user) {
            throw new Error('User not found');
        }

        // Tìm tenant record
        const tenant = await prisma.tenants.findUnique({
            where: { user_id: userIdInt },
            include: {
                rooms: {
                    include: {
                        buildings: {
                            select: {
                                building_id: true,
                                name: true,
                                address: true
                            }
                        },
                        contracts: {
                            where: {
                                tenant_user_id: userIdInt,
                                status: 'active',
                                deleted_at: null
                            },
                            select: {
                                contract_id: true,
                                start_date: true,
                                end_date: true,
                                rent_amount: true,
                                deposit_amount: true,
                                status: true
                            }
                        },
                        maintenance_requests: {
                            where: {
                                tenant_user_id: userIdInt,
                                status: {
                                    in: ['pending', 'in_progress']
                                }
                            },
                            select: {
                                request_id: true,
                                title: true,
                                category: true,
                                priority: true,
                                status: true,
                                created_at: true
                            },
                            orderBy: { created_at: 'desc' }
                        }
                    }
                }
            }
        });

        if (!tenant) {
            throw new Error('User is not a tenant');
        }

        // Nếu tenant có room_id, lấy thông tin room đó
        let currentRoom = null;
        if (tenant.room_id) {
            currentRoom = await prisma.rooms.findUnique({
                where: { room_id: tenant.room_id },
                include: {
                    buildings: {
                        select: {
                            building_id: true,
                            name: true,
                            address: true
                        }
                    },
                    contracts: {
                        where: {
                            tenant_user_id: userIdInt,
                            status: 'active',
                            deleted_at: null
                        },
                        select: {
                            contract_id: true,
                            start_date: true,
                            end_date: true,
                            rent_amount: true,
                            deposit_amount: true,
                            status: true
                        }
                    },
                    maintenance_requests: {
                        where: {
                            tenant_user_id: userIdInt,
                            status: {
                                in: ['pending', 'in_progress']
                            }
                        },
                        select: {
                            request_id: true,
                            title: true,
                            category: true,
                            priority: true,
                            status: true,
                            created_at: true
                        },
                        orderBy: { created_at: 'desc' }
                    }
                }
            });
        }

        // Lấy lịch sử các phòng đã thuê (qua contracts)
        const contractHistory = await prisma.contracts.findMany({
            where: {
                tenant_user_id: userIdInt,
                deleted_at: null
            },
            include: {
                rooms: {
                    include: {
                        buildings: {
                            select: {
                                building_id: true,
                                name: true,
                                address: true
                            }
                        }
                    }
                }
            },
            orderBy: { created_at: 'desc' }
        });

        return {
            user_id: userIdInt,
            user_info: {
                full_name: user.full_name,
                email: user.email,
                phone: user.phone,
                avatar_url: user.avatar_url
            },
            tenant_info: {
                id_number: tenant.id_number,
                tenant_since: tenant.tenant_since,
                emergency_contact_phone: tenant.emergency_contact_phone
            },
            current_room: currentRoom ? this.formatRoomDetailForTenant(currentRoom, userIdInt) : null,
            contract_history: contractHistory.map(c => ({
                contract_id: c.contract_id,
                room: {
                    room_id: c.rooms.room_id,
                    room_number: c.rooms.room_number,
                    building_name: c.rooms.buildings?.name,
                    building_address: c.rooms.buildings?.address,
                    floor: c.rooms.floor,
                    size: c.rooms.size
                },
                start_date: c.start_date,
                end_date: c.end_date,
                rent_amount: c.rent_amount,
                deposit_amount: c.deposit_amount,
                status: c.status,
                created_at: c.created_at
            }))
        };
    }

    // STATISTICS - Thống kê phòng theo building
    async getRoomStatisticsByBuilding(buildingId, userRole, userId) {
        // Kiểm tra quyền truy cập
        await this.checkBuildingAccess(buildingId, userRole, userId);

        const building = await prisma.buildings.findUnique({
            where: { building_id: buildingId }
        });

        if (!building) {
            throw new Error('Building not found');
        }

        const [
            totalRooms,
            activeRooms,
            occupiedRooms,
            availableRooms,
            maintenanceRooms,
            reservedRooms,
            activeContracts,
            pendingMaintenance
        ] = await Promise.all([
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
                    status: 'occupied'
                }
            }),
            prisma.rooms.count({
                where: {
                    building_id: buildingId,
                    is_active: true,
                    status: 'available'
                }
            }),
            prisma.rooms.count({
                where: {
                    building_id: buildingId,
                    is_active: true,
                    status: 'maintenance'
                }
            }),
            prisma.rooms.count({
                where: {
                    building_id: buildingId,
                    is_active: true,
                    status: 'reserved'
                }
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
                    status: {
                        in: ['pending', 'in_progress']
                    }
                }
            })
        ]);

        return {
            building_id: buildingId,
            building_name: building.name,
            total_rooms: totalRooms,
            active_rooms: activeRooms,
            occupied_rooms: occupiedRooms,
            available_rooms: availableRooms,
            maintenance_rooms: maintenanceRooms,
            reserved_rooms: reservedRooms,
            occupancy_rate: activeRooms > 0 ? ((occupiedRooms / activeRooms) * 100).toFixed(2) : 0,
            active_contracts: activeContracts,
            pending_maintenance: pendingMaintenance
        };
    }

    // Helper functions - Format response
    formatRoomResponse(room) {
        return {
            room_id: room.room_id,
            building_id: room.building_id,
            building_name: room.buildings?.name,
            building_address: room.buildings?.address,
            room_number: room.room_number,
            floor: room.floor,
            size: room.size,
            description: room.description,
            status: room.status,
            is_active: room.is_active,
            tenants: room.tenants?.map(t => ({
                user_id: t.user_id,
                full_name: t.users?.full_name,
                email: t.users?.email,
                phone: t.users?.phone,
                tenant_since: t.tenant_since
            })) || [],
            created_at: room.created_at,
            updated_at: room.updated_at
        };
    }

    formatRoomListResponse(room) {
        return {
            room_id: room.room_id,
            building_id: room.building_id,
            building_name: room.buildings?.name,
            room_number: room.room_number,
            floor: room.floor,
            size: room.size,
            status: room.status,
            is_active: room.is_active,
            tenant_count: room.tenants?.length || 0,
            active_contracts: room._count?.contracts || 0,
            pending_maintenance: room._count?.maintenance_requests || 0,
            primary_tenant: room.tenants?.[0] ? {
                user_id: room.tenants[0].user_id,
                full_name: room.tenants[0].users?.full_name,
                phone: room.tenants[0].users?.phone
            } : null,
            created_at: room.created_at,
            updated_at: room.updated_at
        };
    }

    formatRoomDetailResponse(room) {
        return {
            room_id: room.room_id,
            building_id: room.building_id,
            building_name: room.buildings?.name,
            building_address: room.buildings?.address,
            building_floors: room.buildings?.number_of_floors,
            room_number: room.room_number,
            floor: room.floor,
            size: room.size,
            description: room.description,
            status: room.status,
            is_active: room.is_active,
            tenants: room.tenants?.map(t => ({
                user_id: t.user_id,
                full_name: t.users?.full_name,
                email: t.users?.email,
                phone: t.users?.phone,
                avatar_url: t.users?.avatar_url,
                tenant_since: t.tenant_since,
                id_number: t.id_number,
                emergency_contact_phone: t.emergency_contact_phone
            })) || [],
            active_contracts: room.contracts?.map(c => ({
                contract_id: c.contract_id,
                start_date: c.start_date,
                end_date: c.end_date,
                rent_amount: c.rent_amount,
                status: c.status
            })) || [],
            recent_maintenance_requests: room.maintenance_requests?.map(m => ({
                request_id: m.request_id,
                title: m.title,
                category: m.category,
                priority: m.priority,
                status: m.status,
                created_at: m.created_at
            })) || [],
            created_at: room.created_at,
            updated_at: room.updated_at
        };
    }

    formatRoomDetailForTenant(room, tenantUserId) {
        return {
            room_id: room.room_id,
            building_id: room.building_id,
            building_name: room.buildings?.name,
            building_address: room.buildings?.address,
            room_number: room.room_number,
            floor: room.floor,
            size: room.size,
            description: room.description,
            status: room.status,
            is_active: room.is_active,
            active_contracts: room.contracts?.map(c => ({
                contract_id: c.contract_id,
                start_date: c.start_date,
                end_date: c.end_date,
                rent_amount: c.rent_amount,
                deposit_amount: c.deposit_amount,
                status: c.status
            })) || [],
            my_maintenance_requests: room.maintenance_requests?.map(m => ({
                request_id: m.request_id,
                title: m.title,
                category: m.category,
                priority: m.priority,
                status: m.status,
                created_at: m.created_at
            })) || [],
            created_at: room.created_at,
            updated_at: room.updated_at
        };
    }
}

module.exports = new RoomService();