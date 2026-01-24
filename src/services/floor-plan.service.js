// Updated: 2025-12-22
// by: DatNB
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function calculateMaxTenants(size) {
  const s = Number(size);
  if (!s || Number.isNaN(s)) return 1;
  if (s <= 15) return 1;
  if (s <= 25) return 2;
  if (s <= 35) return 3;
  return 4;
}

class FloorPlanService {
  // Helper: Kiểm tra quyền truy cập building
  async checkBuildingAccess(userId, userRole, buildingId) {
    const normalizedRole = String(userRole || "").toUpperCase();

    // OWNER có toàn quyền
    if (normalizedRole === "OWNER") return true;

    // MANAGER: chỉ được truy cập building được assign (building_managers.user_id)
    if (normalizedRole === "MANAGER") {
      const managerBuilding = await prisma.building_managers.findFirst({
        where: {
          user_id: userId,
          building_id: buildingId,
        },
        select: { manager_id: true },
      });
      return !!managerBuilding;
    }

    return false;
  }

  // Helper: Parse layout JSON (đảm bảo đúng format)
  parseLayout(layout) {
    if (!layout) return null;
    if (typeof layout === "object") return layout;

    try {
      return JSON.parse(layout);
    } catch (err) {
      throw new Error("Invalid layout JSON format");
    }
  }

  /* =========================================================
   * RULES (FloorPlan):
   * 1) Room không được đè lên nhau
   * 2) Room phải nằm hoàn toàn trong "Tòa nhà" (node type="building")
   * ========================================================= */

  _pointInPolygon(point, polygon) {
    // Ray-casting algorithm
    const { x, y } = point;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x,
        yi = polygon[i].y;
      const xj = polygon[j].x,
        yj = polygon[j].y;

      const intersect =
        yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi;

      if (intersect) inside = !inside;
    }
    return inside;
  }

  _rectsOverlap(a, b) {
    return (
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
    );
  }

  _getBuildingPolygon(layoutObj) {
    const nodes = Array.isArray(layoutObj?.nodes) ? layoutObj.nodes : [];
    const building = nodes.find(
      (n) => n?.type === "building" && Array.isArray(n?.data?.points),
    );
    if (!building) return null;

    const bx = Number(building?.position?.x || 0);
    const by = Number(building?.position?.y || 0);

    // points là tọa độ tương đối trong node, cộng position để ra tọa độ tuyệt đối
    const pts = building.data.points.map((p) => ({
      x: bx + Number(p.x || 0),
      y: by + Number(p.y || 0),
    }));

    // an toàn: nếu polygon quá ít điểm
    if (!pts || pts.length < 3) return null;

    return pts;
  }

  _getRoomRects(layoutObj) {
    const nodes = Array.isArray(layoutObj?.nodes) ? layoutObj.nodes : [];
    const roomNodes = nodes.filter(
      (n) => n?.type === "block" && n?.data?.icon === "room",
    );

    return roomNodes.map((n) => {
      const x = Number(n?.position?.x || 0);
      const y = Number(n?.position?.y || 0);
      const w = Number(n?.data?.w || 0);
      const h = Number(n?.data?.h || 0);
      const roomNo = String(n?.data?.room_number || "").trim();

      return {
        id: n?.id,
        roomNo,
        x,
        y,
        w,
        h,
      };
    });
  }

  _validateRoomLayoutRules(layoutObj) {
    const rooms = this._getRoomRects(layoutObj);

    // Không có room thì khỏi check
    if (!rooms || rooms.length === 0) return;

    const buildingPoly = this._getBuildingPolygon(layoutObj);
    if (!buildingPoly) {
      throw new Error(
        "Vui lòng tạo Tòa nhà (Building) trước khi lưu, vì phòng phải nằm trong tòa nhà.",
      );
    }

    // 1) Room phải nằm hoàn toàn trong building (4 góc)
    for (const r of rooms) {
      if (!r.w || !r.h) {
        throw new Error(
          `Phòng ${r.roomNo || "(chưa có số phòng)"} thiếu kích thước (w/h).`,
        );
      }

      const corners = [
        { x: r.x, y: r.y },
        { x: r.x + r.w, y: r.y },
        { x: r.x + r.w, y: r.y + r.h },
        { x: r.x, y: r.y + r.h },
      ];

      const ok = corners.every((pt) => this._pointInPolygon(pt, buildingPoly));
      if (!ok) {
        throw new Error(
          `Phòng ${
            r.roomNo || "(chưa có số phòng)"
          } phải nằm hoàn toàn trong tòa nhà.`,
        );
      }
    }

    // 2) Room không được overlap nhau
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i];
        const b = rooms[j];
        if (this._rectsOverlap(a, b)) {
          throw new Error(
            `Phòng ${a.roomNo || a.id} đang bị đè lên phòng ${
              b.roomNo || b.id
            }. Vui lòng sắp xếp lại.`,
          );
        }
      }
    }
  }

  // Helper: Tạo rooms data từ layout nodes
  extractRoomsFromLayout(layout, buildingId, floorNumber) {
    if (!layout || !Array.isArray(layout.nodes)) return [];

    const nodes = layout.nodes; // ✅ FIX QUAN TRỌNG

    const rooms = nodes
      .filter(
        (n) =>
          n?.type === "room" ||
          (n?.type === "block" && n?.data?.icon === "room"),
      )
      .map((node) => {
        // ✅ CHỈ lấy room_number (không fallback sang label)
        let roomNumber = String(node?.data?.room_number ?? "").trim();

        // (Tuỳ chọn) hỗ trợ legacy type="room" cũ nếu trước đây bạn có lưu label là số phòng
        if (!roomNumber && node?.type === "room") {
          roomNumber = String(node?.data?.label ?? "").trim();
        }

        if (!roomNumber) return null;

        // ✅ chặn các label chữ như "Cửa", "Hành lang", "Lối thoát"...
        if (!/^(\d+|[A-Z]+[-_ ]?\d+)$/.test(roomNumber)) return null;

        // size (m²) – FE đang truyền size = 4*3
        // size (m²)
        let size = null;

        // chấp nhận w/h là number hoặc string-number
        const wPx = Number(node?.data?.w);
        const hPx = Number(node?.data?.h);

        if (
          Number.isFinite(wPx) &&
          Number.isFinite(hPx) &&
          wPx > 0 &&
          hPx > 0
        ) {
          const wM = wPx / 80; // pxPerMeter = 80
          const hM = hPx / 80;
          size = Number((wM * hM).toFixed(2));
        }
        // FALLBACK: size FE gửi (nếu có) ví dụ "56m2"
        else if (node?.data?.size !== undefined && node?.data?.size !== null) {
          const s = String(node.data.size).match(/(\d+(\.\d+)?)/);
          if (s) size = parseFloat(s[1]);
        }

        return {
          building_id: Number(buildingId),
          floor: Number(floorNumber),
          room_number: roomNumber,
          size,
          max_tenants: calculateMaxTenants(size),
          description: node?.data?.description || null,
          status: "available",
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        };
      })
      .filter(Boolean);

    return rooms;
  }

  // NEXT FLOOR - Lấy tầng tiếp theo cần tạo cho building (dựa trên dữ liệu floor_plans)
  async getNextFloorNumber(buildingId, userId, userRole) {
    if (!buildingId) {
      throw new Error("Missing required field: building_id");
    }
    if (!userId) {
      throw new Error("Missing required field: user_id");
    }

    const bId = parseInt(buildingId);
    if (isNaN(bId)) {
      throw new Error("building_id must be a valid number");
    }

    // Kiểm tra quyền truy cập building (giống create)
    const hasAccess = await this.checkBuildingAccess(userId, userRole, bId);
    if (!hasAccess) {
      throw new Error(
        "Access denied: You do not have permission to access floor plans for this building",
      );
    }

    // Kiểm tra building tồn tại
    const building = await prisma.buildings.findUnique({
      where: { building_id: bId },
    });
    if (!building) {
      throw new Error("Building not found");
    }
    if (!building.is_active) {
      throw new Error("Building is inactive");
    }

    const agg = await prisma.floor_plans.aggregate({
      where: { building_id: bId },
      _max: { floor_number: true },
    });

    const maxFloor = agg?._max?.floor_number || 0;
    const nextFloor = maxFloor + 1;

    return {
      building_id: bId,
      max_floor_number: maxFloor,
      next_floor_number: nextFloor,
    };
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
      buildingId,
    );
    if (!hasAccess) {
      throw new Error(
        "Access denied: You do not have permission to create floor plans for this building",
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

    // ===== CHECK TẠO TẦNG LIÊN TỤC (KHÔNG ĐƯỢC NHẢY TẦNG) =====
    const agg = await prisma.floor_plans.aggregate({
      where: { building_id: buildingId },
      _max: { floor_number: true },
    });

    const maxFloor = agg?._max?.floor_number || 0;
    const expectedNextFloor = maxFloor + 1;

    if (floorNum !== expectedNextFloor) {
      throw new Error(
        `Phải tạo tầng liên tục. Tầng tiếp theo phải là tầng ${expectedNextFloor}.`,
      );
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
        `Floor plan already exists for building ${buildingId}, floor ${floorNum}`,
      );
    }

    // ✅ Parse + validate rules (room không đè nhau, room trong building)
    const layoutObj = this.parseLayout(layout);
    if (layoutObj) {
      this._validateRoomLayoutRules(layoutObj);
    }

    // Sử dụng transaction để tạo floor plan và rooms
    return await prisma.$transaction(async (tx) => {
      // 1️⃣ Tạo floor plan
      const floorPlan = await tx.floor_plans.create({
        data: {
          building_id: buildingId,
          name: name?.trim() || null,
          floor_number: floorNum,
          layout: layoutObj || null,
          file_url: file_url?.trim() || null,
          is_published: is_published === true || is_published === "true",
          created_by: createdBy,
          note: note?.trim() || null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        include: {
          building: {
            select: {
              building_id: true,
              name: true,
              address: true,
            },
          },
          creator: {
            select: {
              user_id: true,
              full_name: true,
              email: true,
            },
          },
        },
      });
      // ===== UPDATE LẠI number_of_floors CỦA BUILDING =====
      await tx.buildings.update({
        where: { building_id: buildingId },
        data: {
          number_of_floors: expectedNextFloor,
        },
      });

      // 2️⃣ Trích xuất rooms từ layout
      const roomsToCreate = this.extractRoomsFromLayout(
        layoutObj,
        buildingId,
        floorNum,
      );

      // ===== PATCH: prevent duplicate room_number within same building (across all floors) =====
      if (roomsToCreate.length > 0) {
        const roomNumbers = roomsToCreate
          .map((r) => String(r.room_number || "").trim())
          .filter(Boolean);

        if (roomNumbers.length > 0) {
          const existed = await tx.rooms.findMany({
            where: {
              building_id: buildingId,
              is_active: true,
              room_number: { in: roomNumbers },
            },
            select: { room_number: true, floor: true },
          });

          if (existed.length > 0) {
            const dupList = existed
              .map((x) => `${x.room_number} (tầng ${x.floor ?? "?"})`)
              .join(", ");
            throw new Error(
              `Số phòng đã tồn tại trong tòa nhà này: ${dupList}. Vui lòng đặt số phòng khác.`,
            );
          }
        }
      }

      // 3️⃣ Tạo rooms (nếu có)
      if (roomsToCreate.length > 0) {
        const roomNumbers = Array.from(
          new Set(roomsToCreate.map((r) => String(r.room_number).trim())),
        );

        const existed = await tx.rooms.findMany({
          where: {
            building_id: buildingId,
            is_active: true,
            room_number: { in: roomNumbers },
          },
          select: { room_number: true, floor: true },
        });

        if (existed.length > 0) {
          const msg = existed
            .map((x) => `${x.room_number} (tầng ${x.floor})`)
            .join(", ");
          throw new Error(`Số phòng đã tồn tại trong tòa nhà: ${msg}`);
        }
        await tx.rooms.createMany({
          data: roomsToCreate,
          skipDuplicates: true,
        });
      }
      // ===== PATCH START: sync room_id back into layout after CREATE =====
      let finalLayout = layout;

      // Chỉ sync khi layout có nodes
      if (layoutObj && Array.isArray(layoutObj.nodes) && roomsToCreate.length > 0) {
        // Lấy lại rooms vừa tạo trong tầng này
        const createdRooms = await tx.rooms.findMany({
          where: {
            building_id: buildingId,
            floor: floorNum,
            is_active: true,
          },
          select: {
            room_id: true,
            room_number: true,
            size: true,
          },
        });

        // Map room_number -> room
        const roomByNumber = new Map(
          createdRooms.map((r) => [String(r.room_number).trim(), r]),
        );

        finalLayout = {
          ...layoutObj,
          nodes: (layoutObj?.nodes || []).map((node) => {
            // chỉ xử lý node ROOM
            if (
              (node.type === "room" ||
                (node.type === "block" && node.data?.icon === "room")) &&
              node.data?.room_number
            ) {
              const key = String(node.data.room_number).trim();
              const matchedRoom = roomByNumber.get(key);

              if (!matchedRoom) return node;

              return {
                ...node,
                data: {
                  ...node.data,
                  room_id: matchedRoom.room_id,
                  size: node.data.size ?? matchedRoom.size ?? null,
                },
              };
            }

            // các node khác giữ nguyên
            return node;
          }),
        };

        // Update lại layout đã gắn room_id
        await tx.floor_plans.update({
          where: { plan_id: floorPlan.plan_id },
          data: {
            layout: finalLayout,
            updated_at: new Date(),
          },
        });
      }
      // ===== PATCH END =====

      return this.formatFloorPlanResponse({
        ...floorPlan,
        layout: finalLayout ?? floorPlan.layout,
      });
    });
  }

  // READ - Lấy thông tin floor plan theo ID
  async getFloorPlanById(planId) {
    const floorPlan = await prisma.floor_plans.findUnique({
      where: { plan_id: planId },
      include: {
        building: {
          select: {
            building_id: true,
            name: true,
            address: true,
            number_of_floors: true,
          },
        },
        creator: { select: { user_id: true, full_name: true, email: true } },
      },
    });

    if (!floorPlan) throw new Error("Floor plan not found");

    // ✅ Enrich layout: attach room_id from DB
    const layoutObj = floorPlan.layout || {};
    const nodes = Array.isArray(layoutObj.nodes) ? layoutObj.nodes : [];
    const normalizeRoomSize = (raw) => {
      if (raw === undefined || raw === null || raw === "") return null;
      if (typeof raw === "number" && Number.isFinite(raw)) return raw;

      const str = String(raw).trim().toLowerCase().replace("m²", "m2");

      // "5x3" hoặc "5 x 3" hoặc "5*3"
      const expr = str.match(/(\d+(\.\d+)?)\s*(x|\*)\s*(\d+(\.\d+)?)/);
      if (expr) {
        const a = parseFloat(expr[1]);
        const b = parseFloat(expr[4]);
        if (Number.isFinite(a) && Number.isFinite(b)) return a * b;
      }

      // "15m2" / "15"
      const num = str.match(/(\d+(\.\d+)?)/);
      if (!num) return null;

      const val = parseFloat(num[1]);
      return Number.isFinite(val) ? val : null;
    };
    // Lấy rooms theo building + floor
    const rooms = await prisma.rooms.findMany({
      where: {
        building_id: floorPlan.building_id,
        floor: floorPlan.floor_number,
        is_active: true,
      },
      select: { room_id: true, room_number: true, size: true },
    });

    // ===== PATCH A5 START: compute locked_room_ids =====
    const roomIds = rooms.map((r) => r.room_id);

    let lockedRoomIds = [];
    if (roomIds.length > 0) {
      const [tenantRoomRows, contractRoomRows] = await Promise.all([
        prisma.room_tenants.findMany({
          where: { room_id: { in: roomIds }, is_current: true },
          select: { room_id: true },
        }),
        prisma.contracts.findMany({
          where: { room_id: { in: roomIds } },
          select: { room_id: true },
        }),
      ]);

      lockedRoomIds = Array.from(
        new Set([
          ...tenantRoomRows.map((x) => x.room_id),
          ...contractRoomRows.map((x) => x.room_id),
        ]),
      );
    }

    // gắn vào floorPlan để formatter trả về FE
    floorPlan.locked_room_ids = lockedRoomIds;
    // ===== PATCH A5 END =====

    const mapByRoomNumber = new Map(
      rooms.map((r) => [String(r.room_number).trim(), r]),
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

  // READ (TENANT) - Xem floor plan theo ID (published + đúng building của tenant)
  async getFloorPlanByIdTenant(planId, userId) {
    const id = parseInt(planId);
    if (isNaN(id)) throw new Error("Invalid floor plan id");

    const floorPlan = await prisma.floor_plans.findUnique({
      where: { plan_id: id },
      include: {
        building: {
          select: {
            building_id: true,
            name: true,
            address: true,
            number_of_floors: true,
          },
        },
        creator: { select: { user_id: true, full_name: true, email: true } },
      },
    });

    if (!floorPlan) throw new Error("Floor plan not found");
    if (!floorPlan.is_published) throw new Error("Floor plan not published");

    // Tenant chỉ VIEW -> không cần enrich nodes theo rooms DB (web mới cần)
    return this.formatFloorPlanDetailResponse(floorPlan);
  }

  // READ - Lấy danh sách floor plans (có phân trang và filter)
  async getFloorPlans(filters = {}, userId, userRole) {
    const {
      building_id,
      floor_number,
      is_published,
      page = 1,
      limit = 10,
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
          building: {
            select: {
              building_id: true,
              name: true,
              address: true,
            },
          },
          creator: {
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
    const { floor_number, is_published, page = 1, limit = 10 } = filters;

    // ===== ACCESS CONTROL (FIX FOR TENANT APP) =====

    // OWNER: xem tất cả
    if (userRole === "OWNER") {
      // pass
    }

    // MANAGER: chỉ building được assign
    else if (userRole === "MANAGER") {
      const hasAccess = await this.checkBuildingAccess(
        userId,
        userRole,
        buildingId,
      );
      if (!hasAccess) {
        throw new Error("Access denied");
      }
    }

    // TENANT: chỉ VIEW floor plan (cho phép xem mọi tòa)
    else if (userRole === "TENANT") {
      // Tenant chỉ xem published
      filters.is_published = true;
    } else {
      throw new Error("Access denied");
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
          creator: {
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

    // 1️⃣ Verify floor plan exists
    const existingPlan = await prisma.floor_plans.findUnique({
      where: { plan_id: planId },
    });
    if (!existingPlan) {
      throw new Error("Floor plan not found");
    }

    // 2️⃣ Check access
    const hasAccess = await this.checkFloorPlanAccess(userId, userRole, planId);
    if (!hasAccess) {
      throw new Error(
        "Access denied: You do not have permission to update this floor plan",
      );
    }

    // 3️⃣ Transaction
    return await prisma.$transaction(async (tx) => {
      /* =========================
       A. UPDATE FLOOR PLAN META
    ========================== */
      const updateData = {
        updated_at: new Date(),
      };

      if (name !== undefined) updateData.name = name?.trim() || null;
      if (file_url !== undefined)
        updateData.file_url = file_url?.trim() || null;
      if (note !== undefined) updateData.note = note?.trim() || null;
      if (is_published !== undefined) {
        updateData.is_published =
          is_published === true || is_published === "true";
      }

      // layout sẽ update SAU khi sync room xong
      const floorPlan = await tx.floor_plans.update({
        where: { plan_id: planId },
        data: updateData,
        include: {
          building: {
            select: { building_id: true, name: true, address: true },
          },
          creator: {
            select: { user_id: true, full_name: true, email: true },
          },
        },
      });

      /* =========================
       B. SYNC ROOMS FROM LAYOUT
       (CHỈ KHI CÓ layout)
    ========================== */
      let finalLayout = undefined;

      if (layout !== undefined) {
        const layoutObj = this.parseLayout(layout) || {};

        // ✅ Validate rules (room không đè nhau, room trong building)
        this._validateRoomLayoutRules(layoutObj);

        const nodes = Array.isArray(layoutObj.nodes) ? layoutObj.nodes : [];
        // ✅ Helper: normalize size về số (DECIMAL) để lưu DB
        const normalizeSizeFromNode = (node) => {
          // Ưu tiên nếu FE có nhập dài/rộng riêng
          const rawLength =
            node?.data?.length ?? node?.data?.room_length ?? node?.data?.dai;
          const rawWidth =
            node?.data?.width ?? node?.data?.room_width ?? node?.data?.rong;

          const toNumber = (v) => {
            if (v === undefined || v === null || v === "") return null;
            if (typeof v === "number") return Number.isFinite(v) ? v : null;
            const m = String(v)
              .replace(",", ".")
              .match(/(\d+(\.\d+)?)/);
            return m ? parseFloat(m[1]) : null;
          };

          const L = toNumber(rawLength);
          const W = toNumber(rawWidth);

          // Nếu có dài & rộng => size = L*W
          if (L !== null && W !== null) return L * W;

          // Nếu không có dài/rộng thì dùng size FE gửi
          const rawSize =
            node?.data?.size ?? node?.data?.area ?? node?.data?.room_size;
          const S = toNumber(rawSize);
          if (S !== null) return S;

          // FALLBACK: tính từ w/h (px) nếu user resize bằng kéo
          const wPx = toNumber(node?.data?.w);
          const hPx = toNumber(node?.data?.h);

          if (wPx !== null && hPx !== null && wPx > 0 && hPx > 0) {
            // lấy pxPerMeter từ meta nếu có, fallback 80 giống create
            const pxPerMeter = Number(layoutObj?.meta?.pxPerMeter) || 80;
            const wM = wPx / pxPerMeter;
            const hM = hPx / pxPerMeter;
            return Number((wM * hM).toFixed(2));
          }

          return null;
        };

        // 1) Extract rooms from layout (CHỈ LẤY NODE ROOM)
const isRoomNodeForSync = (n) =>
  n?.type === "room" || (n?.type === "block" && n?.data?.icon === "room");

let layoutRooms = nodes
  .filter(isRoomNodeForSync)
  .map((n) => {
    const computedSize = normalizeSizeFromNode(n);

    // Ưu tiên room_number; fallback label để không phá layout cũ
    const roomNumber = String(n?.data?.room_number ?? n?.data?.label ?? "").trim();
    if (!roomNumber) return null;

    return {
      __nodeRef: n,
      room_id: n?.data?.room_id ? parseInt(n.data.room_id) : null,
      room_number: roomNumber,
      size: computedSize,
      floor: existingPlan.floor_number,
      building_id: existingPlan.building_id,
    };
  })
  .filter(Boolean);

        // 2) Rooms in DB
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
          dbRooms.map((r) => [String(r.room_number).trim(), r]),
        );

        const dbRoomIds = dbRooms.map((r) => r.room_id);

        const [tenantRoomRows, contractRoomRows] = await Promise.all([
          tx.room_tenants.findMany({
            where: { room_id: { in: dbRoomIds }, is_current: true },
            select: { room_id: true },
          }),
          tx.contracts.findMany({
            where: {
              room_id: { in: dbRoomIds },
              ...(tx.contracts.fields?.deleted_at ? { deleted_at: null } : {}),
            },
            select: { room_id: true },
          }),
        ]);

        const lockedRoomIdSet = new Set([
          ...tenantRoomRows.map((x) => x.room_id),
          ...contractRoomRows.map((x) => x.room_id),
        ]);

        const hasLockedRooms = lockedRoomIdSet.size > 0;

        const oldLayoutObj = this.parseLayout(existingPlan.layout) || {};
        const oldNodes = Array.isArray(oldLayoutObj.nodes)
          ? oldLayoutObj.nodes
          : [];
        const newNodes = nodes; // nodes của layoutObj hiện tại

        const isRoomNode = (n) =>
          n?.type === "block" &&
          n?.data?.icon === "room" &&
          String(n?.data?.room_number ?? n?.data?.label ?? "").trim();

        const isBuildingNode = (n) =>
          n?.type === "building" || n?.id === "building";

        // map room nodes
        const oldRoomById = new Map();
        const oldRoomByNumber = new Map();
        for (const n of oldNodes.filter(isRoomNode)) {
          const rn = String(n.data.room_number ?? n.data.label).trim();
          const rid = n.data?.room_id ? parseInt(n.data.room_id) : null;
          if (rid) oldRoomById.set(rid, n);
          if (rn) oldRoomByNumber.set(rn, n);
        }

        const newRoomById = new Map();
        const newRoomByNumber = new Map();
        for (const n of newNodes.filter(isRoomNode)) {
          const rn = String(n.data.room_number ?? n.data.label).trim();
          const rid = n.data?.room_id ? parseInt(n.data.room_id) : null;
          if (rid) newRoomById.set(rid, n);
          if (rn) newRoomByNumber.set(rn, n);
        }

        // 1) khóa phòng: không cho đổi room_number, size, w/h, position
        for (const db of dbRooms) {
          if (!lockedRoomIdSet.has(db.room_id)) continue;

          const oldNode =
            oldRoomById.get(db.room_id) ||
            oldRoomByNumber.get(String(db.room_number).trim());
          const newNode =
            newRoomById.get(db.room_id) ||
            newRoomByNumber.get(String(db.room_number).trim());

          if (!newNode) {
            throw new Error(
              `Phòng ${db.room_number} đang có hợp đồng/người ở nên không được xóa khỏi tầng.`,
            );
          }
          if (!oldNode) continue; // nếu layout cũ thiếu node (hiếm), bỏ qua

          const oldPos = oldNode.position || {};
          const newPos = newNode.position || {};

          const oldW = oldNode.data?.w ?? null;
          const oldH = oldNode.data?.h ?? null;
          const newW = newNode.data?.w ?? null;
          const newH = newNode.data?.h ?? null;

          const oldRn = String(
            oldNode.data?.room_number ?? oldNode.data?.label ?? "",
          ).trim();
          const newRn = String(
            newNode.data?.room_number ?? newNode.data?.label ?? "",
          ).trim();

          const moved =
            Number(oldPos.x) !== Number(newPos.x) ||
            Number(oldPos.y) !== Number(newPos.y);
          const resized =
            (oldW !== null && newW !== null && Number(oldW) !== Number(newW)) ||
            (oldH !== null && newH !== null && Number(oldH) !== Number(newH));
          const renamed = oldRn && newRn && oldRn !== newRn;

          // size đổi sẽ bị bắt ở needUpdate, nhưng mình chặn luôn ở đây cho chắc
          if (moved || resized || renamed) {
            throw new Error(
              `Phòng ${db.room_number} đang có hợp đồng/người ở nên không được chỉnh sửa hoặc di chuyển.`,
            );
          }
        }

        // 2) nếu có phòng bị khóa => khóa luôn building shape (không cho sửa layout tòa)
        if (hasLockedRooms) {
          const oldBuilding = oldNodes.find(isBuildingNode);
          const newBuilding = newNodes.find(isBuildingNode);

          if (oldBuilding && newBuilding) {
            const oldPos = oldBuilding.position || {};
            const newPos = newBuilding.position || {};
            const posChanged =
              Number(oldPos.x) !== Number(newPos.x) ||
              Number(oldPos.y) !== Number(newPos.y);

            const oldPts = oldBuilding.data?.points ?? null;
            const newPts = newBuilding.data?.points ?? null;
            const pointsChanged =
              JSON.stringify(oldPts) !== JSON.stringify(newPts);

            if (posChanged || pointsChanged) {
              throw new Error(
                "Tầng đang có phòng có hợp đồng/người ở nên không được chỉnh sửa layout tòa nhà.",
              );
            }
          }
        }

        // 3) UPSERT rooms
        for (const r of layoutRooms) {
          const found =
            (r.room_id && dbById.get(r.room_id)) ||
            dbByNumber.get(r.room_number);

          if (!found) {
            // CREATE
            const created = await tx.rooms.create({
              data: {
                building_id: r.building_id,
                floor: r.floor,
                room_number: r.room_number,
                size: r.size,
                max_tenants: calculateMaxTenants(r.size),
                status: "available",
                is_active: true,
                created_at: new Date(),
                updated_at: new Date(),
              },
              select: { room_id: true },
            });
            r.room_id = created.room_id;
          } else {
            const numberChanged =
              String(found.room_number).trim() !== r.room_number;

            // Convert Decimal -> number
            const oldSizeNum =
              found.size === null || found.size === undefined
                ? null
                : Number(found.size);

            // computed from layout -> number
            const newSizeNum =
              r.size === null || r.size === undefined ? null : Number(r.size);

            // CHỈ coi sizeChanged nếu FE có newSizeNum hợp lệ
            let sizeChanged = false;
            if (newSizeNum !== null && !Number.isNaN(newSizeNum)) {
              if (oldSizeNum === null || Number.isNaN(oldSizeNum))
                sizeChanged = true;
              else sizeChanged = Math.abs(oldSizeNum - newSizeNum) > 0.01; // tolerance
            }

            const needUpdate = numberChanged || sizeChanged;

            if (needUpdate) {
              // bạn muốn "có hợp đồng trỏ đến là tính" -> count any contract
              const [tenantCount, contractCount] = await Promise.all([
                tx.room_tenants.count({
                  where: { room_id: found.room_id, is_current: true },
                }),
                tx.contracts.count({
                  where: { room_id: found.room_id },
                }),
              ]);

              if (tenantCount > 0 || contractCount > 0) {
                throw new Error(
                  "Chỉ được sửa phòng khi phòng không có người ở.",
                );
              }

              const finalSizeNum =
                newSizeNum !== null && !Number.isNaN(newSizeNum)
                  ? newSizeNum
                  : oldSizeNum;

              await tx.rooms.update({
                where: { room_id: found.room_id },
                data: {
                  room_number: r.room_number,
                  size: finalSizeNum, // ✅ lưu theo số (Decimal nhận number)
                  max_tenants: calculateMaxTenants(finalSizeNum), // ✅ nghiệp vụ theo size số
                  updated_at: new Date(),
                },
              });

              r.size = finalSizeNum; // sync lại layout
            } else {
              r.size = oldSizeNum; // sync lại để tránh save lần sau bị lệch
            }

            r.room_id = found.room_id;
          }
        }

        // 4) DELETE / DEACTIVATE removed rooms
        const layoutRoomIds = new Set(
          layoutRooms.map((x) => x.room_id).filter(Boolean),
        );
        const layoutRoomNumbers = new Set(
          layoutRooms.map((x) => x.room_number),
        );

        for (const db of dbRooms) {
          const stillExists =
            layoutRoomIds.has(db.room_id) ||
            layoutRoomNumbers.has(String(db.room_number).trim());

          if (stillExists) continue;

          const [tenantCount, activeContractCount] = await Promise.all([
            tx.room_tenants.count({
              where: { room_id: db.room_id, is_current: true },
            }),
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

        // 5) Build FINAL layout (gắn room_id ngược lại node)
        const roomByNumber = new Map(
          layoutRooms.map((r) => [String(r.room_number), r]),
        );

        finalLayout = {
          ...layoutObj,
          nodes: nodes.map((n) => {
            // chỉ update node ROOM
            if (
              n.type === "block" &&
              n.data?.icon === "room" &&
              n.data?.room_number
            ) {
              const key = String(n.data.room_number).trim();
              const r = roomByNumber.get(key);

              if (!r) return n;

              return {
                ...n,
                data: {
                  ...n.data,
                  room_id: r.room_id,
                  room_number: r.room_number,
                  size: r.size,
                },
              };
            }

            // ⚠️ các node khác GIỮ NGUYÊN
            return n;
          }),
        };
      }

      /* =========================
       C. UPDATE LAYOUT (ONCE)
    ========================== */
      if (finalLayout !== undefined) {
        await tx.floor_plans.update({
          where: { plan_id: planId },
          data: {
            layout: finalLayout,
            updated_at: new Date(),
          },
        });
      }

      return this.formatFloorPlanResponse({
        ...floorPlan,
        layout: finalLayout ?? floorPlan.layout,
      });
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
        "Access denied: You do not have permission to publish this floor plan",
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
        building: {
          select: {
            building_id: true,
            name: true,
          },
        },
        creator: {
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
        "Access denied: You do not have permission to unpublish this floor plan",
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
        building: {
          select: {
            building_id: true,
            name: true,
          },
        },
        creator: {
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
    // 1) Floor plan tồn tại?
    const existingPlan = await prisma.floor_plans.findUnique({
      where: { plan_id: planId },
    });
    if (!existingPlan) {
      throw new Error("Floor plan not found");
    }

    // 2) Check quyền
    const hasAccess = await this.checkFloorPlanAccess(userId, userRole, planId);
    if (!hasAccess) {
      throw new Error(
        "Access denied: You do not have permission to delete this floor plan",
      );
    }

    const buildingId = existingPlan.building_id;
    const floorNumber = existingPlan.floor_number;

    return prisma.$transaction(async (tx) => {
      // 3) Lấy tất cả phòng thuộc building + floor
      const rooms = await tx.rooms.findMany({
        where: {
          building_id: buildingId,
          floor: floorNumber,
        },
        select: { room_id: true },
      });

      const roomIds = rooms.map((r) => r.room_id);

      if (roomIds.length > 0) {
        // ✅ Chặn xóa nếu có phòng đang bảo trì (status = 'maintenance')
        const maintenanceRooms = rooms.filter(
          (r) => r.status === "maintenance",
        );
        if (maintenanceRooms.length > 0) {
          const list = maintenanceRooms.map((r) => r.room_number).join(", ");
          throw new Error(
            `Không thể xóa tầng vì có phòng đang bảo trì: ${list}`,
          );
        }
        // 4) Chặn xóa nếu có người đang ở (room_tenants.is_current = true)
        const livingCount = await tx.room_tenants.count({
          where: {
            room_id: { in: roomIds },
            is_current: true,
          },
        });
        if (livingCount > 0) {
          throw new Error("Không thể xóa tầng vì có phòng đang có người ở.");
        }

        // 5) Chặn xóa nếu có BẤT KỲ hợp đồng nào đang tham chiếu room (FK RESTRICT sẽ chặn)
        // Nếu contracts có deleted_at thì bỏ qua hợp đồng đã xóa mềm
        const anyContractCount = await tx.contracts.count({
          where: {
            room_id: { in: roomIds },
            ...(tx.contracts.fields?.deleted_at ? { deleted_at: null } : {}), // nếu schema có deleted_at
          },
        });

        if (anyContractCount > 0) {
          throw new Error("Không thể xóa tầng vì có phòng đang có hợp đồng.");
        }

        // 6) Xóa các bảng phụ thuộc (nếu DB bạn chưa cascade đủ)
        // Nếu bạn đã ON DELETE CASCADE hết thì các deleteMany này vẫn an toàn.
        await tx.room_tenants.deleteMany({
          where: { room_id: { in: roomIds } },
        });

        // Nếu có bảng khác FK tới rooms mà không cascade, thêm ở đây (guest_registrations, bills, etc.)
        // Ví dụ:
        // await tx.guest_registrations.deleteMany({ where: { room_id: { in: roomIds } } });

        // 7) Xóa rooms
        await tx.rooms.deleteMany({
          where: { room_id: { in: roomIds } },
        });
      }

      // 8) Xóa floor plan
      await tx.floor_plans.delete({
        where: { plan_id: planId },
      });

      // 9) (Tuỳ bạn) cập nhật number_of_floors nếu bạn đang dùng field này
      // Gợi ý: set = max floor_number còn lại, hoặc 0 nếu không còn.
      const agg = await tx.floor_plans.aggregate({
        where: { building_id: buildingId },
        _max: { floor_number: true },
      });
      const maxFloor = agg?._max?.floor_number ?? 0;

      // Nếu bảng buildings có number_of_floors
      await tx.buildings.update({
        where: { building_id: buildingId },
        data: { number_of_floors: maxFloor },
      });

      return {
        message: "Deleted floor plan and all rooms on that floor successfully",
      };
    });
  }

  // STATISTICS - Thống kê floor plans
  async getFloorPlanStatistics(buildingId, userId, userRole) {
    // Kiểm tra quyền truy cập building
    const normalizedRole = String(userRole || "").toUpperCase();
    const bId = parseInt(buildingId);
    if (isNaN(bId)) throw new Error("building_id must be a valid number");

    const hasAccess = await this.checkBuildingAccess(
      userId,
      normalizedRole,
      bId,
    );
    if (!hasAccess) {
      throw new Error(
        "Access denied: You do not have permission to view statistics for this building",
      );
    }

    const building = await prisma.buildings.findUnique({
      where: { building_id: bId },
    });

    if (!building) {
      throw new Error("Building not found");
    }

    const [totalPlans, publishedPlans, unpublishedPlans, uniqueFloors] =
      await Promise.all([
        prisma.floor_plans.count({
          where: { building_id: bId },
        }),
        prisma.floor_plans.count({
          where: {
            building_id: bId,
            is_published: true,
          },
        }),
        prisma.floor_plans.count({
          where: {
            building_id: bId,
            is_published: false,
          },
        }),
        prisma.floor_plans.findMany({
          where: { building_id: bId },
          select: { floor_number: true },
          distinct: ["floor_number"],
        }),
      ]);

    return {
      building_id: bId,
      building_name: building.name,
      total_plans: totalPlans,
      published_plans: publishedPlans,
      unpublished_plans: unpublishedPlans,
      total_floors_with_plans: uniqueFloors.length,
    };
  }

  async checkFloorPlanAccess(userId, role, floorPlanId) {
    if (!userId || !floorPlanId) return false;

    const normalizedRole = String(role || "").toUpperCase();

    // Owner toàn quyền
    if (normalizedRole === "OWNER") return true;

    const planId = parseInt(floorPlanId);
    if (isNaN(planId)) return false;

    const floorPlan = await prisma.floor_plans.findUnique({
      where: { plan_id: planId },
      select: { building_id: true },
    });

    if (!floorPlan || !floorPlan.building_id) return false;

    return this.checkBuildingAccess(
      userId,
      normalizedRole,
      floorPlan.building_id,
    );
  }

  // Helper functions - Format response
  formatFloorPlanResponse(floorPlan) {
    return {
      plan_id: floorPlan.plan_id,
      building_id: floorPlan.building_id,
      building_name: floorPlan.building?.name,
      building_address: floorPlan.building?.address,
      name: floorPlan.name,
      floor_number: floorPlan.floor_number,
      layout: floorPlan.layout,
      file_url: floorPlan.file_url,
      is_published: floorPlan.is_published,
      created_by: {
        user_id: floorPlan.creator?.user_id,
        full_name: floorPlan.creator?.full_name,
        email: floorPlan.creator?.email,
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
      building_name: floorPlan.building?.name,
      name: floorPlan.name,
      floor_number: floorPlan.floor_number,
      is_published: floorPlan.is_published,
      created_by: {
        user_id: floorPlan.creator?.user_id,
        full_name: floorPlan.creator?.full_name,
      },
      created_at: floorPlan.created_at,
      updated_at: floorPlan.updated_at,
    };
  }

  formatFloorPlanDetailResponse(floorPlan) {
    return {
      plan_id: floorPlan.plan_id,
      building: {
        building_id: floorPlan.building?.building_id,
        name: floorPlan.building?.name,
        address: floorPlan.building?.address,
        number_of_floors: floorPlan.building?.number_of_floors,
      },
      name: floorPlan.name,
      floor_number: floorPlan.floor_number,
      layout: floorPlan.layout,
      locked_room_ids: floorPlan.locked_room_ids ?? [],
      file_url: floorPlan.file_url,
      is_published: floorPlan.is_published,
      created_by: {
        user_id: floorPlan.creator?.user_id,
        full_name: floorPlan.creator?.full_name,
        email: floorPlan.creator?.email,
      },
      note: floorPlan.note,
      created_at: floorPlan.created_at,
      updated_at: floorPlan.updated_at,
    };
  }
}

module.exports = new FloorPlanService();
