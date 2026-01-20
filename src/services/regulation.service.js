// Updated: 2025-12-19
// by: DatNB
// Changed: TENANT can now view all regulations (published only)

const prisma = require("../config/prisma");
const NotificationService = require("./notification.service");

class RegulationService {
  // Helper: Kiểm tra quyền truy cập regulation
  async checkRegulationAccess(regulationId, userId, userRole) {
    // OWNER có toàn quyền
    if (userRole === "OWNER") {
      return true;
    }

    const regulation = await prisma.regulations.findUnique({
      where: { regulation_id: regulationId },
    });

    if (!regulation) {
      throw new Error("Regulation not found");
    }

    // TENANT chỉ xem được regulation đã published
    if (userRole === "TENANT") {
      return regulation.status === "published";
    }

    // MANAGER chỉ có quyền với regulation của tòa nhà họ quản lý
    if (userRole === "MANAGER") {
      // Nếu regulation không thuộc building nào (general regulation), manager không có quyền
      if (!regulation.building_id) {
        return false;
      }

      // Kiểm tra manager có quản lý building này không
      const isManager = await prisma.building_managers.findFirst({
        where: {
          user_id: userId,
          building_id: regulation.building_id,
          is_active: true,
        },
      });

      return !!isManager;
    }

    return false;
  }

  // Helper: Lấy danh sách building_ids mà manager quản lý
  async getManagerBuildingIds(userId) {
    const managedBuildings = await prisma.building_managers.findMany({
      where: {
        user_id: userId,
      },
      select: { building_id: true },
    });

    return managedBuildings.map((b) => b.building_id);
  }

  // Helper: Lấy building_id của tenant
  async getTenantBuildingId(userId) {
    const tenant = await prisma.tenants.findUnique({
      where: { user_id: userId },
      select: {
        room_id: true,
        rooms: {
          select: {
            building_id: true,
          },
        },
      },
    });

    return tenant?.rooms?.building_id || null;
  }

  // CREATE - Tạo quy định mới (OWNER / MANAGER)
  async createRegulation(data, createdBy, userRole) {
    /* =========================
     * KIỂM TRA QUYỀN
     * ========================= */
    if (!["OWNER", "MANAGER"].includes(userRole)) {
      throw new Error("Chỉ OWNER hoặc MANAGER mới được tạo quy định");
    }

    /* =========================
     * KIỂM TRA NGƯỜI TẠO
     * ========================= */
    if (createdBy === undefined || createdBy === null) {
      throw new Error("Không xác định được người tạo quy định");
    }

    const parsedCreatedBy = Number(createdBy);
    if (!Number.isInteger(parsedCreatedBy) || parsedCreatedBy <= 0) {
      throw new Error("ID người tạo không hợp lệ");
    }

    const creator = await prisma.users.findUnique({
      where: { user_id: parsedCreatedBy },
      select: { user_id: true },
    });

    if (!creator) {
      throw new Error("Người tạo không tồn tại trong hệ thống");
    }

    /* =========================
     * DỮ LIỆU ĐẦU VÀO
     * ========================= */
    const { title, content, effective_date, note } = data;

    // Mặc định
    const parsedBuildingId = null; // ❌ Không áp dụng tòa nhà
    const regulationTarget = "tenants"; // ✅ Mặc định tenants
    const regulationStatus = "draft"; // ✅ Mặc định nháp

    if (!title || !title.trim()) {
      throw new Error("Thiếu tiêu đề quy định");
    }

    if (!content || !content.trim()) {
      throw new Error("Thiếu nội dung quy định");
    }

    /* =========================
     * KIỂM TRA NGÀY HIỆU LỰC
     * ========================= */
    let parsedEffectiveDate = null;

    if (effective_date) {
      parsedEffectiveDate = new Date(effective_date);

      if (isNaN(parsedEffectiveDate.getTime())) {
        throw new Error("Ngày hiệu lực không hợp lệ");
      }

      // So sánh theo NGÀY (bỏ giờ)
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const effectiveDateOnly = new Date(parsedEffectiveDate);
      effectiveDateOnly.setHours(0, 0, 0, 0);

      if (effectiveDateOnly < today) {
        throw new Error("Ngày hiệu lực không được nhỏ hơn ngày hiện tại");
      }
    }

    /* =========================
     * QUY ĐỊNH CHUNG
     * ========================= */
    // Vì building_id luôn NULL → chỉ OWNER được tạo
    if (userRole !== "OWNER") {
      throw new Error("Chỉ OWNER mới được tạo quy định chung");
    }

    /* =========================
     * VERSIONING
     * ========================= */
    const latestRegulation = await prisma.regulations.findFirst({
      where: {
        title: title.trim(),
        building_id: null,
      },
      orderBy: { version: "desc" },
    });

    const newVersion = latestRegulation ? latestRegulation.version + 1 : 1;

    /* =========================
     * TẠO QUY ĐỊNH
     * ========================= */
    const regulation = await prisma.regulations.create({
      data: {
        title: title.trim(),
        content: content.trim(),
        building_id: null,
        effective_date: parsedEffectiveDate,
        version: newVersion,
        status: regulationStatus,
        target: regulationTarget,
        created_by: parsedCreatedBy,
        note: note?.trim() || null,
      },
      include: {
        creator: {
          select: {
            user_id: true,
            full_name: true,
            email: true,
          },
        },
      },
    });

    return this.formatRegulationResponse(regulation);
  }

  // READ - Lấy thông tin regulation theo ID
  async getRegulationById(regulationId, userId, userRole) {
    const regulation = await prisma.regulations.findUnique({
      where: { regulation_id: regulationId },
      include: {
        creator: {
          select: {
            user_id: true,
            full_name: true,
          },
        },
      },
    });

    if (!regulation) {
      throw new Error("Không tìm thấy quy định");
    }

    // Kiểm tra quyền truy cập
    const hasAccess = await this.checkRegulationAccess(
      regulationId,
      userId,
      userRole,
    );

    if (!hasAccess) {
      throw new Error("Bạn không có quyền truy cập quy định này");
    }

    return this.formatRegulationDetailResponse(regulation);
  }
  // READ - Lấy danh sách regulations (có phân trang và filter)
  async getRegulations(filters = {}, userId, userRole) {
    const {
      building_id,
      status,
      target,
      version,
      page = 1,
      limit = 20,
    } = filters;

    const skip = (page - 1) * limit;
    const where = {};

    /* =========================
     * ROLE-BASED FILTERING
     * ========================= */

    if (userRole === "TENANT") {
      // TENANT chỉ xem regulations đã published
      where.status = "published";

      if (building_id !== undefined) {
        if (building_id === "null" || building_id === null) {
          where.building_id = null;
        } else {
          const buildingId = parseInt(building_id);
          if (!isNaN(buildingId)) {
            where.building_id = buildingId;
          }
        }
      }
    } else if (userRole === "MANAGER") {
      // MANAGER chỉ xem regulations của building họ quản lý
      const managedBuildingIds = await this.getManagerBuildingIds(userId);

      if (!managedBuildingIds || managedBuildingIds.length === 0) {
        return {
          data: [],
          pagination: {
            total: 0,
            page,
            limit,
            pages: 0,
          },
        };
      }

      where.building_id = { in: managedBuildingIds };

      if (building_id !== undefined) {
        if (building_id === "null" || building_id === null) {
          // Manager không được xem general regulations
          return {
            data: [],
            pagination: {
              total: 0,
              page,
              limit,
              pages: 0,
            },
          };
        } else {
          const buildingId = parseInt(building_id);
          if (!managedBuildingIds.includes(buildingId)) {
            throw new Error(
              "You do not have permission to access regulations for this building",
            );
          }
          where.building_id = buildingId;
        }
      }

      if (status) {
        where.status = status;
      } else {
        where.status = { not: "deleted" };
      }
    } else if (userRole === "OWNER") {
      // OWNER xem tất cả
      if (building_id !== undefined) {
        if (building_id === "null" || building_id === null) {
          where.building_id = null;
        } else {
          const buildingId = parseInt(building_id);
          if (!isNaN(buildingId)) {
            where.building_id = buildingId;
          }
        }
      }

      if (status) {
        where.status = status;
      } else {
        where.status = { not: "deleted" };
      }
    } else {
      throw new Error("Unauthorized access");
    }

    /* =========================
     * COMMON FILTERS
     * ========================= */

    if (target && userRole !== "TENANT") {
      where.target = target;
    }

    if (version !== undefined && version !== "" && userRole !== "TENANT") {
      const ver = parseInt(version);
      if (!isNaN(ver)) {
        where.version = ver;
      }
    }

    /* =========================
     * QUERY
     * ========================= */

    const [regulations, total] = await Promise.all([
      prisma.regulations.findMany({
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
            // ✅ ĐÚNG schema
            select: {
              user_id: true,
              full_name: true,
              email: true,
            },
          },
          // Nếu sau này cần:
          // publisher: { select: { user_id: true, full_name: true, email: true } },
        },
        skip,
        take: limit,
        orderBy: {
          created_at: "desc",
        },
      }),
      prisma.regulations.count({ where }),
    ]);

    /* =========================
     * RESPONSE
     * ========================= */

    return {
      data: regulations.map((r) => this.formatRegulationListResponse(r)),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  // READ - Lấy danh sách regulations (có phân trang và filter)
  async getRegulations(filters = {}, userId, userRole) {
    const {
      building_id,
      status,
      target,
      version,
      page = 1,
      limit = 20,
    } = filters;

    const skip = (page - 1) * limit;
    const where = {};

    /* =========================
     * ROLE-BASED FILTERING
     * ========================= */

    if (userRole === "TENANT") {
      where.status = "published";

      if (building_id !== undefined) {
        if (building_id === "null" || building_id === null) {
          where.building_id = null;
        } else {
          const buildingId = parseInt(building_id);
          if (!isNaN(buildingId)) {
            where.building_id = buildingId;
          }
        }
      }
    } else if (userRole === "MANAGER") {
      const managedBuildingIds = await this.getManagerBuildingIds(userId);

      if (!managedBuildingIds.length) {
        return {
          data: [],
          pagination: { total: 0, page, limit, pages: 0 },
        };
      }

      where.building_id = { in: managedBuildingIds };

      if (building_id !== undefined) {
        if (building_id === "null" || building_id === null) {
          return {
            data: [],
            pagination: { total: 0, page, limit, pages: 0 },
          };
        }

        const buildingId = parseInt(building_id);
        if (!managedBuildingIds.includes(buildingId)) {
          throw new Error("You do not have permission to access this building");
        }
        where.building_id = buildingId;
      }

      where.status = status || { not: "deleted" };
    } else if (userRole === "OWNER") {
      if (building_id !== undefined) {
        if (building_id === "null" || building_id === null) {
          where.building_id = null;
        } else {
          const buildingId = parseInt(building_id);
          if (!isNaN(buildingId)) {
            where.building_id = buildingId;
          }
        }
      }

      where.status = status || { not: "deleted" };
    } else {
      throw new Error("Unauthorized access");
    }

    /* =========================
     * COMMON FILTERS
     * ========================= */

    if (target && userRole !== "TENANT") {
      where.target = target;
    }

    if (version && userRole !== "TENANT") {
      const ver = parseInt(version);
      if (!isNaN(ver)) {
        where.version = ver;
      }
    }

    /* =========================
     * QUERY (JOIN USERS TẠI ĐÂY)
     * ========================= */

    const [regulations, total] = await Promise.all([
      prisma.regulations.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: "desc" },
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
      }),
      prisma.regulations.count({ where }),
    ]);

    /* =========================
     * RESPONSE
     * ========================= */

    return {
      data: regulations.map((r) => this.formatRegulationListResponse(r)),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  // UPDATE - Cập nhật regulation (chỉ OWNER và MANAGER)
  async updateRegulation(regulationId, data, userId, userRole) {
    // 1. Kiểm tra quyền
    if (!["OWNER", "MANAGER"].includes(userRole)) {
      throw new Error("Chỉ OWNER và MANAGER mới được cập nhật quy định");
    }

    const { title, content, effective_date, note } = data;

    // 2. Kiểm tra quyền truy cập
    const hasAccess = await this.checkRegulationAccess(
      regulationId,
      userId,
      userRole,
    );
    if (!hasAccess) {
      throw new Error("Bạn không có quyền cập nhật quy định này");
    }

    // 3. Kiểm tra regulation tồn tại
    const existingRegulation = await prisma.regulations.findUnique({
      where: { regulation_id: regulationId },
      select: {
        regulation_id: true,
        status: true,
        building_id: true,
        title: true,
        created_at: true,
      },
    });

    if (!existingRegulation) {
      throw new Error("Không tìm thấy quy định");
    }

    if (existingRegulation.status === "deleted") {
      throw new Error("Không thể cập nhật quy định đã bị xóa");
    }

    // 4. Chuẩn bị dữ liệu update
    const updateData = {
      updated_at: new Date(),
    };

    // ---- Tiêu đề
    if (title !== undefined) {
      if (!title.trim()) {
        throw new Error("Tiêu đề quy định không được để trống");
      }
      updateData.title = title.trim();
    }

    // ---- Nội dung
    if (content !== undefined) {
      updateData.content = content?.trim() || null;
    }

    // ---- Ngày hiệu lực (không được trước ngày tạo)
    if (effective_date !== undefined) {
      if (effective_date) {
        const effectiveDateObj = new Date(effective_date);

        if (isNaN(effectiveDateObj.getTime())) {
          throw new Error("Ngày hiệu lực không hợp lệ");
        }

        if (effectiveDateObj < existingRegulation.created_at) {
          throw new Error("Ngày hiệu lực không được trước ngày tạo quy định");
        }

        updateData.effective_date = effectiveDateObj;
      } else {
        updateData.effective_date = null;
      }
    }

    // ---- Ghi chú
    if (note !== undefined) {
      updateData.note = note?.trim() || null;
    }

    // 5. Update regulation
    const regulation = await prisma.regulations.update({
      where: { regulation_id: regulationId },
      data: updateData,
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
        publisher: {
          select: {
            user_id: true,
            full_name: true,
          },
        },
      },
    });

    // 6. Gửi thông báo nếu regulation đã publish
    if (regulation.building_id && regulation.status === "published") {
      const notificationTitle = `Cập nhật quy định: ${regulation.title}`;
      const notificationBody = `Quy định "${regulation.title}" đã được cập nhật. Vui lòng xem lại nội dung mới.`;

      const payload = {
        type: "regulation_updated",
        regulation_id: regulation.regulation_id,
        building_id: regulation.building_id,
      };

      await NotificationService.createBuildingBroadcast(
        regulation.created_by,
        regulation.building_id,
        notificationTitle,
        notificationBody,
        payload,
      );
    }

    return this.formatRegulationResponse(regulation);
  }

  // PUBLISH - Publish regulation (chỉ OWNER và MANAGER)
  async publishRegulation(regulationId, userId, userRole) {
    /* =========================
     * PERMISSION CHECK
     * ========================= */
    if (!["OWNER", "MANAGER"].includes(userRole)) {
      throw new Error("Only OWNER and MANAGER can publish regulations");
    }

    /* =========================
     * ACCESS CHECK
     * ========================= */
    const hasAccess = await this.checkRegulationAccess(
      regulationId,
      userId,
      userRole,
    );

    if (!hasAccess) {
      throw new Error("You do not have permission to publish this regulation");
    }

    /* =========================
     * GET REGULATION
     * ========================= */
    const regulation = await prisma.regulations.findUnique({
      where: { regulation_id: regulationId },
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

    if (!regulation) {
      throw new Error("Regulation not found");
    }

    if (regulation.status === "deleted") {
      throw new Error("Cannot publish deleted regulation");
    }

    if (regulation.status === "published") {
      throw new Error("Regulation is already published");
    }

    /* =========================
     * UPDATE STATUS
     * ========================= */
    const published = await prisma.regulations.update({
      where: { regulation_id: regulationId },
      data: {
        status: "published",
        published_by: userId,
        published_at: new Date(),
        // updated_at Prisma tự xử lý
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
        publisher: {
          select: {
            user_id: true,
            full_name: true,
          },
        },
      },
    });

    /* =========================
     * SEND NOTIFICATION
     * ========================= */
    if (published.building_id) {
      const notificationTitle = `Quy định mới: ${published.title}`;
      const notificationBody = `Quy định "${published.title}" đã được công bố. Vui lòng đọc và tuân thủ.`;

      const payload = {
        type: "regulation_published",
        regulation_id: published.regulation_id,
        building_id: published.building_id,
      };

      await NotificationService.createBuildingBroadcast(
        published.created_by,
        published.building_id,
        notificationTitle,
        notificationBody,
        payload,
      );
    } else {
      const notificationTitle = `Quy định chung mới: ${published.title}`;
      const notificationBody = `Quy định chung "${published.title}" đã được công bố. Vui lòng đọc và tuân thủ.`;

      const payload = {
        type: "regulation_published",
        regulation_id: published.regulation_id,
      };

      await NotificationService.createBroadcastNotification(
        published.created_by,
        notificationTitle,
        notificationBody,
        payload,
      );
    }

    return this.formatRegulationResponse(published);
  }

  // UNPUBLISH - Chuyển regulation từ published về draft (OWNER, MANAGER)
  async unpublishRegulation(regulationId, userId, userRole) {
    // 1. Check role
    if (!["OWNER", "MANAGER"].includes(userRole)) {
      throw new Error("Only OWNER and MANAGER can unpublish regulations");
    }

    // 2. Check access
    const hasAccess = await this.checkRegulationAccess(
      regulationId,
      userId,
      userRole,
    );
    if (!hasAccess) {
      throw new Error(
        "You do not have permission to unpublish this regulation",
      );
    }

    // 3. Get regulation
    const regulation = await prisma.regulations.findUnique({
      where: { regulation_id: regulationId },
      include: {
        building: {
          select: {
            building_id: true,
            name: true,
            address: true,
          },
        },
      },
    });

    if (!regulation) {
      throw new Error("Regulation not found");
    }

    // 4. Validate status
    if (regulation.status === "deleted") {
      throw new Error("Cannot unpublish deleted regulation");
    }

    if (regulation.status === "draft") {
      throw new Error("Regulation is already in draft status");
    }

    if (regulation.status !== "published") {
      throw new Error("Only published regulations can be unpublished");
    }

    // 5. Update regulation
    const unpublished = await prisma.regulations.update({
      where: { regulation_id: regulationId },
      data: {
        status: "draft",
        published_by: null,
        published_at: null,
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
        publisher: {
          select: {
            user_id: true,
            full_name: true,
            email: true,
          },
        },
      },
    });

    // 6. Send notification
    if (unpublished.building_id) {
      await NotificationService.createBuildingBroadcast(
        unpublished.created_by,
        unpublished.building_id,
        `Quy định đã gỡ: ${unpublished.title}`,
        `Quy định "${unpublished.title}" đã được chuyển về trạng thái nháp và không còn hiệu lực.`,
        {
          type: "regulation_unpublished",
          regulation_id: unpublished.regulation_id,
          building_id: unpublished.building_id,
        },
      );
    } else {
      await NotificationService.createBroadcastNotification(
        unpublished.created_by,
        `Quy định chung đã gỡ: ${unpublished.title}`,
        `Quy định chung "${unpublished.title}" đã được chuyển về trạng thái nháp và không còn hiệu lực.`,
        {
          type: "regulation_unpublished",
          regulation_id: unpublished.regulation_id,
        },
      );
    }

    // 7. Format response
    return this.formatRegulationResponse(unpublished);
  }

  // DELETE - Xóa regulation (soft delete) - chỉ OWNER và MANAGER
  async deleteRegulation(regulationId, userId, userRole) {
    // 1. Kiểm tra quyền
    if (!["OWNER", "MANAGER"].includes(userRole)) {
      throw new Error("Only OWNER and MANAGER can delete regulations");
    }

    // 2. Kiểm tra quyền truy cập regulation
    const hasAccess = await this.checkRegulationAccess(
      regulationId,
      userId,
      userRole,
    );
    if (!hasAccess) {
      throw new Error("You do not have permission to delete this regulation");
    }

    // 3. Lấy regulation
    const regulation = await prisma.regulations.findUnique({
      where: { regulation_id: regulationId },
      select: {
        regulation_id: true,
        status: true,
        building_id: true,
        title: true,
      },
    });

    if (!regulation) {
      throw new Error("Regulation not found");
    }

    // 4. Validate trạng thái
    if (regulation.status === "published") {
      throw new Error("Cannot delete published regulation. Unpublish it first");
    }

    if (regulation.status === "deleted") {
      throw new Error("Regulation is already deleted");
    }

    // 5. Soft delete
    await prisma.regulations.update({
      where: { regulation_id: regulationId },
      data: {
        status: "deleted",
        updated_at: new Date(),
      },
    });

    return {
      success: true,
      message: "Regulation deleted successfully",
    };
  }

  // GET VERSIONS - Lấy tất cả versions của một regulation
  async getRegulationVersions(title, buildingId = null, userId, userRole) {
    // MANAGER chỉ xem được versions của building họ quản lý
    if (userRole === "MANAGER") {
      if (buildingId === null) {
        throw new Error(
          "You do not have permission to access general regulations",
        );
      }

      const isManager = await prisma.building_managers.findFirst({
        where: {
          user_id: userId,
          building_id: parseInt(buildingId),
          is_active: true,
        },
      });

      if (!isManager) {
        throw new Error(
          "You do not have permission to access regulations for this building",
        );
      }
    }

    const whereClause = {
      title: title.trim(),
      building_id: buildingId ? parseInt(buildingId) : null,
    };

    // TENANT chỉ xem published versions
    if (userRole === "TENANT") {
      whereClause.status = "published";
    } else {
      // OWNER và MANAGER xem tất cả trừ deleted
      whereClause.status = { not: "deleted" };
    }

    const versions = await prisma.regulations.findMany({
      where: whereClause,
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
            email: true,
          },
        },
      },
      orderBy: { version: "desc" },
    });

    if (versions.length === 0) {
      throw new Error("No regulations found with this title");
    }

    return versions.map((v) => this.formatRegulationListResponse(v));
  }

  // FEEDBACK - Thêm feedback cho regulation (tất cả roles có thể feedback)
  async addFeedback(regulationId, userId, comment, userRole) {
    const regulation = await prisma.regulations.findUnique({
      where: { regulation_id: regulationId },
    });

    if (!regulation) {
      throw new Error("Regulation not found");
    }

    if (regulation.status !== "published") {
      throw new Error("Can only add feedback to published regulations");
    }

    // Kiểm tra quyền xem regulation này
    const hasAccess = await this.checkRegulationAccess(
      regulationId,
      userId,
      userRole,
    );
    if (!hasAccess) {
      throw new Error(
        "You do not have permission to provide feedback on this regulation",
      );
    }

    const feedback = await prisma.regulation_feedbacks.create({
      data: {
        regulation_id: regulationId,
        created_by: userId,
        comment: comment?.trim() || null,
        created_at: new Date(),
      },
      include: {
        users: {
          select: {
            user_id: true,
            full_name: true,
            email: true,
          },
        },
      },
    });

    return {
      feedback_id: feedback.feedback_id,
      regulation_id: feedback.regulation_id,
      comment: feedback.comment,
      created_by: {
        user_id: feedback.users.user_id,
        full_name: feedback.users.full_name,
        email: feedback.users.email,
      },
      created_at: feedback.created_at,
    };
  }
  // GET FEEDBACKS - Lấy feedbacks của regulation
  async getFeedbacks(regulationId, filters = {}) {
    const { page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const [feedbacks, total] = await Promise.all([
      prisma.regulation_feedbacks.findMany({
        where: { regulation_id: regulationId },
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
        orderBy: { created_at: "desc" },
      }),
      prisma.regulation_feedbacks.count({
        where: { regulation_id: regulationId },
      }),
    ]);

    return {
      data: feedbacks.map((f) => ({
        feedback_id: f.feedback_id,
        regulation_id: f.regulation_id,
        comment: f.comment,
        created_by: {
          user_id: f.users.user_id,
          full_name: f.users.full_name,
          email: f.users.email,
        },
        created_at: f.created_at,
      })),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  // STATISTICS - Thống kê regulations
  async getRegulationStatistics(buildingId = null, userId, userRole) {
    // Manager chỉ xem thống kê của building họ quản lý
    if (userRole === "MANAGER") {
      if (!buildingId) {
        throw new Error("Building ID is required for managers");
      }

      const isManager = await prisma.building_managers.findFirst({
        where: {
          user_id: userId,
          building_id: buildingId,
        },
      });

      if (!isManager) {
        throw new Error(
          "You do not have permission to access statistics for this building",
        );
      }
    }

    const where = buildingId ? { building_id: buildingId } : {};

    if (buildingId) {
      const building = await prisma.buildings.findUnique({
        where: { building_id: buildingId },
      });

      if (!building) {
        throw new Error("Building not found");
      }
    }

    const [
      totalRegulations,
      draftRegulations,
      publishedRegulations,
      deletedRegulations,
      totalFeedbacks,
    ] = await Promise.all([
      prisma.regulations.count({
        where: { ...where, status: { not: "deleted" } },
      }),
      prisma.regulations.count({
        where: { ...where, status: "draft" },
      }),
      prisma.regulations.count({
        where: { ...where, status: "published" },
      }),
      prisma.regulations.count({
        where: { ...where, status: "deleted" },
      }),
      prisma.regulation_feedbacks.count({
        where: buildingId
          ? {
              regulations: { building_id: buildingId },
            }
          : {},
      }),
    ]);

    const result = {
      total_regulations: totalRegulations,
      draft_regulations: draftRegulations,
      published_regulations: publishedRegulations,
      deleted_regulations: deletedRegulations,
      total_feedbacks: totalFeedbacks,
    };

    if (buildingId) {
      const building = await prisma.buildings.findUnique({
        where: { building_id: buildingId },
      });
      result.building_id = buildingId;
      result.building_name = building.name;
    }

    return result;
  }

  // ============ BOT METHODS ============
  // Bot methods không cần kiểm tra authorization phức tạp

  /**
   * GET REGULATIONS FOR BOT
   * Smartly fetches regulations relevant to the tenant (General + Their Buildings)
   */
  async getRegulationsByBot(tenantUserId, filters = {}, botInfo) {
    // 1. Verify Tenant & Find their Buildings
    const tenant = await prisma.tenants.findUnique({
      where: { user_id: tenantUserId },
      include: {
        // Use the Single Source of Truth: Active Room Tenants
        room_tenants_history: {
          where: { is_current: true },
          include: {
            room: { select: { building_id: true } },
          },
        },
      },
    });

    if (!tenant) throw new Error("Tenant not found");

    // Extract unique building IDs the tenant is associated with
    const buildingIds = [
      ...new Set(tenant.room_tenants_history.map((rt) => rt.room.building_id)),
    ];

    // 2. Build Query
    const { limit = 10, page = 1 } = filters;
    const take = parseInt(limit);
    const skip = (parseInt(page) - 1) * take;

    const where = {
      status: "published", // Bot only sees published stuff
      OR: [
        { building_id: null }, // Case A: General Regulations
        { building_id: { in: buildingIds } }, // Case B: Building-specific
      ],
      // Optional: Filter by 'target' (e.g. only 'all' or 'tenants')
      target: { in: ["all", "tenants"] },
    };

    // 3. Execute
    const [regulations, total] = await Promise.all([
      prisma.regulations.findMany({
        where,
        take,
        skip,
        orderBy: [
          { building_id: "desc" }, // Show Building-specific first (usually non-null > null)
          { created_at: "desc" },
        ],
        include: {
          building: { select: { name: true } },
        },
      }),
      prisma.regulations.count({ where }),
    ]);

    // 4. Format
    const formatted = regulations.map((r) => ({
      id: r.regulation_id,
      title: r.title,
      type: r.building_id ? "Building Specific" : "General",
      building: r.building?.name || "All Buildings",
      content_preview: r.content.substring(0, 100) + "...",
      full_content: r.content, // Bot might need full text for RAG
      effective_date: r.effective_date,
    }));

    return {
      data: formatted,
      pagination: {
        total,
        page: parseInt(page),
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  // Helper - Format response
  async formatRegulationResponse(regulation) {
    const creator = await prisma.users.findUnique({
      where: { user_id: regulation.created_by },
      select: {
        user_id: true,
        full_name: true,
        email: true,
      },
    });

    return {
      regulation_id: regulation.regulation_id,
      title: regulation.title,
      content: regulation.content,

      building_id: regulation.building_id,
      building_name: regulation.building?.name || null,
      building_address: regulation.building?.address || null,

      effective_date: regulation.effective_date,
      version: regulation.version,
      status: regulation.status,
      target: regulation.target,

      created_by: creator, // ← LÚC NÀY KHÔNG BAO GIỜ RỖNG

      note: regulation.note,
      created_at: regulation.created_at,
      updated_at: regulation.updated_at,
    };
  }

  formatRegulationListResponse(regulation) {
    return {
      regulation_id: regulation.regulation_id,
      title: regulation.title,
      content: regulation.content,

      building_id: regulation.building_id,
      building_name: regulation.building?.name || null,

      effective_date: regulation.effective_date,
      version: regulation.version,
      status: regulation.status,
      target: regulation.target,

      created_by: {
        user_id: regulation.creator?.user_id || null,
        full_name: regulation.creator?.full_name || null,
      },

      created_at: regulation.created_at,
      updated_at: regulation.updated_at,
    };
  }

  formatRegulationDetailResponse(regulation) {
    return {
      regulation_id: regulation.regulation_id,
      title: regulation.title,
      content: regulation.content,

      status: regulation.status,
      effective_date: regulation.effective_date,
      created_at: regulation.created_at,

      created_by: {
        user_id: regulation.created_by,
        full_name: regulation.creator?.full_name || null,
      },
    };
  }
}

module.exports = new RegulationService();
