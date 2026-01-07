// Updated: 2025-12-22
// by: DatNB
// Changed: Auto-update room status based on maintenance requests and contracts

const prisma = require("../config/prisma");
const {
  room_status,
  contract_status,
  maintenance_status,
} = require("../config/prisma");

function calculateMaxTenants(size) {
  const s = Number(size);
  if (!s || Number.isNaN(s)) return 1;
  if (s <= 15) return 1;
  if (s <= 25) return 2;
  if (s <= 35) return 3;
  return 4;
}

class RoomService {
  // Helper: Tính toán status động của phòng
  async calculateRoomStatus(roomId) {
    // Kiểm tra maintenance requests chưa giải quyết
    const pendingMaintenance = await prisma.maintenance_requests.count({
      where: {
        room_id: roomId,
        status: {
          in: ["pending", "in_progress"],
        },
      },
    });

    // Nếu có maintenance chưa giải quyết -> status = maintenance
    if (pendingMaintenance > 0) {
      return "maintenance";
    }

    // Kiểm tra hợp đồng active
    const activeContracts = await prisma.contracts.count({
      where: {
        room_id: roomId,
        status: "active",
        deleted_at: null,
      },
    });

    // Có hợp đồng active -> occupied, không có -> available
    return activeContracts > 0 ? "occupied" : "available";
  }

  // Helper: Cập nhật status của phòng
  async updateRoomStatus(roomId) {
    const newStatus = await this.calculateRoomStatus(roomId);

    await prisma.rooms.update({
      where: { room_id: roomId },
      data: {
        status: newStatus,
        updated_at: new Date(),
      },
    });

    return newStatus;
  }

  // Helper: Kiểm tra quyền truy cập building
  async checkBuildingAccess(buildingId, userRole, userId) {
    if (userRole === "OWNER") {
      return true;
    }

    if (userRole === "MANAGER") {
      const manager = await prisma.building_managers.findFirst({
        where: {
          user_id: userId,
          building_id: buildingId,
        },
      });

      if (!manager) {
        throw new Error("You do not have permission to access this building");
      }

      return true;
    }

    throw new Error("Unauthorized access");
  }

  async getManagedBuildingIds(userId) {
    if (!userId) return [];

    const managedBuildings = await prisma.building_managers.findMany({
      where: {
        user_id: userId,
      },
      select: {
        building_id: true,
      },
    });

    return managedBuildings.map((mb) => mb.building_id);
  }

  isManagementRole(userRole) {
    return ["OWNER", "MANAGER"].includes(userRole);
  }

  // CREATE - Tạo phòng mới (chỉ OWNER và MANAGER)
  async createRoom(data, userRole, userId) {
    const normalizedRole = (userRole || "").toUpperCase();
    if (!this.isManagementRole(normalizedRole)) {
      throw new Error("Only OWNER and MANAGER can create rooms");
    }

    const { building_id, room_number, floor, size, description, status } = data;

    if (!building_id || !room_number) {
      throw new Error("Missing required fields: building_id, room_number");
    }

    const buildingId = parseInt(building_id);
    if (isNaN(buildingId)) {
      throw new Error("building_id must be a valid number");
    }

    await this.checkBuildingAccess(buildingId, normalizedRole, userId);

    const building = await prisma.buildings.findUnique({
      where: { building_id: buildingId },
    });

    if (!building) {
      throw new Error("Building not found");
    }

    if (!building.is_active) {
      throw new Error("Cannot create room in inactive building");
    }

    const existingRoom = await prisma.rooms.findFirst({
      where: {
        building_id: buildingId,
        room_number: room_number.trim(),
        is_active: true,
      },
    });

    if (existingRoom) {
      throw new Error("Room number already exists in this building");
    }

    if (floor !== undefined && floor !== null) {
      const floorNum = parseInt(floor);
      if (isNaN(floorNum)) {
        throw new Error("floor must be a valid number");
      }

      if (building.number_of_floors && floorNum > building.number_of_floors) {
        throw new Error(
          `Floor ${floorNum} exceeds building's number of floors (${building.number_of_floors})`
        );
      }
    }

    const sizeNumber =
      size === undefined || size === null || size === "" ? null : Number(size);
    const maxTenants = calculateMaxTenants(sizeNumber);

    const room = await prisma.rooms.create({
      data: {
        building_id: buildingId,
        room_number: room_number.trim(),
        floor: floor ? parseInt(floor) : null,
        size: sizeNumber,
        max_tenants: maxTenants,
        description: description?.trim() || null,
        status: status || "available", // Mặc định available khi tạo mới
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
      include: {
        buildings: {
          select: {
            building_id: true,
            name: true,
            address: true,
          },
        },
      },
    });

    return this.formatRoomResponse(room);
  }

  // READ - Lấy thông tin phòng theo ID với status động
  async getRoomById(roomId, userRole, userId) {
    const room = await prisma.rooms.findUnique({
      where: { room_id: roomId },
      include: {
        buildings: {
          select: {
            building_id: true,
            name: true,
            address: true,
            number_of_floors: true,
          },
        },
        tenants: {
          include: {
            users: {
              select: {
                user_id: true,
                full_name: true,
                email: true,
                phone: true,
                avatar_url: true,
              },
            },
          },
        },
        contracts: {
          where: {
            status: "active",
            deleted_at: null,
          },
          select: {
            contract_id: true,
            start_date: true,
            end_date: true,
            rent_amount: true,
            status: true,
          },
        },
        maintenance_requests: {
          where: {
            status: {
              in: ["pending", "in_progress"],
            },
          },
          select: {
            request_id: true,
            title: true,
            category: true,
            priority: true,
            status: true,
            created_at: true,
          },
          orderBy: { created_at: "desc" },
          take: 5,
        },
      },
    });

    if (!room) {
      throw new Error("Room not found");
    }

    const normalizedRole = (userRole || "").toUpperCase();

    if (this.isManagementRole(normalizedRole)) {
      await this.checkBuildingAccess(room.building_id, normalizedRole, userId);
    } else if (normalizedRole === "TENANT") {
      const tenant = await prisma.tenants.findUnique({
        where: { user_id: userId },
      });
      if (!tenant || tenant.room_id !== roomId) {
        throw new Error("You can only view your own room");
      }
    } else {
      throw new Error("Unauthorized access");
    }

    // Tính toán status động
    const dynamicStatus = await this.calculateRoomStatus(roomId);

    // Cập nhật status nếu khác với DB
    if (room.status !== dynamicStatus) {
      await this.updateRoomStatus(roomId);
      room.status = dynamicStatus;
    }

    return this.formatRoomDetailResponse(room);
  }

  // READ - Lấy danh sách phòng với status động
  async getRooms(filters = {}, userRole, userId) {
    const {
      building_id,
      room_number,
      floor,
      status,
      is_active,
      page = 1,
      limit = 20,
    } = filters;

    const normalizedRole = (userRole || "").trim().toUpperCase();
    const skip = (page - 1) * limit;
    const where = {};

    /* =======================
     * 1️⃣ PHÂN QUYỀN THEO ROLE
     * ======================= */
    if (normalizedRole === "MANAGER") {
      const managedBuildingIds = await this.getManagedBuildingIds(userId);

      if (!managedBuildingIds || managedBuildingIds.length === 0) {
        return {
          data: [],
          pagination: { total: 0, page, limit, pages: 0 },
        };
      }

      if (building_id) {
        const buildingIdInt = parseInt(building_id);
        if (!managedBuildingIds.includes(buildingIdInt)) {
          throw new Error("You do not have permission to access this building");
        }
        where.building_id = buildingIdInt;
      } else {
        where.building_id = { in: managedBuildingIds };
      }
    } else if (normalizedRole === "OWNER") {
      if (building_id) {
        const buildingIdInt = parseInt(building_id);
        if (!isNaN(buildingIdInt)) {
          where.building_id = buildingIdInt;
        }
      }
    } else if (normalizedRole === "TENANT") {
      const tenant = await prisma.tenants.findUnique({
        where: { user_id: userId },
      });

      if (!tenant || !tenant.room_id) {
        return {
          data: [],
          pagination: { total: 0, page, limit, pages: 0 },
        };
      }

      where.room_id = tenant.room_id;
    } else {
      throw new Error("Unauthorized access");
    }

    /* =======================
     * 2️⃣ FILTER
     * ======================= */
    if (room_number) {
      where.room_number = {
        contains: room_number,
        mode: "insensitive",
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
      where.is_active = is_active === true || is_active === "true";
    }

    /* =======================
     * 3️⃣ QUERY DATABASE
     * ======================= */
    const [rooms, total] = await Promise.all([
      prisma.rooms.findMany({
        where,
        include: {
          // 🏢 Tòa nhà
          building: {
            select: {
              building_id: true,
              name: true,
              address: true,
            },
          },

          // 👤 Người ở: rooms → room_tenants → tenant → users
          room_tenants: {
            include: {
              tenant: {
                include: {
                  user: {
                    select: {
                      user_id: true,
                      full_name: true,
                      phone: true,
                    },
                  },
                },
              },
            },
          },

          // 🔢 Đếm liên quan
          _count: {
            select: {
              contracts_history: {
                where: {
                  status: "active",
                  deleted_at: null,
                },
              },
              maintenance_requests: {
                where: {
                  status: {
                    in: ["pending", "in_progress"],
                  },
                },
              },
            },
          },
        },
        skip,
        take: limit,
        orderBy: [
          { building_id: "asc" },
          { floor: "asc" },
          { room_number: "asc" },
        ],
      }),

      prisma.rooms.count({ where }),
    ]);

    /* =======================
     * 4️⃣ CẬP NHẬT STATUS ĐỘNG
     * ======================= */
    const roomsWithDynamicStatus = await Promise.all(
      rooms.map(async (room) => {
        const dynamicStatus = await this.calculateRoomStatus(room.room_id);

        if (room.status !== dynamicStatus) {
          await this.updateRoomStatus(room.room_id);
          room.status = dynamicStatus;
        }

        return room;
      })
    );

    /* =======================
     * 5️⃣ RESPONSE
     * ======================= */
    return {
      data: roomsWithDynamicStatus.map((room) =>
        this.formatRoomListResponse(room)
      ),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  // UPDATE - Cập nhật thông tin phòng (chỉ OWNER và MANAGER)
  async updateRoom(roomId, data, userRole, userId) {
    const normalizedRole = (userRole || "").toUpperCase();

    if (!this.isManagementRole(normalizedRole)) {
      throw new Error("Only OWNER and MANAGER can update rooms");
    }

    const { room_number, floor, size, description, status, is_active } = data;

    const existingRoom = await prisma.rooms.findUnique({
      where: { room_id: roomId },
      include: {
        buildings: true,
        tenants: true,
      },
    });
    const hasSensitiveChange =
      (room_number !== undefined &&
        room_number.trim() !== existingRoom.room_number) ||
      (size !== undefined &&
        (size?.trim() || null) !== (existingRoom.size || null));

    if (hasSensitiveChange) {
      const activeContracts = await prisma.contracts.count({
        where: { room_id: roomId, status: "active", deleted_at: null },
      });

      if (existingRoom.tenants?.length > 0 || activeContracts > 0) {
        throw new Error("Chỉ được sửa phòng khi phòng không có người ở.");
      }
    }

    if (!existingRoom) {
      throw new Error("Room not found");
    }

    await this.checkBuildingAccess(
      existingRoom.building_id,
      normalizedRole,
      userId
    );

    if (room_number && room_number.trim() !== existingRoom.room_number) {
      const duplicateRoom = await prisma.rooms.findFirst({
        where: {
          building_id: existingRoom.building_id,
          room_number: room_number.trim(),
          room_id: { not: roomId },
          is_active: true,
        },
      });

      if (duplicateRoom) {
        throw new Error("Room number already exists in this building");
      }
    }

    if (floor !== undefined && floor !== null) {
      const floorNum = parseInt(floor);
      if (isNaN(floorNum)) {
        throw new Error("floor must be a valid number");
      }

      if (
        existingRoom.buildings.number_of_floors &&
        floorNum > existingRoom.buildings.number_of_floors
      ) {
        throw new Error(
          `Floor ${floorNum} exceeds building's number of floors (${existingRoom.buildings.number_of_floors})`
        );
      }
    }

    const updateData = {
      updated_at: new Date(),
    };

    if (room_number !== undefined) updateData.room_number = room_number.trim();
    if (floor !== undefined) {
      updateData.floor =
        floor === null || floor === "" ? null : parseInt(floor);
    }
    if (size !== undefined) {
      const sizeNumber = size === null || size === "" ? null : Number(size);

      const newMaxTenants = calculateMaxTenants(sizeNumber);

      // Đếm số tenant hiện tại (chỉ tenant đang ở: is_current = true)
      const currentTenantCount = await prisma.room_tenants.count({
        where: {
          room_id: roomId,
          is_current: true,
        },
      });

      // Nếu đang có nhiều tenant hơn giới hạn mới -> CHẶN
      if (currentTenantCount > newMaxTenants) {
        throw new Error(
          "Không thể giảm diện tích vì phòng đang có quá nhiều người thuê"
        );
      }

      updateData.size = sizeNumber;
      updateData.max_tenants = newMaxTenants;
    }
    if (description !== undefined)
      updateData.description = description?.trim() || null;

    // Chỉ cho phép update status thủ công, nhưng sẽ bị override bởi logic tự động
    if (status !== undefined) {
      updateData.status = status;
    }

    if (is_active !== undefined) {
      updateData.is_active = is_active === "true" || is_active === true;
    }

    const room = await prisma.rooms.update({
      where: { room_id: roomId },
      data: updateData,
      include: {
        buildings: {
          select: {
            building_id: true,
            name: true,
            address: true,
          },
        },
        tenants: {
          include: {
            users: {
              select: {
                user_id: true,
                full_name: true,
                email: true,
                phone: true,
              },
            },
          },
        },
      },
    });

    // Cập nhật lại status động sau khi update
    const dynamicStatus = await this.calculateRoomStatus(roomId);
    if (room.status !== dynamicStatus) {
      await this.updateRoomStatus(roomId);
      room.status = dynamicStatus;
    }

    return this.formatRoomResponse(room);
  }

  // DELETE - Vô hiệu hóa phòng (soft delete) - chỉ OWNER và MANAGER
  async deactivateRoom(roomId, userRole, userId) {
    const normalizedRole = (userRole || "").toUpperCase();

    if (!this.isManagementRole(normalizedRole)) {
      throw new Error("Only OWNER and MANAGER can deactivate rooms");
    }

    const room = await prisma.rooms.findUnique({
      where: { room_id: roomId },
      include: {
        tenants: true,
        contracts: {
          where: {
            status: "active",
            deleted_at: null,
          },
        },
      },
    });

    if (!room) {
      throw new Error("Room not found");
    }

    await this.checkBuildingAccess(room.building_id, normalizedRole, userId);

    if (!room.is_active) {
      throw new Error("Room is already inactive");
    }

    if (room.tenants.length > 0) {
      throw new Error("Cannot deactivate room with active tenants");
    }

    if (room.contracts.length > 0) {
      throw new Error("Cannot deactivate room with active contracts");
    }

    await prisma.rooms.update({
      where: { room_id: roomId },
      data: {
        is_active: false,
        status: "available",
        updated_at: new Date(),
      },
    });

    return { success: true, message: "Room deactivated successfully" };
  }

  // ACTIVATE - Kích hoạt lại phòng - chỉ OWNER và MANAGER
  async activateRoom(roomId, userRole, userId) {
    const normalizedRole = (userRole || "").toUpperCase();

    if (!this.isManagementRole(normalizedRole)) {
      throw new Error("Only OWNER and MANAGER can activate rooms");
    }

    const room = await prisma.rooms.findUnique({
      where: { room_id: roomId },
      include: {
        buildings: true,
      },
    });

    if (!room) {
      throw new Error("Room not found");
    }

    await this.checkBuildingAccess(room.building_id, normalizedRole, userId);

    if (room.is_active) {
      throw new Error("Room is already active");
    }

    if (!room.buildings.is_active) {
      throw new Error("Cannot activate room in inactive building");
    }

    // Tính status động khi activate
    const dynamicStatus = await this.calculateRoomStatus(roomId);

    const activated = await prisma.rooms.update({
      where: { room_id: roomId },
      data: {
        is_active: true,
        status: dynamicStatus,
        updated_at: new Date(),
      },
      include: {
        buildings: {
          select: {
            building_id: true,
            name: true,
            address: true,
          },
        },
      },
    });

    return this.formatRoomResponse(activated);
  }

  // DELETE - Xóa vĩnh viễn phòng - chỉ OWNER
  async hardDeleteRoom(roomId, userRole, userId) {
    const normalizedRole = (userRole || "").toUpperCase();

    if (normalizedRole !== "OWNER") {
      throw new Error("Only OWNER can permanently delete rooms");
    }

    const room = await prisma.rooms.findUnique({
      where: { room_id: roomId },
      include: {
        tenants: true,
        contracts: true,
        maintenance_requests: true,
        guest_registrations: true,
      },
    });

    if (!room) {
      throw new Error("Room not found");
    }

    await this.checkBuildingAccess(room.building_id, normalizedRole, userId);

    if (room.tenants.length > 0) {
      throw new Error("Cannot delete room with existing tenants");
    }

    if (room.contracts.length > 0) {
      throw new Error("Cannot delete room with existing contracts");
    }

    if (room.maintenance_requests.length > 0) {
      throw new Error("Cannot delete room with existing maintenance requests");
    }

    if (room.guest_registrations.length > 0) {
      throw new Error("Cannot delete room with existing guest registrations");
    }

    await prisma.rooms.delete({
      where: { room_id: roomId },
    });

    return { success: true, message: "Room permanently deleted" };
  }
  // READ - Tìm phòng theo user_id (dành cho TENANT)
  async getRoomsByUserId(userId, requestUserRole, requestUserId) {
    const userIdInt = parseInt(userId);
    if (isNaN(userIdInt)) {
      throw new Error("user_id must be a valid number");
    }

    const normalizedRole = (requestUserRole || "").toUpperCase();

    if (normalizedRole === "TENANT" && requestUserId !== userIdInt) {
      throw new Error("You can only view your own room information");
    }

    if (normalizedRole === "USER") {
      throw new Error("Unauthorized access");
    }

    const user = await prisma.users.findUnique({
      where: { user_id: userIdInt },
    });
    if (!user) throw new Error("User not found");

    const tenant = await prisma.tenants.findUnique({
      where: { user_id: userIdInt },
      include: {
        contracts: {
          where: { deleted_at: null },
          include: {
            room_history: {
              include: {
                building: {
                  select: { building_id: true, name: true, address: true },
                },
              },
            },
          },
          orderBy: { created_at: "desc" },
        },
      },
    });
    if (!tenant) throw new Error("User is not a tenant");

    // 🟢 PHÒNG HIỆN TẠI
    const currentRoom = await prisma.rooms.findFirst({
      where: {
        current_contract: {
          is: {
            tenant_user_id: userIdInt,
            status: "active",
            deleted_at: null,
          },
        },
        is_active: true,
      },
      include: {
        building: { select: { building_id: true, name: true, address: true } },
        current_contract: {
          select: {
            contract_id: true,
            start_date: true,
            end_date: true,
            rent_amount: true,
            deposit_amount: true,
            status: true,
          },
        },
        maintenance_requests: {
          where: {
            tenant_user_id: userIdInt,
            status: { in: ["pending", "in_progress"] },
          },
          orderBy: { created_at: "desc" },
          select: {
            request_id: true,
            title: true,
            category: true,
            priority: true,
            status: true,
            created_at: true,
          },
        },
      },
    });

    // 🟢 LỊCH SỬ HỢP ĐỒNG
    const contractHistory = tenant.contracts.map((c) => ({
      contract_id: c.contract_id,
      room: {
        room_id: c.room_history.room_id,
        room_number: c.room_history.room_number,
        floor: c.room_history.floor,
        size: c.room_history.size,
        building_name: c.room_history.building?.name,
        building_address: c.room_history.building?.address,
      },
      start_date: c.start_date,
      end_date: c.end_date,
      rent_amount: c.rent_amount,
      deposit_amount: c.deposit_amount,
      status: c.status,
      created_at: c.created_at,
    }));

    return {
      user_id: userIdInt,
      user_info: {
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        avatar_url: user.avatar_url,
      },
      tenant_info: {
        id_number: tenant.id_number,
        tenant_since: tenant.tenant_since,
        note: tenant.note,
      },
      current_room: currentRoom
        ? {
            room_id: currentRoom.room_id,
            room_number: currentRoom.room_number,
            floor: currentRoom.floor,
            size: currentRoom.size,
            building_name: currentRoom.building?.name,
            building_address: currentRoom.building?.address,
            current_contract: currentRoom.current_contract,
            maintenance_requests: currentRoom.maintenance_requests,
            status: currentRoom.status,
          }
        : null,
      contract_history: contractHistory,
    };
  }

  async getRoomStatisticsByBuilding(buildingId, userRole, userId) {
    const normalizedRole = (userRole || "").toUpperCase();
    if (!this.isManagementRole(normalizedRole)) {
      throw new Error("Only OWNER and MANAGER can view room statistics");
    }

    await this.checkBuildingAccess(buildingId, normalizedRole, userId);

    const building = await prisma.buildings.findUnique({
      where: { building_id: buildingId },
      select: { name: true }, // Chỉ lấy field cần thiết
    });

    if (!building) {
      throw new Error("Building not found");
    }

    // 1. Dùng groupBy để lấy thống kê Room Status trong 1 lần query
    // Schema enum: available, occupied, maintenance
    const roomStats = await prisma.rooms.groupBy({
      by: ["status"],
      where: {
        building_id: buildingId,
        is_active: true,
      },
      _count: {
        room_id: true,
      },
    });

    // Chuyển mảng groupBy thành object map để dễ truy xuất
    // Ví dụ: { available: 10, occupied: 5, maintenance: 2 }
    const statsMap = roomStats.reduce((acc, curr) => {
      acc[curr.status] = curr._count.room_id;
      return acc;
    }, {});

    // Tính tổng số phòng active
    const activeRooms =
      (statsMap["available"] || 0) +
      (statsMap["occupied"] || 0) +
      (statsMap["maintenance"] || 0);

    // Tính tổng số phòng bao gồm cả inactive (nếu cần)
    const totalRooms = await prisma.rooms.count({
      where: { building_id: buildingId },
    });

    // 2. Chạy song song các query còn lại
    const [activeContracts, pendingMaintenance] = await Promise.all([
      prisma.contracts.count({
        where: {
          rooms: { building_id: buildingId }, // Relation filter correct based on schema
          status: "active", // Enum value trong DB là chữ thường
          deleted_at: null,
        },
      }),
      prisma.maintenance_requests.count({
        where: {
          rooms: { building_id: buildingId },
          status: {
            in: ["pending", "in_progress"], // Enum value trong DB là chữ thường
          },
        },
      }),
    ]);

    const occupiedRooms = statsMap["occupied"] || 0;

    return {
      building_id: buildingId,
      building_name: building.name,
      total_rooms: totalRooms,
      active_rooms: activeRooms,
      occupied_rooms: occupiedRooms,
      available_rooms: statsMap["available"] || 0,
      maintenance_rooms: statsMap["maintenance"] || 0,
      // reserved_rooms: 0, // Đã xóa vì không có trong Schema enum
      occupancy_rate:
        activeRooms > 0 ? ((occupiedRooms / activeRooms) * 100).toFixed(2) : 0,
      active_contracts: activeContracts,
      pending_maintenance: pendingMaintenance,
    };
  }

  async getSimpleRoomsByBuilding(buildingId, onlyEmpty) {
    const bId = parseInt(buildingId);
    if (isNaN(bId)) throw new Error("Building ID must be a number");

    const where = {
      building_id: bId,
      is_active: true,
    };

    // Logic lọc phòng trống
    if (onlyEmpty === "true" || onlyEmpty === true) {
      // [FIX] Sử dụng NOT + some thay vì none
      // Ý nghĩa: Loại bỏ phòng nếu tìm thấy (some) hợp đồng thỏa mãn điều kiện bên trong
      where.NOT = {
        contracts_history: {
          some: {
            // 1. Chỉ chặn bởi các hợp đồng chưa bị xóa (quan trọng)
            deleted_at: null,

            // 2. Các trạng thái được coi là "Đang chiếm chỗ"
            status: {
              in: [
                "active", // Đang ở
                "pending", // Đang chờ duyệt -> Phòng này phải ẩn
                "pending_transaction", // Đang chờ cọc -> Phòng này phải ẩn
                "requested_termination", // Đang xin hủy nhưng chưa đi
              ],
            },
          },
        },
      };
    }

    const rooms = await prisma.rooms.findMany({
      where: where,
      select: {
        room_id: true,
        room_number: true,
        floor: true,
        size: true,
        max_tenants: true,
        status: true,
        description: true,
        current_contract_id: true, // FE có thể dùng để check lại lần nữa
        building: {
          select: { name: true },
        },
      },
      orderBy: [{ floor: "asc" }, { room_number: "asc" }],
    });

    return rooms;
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
      tenants:
        room.tenants?.map((t) => ({
          user_id: t.user_id,
          full_name: t.users?.full_name,
          email: t.users?.email,
          phone: t.users?.phone,
          tenant_since: t.tenant_since,
        })) || [],
      created_at: room.created_at,
      updated_at: room.updated_at,
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
      primary_tenant: room.tenants?.[0]
        ? {
            user_id: room.tenants[0].user_id,
            full_name: room.tenants[0].users?.full_name,
            phone: room.tenants[0].users?.phone,
          }
        : null,
      created_at: room.created_at,
      updated_at: room.updated_at,
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
      tenants:
        room.tenants?.map((t) => ({
          user_id: t.user_id,
          full_name: t.users?.full_name,
          email: t.users?.email,
          phone: t.users?.phone,
          avatar_url: t.users?.avatar_url,
          tenant_since: t.tenant_since,
          id_number: t.id_number,
          emergency_contact_phone: t.emergency_contact_phone,
        })) || [],
      active_contracts:
        room.contracts?.map((c) => ({
          contract_id: c.contract_id,
          start_date: c.start_date,
          end_date: c.end_date,
          rent_amount: c.rent_amount,
          status: c.status,
        })) || [],
      recent_maintenance_requests:
        room.maintenance_requests?.map((m) => ({
          request_id: m.request_id,
          title: m.title,
          category: m.category,
          priority: m.priority,
          status: m.status,
          created_at: m.created_at,
        })) || [],
      created_at: room.created_at,
      updated_at: room.updated_at,
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
      active_contracts:
        room.contracts?.map((c) => ({
          contract_id: c.contract_id,
          start_date: c.start_date,
          end_date: c.end_date,
          rent_amount: c.rent_amount,
          deposit_amount: c.deposit_amount,
          status: c.status,
        })) || [],
      my_maintenance_requests:
        room.maintenance_requests?.map((m) => ({
          request_id: m.request_id,
          title: m.title,
          category: m.category,
          priority: m.priority,
          status: m.status,
          created_at: m.created_at,
        })) || [],
      created_at: room.created_at,
      updated_at: room.updated_at,
    };
  }
}

module.exports = new RoomService();
