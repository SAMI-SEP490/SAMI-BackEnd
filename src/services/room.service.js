// Updated: 2025-10-31
// by: DatNB

const prisma = require('../config/prisma');

class RoomService {
    // CREATE - Tạo phòng mới
    async createRoom(data) {
        const { building_id, room_number, floor, size, description, status } = data;

        // Validate required fields
        if (!building_id || !room_number) {
            throw new Error('Missing required fields: building_id, room_number');
        }

        const buildingId = parseInt(building_id);
        if (isNaN(buildingId)) {
            throw new Error('building_id must be a valid number');
        }

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
    async getRoomById(roomId) {
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

        return this.formatRoomDetailResponse(room);
    }

    // READ - Lấy danh sách phòng (có phân trang và filter)
    async getRooms(filters = {}) {
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

        if (building_id) {
            const buildingId = parseInt(building_id);
            if (!isNaN(buildingId)) {
                where.building_id = buildingId;
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
    async updateRoom(roomId, data) {
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
                // Cho phép, nhưng cảnh báo trong log
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
    async deactivateRoom(roomId) {
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
    async activateRoom(roomId) {
        const room = await prisma.rooms.findUnique({
            where: { room_id: roomId },
            include: {
                buildings: true
            }
        });

        if (!room) {
            throw new Error('Room not found');
        }

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
    async hardDeleteRoom(roomId) {
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

    // STATISTICS - Thống kê phòng theo building
    async getRoomStatisticsByBuilding(buildingId) {
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
}

module.exports = new RoomService();