// Updated: 2025-21-11
// by: DatNB

const prisma = require("../config/prisma");
const NotificationService = require("./notification.service");

class MaintenanceService {
  // CREATE - Tenant tạo yêu cầu bảo trì cho phòng đang ở
  async createMaintenanceRequest(data, currentUser) {
    let { room_id, title, description, category, priority, note } = data;

    // 1. Basic Validation
    if (!title || title.trim() === "") throw new Error("Missing required field: title");
    if (currentUser.role !== "TENANT") throw new Error("Only tenants can create maintenance requests");

    let targetRoomId = room_id ? parseInt(room_id) : null;

    // 2. [GUARD] Strict Room Validation
    // Strategy: Fetch ALL active residencies for this user
    const activeResidencies = await prisma.room_tenants.findMany({
      where: {
        tenant_user_id: currentUser.user_id,
        is_current: true
      },
      select: { room_id: true }
    });

    const activeRoomIds = activeResidencies.map(r => r.room_id);

    if (activeRoomIds.length === 0) {
      throw new Error("You do not have any active room contracts.");
    }

    // Case A: Room ID provided -> Check ownership
    if (targetRoomId) {
      if (!activeRoomIds.includes(targetRoomId)) {
        throw new Error("Unauthorized: You do not live in this room.");
      }
    }
    // Case B: No Room ID provided -> Auto-detect
    else {
      if (activeRoomIds.length === 1) {
        targetRoomId = activeRoomIds[0]; // Auto-select the only room
      } else {
        throw new Error("You have multiple active rooms. Please specify 'room_id'.");
      }
    }

    // 3. Create Request
    const maintenanceRequest = await prisma.maintenance_requests.create({
      data: {
        tenant_user_id: currentUser.user_id,
        room_id: targetRoomId,
        title: title.trim(),
        description: description || null,
        category: category || null,
        priority: priority || "normal",
        status: "pending",
        note: note || null,
        created_at: new Date(),
        updated_at: new Date(),
      },
      include: {
        room: {
          select: {
            room_number: true,
            building: { select: { name: true } },
          },
        },
        tenant: {
          select: {
            user: { select: { full_name: true, email: true, phone: true } },
          },
        },
        assignee: { select: { full_name: true, email: true } },
        approver: { select: { full_name: true, email: true } },
      },
    });

    /* ======================
     * 5. FORMAT RESPONSE
     * ====================== */
    return this.formatMaintenanceResponse(maintenanceRequest);
  }

  // READ - Lấy yêu cầu bảo trì theo ID
  async getMaintenanceRequestById(requestId, currentUser) {
    const maintenanceRequest = await prisma.maintenance_requests.findUnique({
      where: { request_id: requestId },
      include: {
        room: { include: { building: true } },
        tenant: { select: { user: { select: { full_name: true, email: true, phone: true } } } },
        assignee: { select: { full_name: true, email: true } },
        approver: { select: { full_name: true, email: true } },
      },
    });
    if (!maintenanceRequest) throw new Error("Maintenance request not found");
    if (currentUser.role === "TENANT" && maintenanceRequest.tenant_user_id !== currentUser.user_id) {
      throw new Error("You do not have permission to view this maintenance request");
    }
    return this.formatMaintenanceResponse(maintenanceRequest);
  }

  // READ - Lấy danh sách yêu cầu bảo trì (phân trang + filter)
  async getMaintenanceRequests(filters = {}, currentUser) { /* ... */
    const { room_id, tenant_user_id, category, priority, status, page = 1, limit = 20, approved_by } = filters;
    const skip = (page - 1) * limit;
    const where = {};
    if (currentUser.role === "TENANT") where.tenant_user_id = currentUser.user_id;
    else if (tenant_user_id) where.tenant_user_id = Number(tenant_user_id);
    if (room_id) where.room_id = Number(room_id);
    if (category) where.category = category;
    if (priority) where.priority = priority;
    if (status) where.status = status;
    if (approved_by) where.approved_by = Number(approved_by);

    const [requests, total] = await Promise.all([
      prisma.maintenance_requests.findMany({
        where, skip, take: limit, orderBy: { created_at: "desc" },
        include: {
          room: { select: { room_id: true, room_number: true, building: { select: { name: true } } } },
          tenant: { select: { user: { select: { user_id: true, full_name: true, email: true, phone: true } } } },
          approver: { select: { user_id: true, full_name: true, email: true } },
          assignee: { select: { user_id: true, full_name: true, email: true } },
        },
      }),
      prisma.maintenance_requests.count({ where }),
    ]);
    return { data: requests.map((r) => this.formatMaintenanceResponse(r)), pagination: { total, page, limit, pages: Math.ceil(total / limit) } };
  }

  // UPDATE - Cập nhật yêu cầu bảo trì
  async updateMaintenanceRequest(requestId, data, currentUser) {
    const { title, description, category, priority, status, note } = data;

    // Verify request exists
    const existingRequest = await prisma.maintenance_requests.findUnique({
      where: { request_id: requestId },
    });

    if (!existingRequest) {
      throw new Error("Maintenance request not found");
    }

    // Check permission
    if (currentUser.role === "TENANT") {
      // Tenant chỉ có thể cập nhật yêu cầu của mình và chỉ một số trường
      if (existingRequest.tenant_user_id !== currentUser.user_id) {
        throw new Error(
          "You do not have permission to update this maintenance request",
        );
      }

      // Tenant không thể thay đổi status
      if (status !== undefined) {
        throw new Error("Tenants cannot update status");
      }
    }

    // Prepare update data
    const updateData = {};

    if (title !== undefined) updateData.title = title;
    if (priority !== undefined) updateData.priority = priority;
    if (description !== undefined) updateData.description = description;
    if (category !== undefined) updateData.category = category;
    if (note !== undefined) updateData.note = note;

    // Only manager/owner can update these fields
    if (currentUser.role === "MANAGER" || currentUser.role === "OWNER") {
      if (status) {
        updateData.status = status;

        // Set resolved_at when status changes to resolved or completed
        if (
          (status === "resolved" || status === "completed") &&
          !existingRequest.resolved_at
        ) {
          updateData.resolved_at = new Date();
        }
      }
    }

    const maintenanceRequest = await prisma.maintenance_requests.update({
      where: { request_id: requestId },
      data: updateData,
      include: {
        room: {
          // ✅ sửa từ rooms
          include: {
            building: true, // ✅ sửa từ buildings
          },
        },
        tenant: {
          // ✅ sửa từ tenants
          select: {
            user: {
              // phải include user để lấy thông tin
              select: {
                full_name: true,
                email: true,
                phone: true,
              },
            },
          },
        },
        assignee: {
          // nếu muốn trả về người được giao
          select: {
            full_name: true,
            email: true,
          },
        },
        approver: {
          // nếu muốn trả về người duyệt
          select: {
            full_name: true,
            email: true,
          },
        },
      },
    });

    return this.formatMaintenanceResponse(maintenanceRequest);
  }

  // DELETE - Xóa yêu cầu bảo trì (chỉ tenant có thể xóa yêu cầu của mình khi status là pending)
  async deleteMaintenanceRequest(requestId, currentUser) {
    const maintenanceRequest = await prisma.maintenance_requests.findUnique({
      where: { request_id: requestId },
    });

    if (!maintenanceRequest) {
      throw new Error("Maintenance request not found");
    }

    // Check permission
    if (currentUser.role === "TENANT") {
      if (maintenanceRequest.tenant_user_id !== currentUser.user_id) {
        throw new Error(
          "You do not have permission to delete this maintenance request",
        );
      }

      // Tenant chỉ có thể xóa yêu cầu đang pending
      if (maintenanceRequest.status !== "pending") {
        throw new Error("Can only delete pending maintenance requests");
      }
    }

    await prisma.maintenance_requests.delete({
      where: { request_id: requestId },
    });

    return {
      success: true,
      message: "Maintenance request deleted successfully",
    };
  }
  // APPROVE - Phê duyệt yêu cầu bảo trì
  async approveMaintenanceRequest(requestId, currentUser) {
    // ===== CHECK ROLE =====
    if (!["MANAGER", "OWNER"].includes(currentUser.role)) {
      throw new Error(
        "Only managers and owners can approve maintenance requests",
      );
    }

    const id = Number(requestId);

    // ===== GET REQUEST =====
    const request = await prisma.maintenance_requests.findUnique({
      where: { request_id: id },
      select: {
        request_id: true,
        status: true,
      },
    });

    if (!request) {
      throw new Error("Maintenance request not found");
    }

    // ===== CHỈ DUYỆT KHI PENDING =====
    if (request.status !== "pending") {
      throw new Error("Only pending maintenance requests can be approved");
    }

    // ===== UPDATE =====
    return prisma.maintenance_requests.update({
      where: { request_id: id },
      data: {
        status: "in_progress", // ✅ ĐÚNG ENUM
        approved_by: currentUser.user_id,
        approved_at: new Date(),
      },
    });
  }

  // REJECT - Từ chối yêu cầu bảo trì
  async rejectMaintenanceRequest(requestId, reason, currentUser) {
    // ===== CHECK ROLE =====
    if (!["MANAGER", "OWNER"].includes(currentUser.role)) {
      throw new Error(
        "Only managers and owners can reject maintenance requests",
      );
    }

    const id = Number(requestId);

    // ===== GET REQUEST =====
    const maintenanceRequest = await prisma.maintenance_requests.findUnique({
      where: { request_id: id },
      include: {
        room: {
          // ✅ room (không phải rooms)
          select: {
            room_number: true,
          },
        },
      },
    });

    if (!maintenanceRequest) {
      throw new Error("Maintenance request not found");
    }

    // ===== CHỈ TỪ CHỐI KHI PENDING =====
    if (maintenanceRequest.status !== "pending") {
      throw new Error("Only pending requests can be rejected");
    }

    // ===== UPDATE =====
    const rejected = await prisma.maintenance_requests.update({
      where: { request_id: id },
      data: {
        status: "rejected", // ✅ enum hợp lệ
        approved_by: currentUser.user_id,
        approved_at: new Date(),
        note: reason
          ? `${maintenanceRequest.note || ""}\nRejection reason: ${reason}`
          : maintenanceRequest.note,
        updated_at: new Date(),
      },
      include: {
        room: {
          include: {
            building: true,
          },
        },
        tenant: {
          // ✅ tenant
          include: {
            user: {
              // ✅ user (không phải users)
              select: {
                full_name: true,
                email: true,
                phone: true,
              },
            },
          },
        },
        approver: {
          // ✅ đúng quan hệ
          select: {
            full_name: true,
            email: true,
          },
        },
      },
    });

    // ===== SEND NOTIFICATION =====
    try {
      const roomInfo = maintenanceRequest.room?.room_number
        ? ` phòng ${maintenanceRequest.room.room_number}`
        : "";

      const reasonText = reason ? ` Lý do: ${reason}` : "";

      await NotificationService.createNotification(
        currentUser.user_id, // sender
        maintenanceRequest.tenant_user_id, // receiver
        "Yêu cầu bảo trì đã bị từ chối",
        `Yêu cầu bảo trì "${maintenanceRequest.title}"${roomInfo} đã bị từ chối.${reasonText}`,
        {
          type: "maintenance_rejected",
          request_id: id,
          reason,
          link: `/maintenance/${id}`,
        },
      );
    } catch (err) {
      console.error("Error sending rejection notification:", err);
    }

    return this.formatMaintenanceResponse(rejected);
  }

  // RESOLVE - Đánh dấu đã giải quyết
  async resolveMaintenanceRequest(requestId, currentUser) {
    // ===== CHECK ROLE =====
    if (!["MANAGER", "OWNER"].includes(currentUser.role)) {
      throw new Error(
        "Only managers and owners can resolve maintenance requests",
      );
    }

    const id = Number(requestId);

    // ===== GET REQUEST =====
    const maintenanceRequest = await prisma.maintenance_requests.findUnique({
      where: { request_id: id },
      include: {
        room: {
          // ✅ ĐÚNG TÊN QUAN HỆ
          select: {
            room_number: true,
          },
        },
      },
    });

    if (!maintenanceRequest) {
      throw new Error("Maintenance request not found");
    }

    // ===== CHECK STATUS =====
    if (["resolved", "completed"].includes(maintenanceRequest.status)) {
      throw new Error("Maintenance request is already resolved");
    }

    if (maintenanceRequest.status === "pending") {
      throw new Error(
        "Cannot resolve a pending request. Please approve it first",
      );
    }

    if (!["in_progress", "on_hold"].includes(maintenanceRequest.status)) {
      throw new Error(
        "Maintenance request cannot be resolved in its current status",
      );
    }

    // ===== UPDATE =====
    const resolved = await prisma.maintenance_requests.update({
      where: { request_id: id },
      data: {
        status: "resolved", // enum hợp lệ
        resolved_at: new Date(),
        updated_at: new Date(),
      },
      include: {
        room: {
          include: {
            building: true,
          },
        },
        tenant: {
          include: {
            user: {
              // ✅ FIX
              select: {
                full_name: true,
                email: true,
                phone: true,
              },
            },
          },
        },
        assignee: {
          select: {
            full_name: true,
            email: true,
          },
        },
      },
    });

    // ===== SEND NOTIFICATION =====
    try {
      const roomInfo = maintenanceRequest.room?.room_number
        ? ` phòng ${maintenanceRequest.room.room_number}`
        : "";

      await NotificationService.createNotification(
        currentUser.user_id, // sender
        maintenanceRequest.tenant_user_id, // recipient
        "Yêu cầu bảo trì đã được giải quyết",
        `Yêu cầu bảo trì "${maintenanceRequest.title}"${roomInfo} đã được giải quyết xong.`,
        {
          type: "maintenance_resolved",
          request_id: id,
          link: `/maintenance/${id}`,
        },
      );
    } catch (error) {
      console.error("Error sending resolve notification:", error);
    }

    return this.formatMaintenanceResponse(resolved);
  }

  // COMPLETE - Đánh dấu hoàn thành
  async completeMaintenanceRequest(requestId, currentUser) {
    // Only manager/owner can complete
    if (currentUser.role !== "MANAGER" && currentUser.role !== "OWNER") {
      throw new Error(
        "Only managers and owners can complete maintenance requests",
      );
    }

    const maintenanceRequest = await prisma.maintenance_requests.findUnique({
      where: { request_id: requestId },
    });

    if (!maintenanceRequest) {
      throw new Error("Maintenance request not found");
    }

    if (maintenanceRequest.status !== "resolved") {
      throw new Error("Only resolved requests can be marked as completed");
    }

    const completed = await prisma.maintenance_requests.update({
      where: { request_id: requestId },
      data: {
        status: "completed",
        updated_at: new Date(),
      },
      include: {
        room: {
          include: {
            building: true,
          },
        },
        tenant: {
          include: {
            user: true,
          },
        },
        approver: {
          select: {
            full_name: true,
            email: true,
          },
        },
        assignee: {
          select: {
            full_name: true,
            email: true,
          },
        },
      },
    });

    return this.formatMaintenanceResponse(completed);
  }

  // GET ROOM HISTORY - Lấy lịch sử bảo trì của một phòng
  async getRoomMaintenanceHistory(roomId, filters = {}, currentUser) {
    const {
      category,
      priority,
      status,
      page = 1,
      limit = 20,
      from_date,
      to_date,
    } = filters;

    // Verify room exists
    const room = await prisma.rooms.findUnique({
      where: { room_id: roomId },
      include: {
        building: {
          // ✅ sửa từ 'buildings' thành 'building'
          select: {
            name: true,
            address: true,
          },
        },
      },
    });

    if (!room) {
      throw new Error("Room not found");
    }

    const skip = (page - 1) * limit;

    // Build where clause
    const where = { room_id: roomId };

    if (category) where.category = category;
    if (priority) where.priority = priority;
    if (status) where.status = status;

    // Date range filter
    if (from_date || to_date) {
      where.created_at = {};
      if (from_date) where.created_at.gte = new Date(from_date);
      if (to_date) where.created_at.lte = new Date(to_date);
    }

    const [requests, total, statistics] = await Promise.all([
      prisma.maintenance_requests.findMany({
        where,
        include: {
          tenant: {
            // ✅ đúng tên quan hệ
            select: {
              user: {
                // phải include user để lấy thông tin
                select: {
                  full_name: true,
                  email: true,
                  phone: true,
                },
              },
            },
          },
          assignee: {
            select: {
              full_name: true,
              email: true,
            },
          },
          approver: {
            select: {
              full_name: true,
              email: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: { created_at: "desc" },
      }),
      prisma.maintenance_requests.count({ where }),
      prisma.maintenance_requests.groupBy({
        by: ["status"],
        where: { room_id: roomId },
        _count: true,
      }),
    ]);

    // Calculate statistics
    const stats = {
      total_requests: total,
      by_status: {},
      by_category: {},
    };

    statistics.forEach((stat) => {
      stats.by_status[stat.status] = stat._count;
    });

    // Get category statistics
    const categoryStats = await prisma.maintenance_requests.groupBy({
      by: ["category"],
      where: { room_id: roomId },
      _count: true,
    });

    categoryStats.forEach((stat) => {
      if (stat.category) stats.by_category[stat.category] = stat._count;
    });

    return {
      room_info: {
        room_id: room.room_id,
        room_number: room.room_number,
        floor: room.floor,
        building_name: room.building?.name, // ✅ sửa từ buildings
        building_address: room.building?.address,
      },
      statistics: stats,
      data: requests.map((r) => this.formatMaintenanceResponse(r)),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  // GET STATISTICS - Thống kê tổng quan maintenance
  async getMaintenanceStatistics(filters = {}, currentUser) {
    const { room_id, building_id, from_date, to_date } = filters;

    const where = {};

    // Apply filters
    if (room_id) where.room_id = parseInt(room_id);

    if (building_id) {
      // Get all rooms in building
      const rooms = await prisma.rooms.findMany({
        where: { building_id: parseInt(building_id) },
        select: { room_id: true },
      });
      where.room_id = { in: rooms.map((r) => r.room_id) };
    }

    // Date range filter
    if (from_date || to_date) {
      where.created_at = {};
      if (from_date) {
        where.created_at.gte = new Date(from_date);
      }
      if (to_date) {
        where.created_at.lte = new Date(to_date);
      }
    }

    // Tenant can only see their own requests
    if (currentUser.role === "TENANT") {
      where.tenant_user_id = currentUser.user_id;
    }

    const [total, byStatus, byCategory, byPriority, avgResolutionTime] =
      await Promise.all([
        // Total requests
        prisma.maintenance_requests.count({ where }),

        // Group by status
        prisma.maintenance_requests.groupBy({
          by: ["status"],
          where,
          _count: true,
        }),

        // Group by category
        prisma.maintenance_requests.groupBy({
          by: ["category"],
          where,
          _count: true,
        }),

        // Group by priority
        prisma.maintenance_requests.groupBy({
          by: ["priority"],
          where,
          _count: true,
        }),

        // Get resolved requests for avg time calculation
        prisma.maintenance_requests.findMany({
          where: {
            ...where,
            resolved_at: { not: null },
          },
          select: {
            created_at: true,
            resolved_at: true,
          },
        }),
      ]);

    // Calculate average resolution time (in hours)
    let avgTime = 0;
    if (avgResolutionTime.length > 0) {
      const totalTime = avgResolutionTime.reduce((sum, req) => {
        const diff = new Date(req.resolved_at) - new Date(req.created_at);
        return sum + diff / (1000 * 60 * 60); // Convert to hours
      }, 0);
      avgTime = totalTime / avgResolutionTime.length;
    }

    return {
      total_requests: total,
      by_status: byStatus.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {}),
      by_category: byCategory.reduce((acc, item) => {
        if (item.category) acc[item.category] = item._count;
        return acc;
      }, {}),
      by_priority: byPriority.reduce((acc, item) => {
        acc[item.priority] = item._count;
        return acc;
      }, {}),
      average_resolution_time_hours: Math.round(avgTime * 100) / 100,
    };
  }

  /**
   * CREATE BY BOT
   */
  async createMaintenanceRequestByBot(data, tenantUserId, botInfo) {
    const { room_id, title, description, category, priority, note } = data;

    // 1. Validate Tenant Exists & Active
    const tenant = await prisma.tenants.findUnique({
      where: { user_id: tenantUserId },
      include: {
        user: { select: { status: true, full_name: true } },
      },
    });

    if (!tenant) throw new Error("Tenant not found");
    if (tenant.user.status !== "Active")
      throw new Error("Tenant account is not active");

    // 2. Resolve Room ID
    // If bot didn't send room_id, try to find the tenant's current active room
    let targetRoomId = room_id ? parseInt(room_id) : null;

    if (!targetRoomId) {
      // Find where they currently live
      const currentLiving = await prisma.room_tenants.findFirst({
        where: { tenant_user_id: tenantUserId, is_current: true },
      });

      if (!currentLiving)
        throw new Error("Tenant is not currently assigned to any room");
      targetRoomId = currentLiving.room_id;
    } else {
      // Validate provided room_id against tenant's access
      const isAuthorized = await prisma.room_tenants.findFirst({
        where: {
          room_id: targetRoomId,
          tenant_user_id: tenantUserId,
          is_current: true,
        },
      });

      if (!isAuthorized)
        throw new Error("Tenant does not have access to this room");
    }

    // 3. Prepare Data
    const botDescription = [
      description || "",
      `---`,
      `🤖 Created by AI Assistant (${botInfo.name || "SAMI Bot"})`,
    ].join("\n");

    // 4. Create Request
    const request = await prisma.maintenance_requests.create({
      data: {
        tenant_user_id: tenantUserId,
        room_id: targetRoomId,
        title: title || "Yêu cầu bảo trì (từ Chatbot)",
        description: botDescription,
        category: category || "other",
        priority: priority || "normal",
        status: "pending",
        note: note || "Created via Chatbot Interface",
        created_at: new Date(),
        updated_at: new Date(),
      },
      include: {
        room: {
          select: {
            room_number: true,
            building: { select: { name: true } },
          },
        },
        tenant: {
          select: { user: { select: { full_name: true } } },
        },
      },
    });

    // 5. Notify Tenant (Confirmation)
    try {
      const roomName = request.room?.room_number || "Unknown Room";
      await NotificationService.createNotification(
        null, // System sender
        tenantUserId,
        "✅ Yêu cầu bảo trì đã được tạo",
        `Chatbot đã giúp bạn tạo yêu cầu: "${request.title}" cho phòng ${roomName}.`,
        {
          type: "maintenance_bot_created",
          request_id: request.request_id,
          link: `/maintenance/${request.request_id}`,
        },
      );
    } catch (e) {
      console.error("[Bot] Failed to send notification:", e.message);
    }

    return this.formatMaintenanceResponse(request);
  }

  /**
   * UPDATE BY BOT
   */
  async updateMaintenanceRequestByBot(requestId, data, tenantUserId, botInfo) {
    const { title, description, category, priority } = data;

    // 1. Verify Ownership & Status
    const existing = await prisma.maintenance_requests.findUnique({
      where: { request_id: requestId },
    });

    if (!existing) throw new Error("Request not found");
    if (existing.tenant_user_id !== tenantUserId)
      throw new Error("Unauthorized access");
    if (existing.status !== "pending")
      throw new Error("Can only update pending requests");

    // 2. Prepare Update
    const updateData = { updated_at: new Date() };
    if (title) updateData.title = title;
    if (category) updateData.category = category;
    if (priority) updateData.priority = priority;
    if (description) {
      updateData.description = `${description}\n\n[Updated by Bot at ${new Date().toLocaleString()}]`;
    }

    // 3. Execute
    const updated = await prisma.maintenance_requests.update({
      where: { request_id: requestId },
      data: updateData,
      include: { room: true, tenant: { include: { user: true } } },
    });

    return this.formatMaintenanceResponse(updated);
  }

  /**
   * DELETE BY BOT
   */
  async deleteMaintenanceRequestByBot(requestId, tenantUserId, botInfo) {
    const existing = await prisma.maintenance_requests.findUnique({
      where: { request_id: requestId },
    });

    if (!existing) throw new Error("Request not found");
    if (existing.tenant_user_id !== tenantUserId)
      throw new Error("Unauthorized access");
    if (existing.status !== "pending")
      throw new Error("Can only delete pending requests");

    await prisma.maintenance_requests.delete({
      where: { request_id: requestId },
    });

    return { success: true, message: "Request deleted successfully" };
  }

  // Helper function - Format response
  formatMaintenanceResponse(request) {
    return {
      request_id: request.request_id,

      tenant_user_id: request.tenant_user_id,
      tenant_name: request.tenant?.user?.full_name || null,
      tenant_email: request.tenant?.user?.email || null,
      tenant_phone: request.tenant?.user?.phone || null,

      room_id: request.room_id || null,
      room_number: request.room?.room_number || null,
      building_name: request.room?.building?.name || null,

      title: request.title,
      description: request.description,
      category: request.category,
      priority: request.priority,
      status: request.status,

      approved_by: request.approved_by,
      approved_by_name: request.approver?.full_name || null,
      approved_by_email: request.approver?.email || null,
      approved_at: request.approved_at,

      assigned_to: request.assigned_to,
      assignee_name: request.assignee?.full_name || null,
      assignee_email: request.assignee?.email || null,
      assigned_at: request.assigned_at,

      note: request.note,

      created_at: request.created_at,
      updated_at: request.updated_at,
      resolved_at: request.resolved_at,
    };
  }
}

module.exports = new MaintenanceService();
