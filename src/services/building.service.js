// Updated: 2025-01-10
// by: DatNB (Fixed by Gemini)

const prisma = require("../config/prisma");
const NotificationService = require("./notification.service");

class BuildingService {
  // CREATE - Tạo tòa nhà mới
  async createBuilding(data) {
    const { name, address, number_of_floors, total_area } = data;

    // Validate required fields
    if (!name) {
      throw new Error("Missing required field: name");
    }

    // Kiểm tra tên tòa nhà đã tồn tại chưa
    const existingBuilding = await prisma.buildings.findFirst({
      where: {
        name: name.trim(),
        is_active: true,
      },
    });

    if (existingBuilding) {
      throw new Error("Building with this name already exists");
    }

    // Validate number_of_floors
    if (number_of_floors !== undefined && number_of_floors !== null) {
      const floors = parseInt(number_of_floors);
      if (isNaN(floors) || floors <= 0) {
        throw new Error("number_of_floors must be a positive number");
      }
    }

    // Validate total_area
    if (total_area !== undefined && total_area !== null) {
      const area = parseFloat(total_area);
      if (isNaN(area) || area <= 0) {
        throw new Error("total_area must be a positive number");
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
        updated_at: new Date(),
      },
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
            // [FIX] Sửa 'users' thành 'user' để khớp với schema chuẩn
            user: {
              select: {
                user_id: true,
                full_name: true,
                email: true,
                phone: true,
              },
            },
          },
        },
        rooms: {
          where: { is_active: true },
          select: {
            room_id: true,
            room_number: true,
            floor: true,
            size: true,
            is_active: true,
          },
        },
        regulations: {
          where: { status: "published" },
          select: {
            regulation_id: true,
            title: true,
            effective_date: true,
            version: true,
          },
        },
        floor_plans: {
          where: { is_published: true },
          select: {
            plan_id: true,
            name: true,
            floor_number: true,
          },
        },
      },
    });

    if (!building) {
      throw new Error("Building not found");
    }
    // console.log("🔥🔥 RAW BUILDING FROM DB:", building);

    return this.formatBuildingDetailResponse(building);
  }

  // READ - Lấy danh sách tòa nhà (có phân trang và filter)
  async getBuildings(filters = {}) {
    const { name, address, is_active, page = 1, limit = 20 } = filters;

    const skip = (page - 1) * limit;
    const where = {};

    if (name) {
      where.name = {
        contains: name,
        mode: "insensitive",
      };
    }

    if (address) {
      where.address = {
        contains: address,
        mode: "insensitive",
      };
    }

    if (is_active !== undefined) {
      where.is_active = is_active === "true" || is_active === true;
    }

    const [buildings, total] = await Promise.all([
      prisma.buildings.findMany({
        where,
        include: {
          building_managers: {
            include: {
              user: {
                select: {
                  user_id: true,
                  full_name: true,
                  email: true,
                },
              },
            },
          },
          _count: {
            select: {
              rooms: { where: { is_active: true } },
              regulations: true,
              floor_plans: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: { created_at: "desc" },
      }),
      prisma.buildings.count({ where }),
    ]);

    return {
      data: buildings.map((b) => this.formatBuildingListResponse(b)),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  // [NEW] READ - Lấy danh sách tòa nhà được gán cho Manager
  async getAssignedBuildings(userId) {
    // Lấy danh sách các assignment còn hiệu lực
    const assignments = await prisma.building_managers.findMany({
      where: {
        user_id: userId,
      },
      include: {
        building: {
          select: {
            building_id: true,
            name: true,
            address: true,
            is_active: true,
          },
        },
      },
    });

    // Map data để trả về format gọn gàng
    return assignments.map((a) => ({
      building_id: a.building_id,
      name: a.building.name,
      address: a.building.address,
      is_building_active: a.building.is_active,
    }));
  }

  async updateBuilding(buildingId, data, senderId) {
    const {
      name,
      address,
      number_of_floors,
      total_area,
      is_active,
      electric_unit_price,
      water_unit_price,
      service_fee,
      bill_due_day,
      max_4_wheel_slot,
      max_2_wheel_slot,
    } = data;

    // console.log("🔥🔥🔥 RUNNING updateBuilding WITH DATA:", data);

    // 1️⃣ Verify building exists
    const existingBuilding = await prisma.buildings.findUnique({
      where: { building_id: buildingId },
    });

    if (!existingBuilding) {
      throw new Error("Building not found");
    }

    // 2️⃣ Check duplicate name
    if (name && name.trim() !== existingBuilding.name) {
      const duplicateName = await prisma.buildings.findFirst({
        where: {
          name: name.trim(),
          building_id: { not: buildingId },
          is_active: true,
        },
      });

      if (duplicateName) {
        throw new Error("Building with this name already exists");
      }
    }

    // 3️⃣ Prepare update data
    const updateData = {
      updated_at: new Date(),
    };

    // Track changed billing-related fields
    const billingChanges = [];

    // Name
    if (name !== undefined) updateData.name = name.trim();

    // Address
    if (address !== undefined) updateData.address = address?.trim() || null;

    // Number of floors
    if (number_of_floors !== undefined) {
      if (number_of_floors === null || number_of_floors === "") {
        updateData.number_of_floors = null;
      } else {
        const floors = parseInt(number_of_floors);
        if (isNaN(floors) || floors <= 0) {
          throw new Error("number_of_floors must be a positive number");
        }
        updateData.number_of_floors = floors;
      }
    }

    // Total area
    if (total_area !== undefined) {
      if (total_area === null || total_area === "") {
        updateData.total_area = null;
      } else {
        const area = parseFloat(total_area);
        if (isNaN(area) || area <= 0) {
          throw new Error("total_area must be a positive number");
        }
        updateData.total_area = area;
      }
    }

    // Electric unit price
    if (electric_unit_price !== undefined) {
      const newValue =
        electric_unit_price === "" || electric_unit_price === null
          ? null
          : parseFloat(electric_unit_price);

      if (newValue !== existingBuilding.electric_unit_price) {
        billingChanges.push(
          `💡 Tiền điện: ${existingBuilding.electric_unit_price ?? "—"} → ${
            newValue ?? "—"
          }`
        );
      }

      updateData.electric_unit_price = newValue;
    }

    // Water unit price
    if (water_unit_price !== undefined) {
      const newValue =
        water_unit_price === "" || water_unit_price === null
          ? null
          : parseFloat(water_unit_price);

      if (newValue !== existingBuilding.water_unit_price) {
        billingChanges.push(
          `🚿 Tiền nước: ${existingBuilding.water_unit_price ?? "—"} → ${
            newValue ?? "—"
          }`
        );
      }

      updateData.water_unit_price = newValue;
    }

    // Service fee
    if (service_fee !== undefined) {
      const newValue =
        service_fee === "" || service_fee === null
          ? null
          : parseFloat(service_fee);

      if (newValue !== existingBuilding.service_fee) {
        billingChanges.push(
          `🧾 Phí dịch vụ: ${existingBuilding.service_fee ?? "—"} → ${
            newValue ?? "—"
          }`
        );
      }

      updateData.service_fee = newValue;
    }

    // Bill due day
    if (bill_due_day !== undefined) {
      const newValue =
        bill_due_day === "" || bill_due_day === null
          ? null
          : parseInt(bill_due_day);

      if (newValue !== existingBuilding.bill_due_day) {
        billingChanges.push(
          `📅 Ngày thanh toán: ${existingBuilding.bill_due_day ?? "—"} → ${
            newValue ?? "—"
          }`
        );
      }

      updateData.bill_due_day = newValue;
    }

    // ✅ MAX 4-WHEEL SLOT
    if (max_4_wheel_slot !== undefined) {
      if (max_4_wheel_slot === "" || max_4_wheel_slot === null) {
        updateData.max_4_wheel_slot = null;
      } else {
        const value = parseInt(max_4_wheel_slot);
        if (isNaN(value) || value < 0) {
          throw new Error("max_4_wheel_slot must be a non-negative integer");
        }
        updateData.max_4_wheel_slot = value;
      }
    }

    // ✅ MAX 2-WHEEL SLOT
    if (max_2_wheel_slot !== undefined) {
      if (max_2_wheel_slot === "" || max_2_wheel_slot === null) {
        updateData.max_2_wheel_slot = null;
      } else {
        const value = parseInt(max_2_wheel_slot);
        if (isNaN(value) || value < 0) {
          throw new Error("max_2_wheel_slot must be a non-negative integer");
        }
        updateData.max_2_wheel_slot = value;
      }
    }

    // Active status
    if (is_active !== undefined) {
      updateData.is_active = is_active === true || is_active === "true";
    }

    // 4️⃣ Update building
    const building = await prisma.buildings.update({
      where: { building_id: buildingId },
      data: updateData,
    });

    // 5️⃣ Send notification if billing-related fields changed
    if (billingChanges.length > 0) {
      const title = `Cập nhật chi phí tòa nhà ${existingBuilding.name}`;
      const body =
        `Các thông tin sau đã được cập nhật:\n\n` + billingChanges.join("\n");

      await NotificationService.createBroadcastNotification(
        senderId,
        title,
        body,
        {
          building_id: buildingId,
          type: "BUILDING_BILLING_UPDATE",
        }
      );
    }

    // console.log("🔥 UPDATED BUILDING:", building);

    return this.formatBuildingResponse(building);
  }

  // DELETE - Vô hiệu hóa tòa nhà (soft delete)
  async deactivateBuilding(buildingId) {
    const building = await prisma.buildings.findUnique({
      where: { building_id: buildingId },
    });

    if (!building) {
      throw new Error("Building not found");
    }

    if (!building.is_active) {
      throw new Error("Building is already inactive");
    }

    // Kiểm tra có phòng đang hoạt động không
    const activeRooms = await prisma.rooms.count({
      where: {
        building_id: buildingId,
        is_active: true,
      },
    });

    if (activeRooms > 0) {
      throw new Error("Cannot deactivate building with active rooms");
    }

    await prisma.buildings.update({
      where: { building_id: buildingId },
      data: {
        is_active: false,
        updated_at: new Date(),
      },
    });

    return { success: true, message: "Building deactivated successfully" };
  }

  // ACTIVATE - Kích hoạt lại tòa nhà
  async activateBuilding(buildingId) {
    const building = await prisma.buildings.findUnique({
      where: { building_id: buildingId },
    });

    if (!building) {
      throw new Error("Building not found");
    }

    if (building.is_active) {
      throw new Error("Building is already active");
    }

    const activated = await prisma.buildings.update({
      where: { building_id: buildingId },
      data: {
        is_active: true,
        updated_at: new Date(),
      },
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
        floor_plans: true,
      },
    });

    if (!building) {
      throw new Error("Building not found");
    }

    // Kiểm tra có dữ liệu liên quan không
    if (building.rooms.length > 0) {
      throw new Error("Cannot delete building with existing rooms");
    }

    if (building.regulations.length > 0) {
      throw new Error("Cannot delete building with existing regulations");
    }

    if (building.floor_plans.length > 0) {
      throw new Error("Cannot delete building with existing floor plans");
    }

    // Xóa building managers trước (nếu có)
    if (building.building_managers.length > 0) {
      await prisma.building_managers.deleteMany({
        where: { building_id: buildingId },
      });
    }

    // Xóa building
    await prisma.buildings.delete({
      where: { building_id: buildingId },
    });

    return { success: true, message: "Building permanently deleted" };
  }

  // GET MANAGERS - Lấy danh sách building managers
  async getBuildingManagers(buildingId, filters = {}) {
    const { page = 1, limit = 20, is_active } = filters;

    // Verify building exists
    const building = await prisma.buildings.findUnique({
      where: { building_id: buildingId },
    });

    if (!building) {
      throw new Error("Building not found");
    }

    const skip = (page - 1) * limit;
    const where = { building_id: buildingId };

    // Filter by active status (assigned_to is null or in future)
    if (is_active !== undefined) {
      const isActiveFilter = is_active === "true" || is_active === true;
    }
    // console.log("🔥 RUNNING getBuildingManagers WITH USER INCLUDE");

    const [managers, total] = await Promise.all([
      prisma.building_managers.findMany({
        where,
        include: {
          user: {
            select: {
              user_id: true,
              full_name: true,
              email: true,
              phone: true,
              avatar_url: true,
              status: true,
              role: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: { manager_id: "desc" },
      }),
      prisma.building_managers.count({ where }),
    ]);

    return {
      data: managers.map((m) => this.formatManagerResponse(m)),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  // ASSIGN MANAGER - Gán manager cho tòa nhà
  async assignManager(buildingId, data) {
    const { user_id, note } = data;

    // Validate required fields
    if (!user_id) {
      throw new Error("Missing required field: user_id");
    }

    const userId = parseInt(user_id);
    if (isNaN(userId)) {
      throw new Error("user_id must be a valid number");
    }

    // Verify building exists
    const building = await prisma.buildings.findUnique({
      where: { building_id: buildingId },
    });

    if (!building) {
      throw new Error("Building not found");
    }

    // Verify user exists and has MANAGER role
    const user = await prisma.users.findUnique({
      where: { user_id: userId },
    });

    if (!user) {
      throw new Error("User not found");
    }

    if (user.role !== "MANAGER") {
      throw new Error("User must have MANAGER role");
    }

    if (user.status !== "Active") {
      throw new Error("User is not active");
    }

    // Check if manager already assigned to this building
    const existingAssignment = await prisma.building_managers.findUnique({
      where: { user_id: userId },
    });

    if (existingAssignment) {
      if (existingAssignment.building_id === buildingId) {
        throw new Error("Manager already assigned to this building");
      } else {
        throw new Error("Manager is already assigned to another building");
      }
    }

    // Create assignment
    const assignment = await prisma.building_managers.create({
      data: {
        user_id: userId,
        building_id: buildingId,
        note: note || null,
      },
      include: {
        user: {
          select: {
            user_id: true,
            full_name: true,
            email: true,
            phone: true,
            avatar_url: true,
            status: true,
            role: true,
          },
        },
        building: {
          select: {
            building_id: true,
            name: true,
            address: true,
          },
        },
      },
    });

    return this.formatManagerAssignmentResponse(assignment);
  }

  // UPDATE MANAGER ASSIGNMENT - Cập nhật thông tin assignment
 async updateManagerAssignment(buildingId, userId, data) {
  const { note } = data;

  const userIdInt = Number(userId);
  const buildingIdInt = Number(buildingId);

  if (isNaN(userIdInt) || isNaN(buildingIdInt)) {
    throw new Error("user_id and building_id must be valid numbers");
  }

  // 1️⃣ Find assignment by USER
  const existingAssignment = await prisma.building_managers.findFirst({
    where: { user_id: userIdInt },
  });

  if (!existingAssignment) {
    throw new Error("Manager assignment not found");
  }

  // 2️⃣ Verify building exists
  const building = await prisma.buildings.findUnique({
    where: { building_id: buildingIdInt },
  });

  if (!building) {
    throw new Error("Building not found");
  }

  // 3️⃣ Prepare update
  const updateData = {
    building_id: buildingIdInt,
  };

  if (note !== undefined) {
    updateData.note = note || null;
  }

  // 4️⃣ Update assignment
  const updated = await prisma.building_managers.update({
    where: {
      manager_id: existingAssignment.manager_id,
    },
    data: updateData,
    include: {
      user: {
        select: {
          user_id: true,
          full_name: true,
          email: true,
          phone: true,
          avatar_url: true,
          status: true,
          role: true,
        },
      },
      building: {
        select: {
          building_id: true,
          name: true,
          address: true,
        },
      },
    },
  });

  return this.formatManagerAssignmentResponse(updated);
}

  // REMOVE MANAGER - Xóa manager khỏi tòa nhà
  async removeManager(buildingId, userId) {
    const userIdInt = parseInt(userId);
    if (isNaN(userIdInt)) {
      throw new Error("user_id must be a valid number");
    }

    // Verify assignment exists
    const assignment = await prisma.building_managers.findUnique({
      where: { user_id: userIdInt },
    });

    if (!assignment) {
      throw new Error("Manager assignment not found");
    }

    if (assignment.building_id !== buildingId) {
      throw new Error("Manager is not assigned to this building");
    }

    // Delete assignment
    await prisma.building_managers.delete({
      where: { user_id: userIdInt },
    });

    return {
      success: true,
      message: "Manager removed from building successfully",
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

      // 💰 Prices & fees
      electric_unit_price: building.electric_unit_price,
      water_unit_price: building.water_unit_price,
      service_fee: building.service_fee,
      bill_due_day: building.bill_due_day,

      // 🚗 Bãi xe (THÊM MỚI)
      max_4_wheel_slot: building.max_4_wheel_slot,
      max_2_wheel_slot: building.max_2_wheel_slot,

      managers:
        building.building_managers?.map((m) => ({
          user_id: m.user_id,
          // [FIX] m.users -> m.user
          full_name: m.user?.full_name || m.users?.full_name,
          email: m.user?.email || m.users?.email,
        })) || [],

      created_at: building.created_at,
      updated_at: building.updated_at,
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

      // ✅ ĐÃ CÓ
      electric_unit_price: building.electric_unit_price,
      water_unit_price: building.water_unit_price,

      // ✅ THÊM 2 TRƯỜNG MỚI
      service_fee: building.service_fee,
      bill_due_day: building.bill_due_day,

      total_rooms: building._count?.rooms || 0,
      total_regulations: building._count?.regulations || 0,
      total_floor_plans: building._count?.floor_plans || 0,

      managers:
        building.building_managers?.map((m) => ({
          user_id: m.user_id,
          // [FIX] m.users -> m.user
          full_name: m.user?.full_name || m.users?.full_name,
        })) || [],

      created_at: building.created_at,
      updated_at: building.updated_at,
    };
  }

  formatBuildingDetailResponse(building) {
    // console.log("RAW BUILDING FROM DB:", building);

    return {
      building_id: building.building_id,
      name: building.name,
      address: building.address,
      number_of_floors: building.number_of_floors,
      total_area: building.total_area,
      is_active: building.is_active,

      // ✅ GIÁ ĐIỆN / NƯỚC
      electric_unit_price: building.electric_unit_price,
      water_unit_price: building.water_unit_price,
      service_fee: building.service_fee,
      bill_due_day: building.bill_due_day,

      // ✅ THÊM 2 FIELD BÃI XE (MỚI)
      max_4_wheel_slot: building.max_4_wheel_slot,
      max_2_wheel_slot: building.max_2_wheel_slot,

      managers:
        building.building_managers?.map((m) => ({
          user_id: m.user_id,
          // [FIX] dùng m.user do query trên đã sửa thành include user
          full_name: m.user?.full_name,
          email: m.user?.email,
          phone: m.user?.phone,
          note: m.note,
        })) || [],

      rooms:
        building.rooms?.map((r) => ({
          room_id: r.room_id,
          room_number: r.room_number,
          floor: r.floor,
          size: r.size,
        })) || [],

      regulations:
        building.regulations?.map((r) => ({
          regulation_id: r.regulation_id,
          title: r.title,
          effective_date: r.effective_date,
          version: r.version,
        })) || [],

      floor_plans:
        building.floor_plans?.map((f) => ({
          plan_id: f.plan_id,
          name: f.name,
          floor_number: f.floor_number,
        })) || [],
    }; // [FIX] Đã đóng ngoặc return object
  } // [FIX] Đã đóng ngoặc function formatBuildingDetailResponse

  formatManagerResponse(manager) {
    return {
      user_id: manager.user_id,
      building_id: manager.building_id,

      // [FIX] manager.user
      full_name: manager.user?.full_name,
      email: manager.user?.email,
      phone: manager.user?.phone,
      avatar_url: manager.user?.avatar_url,
      user_status: manager.user?.status,
      role: manager.user?.role,
      note: manager.note,
    };
  }

  formatManagerAssignmentResponse(assignment) {
    return {
      user_id: assignment.user_id,
      building_id: assignment.building_id,
      building_name: assignment.building?.name,
      building_address: assignment.building?.address,
      manager_info: {
        // [FIX] assignment.users -> assignment.user
        full_name: assignment.user?.full_name || assignment.users?.full_name,
        email: assignment.user?.email || assignment.users?.email,
        phone: assignment.user?.phone || assignment.users?.phone,
        avatar_url: assignment.user?.avatar_url || assignment.users?.avatar_url,
        status: assignment.user?.status || assignment.users?.status,
        role: assignment.user?.role || assignment.users?.role,
      },
      note: assignment.note,
    };
  }

  async getMyBuildingDetails(tenantUserId) {
    // 1. Tìm tất cả hợp đồng ACTIVE của tenant này
    const activeContracts = await prisma.contracts.findMany({
      where: {
        tenant_user_id: tenantUserId,
        status: 'active', // Chỉ lấy hợp đồng đang hiệu lực
        deleted_at: null
      },
      include: {
        room_history: { // Relation defined in schema: contract -> room
          include: {
            building: {
              select: {
                building_id: true,
                name: true,
                electric_unit_price: true,
                water_unit_price: true,
                service_fee: true,
                bill_due_day: true
              }
            }
          }
        }
      }
    });

    // 2. Lọc ra danh sách tòa nhà duy nhất (tránh trùng lặp nếu thuê 2 phòng cùng tòa)
    const uniqueBuildingsMap = new Map();

    activeContracts.forEach(contract => {
      const building = contract.room_history?.building;
      if (building && !uniqueBuildingsMap.has(building.building_id)) {
        uniqueBuildingsMap.set(building.building_id, {
          building_id: building.building_id,
          building_name: building.name,
          electric_unit_price: building.electric_unit_price,
          water_unit_price: building.water_unit_price,
          service_fee: building.service_fee,
          bill_due_day: building.bill_due_day
        });
      }
    });

    // 3. Convert Map values to Array
    return Array.from(uniqueBuildingsMap.values());
  }

  async getBuildingContactsForTenant(tenantUserId) {
    // 1. Tìm các tòa nhà mà tenant đang có hợp đồng Active
    const activeContracts = await prisma.contracts.findMany({
      where: {
        tenant_user_id: tenantUserId,
        status: 'active',
        deleted_at: null
      },
      include: {
        room_history: {
          include: {
            building: {
              select: { building_id: true, name: true }
            }
          }
        }
      }
    });

    // Lấy danh sách ID tòa nhà duy nhất
    const uniqueBuildingIds = new Set();
    const buildingsMap = new Map(); // Để lưu tên tòa nhà

    activeContracts.forEach(c => {
      const b = c.room_history?.building;
      if (b) {
        uniqueBuildingIds.add(b.building_id);
        buildingsMap.set(b.building_id, b.name);
      }
    });

    // 2. Lấy thông tin Owner (Global - Lấy tất cả user có role OWNER)
    const owners = await prisma.users.findMany({
      where: {
        role: 'OWNER',
        status: 'Active',
        deleted_at: null
      },
      select: {
        user_id: true,
        full_name: true,
        gender: true,
        phone: true,
        email: true,
        avatar_url: true
      }
    });

    const formattedOwners = owners.map(o => ({
      ...o,
      role: 'OWNER' // Gán nhãn để FE hiển thị
    }));

    // 3. Loop qua từng tòa nhà để lấy Manager cụ thể
    const results = [];

    for (const buildingId of uniqueBuildingIds) {
      // Tìm Manager được gán cho tòa này
      const managers = await prisma.building_managers.findMany({
        where: { building_id: buildingId },
        include: {
          user: {
            select: {
              user_id: true,
              full_name: true,
              gender: true,
              phone: true,
              email: true,
              avatar_url: true
            }
          }
        }
      });

      const formattedManagers = managers.map(m => ({
        user_id: m.user.user_id,
        full_name: m.user.full_name,
        gender: m.user.gender,
        phone: m.user.phone,
        email: m.user.email,
        avatar_url: m.user.avatar_url,
        role: 'MANAGER'
      }));

      results.push({
        building_id: buildingId,
        building_name: buildingsMap.get(buildingId),
        contacts: [...formattedOwners, ...formattedManagers] // Gộp Owner + Manager
      });
    }

    return results;
  }

} // [FIX] Đã đóng ngoặc Class

module.exports = new BuildingService();
