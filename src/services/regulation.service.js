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

  // CREATE - Tạo regulation mới (chỉ OWNER và MANAGER)
  async createRegulation(data, createdBy, userRole) {
    /* =========================
     * PERMISSION CHECK
     * ========================= */
    if (!["OWNER", "MANAGER"].includes(userRole)) {
      throw new Error("Only OWNER and MANAGER can create regulations");
    }

    const {
      title,
      content,
      building_id,
      effective_date,
      status,
      target,
      note,
    } = data;

    if (!title?.trim()) {
      throw new Error("Missing required field: title");
    }

    if (!createdBy) {
      throw new Error("Missing required field: created_by");
    }

    /* =========================
     * BUILDING VALIDATION
     * ========================= */
    let parsedBuildingId = null;

    if (building_id !== undefined && building_id !== null) {
      parsedBuildingId = parseInt(building_id);
      if (isNaN(parsedBuildingId)) {
        throw new Error("building_id must be a valid number");
      }

      const building = await prisma.buildings.findUnique({
        where: { building_id: parsedBuildingId },
      });

      if (!building) {
        throw new Error("Building not found");
      }

      if (!building.is_active) {
        throw new Error("Cannot create regulation for inactive building");
      }

      // MANAGER chỉ tạo regulation cho building họ quản lý
      if (userRole === "MANAGER") {
        const isManager = await prisma.building_managers.findFirst({
          where: {
            user_id: createdBy,
            building_id: parsedBuildingId,
            is_active: true,
          },
        });

        if (!isManager) {
          throw new Error(
            "You do not have permission to create regulations for this building"
          );
        }
      }
    } else {
      // General regulation (building_id = null)
      if (userRole !== "OWNER") {
        throw new Error("Only OWNER can create general regulations");
      }
    }

    /* =========================
     * VERSIONING
     * ========================= */
    const latestRegulation = await prisma.regulations.findFirst({
      where: {
        building_id: parsedBuildingId,
        title: title.trim(),
      },
      orderBy: { version: "desc" },
    });

    const newVersion = latestRegulation ? latestRegulation.version + 1 : 1;

    /* =========================
     * CREATE REGULATION
     * ========================= */
    const regulation = await prisma.regulations.create({
      data: {
        title: title.trim(),
        content: content?.trim() || null,
        building_id: parsedBuildingId,
        effective_date: effective_date ? new Date(effective_date) : null,
        version: newVersion,
        status: status || "draft",
        target: target || "all",
        created_by: createdBy,
        note: note?.trim() || null,
        // ❌ KHÔNG cần created_at / updated_at (Prisma tự xử lý)
      },
      include: {
        building: parsedBuildingId
          ? {
              select: {
                building_id: true,
                name: true,
                address: true,
              },
            }
          : false,
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
    // 1. Lấy regulation
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
        feedbacks: {
          include: {
            user: {
              select: {
                user_id: true,
                full_name: true,
                email: true,
              },
            },
          },
          orderBy: { created_at: "desc" },
        },
      },
    });

    if (!regulation) {
      throw new Error("Regulation not found");
    }

    // 2. Kiểm tra quyền truy cập
    const hasAccess = await this.checkRegulationAccess(
      regulationId,
      userId,
      userRole
    );

    if (!hasAccess) {
      throw new Error("You do not have permission to access this regulation");
    }

    // 3. Format response
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
              "You do not have permission to access regulations for this building"
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

  // READ - Lấy regulations theo building
  async getRegulationsByBuilding(buildingId, filters = {}, userId, userRole) {
    const {
      status,
      target,
      latest_only = false,
      page = 1,
      limit = 20,
    } = filters;

    // Verify building exists (nếu không phải general regulation)
    if (buildingId !== null) {
      const building = await prisma.buildings.findUnique({
        where: { building_id: buildingId },
      });

      if (!building) {
        throw new Error("Building not found");
      }

      // MANAGER chỉ xem được regulations của building họ quản lý
      if (userRole === "MANAGER") {
        const isManager = await prisma.building_managers.findFirst({
          where: {
            user_id: userId,
            building_id: buildingId,
            is_active: true,
          },
        });

        if (!isManager) {
          throw new Error(
            "You do not have permission to access regulations for this building"
          );
        }
      }
    } else {
      // General regulations
      if (userRole === "MANAGER") {
        throw new Error(
          "You do not have permission to access general regulations"
        );
      }
      // TENANT và OWNER có thể xem general regulations
    }

    const skip = (page - 1) * limit;
    const where = {
      building_id: buildingId,
    };

    // TENANT chỉ xem published regulations
    if (userRole === "TENANT") {
      where.status = "published";
    } else {
      // OWNER và MANAGER
      if (status) {
        where.status = status;
      } else {
        where.status = { not: "deleted" };
      }
    }

    if (target && userRole !== "TENANT") {
      where.target = target;
    }

    // Nếu chỉ lấy version mới nhất
    if (latest_only === true || latest_only === "true") {
      const allRegulations = await prisma.regulations.findMany({
        where,
        orderBy: [{ title: "asc" }, { version: "desc" }],
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
      });

      // Lọc lấy version cao nhất cho mỗi title
      const latestRegulations = [];
      const seenTitles = new Set();

      for (const regulation of allRegulations) {
        if (!seenTitles.has(regulation.title)) {
          latestRegulations.push(regulation);
          seenTitles.add(regulation.title);
        }
      }

      return {
        data: latestRegulations.map((r) =>
          this.formatRegulationListResponse(r)
        ),
        pagination: {
          total: latestRegulations.length,
          page: 1,
          limit: latestRegulations.length,
          pages: 1,
        },
      };
    }

    const [regulations, total] = await Promise.all([
      prisma.regulations.findMany({
        where,
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
        skip,
        take: limit,
        orderBy: [{ created_at: "desc" }],
      }),
      prisma.regulations.count({ where }),
    ]);

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
      throw new Error("Only OWNER and MANAGER can update regulations");
    }

    const { title, content, effective_date, status, target, note } = data;

    // 2. Kiểm tra quyền truy cập
    const hasAccess = await this.checkRegulationAccess(
      regulationId,
      userId,
      userRole
    );
    if (!hasAccess) {
      throw new Error("You do not have permission to update this regulation");
    }

    // 3. Kiểm tra regulation tồn tại
    const existingRegulation = await prisma.regulations.findUnique({
      where: { regulation_id: regulationId },
      select: {
        regulation_id: true,
        status: true,
        building_id: true,
        title: true,
      },
    });

    if (!existingRegulation) {
      throw new Error("Regulation not found");
    }

    if (existingRegulation.status === "deleted") {
      throw new Error("Cannot update deleted regulation");
    }

    // 4. Chuẩn bị dữ liệu update
    const updateData = {
      updated_at: new Date(),
    };

    if (title !== undefined) {
      updateData.title = title.trim();
    }

    if (content !== undefined) {
      updateData.content = content?.trim() || null;
    }

    if (effective_date !== undefined) {
      updateData.effective_date = effective_date
        ? new Date(effective_date)
        : null;
    }

    if (status !== undefined) {
      updateData.status = status;
    }

    if (target !== undefined) {
      updateData.target = target;
    }

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
        payload
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
      userRole
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
        payload
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
        payload
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
      userRole
    );
    if (!hasAccess) {
      throw new Error(
        "You do not have permission to unpublish this regulation"
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
        }
      );
    } else {
      await NotificationService.createBroadcastNotification(
        unpublished.created_by,
        `Quy định chung đã gỡ: ${unpublished.title}`,
        `Quy định chung "${unpublished.title}" đã được chuyển về trạng thái nháp và không còn hiệu lực.`,
        {
          type: "regulation_unpublished",
          regulation_id: unpublished.regulation_id,
        }
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
      userRole
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
          "You do not have permission to access general regulations"
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
          "You do not have permission to access regulations for this building"
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
      userRole
    );
    if (!hasAccess) {
      throw new Error(
        "You do not have permission to provide feedback on this regulation"
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
          "You do not have permission to access statistics for this building"
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

  async getRegulationByBot(regulationId, tenantUserId = null, botInfo) {
    const regulation = await prisma.regulations.findUnique({
      where: { regulation_id: regulationId },
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
        regulation_feedbacks: {
          include: {
            users: {
              select: {
                user_id: true,
                full_name: true,
                email: true,
              },
            },
          },
          orderBy: { created_at: "desc" },
          take: 10,
        },
      },
    });

    if (!regulation) {
      throw new Error("Regulation not found");
    }

    if (regulation.status === "deleted") {
      throw new Error("This regulation has been deleted");
    }

    if (tenantUserId) {
      const tenant = await prisma.tenants.findUnique({
        where: { user_id: tenantUserId },
        include: {
          rooms: {
            where: { is_active: true },
            select: {
              building_id: true,
            },
          },
        },
      });

      if (!tenant) {
        throw new Error("Tenant not found");
      }

      const tenantBuildingIds = tenant.rooms.map((r) => r.building_id);

      if (
        regulation.building_id &&
        !tenantBuildingIds.includes(regulation.building_id)
      ) {
        throw new Error(
          "This regulation does not apply to the specified tenant"
        );
      }

      if (regulation.target !== "all" && regulation.target !== "tenant") {
        throw new Error("This regulation does not apply to tenants");
      }
    }

    return this.formatRegulationDetailResponse(regulation);
  }

  async getRegulationsByBot(filters = {}, botInfo) {
    const {
      building_id,
      status,
      target,
      version,
      page = 1,
      limit = 20,
    } = filters;

    const skip = (page - 1) * limit;
    const where = {
      status: status || "published",
    };

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

    if (target) {
      where.target = target;
    }

    if (version !== undefined && version !== "") {
      const ver = parseInt(version);
      if (!isNaN(ver)) {
        where.version = ver;
      }
    }

    const [regulations, total] = await Promise.all([
      prisma.regulations.findMany({
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
        orderBy: [{ created_at: "desc" }],
      }),
      prisma.regulations.count({ where }),
    ]);

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

  async getRegulationsByBuildingForBot(buildingId, filters = {}, botInfo) {
    const {
      status,
      target,
      latest_only = false,
      page = 1,
      limit = 20,
    } = filters;

    if (buildingId !== null) {
      const building = await prisma.buildings.findUnique({
        where: { building_id: buildingId },
      });

      if (!building) {
        throw new Error("Building not found");
      }
    }

    const skip = (page - 1) * limit;
    const where = {
      building_id: buildingId,
      status: status || "published",
    };

    if (target) {
      where.target = target;
    }

    if (latest_only === true || latest_only === "true") {
      const allRegulations = await prisma.regulations.findMany({
        where,
        orderBy: [{ title: "asc" }, { version: "desc" }],
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
      });

      const latestRegulations = [];
      const seenTitles = new Set();

      for (const regulation of allRegulations) {
        if (!seenTitles.has(regulation.title)) {
          latestRegulations.push(regulation);
          seenTitles.add(regulation.title);
        }
      }

      return {
        data: latestRegulations.map((r) =>
          this.formatRegulationListResponse(r)
        ),
        pagination: {
          total: latestRegulations.length,
          page: 1,
          limit: latestRegulations.length,
          pages: 1,
        },
      };
    }

    const [regulations, total] = await Promise.all([
      prisma.regulations.findMany({
        where,
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
        skip,
        take: limit,
        orderBy: [{ created_at: "desc" }],
      }),
      prisma.regulations.count({ where }),
    ]);

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

  async addRegulationFeedbackByBot(
    regulationId,
    tenantUserId,
    comment,
    botInfo
  ) {
    const regulation = await prisma.regulations.findUnique({
      where: { regulation_id: regulationId },
      include: {
        buildings: {
          select: {
            building_id: true,
            name: true,
          },
        },
      },
    });

    if (!regulation) {
      throw new Error("Regulation not found");
    }

    if (regulation.status !== "published") {
      throw new Error("Can only add feedback to published regulations");
    }

    const tenant = await prisma.tenants.findUnique({
      where: { user_id: tenantUserId },
      include: {
        users: {
          select: {
            user_id: true,
            full_name: true,
            email: true,
            status: true,
          },
        },
        rooms: {
          where: { is_active: true },
          select: {
            building_id: true,
          },
        },
      },
    });

    if (!tenant) {
      throw new Error("Tenant not found");
    }

    if (tenant.users.status !== "Active") {
      throw new Error("Tenant account is not active");
    }

    if (regulation.building_id) {
      const tenantBuildingIds = tenant.rooms.map((r) => r.building_id);
      if (!tenantBuildingIds.includes(regulation.building_id)) {
        throw new Error(
          "This regulation does not apply to the specified tenant"
        );
      }
    }

    if (regulation.target !== "all" && regulation.target !== "tenant") {
      throw new Error("This regulation does not apply to tenants");
    }

    const botComment = [
      `🤖 Feedback from Bot`,
      `Bot: ${botInfo.name}`,
      `Submitted at: ${new Date().toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
      })}`,
      `Tenant: ${tenant.users.full_name}`,
      "",
      comment,
    ].join("\n");

    const feedback = await prisma.regulation_feedbacks.create({
      data: {
        regulation_id: regulationId,
        created_by: tenantUserId,
        comment: botComment,
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

    try {
      const regulationTitle = regulation.title;
      const buildingInfo = regulation.buildings?.name
        ? ` tại ${regulation.buildings.name}`
        : "";

      await NotificationService.createNotification(
        null,
        regulation.created_by,
        "Phản hồi mới cho quy định",
        `Có phản hồi mới từ ${tenant.users.full_name} cho quy định "${regulationTitle}"${buildingInfo}.`,
        {
          type: "regulation_feedback_by_bot",
          regulation_id: regulationId,
          feedback_id: feedback.feedback_id,
          link: `/regulations/${regulationId}`,
        }
      );
    } catch (notificationError) {
      console.error("Error sending feedback notification:", notificationError);
    }

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

  async getRegulationFeedbacksByBot(regulationId, filters = {}, botInfo) {
    const { page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const regulation = await prisma.regulations.findUnique({
      where: { regulation_id: regulationId },
    });

    if (!regulation) {
      throw new Error("Regulation not found");
    }

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

  async getRegulationVersionsByBot(title, buildingId = null, botInfo) {
    const whereClause = {
      title: title.trim(),
      building_id: buildingId ? parseInt(buildingId) : null,
      status: "published",
    };

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
      throw new Error("No published regulations found with this title");
    }

    return versions.map((v) => this.formatRegulationListResponse(v));
  }

  // Helper - Format response
  formatRegulationResponse(regulation) {
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

      created_by: {
        user_id: regulation.creator.user_id,
        full_name: regulation.creator.full_name,
        email: regulation.creator.email,
      },

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
      building_name: regulation.buildings?.name,
      effective_date: regulation.effective_date,
      version: regulation.version,
      status: regulation.status,
      target: regulation.target,
      created_by: {
        user_id: regulation.users?.user_id,
        full_name: regulation.users?.full_name,
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
      building: regulation.building_id
        ? {
            building_id: regulation.buildings?.building_id,
            name: regulation.buildings?.name,
            address: regulation.buildings?.address,
          }
        : null,
      effective_date: regulation.effective_date,
      version: regulation.version,
      status: regulation.status,
      target: regulation.target,
      created_by: {
        user_id: regulation.users?.user_id,
        full_name: regulation.users?.full_name,
        email: regulation.users?.email,
      },
      note: regulation.note,
      feedbacks:
        regulation.regulation_feedbacks?.map((f) => ({
          feedback_id: f.feedback_id,
          comment: f.comment,
          created_by: {
            user_id: f.users.user_id,
            full_name: f.users.full_name,
            email: f.users.email,
          },
          created_at: f.created_at,
        })) || [],
      created_at: regulation.created_at,
      updated_at: regulation.updated_at,
    };
  }
}

module.exports = new RegulationService();
