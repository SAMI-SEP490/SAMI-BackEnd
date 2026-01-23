// Updated: 2025-01-10
// by: DatNB (Fixed by Gemini)

const prisma = require("../config/prisma");
const NotificationService = require("./notification.service");

class BuildingService {
  // CREATE - Tạo tòa nhà mới
  async createBuilding(data) {
    const { name, address, number_of_floors, total_area, bill_closing_day } =
      data;

    // ===== VALIDATE NAME =====
    if (!name || !name.trim()) {
      throw new Error("Missing required field: name");
    }

    const normalizedName = name.trim();

    return await prisma.$transaction(async (tx) => {
      // ===== CHECK TRÙNG TÊN (BUILDING ĐANG ACTIVE) =====
      const existingBuilding = await tx.buildings.findFirst({
        where: {
          is_active: true,
          name: {
            equals: normalizedName,
            mode: "insensitive",
          },
        },
        select: { building_id: true },
      });

      if (existingBuilding) {
        throw new Error("Building with this name already exists");
      }

      // ===== VALIDATE number_of_floors =====
      let parsedFloors = null;
      if (number_of_floors !== undefined && number_of_floors !== null) {
        parsedFloors = Number.parseInt(number_of_floors, 10);
        if (!Number.isInteger(parsedFloors) || parsedFloors <= 0) {
          throw new Error("number_of_floors must be a positive integer");
        }
      }

      // ===== VALIDATE total_area =====
      let parsedArea = null;
      if (total_area !== undefined && total_area !== null) {
        parsedArea = Number.parseFloat(total_area);
        if (Number.isNaN(parsedArea) || parsedArea <= 0) {
          throw new Error("total_area must be a positive number");
        }
      }

      // ===== VALIDATE bill_closing_day (1–28) =====
      let parsedClosingDay = null;
      if (bill_closing_day !== undefined && bill_closing_day !== null) {
        parsedClosingDay = Number.parseInt(bill_closing_day, 10);
        if (
          !Number.isInteger(parsedClosingDay) ||
          parsedClosingDay < 1 ||
          parsedClosingDay > 28
        ) {
          throw new Error("bill_closing_day must be between 1 and 28");
        }
      }

      // ===== CREATE BUILDING =====
      const building = await tx.buildings.create({
        data: {
          name: normalizedName,
          address: address?.trim() || null,
          number_of_floors: parsedFloors,
          total_area: parsedArea,
          bill_closing_day: parsedClosingDay,

          // 👇 SET MẶC ĐỊNH SLOT XE
          max_2_wheel_slot: 0,
          max_4_wheel_slot: 0,

          is_active: true,
        },
      });

      // ===== FORMAT RESPONSE =====
      return this.formatBuildingResponse
        ? this.formatBuildingResponse(building)
        : building;
    });
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

    // ✅ Rule: chỉ cho phép sửa ngày chốt sổ nếu tòa nhà CHƯA có hợp đồng active
    const hasActiveContract = await prisma.contracts.findFirst({
      where: {
        status: "active",
        deleted_at: null,
        room_history: { building_id: buildingId },
      },
      select: { contract_id: true },
    });

    // attach flag for formatter
    building.can_edit_bill_closing_day = !hasActiveContract;

    // console.log("🔥🔥 RAW BUILDING FROM DB:", building);

    return this.formatBuildingDetailResponse(building);
  }

  // READ - Lấy danh sách tòa nhà (có phân trang và filter)
  async getBuildings(filters = {}) {
    let { name, address, is_active, page = 1, limit = 20 } = filters;

    // Chuẩn hóa page & limit
    page = Number.parseInt(page, 10);
    limit = Number.parseInt(limit, 10);

    if (!Number.isInteger(page) || page < 1) page = 1;
    if (!Number.isInteger(limit) || limit < 1) limit = 20;

    const skip = (page - 1) * limit;

    // Build điều kiện where
    const where = {};

    if (name?.trim()) {
      where.name = {
        contains: name.trim(),
        mode: "insensitive",
      };
    }

    if (address?.trim()) {
      where.address = {
        contains: address.trim(),
        mode: "insensitive",
      };
    }

    if (is_active !== undefined) {
      where.is_active =
        is_active === true || is_active === "true" ? true : false;
    }

    // Query song song
    const [buildings, total] = await Promise.all([
      prisma.buildings.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          created_at: "desc",
        },
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
              rooms: {
                where: { is_active: true },
              },
              regulations: true,
              floor_plans: true,
            },
          },
        },
      }),

      prisma.buildings.count({ where }),
    ]);

    return {
      data: buildings.map((building) =>
        this.formatBuildingListResponse(building),
      ),
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
    const assignments = await prisma.building_managers.findMany({
      where: { user_id: userId },
      include: {
        building: {
          select: {
            building_id: true,
            name: true,
            address: true,
            is_active: true,
            bill_closing_day: true,
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
      bill_closing_day: a.building.bill_closing_day,
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
      bill_closing_day,
      max_4_wheel_slot,
      max_2_wheel_slot,
    } = data;

    // console.log("🔥🔥🔥 RUNNING updateBuilding WITH DATA:", data);

    // 1️⃣ Verify building exists
    const existingBuilding = await prisma.buildings.findUnique({
      where: { building_id: buildingId },
    });
    const slotCounts = await prisma.parking_slots.groupBy({
      by: ["slot_type"],
      where: {
        building_id: buildingId,
      },
      _count: {
        slot_id: true,
      },
    });

    // Helper
    const countByType = (type) =>
      slotCounts.find(s => s.slot_type === type)?._count.slot_id || 0;

    const current2WheelSlots = countByType("two_wheeler");
    const current4WheelSlots = countByType("four_wheeler");
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
          `💡 Tiền điện: ${existingBuilding.electric_unit_price ?? "—"} → ${newValue ?? "—"
          }`,
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
          `🚿 Tiền nước: ${existingBuilding.water_unit_price ?? "—"} → ${newValue ?? "—"
          }`,
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
          `🧾 Phí dịch vụ: ${existingBuilding.service_fee ?? "—"} → ${newValue ?? "—"
          }`,
        );
      }

      updateData.service_fee = newValue;
    }


    // Bill closing day (1-28) - chỉ cho phép sửa nếu tòa nhà CHƯA có hợp đồng active
    if (bill_closing_day !== undefined) {
      const newValue =
        bill_closing_day === "" || bill_closing_day === null
          ? null
          : parseInt(bill_closing_day, 10);

      if (newValue !== null) {
        if (!Number.isInteger(newValue) || newValue < 1 || newValue > 28) {
          throw new Error("bill_closing_day must be between 1 and 28");
        }
      }

      // Chỉ kiểm tra nếu có thay đổi giá trị
      if (newValue !== existingBuilding.bill_closing_day) {
        const hasActiveContract = await prisma.contracts.findFirst({
          where: {
            status: "active",
            deleted_at: null,
            room_history: { building_id: buildingId },
          },
          select: { contract_id: true },
        });

        if (hasActiveContract) {
          throw new Error(
            "Không thể sửa ngày chốt sổ vì tòa nhà đang có hợp đồng active",
          );
        }

        billingChanges.push(
          `📅 Ngày chốt sổ: ${existingBuilding.bill_closing_day ?? "—"} → ${newValue ?? "—"}`,
        );

        updateData.bill_closing_day = newValue;
      }
    }

    if (max_4_wheel_slot !== undefined) {
      if (max_4_wheel_slot === "" || max_4_wheel_slot === null) {
        if (current4WheelSlots > 0) {
          throw new Error(
            `Không thể đặt số slot xe 4 bánh < ${current4WheelSlots} (đã tồn tại)`
          );
        }
        updateData.max_4_wheel_slot = 0;
      } else {
        const value = parseInt(max_4_wheel_slot);
        if (isNaN(value) || value < 0) {
          throw new Error("max_4_wheel_slot must be a non-negative integer");
        }

        if (value < current4WheelSlots) {
          throw new Error(
            `Số slot xe 4 bánh tối đa (${value}) không được nhỏ hơn số slot hiện có (${current4WheelSlots})`
          );
        }

        updateData.max_4_wheel_slot = value;
      }
    }
    if (max_2_wheel_slot !== undefined) {
      if (max_2_wheel_slot === "" || max_2_wheel_slot === null) {
        if (current2WheelSlots > 0) {
          throw new Error(
            `Không thể đặt số slot xe 2 bánh < ${current2WheelSlots} (đã tồn tại)`
          );
        }
        updateData.max_2_wheel_slot = 0;
      } else {
        const value = parseInt(max_2_wheel_slot);
        if (isNaN(value) || value < 0) {
          throw new Error("max_2_wheel_slot must be a non-negative integer");
        }

        if (value < current2WheelSlots) {
          throw new Error(
            `Số slot xe 2 bánh tối đa (${value}) không được nhỏ hơn số slot hiện có (${current2WheelSlots})`
          );
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
        },
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
      electric_unit_price: building.electric_unit_price,
      water_unit_price: building.water_unit_price,
      service_fee: building.service_fee,
      bill_closing_day: building.bill_closing_day,
      can_edit_bill_closing_day: building.can_edit_bill_closing_day ?? true,
      max_4_wheel_slot: building.max_4_wheel_slot,
      max_2_wheel_slot: building.max_2_wheel_slot,
      managers:
        building.building_managers?.map((m) => ({
          user_id: m.user_id,
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
      electric_unit_price: building.electric_unit_price,
      water_unit_price: building.water_unit_price,
      service_fee: building.service_fee,
      bill_closing_day: building.bill_closing_day,

      total_rooms: building._count?.rooms || 0,
      total_regulations: building._count?.regulations || 0,
      total_floor_plans: building._count?.floor_plans || 0,
      managers:
        building.building_managers?.map((m) => ({
          user_id: m.user_id,
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
      bill_closing_day: building.bill_closing_day,
      max_4_wheel_slot: building.max_4_wheel_slot,
      max_2_wheel_slot: building.max_2_wheel_slot,
      managers:
        building.building_managers?.map((m) => ({
          user_id: m.user_id,
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
    };
  }

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
    const uniqueBuildingsMap = new Map();

       const contracts = await prisma.contracts.findMany({
      where: {
        tenant_user_id: tenantUserId,
        status: "active",
        deleted_at: null,
      },
      select: {
        room_history: {
          select: {
            building: {
              select: {
                building_id: true, name: true, electric_unit_price: true,
                water_unit_price: true, service_fee: true, bill_closing_day: true,
              },
            },
          },
        },
      },
    });

    contracts.forEach(c => {
      const b = c.room_history?.building;
      if (b && !uniqueBuildingsMap.has(b.building_id)) {
        uniqueBuildingsMap.set(b.building_id, b);
      }
    });

    // 2. Tìm qua Room Tenants (Secondary Tenant)
    const residencies = await prisma.room_tenants.findMany({
      where: {
        tenant_user_id: tenantUserId,
        is_current: true, // Đang ở
      },
      select: {
        room: {
          select: {
            building: {
              select: {
                building_id: true, name: true, electric_unit_price: true,
                water_unit_price: true, service_fee: true, bill_closing_day: true,
              },
            },
          },
        },
      },
    });

    residencies.forEach(r => {
      const b = r.room?.building;
      if (b && !uniqueBuildingsMap.has(b.building_id)) {
        uniqueBuildingsMap.set(b.building_id, b);
      }
    });

    return Array.from(uniqueBuildingsMap.values());
  }
  async getBuildingContactsForTenant(tenantUserId) {
    const uniqueBuildingIds = new Set();
    const buildingsMap = new Map();

    // 1. Logic cho Primary Tenant (Qua Contract Active)
    const activeContracts = await prisma.contracts.findMany({
      where: {
        tenant_user_id: tenantUserId,
        status: "active",
        deleted_at: null,
      },
      include: {
        room_history: {
          include: { building: { select: { building_id: true, name: true } } },
        },
      },
    });

    activeContracts.forEach((c) => {
      const b = c.room_history?.building;
      if (b) {
        uniqueBuildingIds.add(b.building_id);
        buildingsMap.set(b.building_id, b.name);
      }
    });

    // 2. [NEW] Logic cho Secondary Tenant (Qua Room Tenants Active)
    const activeResidencies = await prisma.room_tenants.findMany({
      where: {
        tenant_user_id: tenantUserId,
        is_current: true
      },
      include: {
        room: {
          include: { building: { select: { building_id: true, name: true } } }
        }
      }
    });

    activeResidencies.forEach((r) => {
      const b = r.room?.building;
      if (b) {
        uniqueBuildingIds.add(b.building_id);
        buildingsMap.set(b.building_id, b.name);
      }
    });

    // 3. Lấy thông tin Owner (Global)
    const owners = await prisma.users.findMany({
      where: { role: "OWNER", status: "Active", deleted_at: null },
      select: { user_id: true, full_name: true, gender: true, phone: true, avatar_url: true },
    });
    const formattedOwners = owners.map((o) => ({ ...o, role: "OWNER" }));

    // 4. Lấy Manager cho từng tòa nhà tìm được
    const results = [];
    for (const buildingId of uniqueBuildingIds) {
      const managers = await prisma.building_managers.findMany({
        where: { building_id: buildingId },
        include: {
          user: {
            select: { user_id: true, full_name: true, gender: true, phone: true, avatar_url: true },
          },
        },
      });

      const formattedManagers = managers.map((m) => ({
        user_id: m.user.user_id,
        full_name: m.user.full_name,
        gender: m.user.gender,
        phone: m.user.phone,
        avatar_url: m.user.avatar_url,
        role: "MANAGER",
      }));

      results.push({
        building_id: buildingId,
        building_name: buildingsMap.get(buildingId),
        contacts: [...formattedOwners, ...formattedManagers],
      });
    }

    return results;
  }
} // [FIX] Đã đóng ngoặc Class

module.exports = new BuildingService();
