// Updated: 2025-12-22
// by: DatNB
const prisma = require("../config/prisma");

class FloorPlanService {
  // Helper: Kiểm tra quyền truy cập building
  async checkBuildingAccess(userId, userRole, buildingId) {
    // Owner có toàn quyền
    if (userRole === "OWNER") {
      return true;
    }

    // Manager chỉ có quyền với building họ quản lý
    if (userRole === "MANAGER") {
      const manager = await prisma.building_managers.findFirst({
        where: {
          user_id: userId,
          building_id: buildingId,
        },
      });
      return !!manager;
    }

    // Các role khác không có quyền
    return false;
  }

  // Helper: Kiểm tra quyền với floor plan cụ thể
  async checkFloorPlanAccess(userId, userRole, planId) {
    const floorPlan = await prisma.floor_plans.findUnique({
      where: { plan_id: planId },
      select: { building_id: true },
    });

    if (!floorPlan) {
      throw new Error("Floor plan not found");
    }

    return await this.checkBuildingAccess(
      userId,
      userRole,
      floorPlan.building_id
    );
  }

  // Helper: Trích xuất rooms từ layout
  extractRoomsFromLayout(layout, building_id, floor_number) {
    if (!layout || !Array.isArray(layout.nodes)) return [];

    return layout.nodes
      .filter(
        (node) =>
          node.type === "block" &&
          node.data?.icon === "room" &&
          node.data?.room_number
      )
      .map((node) => ({
        building_id,
        floor: floor_number,
        room_number: String(node.data.room_number ?? "").trim(),
        size: node.data.size || null,
        description: node.data.description || null,
        status: "available",
        is_active: true,
      }));
  }

  // CREATE - Tạo floor plan mới
  async createFloorPlan(data, createdBy, userRole) {
    const {
      building_id,
      name,
      floor_number,
      layout,
      file_url,
      is_published,
      note,
    } = data;

    // Validate required fields
    if (!building_id) {
      throw new Error("Missing required field: building_id");
    }

    if (!createdBy) {
      throw new Error("Missing required field: created_by");
    }

    const buildingId = parseInt(building_id);
    if (isNaN(buildingId)) {
      throw new Error("building_id must be a valid number");
    }

    // Kiểm tra quyền truy cập
    const hasAccess = await this.checkBuildingAccess(
      createdBy,
      userRole,
      buildingId
    );
    if (!hasAccess) {
      throw new Error(
        "Access denied: You do not have permission to create floor plans for this building"
      );
    }

    // Kiểm tra building tồn tại
    const building = await prisma.buildings.findUnique({
      where: { building_id: buildingId },
    });

    if (!building) {
      throw new Error("Building not found");
    }

    if (!building.is_active) {
      throw new Error("Cannot create floor plan for inactive building");
    }

    // Validate floor_number
    let floorNum = null;
    if (floor_number !== undefined && floor_number !== null) {
      const floor = parseInt(floor_number);
      if (isNaN(floor)) {
        throw new Error("floor_number must be a valid number");
      }
      floorNum = floor;
    }

    // Kiểm tra xem đã có floor plan cho building và floor này chưa
    const existingPlan = await prisma.floor_plans.findFirst({
      where: {
        building_id: buildingId,
        floor_number: floorNum,
      },
    });

    if (existingPlan) {
      throw new Error(
        `Floor plan already exists for building ${buildingId}, floor ${floorNum}`
      );
    }

    // Sử dụng transaction để tạo floor plan và rooms
    return await prisma.$transaction(async (tx) => {
      // 1️⃣ Tạo floor plan
      const floorPlan = await tx.floor_plans.create({
        data: {
          building_id: buildingId,
          name: name?.trim() || null,
          floor_number: floorNum,
          layout: layout || null,
          file_url: file_url?.trim() || null,
          is_published: is_published === true || is_published === "true",
          created_by: createdBy,
          note: note?.trim() || null,
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
          users: {
            select: {
              user_id: true,
              full_name: true,
              email: true,
            },
          },
        },
      });

      // 2️⃣ Trích xuất rooms từ layout
      const roomsToCreate = this.extractRoomsFromLayout(
        layout,
        buildingId,
        floorNum
      );

      // 3️⃣ Tạo rooms (nếu có)
      if (roomsToCreate.length > 0) {
        await tx.rooms.createMany({
          data: roomsToCreate,
          skipDuplicates: true,
        });
      }

      return this.formatFloorPlanResponse(floorPlan);
    });
  }

  // READ - Lấy thông tin floor plan theo ID
  async getFloorPlanById(planId) {
    const floorPlan = await prisma.floor_plans.findUnique({
      where: { plan_id: planId },
      include: {
        buildings: {
          select: {
            building_id: true,
            name: true,
            address: true,
            number_of_floors: true,
          },
        },
        users: { select: { user_id: true, full_name: true, email: true } },
      },
    });

    if (!floorPlan) throw new Error("Floor plan not found");

    // ✅ Enrich layout: attach room_id from DB
    const layoutObj = floorPlan.layout || {};
    const nodes = Array.isArray(layoutObj.nodes) ? layoutObj.nodes : [];

    // Lấy rooms theo building + floor
    const rooms = await prisma.rooms.findMany({
      where: {
        building_id: floorPlan.building_id,
        floor: floorPlan.floor_number,
        is_active: true,
      },
      select: { room_id: true, room_number: true, size: true },
    });

    const mapByRoomNumber = new Map(
      rooms.map((r) => [String(r.room_number).trim(), r])
    );

    const enrichedNodes = nodes.map((n) => {
      const rn = String(n?.data?.room_number ?? "").trim();
      const matched = mapByRoomNumber.get(rn);

      // chỉ gắn cho node phòng (có room_number)
      if (!rn) return n;

      return {
        ...n,
        data: {
          ...n.data,
          room_id: n.data?.room_id ?? matched?.room_id ?? null,
          // nếu node chưa có size thì lấy từ DB
          size: n.data?.size ?? matched?.size ?? null,
        },
      };
    });

    floorPlan.layout = { ...layoutObj, nodes: enrichedNodes };

    return this.formatFloorPlanDetailResponse(floorPlan);
  }

  // READ - Lấy danh sách floor plans (có phân trang và filter)
  async getFloorPlans(filters = {}, userId, userRole) {
    const {
      building_id,
      floor_number,
      is_published,
      page = 1,
      limit = 20,
    } = filters;

    const skip = (page - 1) * limit;
    const where = {};

    // Nếu là Manager, chỉ lấy floor plans của các building họ quản lý
    if (userRole === "MANAGER") {
      const managedBuildings = await prisma.building_managers.findMany({
        where: { user_id: userId },
        select: { building_id: true },
      });

      if (managedBuildings.length === 0) {
        return {
          data: [],
          pagination: { total: 0, page, limit, pages: 0 },
        };
      }

      where.building_id = {
        in: managedBuildings.map((b) => b.building_id),
      };
    }

    if (building_id) {
      const buildingId = parseInt(building_id);
      if (!isNaN(buildingId)) {
        // Nếu đã có filter building_id từ where (Manager), merge với filter từ query
        if (where.building_id && where.building_id.in) {
          if (!where.building_id.in.includes(buildingId)) {
            // Manager không quản lý building này
            return {
              data: [],
              pagination: { total: 0, page, limit, pages: 0 },
            };
          }
        }
        where.building_id = buildingId;
      }
    }

    if (floor_number !== undefined && floor_number !== "") {
      const floor = parseInt(floor_number);
      if (!isNaN(floor)) {
        where.floor_number = floor;
      }
    }

    if (is_published !== undefined) {
      where.is_published = is_published === "true" || is_published === true;
    }

    const [floorPlans, total] = await Promise.all([
      prisma.floor_plans.findMany({
        where,
        include: {
          buildings: {
            select: {
              building_id: true,
              name: true,
              address: true,
            },
          },
          users: {
            select: {
              user_id: true,
              full_name: true,
              email: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: [{ building_id: "asc" }, { floor_number: "asc" }],
      }),
      prisma.floor_plans.count({ where }),
    ]);

    return {
      data: floorPlans.map((fp) => this.formatFloorPlanListResponse(fp)),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  // READ - Lấy floor plans theo building
  async getFloorPlansByBuilding(buildingId, filters = {}, userId, userRole) {
    const { floor_number, is_published, page = 1, limit = 20 } = filters;

    // Kiểm tra quyền truy cập building
    if (userRole === "MANAGER") {
      const hasAccess = await this.checkBuildingAccess(
        userId,
        userRole,
        buildingId
      );
      if (!hasAccess) {
        throw new Error(
          "Access denied: You do not have permission to view floor plans for this building"
        );
      }
    }

    // Verify building exists
    const building = await prisma.buildings.findUnique({
      where: { building_id: buildingId },
    });

    if (!building) {
      throw new Error("Building not found");
    }

    const skip = (page - 1) * limit;
    const where = { building_id: buildingId };

    if (floor_number !== undefined && floor_number !== "") {
      const floor = parseInt(floor_number);
      if (!isNaN(floor)) {
        where.floor_number = floor;
      }
    }

    if (is_published !== undefined) {
      where.is_published = is_published === "true" || is_published === true;
    }

    const [floorPlans, total] = await Promise.all([
      prisma.floor_plans.findMany({
        where,
        include: {
          users: {
            select: {
              user_id: true,
              full_name: true,
              email: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: [{ floor_number: "asc" }],
      }),
      prisma.floor_plans.count({ where }),
    ]);

    return {
      data: floorPlans.map((fp) => this.formatFloorPlanListResponse(fp)),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  // UPDATE - Cập nhật floor plan
  async updateFloorPlan(planId, data, userId, userRole) {
    const { name, layout, file_url, is_published, note } = data;

    // Verify floor plan exists
    const existingPlan = await prisma.floor_plans.findUnique({
      where: { plan_id: planId },
    });

    if (!existingPlan) {
      throw new Error("Floor plan not found");
    }

    // Kiểm tra quyền truy cập
    const hasAccess = await this.checkFloorPlanAccess(userId, userRole, planId);
    if (!hasAccess) {
      throw new Error(
        "Access denied: You do not have permission to update this floor plan"
      );
    }

    // Sử dụng transaction để update floor plan và sync rooms
    return await prisma.$transaction(async (tx) => {
      // Prepare update data
      const updateData = {
        updated_at: new Date(),
      };

      if (name !== undefined) {
        updateData.name = name?.trim() || null;
      }

      if (layout !== undefined) {
        updateData.layout = layout || null;
      }

      if (file_url !== undefined) {
        updateData.file_url = file_url?.trim() || null;
      }

      if (is_published !== undefined) {
        updateData.is_published =
          is_published === "true" || is_published === true;
      }

      if (note !== undefined) {
        updateData.note = note?.trim() || null;
      }

      // 1️⃣ Update floor plan
      const floorPlan = await tx.floor_plans.update({
        where: { plan_id: planId },
        data: updateData,
        include: {
          buildings: {
            select: {
              building_id: true,
              name: true,
              address: true,
            },
          },
          users: {
            select: {
              user_id: true,
              full_name: true,
              email: true,
            },
          },
        },
      });

      // 2️⃣ Nếu layout được update, sync rooms
      if (layout !== undefined) {
        const layoutObj = layout || {};
        const nodes = Array.isArray(layoutObj.nodes) ? layoutObj.nodes : [];

        // rooms trong layout (chỉ node có room_number)
        const layoutRooms = nodes
          .map((n) => ({
            __nodeRef: n,
            room_id: n?.data?.room_id ? parseInt(n.data.room_id) : null,
            room_number: String(n?.data?.room_number ?? "").trim(),
            size: n?.data?.size ?? null,
            floor: existingPlan.floor_number,
            building_id: existingPlan.building_id,
          }))
          .filter((x) => x.room_number);

        // rooms hiện có trong DB theo building+floor
        const dbRooms = await tx.rooms.findMany({
          where: {
            building_id: existingPlan.building_id,
            floor: existingPlan.floor_number,
            is_active: true,
          },
          select: { room_id: true, room_number: true, size: true },
        });

        const dbById = new Map(dbRooms.map((r) => [r.room_id, r]));
        const dbByNumber = new Map(
          dbRooms.map((r) => [String(r.room_number).trim(), r])
        );

        // A) UPSERT theo layout
        for (const r of layoutRooms) {
          const found =
            (r.room_id && dbById.get(r.room_id)) ||
            dbByNumber.get(r.room_number);

          if (!found) {
            // create mới
            const created = await tx.rooms.create({
              data: {
                building_id: r.building_id,
                floor: r.floor,
                room_number: r.room_number,
                size: r.size,
                status: "available",
                is_active: true,
                created_at: new Date(),
                updated_at: new Date(),
              },
              select: { room_id: true },
            });

            // 🔥 GẮN NGƯỢC room_id VÀO NODE
            r.room_id = created.room_id;
          } else {
            // update name/size nếu đổi (nhưng phải check vacant)
            const needUpdate =
              String(found.room_number).trim() !== r.room_number ||
              (found.size || null) !== (r.size || null);

            if (needUpdate) {
              // check vacant: không tenant + không active contract
              const [tenantCount, activeContractCount] = await Promise.all([
                tx.tenants.count({ where: { room_id: found.room_id } }),
                tx.contracts.count({
                  where: {
                    room_id: found.room_id,
                    status: "active",
                    deleted_at: null,
                  },
                }),
              ]);

              if (tenantCount > 0 || activeContractCount > 0) {
                throw new Error(
                  "Chỉ được sửa phòng khi phòng không có người ở."
                );
              }

              await tx.rooms.update({
                where: { room_id: found.room_id },
                data: {
                  room_number: r.room_number,
                  size: r.size,
                  updated_at: new Date(),
                },
              });
            }
          }
        }

        // B) DELETE/DEACTIVATE các room bị xóa khỏi layout
        const layoutRoomIds = new Set(
          layoutRooms
            .map((x) => x.room_id)
            .filter(Boolean)
            .map((v) => parseInt(v))
        );
        const layoutRoomNumbers = new Set(
          layoutRooms.map((x) => x.room_number)
        );

        for (const db of dbRooms) {
          const stillExists =
            (db.room_id && layoutRoomIds.has(db.room_id)) ||
            layoutRoomNumbers.has(String(db.room_number).trim());

          if (stillExists) continue;

          // check vacant
          const [tenantCount, activeContractCount] = await Promise.all([
            tx.tenants.count({ where: { room_id: db.room_id } }),
            tx.contracts.count({
              where: {
                room_id: db.room_id,
                status: "active",
                deleted_at: null,
              },
            }),
          ]);

          if (tenantCount > 0 || activeContractCount > 0) {
            throw new Error("Chỉ được xóa phòng khi phòng không có người ở.");
          }

          // OWNER: xóa vĩnh viễn, MANAGER: soft delete (an toàn dữ liệu)
          if ((userRole || "").toUpperCase() === "OWNER") {
            await tx.rooms.delete({ where: { room_id: db.room_id } });
          } else {
            await tx.rooms.update({
              where: { room_id: db.room_id },
              data: {
                is_active: false,
                status: "available",
                updated_at: new Date(),
              },
            });
          }
        }
      }

      await tx.floor_plans.update({
        where: { plan_id: planId },
        data: {
          layout: {
            ...layout,
            nodes: layoutRooms.map((r) => ({
              ...r.__nodeRef, // xem lưu node gốc bên dưới
              data: {
                ...r.__nodeRef.data,
                room_id: r.room_id,
                room_number: r.room_number,
                size: r.size,
              },
            })),
          },
          updated_at: new Date(),
        },
      });

      return this.formatFloorPlanResponse(floorPlan);
    });
  }

  // PUBLISH - Publish floor plan
  async publishFloorPlan(planId, userId, userRole) {
    const floorPlan = await prisma.floor_plans.findUnique({
      where: { plan_id: planId },
    });

    if (!floorPlan) {
      throw new Error("Floor plan not found");
    }

    // Kiểm tra quyền truy cập
    const hasAccess = await this.checkFloorPlanAccess(userId, userRole, planId);
    if (!hasAccess) {
      throw new Error(
        "Access denied: You do not have permission to publish this floor plan"
      );
    }

    if (floorPlan.is_published) {
      throw new Error("Floor plan is already published");
    }

    const published = await prisma.floor_plans.update({
      where: { plan_id: planId },
      data: {
        is_published: true,
        updated_at: new Date(),
      },
      include: {
        buildings: {
          select: {
            building_id: true,
            name: true,
          },
        },
        users: {
          select: {
            user_id: true,
            full_name: true,
          },
        },
      },
    });

    return this.formatFloorPlanResponse(published);
  }

  // UNPUBLISH - Unpublish floor plan
  async unpublishFloorPlan(planId, userId, userRole) {
    const floorPlan = await prisma.floor_plans.findUnique({
      where: { plan_id: planId },
    });

    if (!floorPlan) {
      throw new Error("Floor plan not found");
    }

    // Kiểm tra quyền truy cập
    const hasAccess = await this.checkFloorPlanAccess(userId, userRole, planId);
    if (!hasAccess) {
      throw new Error(
        "Access denied: You do not have permission to unpublish this floor plan"
      );
    }

    if (!floorPlan.is_published) {
      throw new Error("Floor plan is already unpublished");
    }

    const unpublished = await prisma.floor_plans.update({
      where: { plan_id: planId },
      data: {
        is_published: false,
        updated_at: new Date(),
      },
      include: {
        buildings: {
          select: {
            building_id: true,
            name: true,
          },
        },
        users: {
          select: {
            user_id: true,
            full_name: true,
          },
        },
      },
    });

    return this.formatFloorPlanResponse(unpublished);
  }

  // DELETE - Xóa floor plan
  async deleteFloorPlan(planId, userId, userRole) {
    const floorPlan = await prisma.floor_plans.findUnique({
      where: { plan_id: planId },
    });

    if (!floorPlan) {
      throw new Error("Floor plan not found");
    }

    // Kiểm tra quyền truy cập
    const hasAccess = await this.checkFloorPlanAccess(userId, userRole, planId);
    if (!hasAccess) {
      throw new Error(
        "Access denied: You do not have permission to delete this floor plan"
      );
    }

    if (floorPlan.is_published) {
      throw new Error("Cannot delete published floor plan. Unpublish it first");
    }

    await prisma.floor_plans.delete({
      where: { plan_id: planId },
    });

    return { success: true, message: "Floor plan deleted successfully" };
  }

  // STATISTICS - Thống kê floor plans
  async getFloorPlanStatistics(buildingId, userId, userRole) {
    // Kiểm tra quyền truy cập building
    if (userRole === "MANAGER") {
      const hasAccess = await this.checkBuildingAccess(
        userId,
        userRole,
        buildingId
      );
      if (!hasAccess) {
        throw new Error(
          "Access denied: You do not have permission to view statistics for this building"
        );
      }
    }

    const building = await prisma.buildings.findUnique({
      where: { building_id: buildingId },
    });

    if (!building) {
      throw new Error("Building not found");
    }

    const [totalPlans, publishedPlans, unpublishedPlans, uniqueFloors] =
      await Promise.all([
        prisma.floor_plans.count({
          where: { building_id: buildingId },
        }),
        prisma.floor_plans.count({
          where: {
            building_id: buildingId,
            is_published: true,
          },
        }),
        prisma.floor_plans.count({
          where: {
            building_id: buildingId,
            is_published: false,
          },
        }),
        prisma.floor_plans.findMany({
          where: { building_id: buildingId },
          select: { floor_number: true },
          distinct: ["floor_number"],
        }),
      ]);

    return {
      building_id: buildingId,
      building_name: building.name,
      total_plans: totalPlans,
      published_plans: publishedPlans,
      unpublished_plans: unpublishedPlans,
      total_floors_with_plans: uniqueFloors.length,
    };
  }

  // Helper functions - Format response
  formatFloorPlanResponse(floorPlan) {
    return {
      plan_id: floorPlan.plan_id,
      building_id: floorPlan.building_id,
      building_name: floorPlan.buildings?.name,
      building_address: floorPlan.buildings?.address,
      name: floorPlan.name,
      floor_number: floorPlan.floor_number,
      layout: floorPlan.layout,
      file_url: floorPlan.file_url,
      is_published: floorPlan.is_published,
      created_by: {
        user_id: floorPlan.users?.user_id,
        full_name: floorPlan.users?.full_name,
        email: floorPlan.users?.email,
      },
      note: floorPlan.note,
      created_at: floorPlan.created_at,
      updated_at: floorPlan.updated_at,
    };
  }

  formatFloorPlanListResponse(floorPlan) {
    return {
      plan_id: floorPlan.plan_id,
      building_id: floorPlan.building_id,
      building_name: floorPlan.buildings?.name,
      name: floorPlan.name,
      floor_number: floorPlan.floor_number,
      is_published: floorPlan.is_published,
      created_by: {
        user_id: floorPlan.users?.user_id,
        full_name: floorPlan.users?.full_name,
      },
      created_at: floorPlan.created_at,
      updated_at: floorPlan.updated_at,
    };
  }

  formatFloorPlanDetailResponse(floorPlan) {
    return {
      plan_id: floorPlan.plan_id,
      building: {
        building_id: floorPlan.buildings?.building_id,
        name: floorPlan.buildings?.name,
        address: floorPlan.buildings?.address,
        number_of_floors: floorPlan.buildings?.number_of_floors,
      },
      name: floorPlan.name,
      floor_number: floorPlan.floor_number,
      layout: floorPlan.layout,
      file_url: floorPlan.file_url,
      is_published: floorPlan.is_published,
      created_by: {
        user_id: floorPlan.users?.user_id,
        full_name: floorPlan.users?.full_name,
        email: floorPlan.users?.email,
      },
      note: floorPlan.note,
      created_at: floorPlan.created_at,
      updated_at: floorPlan.updated_at,
    };
  }
}

module.exports = new FloorPlanService();
