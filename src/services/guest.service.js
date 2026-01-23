// Updated: 2025-11-12
// by: DatNB

const prisma = require("../config/prisma");
const NotificationService = require("./notification.service");

class GuestService {

  // Tenant creates a guest registration with multiple guests
  async createGuestRegistration(tenantUserId, data) {
    function isValidVietnamCCCD(cccd) {
      if (!cccd) return false;

      // 12 digits
      if (!/^\d{12}$/.test(cccd)) return false;

      const genderCenturyDigit = cccd.charAt(3);

      // Chỉ chấp nhận 0,1,2,3
      if (!["0", "1", "2", "3"].includes(genderCenturyDigit)) {
        return false;
      }

      return true;
    }
    function normalizeIdNumber(id) {
      return id?.trim();
    }
    const {
      room_id,
      arrival_date,
      departure_date,
      note,
      guest_details,
    } = data;

    if (!room_id) {
      throw new Error("Phải chọn phòng");
    }

    // Lấy tất cả phòng current của tenant
    const currentResidencies = await prisma.room_tenants.findMany({
      where: {
        tenant_user_id: tenantUserId,
        is_current: true,
      },
      include: {
        room: {
          include: {
            current_contract: true
          }
        }
      }
    });

    if (currentResidencies.length === 0) {
      throw new Error("Người thuê không có phòng đang ở");
    }

    // Check room có thuộc tenant không
    const selectedResidency = currentResidencies.find(
      r => r.room_id === room_id
    );

    if (!selectedResidency) {
      throw new Error("Bạn không có quyền đăng ký khách cho phòng này");
    }

    // Check contract active
    const contract = selectedResidency.room.current_contract;

    if (!contract || contract.status !== "active") {
      throw new Error("Phòng này không có hợp đồng thuê đang hiệu lực");
    }

    const currentRoom = selectedResidency.room;

    // Validate hợp đồng hiệu lực
    const contractStart = new Date(contract.start_date);
    const contractEnd = new Date(contract.end_date);

    contractStart.setHours(0, 0, 0, 0);
    contractEnd.setHours(23, 59, 59, 999);

    // Validate ngày đến / đi
    const arrival = new Date(arrival_date);
    const departure = new Date(departure_date);

    if (departure <= arrival) {
      throw new Error("Ngày đi phải sau ngày đến");
    }

    const diffDays =
      (departure.getTime() - arrival.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays > 30) {
      throw new Error("Thời gian tạm trú không được vượt quá 30 ngày");
    }

    if (arrival < contractStart || departure > contractEnd) {
      throw new Error("Thời gian tạm trú phải nằm trong thời hạn hợp đồng thuê");
    }

    // ===============================
    // Validate guest_details
    // ===============================
    if (!guest_details || guest_details.length === 0) {
      throw new Error("Phải khai báo ít nhất 1 khách");
    }

    for (const guest of guest_details) {
      if (!guest.full_name) {
        throw new Error("Thiếu họ tên khách");
      }

      if (guest.id_type === "national_id") {
        if (!isValidVietnamCCCD(guest.id_number)) {
          throw new Error(
            `CCCD không hợp lệ: ${guest.id_number}`
          );
        }
      }
    }
    // Collect CCCD khách
    const guestIdNumbers = guest_details
      .filter(g => g.id_type === "national_id" && g.id_number)
      .map(g => normalizeIdNumber(g.id_number));

    // ---- A. CCCD tenant đang có contract active ----
    const activeTenants = await prisma.contracts.findMany({
      where: {
        status: "active",
        deleted_at: null
      },
      include: {
        tenant: {
          select: {
            id_number: true
          }
        }
      }
    });

    const tenantIdNumbers = activeTenants
      .map(c => normalizeIdNumber(c.tenant?.id_number))
      .filter(Boolean);

    // Check trùng tenant
    for (const id of guestIdNumbers) {
      if (tenantIdNumbers.includes(id)) {
        throw new Error(
          `CCCD ${id} đã tồn tại trong danh sách người thuê đang ở`
        );
      }
    }

    // ---- B. CCCD guest còn hiệu lực ----
    const now = new Date();

    const activeGuests = await prisma.guest_details.findMany({
      where: {
        id_number: {
          in: guestIdNumbers
        },
        registration: {
          status: "approved",
          arrival_date: { lte: now },
          departure_date: { gte: now }
        }
      },
      select: {
        id_number: true
      }
    });

    if (activeGuests.length > 0) {
      throw new Error(
        `CCCD ${activeGuests[0].id_number} đã được báo cáo tạm trú và còn hiệu lực`
      );
    }
    // ===============================
    // Create báo cáo (AUTO APPROVED)
    // ===============================
    return prisma.guest_registrations.create({
      data: {
        host_user_id: tenantUserId,
        room_id: currentRoom.room_id,
        arrival_date: arrival,
        departure_date: departure,
        status: "approved",
        approved_at: new Date(),
        note,
        guest_details: {
          create: guest_details.map(g => ({
            full_name: g.full_name,
            id_type: g.id_type || "national_id",
            id_number: g.id_number,
            date_of_birth: g.date_of_birth
              ? new Date(g.date_of_birth)
              : null,
            gender: g.gender,
            relationship: g.relationship,
            note: g.note
          }))
        }
      },
      include: {
        room: {
          include: {
            building: true
          }
        },
        guest_details: true
      }
    });
  }

  // Get guest registration by ID
  async getGuestRegistrationById(registrationId, userId, userRole) {
    const registration = await prisma.guest_registrations.findUnique({
      where: { registration_id: registrationId },
      include: {
        host: {
          include: {
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
        room: {
          select: {
            room_id: true,
            room_number: true,
            floor: true,
            building: {
              select: {
                building_id: true,
                name: true,
                address: true,
              },
            },
          },
        },
        approver: {
          select: {
            user_id: true,
            full_name: true,
            email: true,
          },
        },
        canceller: {
          select: {
            user_id: true,
            full_name: true,
            email: true,
          },
        },
        guest_details: {
          orderBy: {
            detail_id: "asc",
          },
        },
      },
    });

    if (!registration) {
      throw new Error("Guest registration not found");
    }

    // Check authorization
    if (userRole === "TENANT" && registration.host_user_id !== userId) {
      throw new Error("Unauthorized to view this registration");
    }

    return registration;
  }

  // Get all guest registrations with filters
  async getGuestRegistrations(filters, user) {
    const {
      status,
      host_user_id,
      room_id,
      building_id,
      arrival_date_from,
      arrival_date_to,
      page = 1,
      limit = 10,
    } = filters;

    const where = {};

    // ================= ROLE FILTER =================

    // TENANT: chỉ xem báo cáo của mình
    if (user.role === "TENANT") {
      where.host_user_id = user.user_id;
    }

    // MANAGER: chỉ xem báo cáo trong building được phân công
    if (user.role === "MANAGER") {
      const managerBuilding = await prisma.building_managers.findFirst({
        where: { user_id: user.user_id },
        select: { building_id: true },
      });

      if (!managerBuilding) {
        throw new Error("Quản lý chưa được phân công tòa nhà");
      }

      where.room = {
        building_id: managerBuilding.building_id,
      };
    }

    // OWNER: xem tất cả, có thể filter theo building
    if (user.role === "OWNER" && building_id) {
      where.room = {
        building_id,
      };
    }

    // ================= BUSINESS FILTER =================
    if (status) {
      where.status = status;
    }

    if (host_user_id && user.role === "OWNER") {
      where.host_user_id = host_user_id;
    }

    if (room_id) {
      where.room_id = room_id;
    }

    if (arrival_date_from || arrival_date_to) {
      where.arrival_date = {};
      if (arrival_date_from) {
        where.arrival_date.gte = new Date(arrival_date_from);
      }
      if (arrival_date_to) {
        where.arrival_date.lte = new Date(arrival_date_to);
      }
    }

    const skip = (page - 1) * limit;

    const [registrations, total] = await Promise.all([
      prisma.guest_registrations.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: "desc" },

        select: {
          registration_id: true,
          arrival_date: true,
          departure_date: true,
          status: true,
          note: true,
          created_at: true,
          submitted_at: true,

          // ================= GUEST =================
          guest_details: {
            select: {
              detail_id: true,
              full_name: true,
              id_number: true,
            },
          },

          _count: {
            select: {
              guest_details: true,
            },
          },

          // ================= HOST =================
          host: {
            select: {
              user_id: true,
              user: {
                select: {
                  full_name: true,
                  phone: true,
                  email: true,
                },
              },
            },
          },

          // ================= ROOM =================
          room: {
            select: {
              room_id: true,
              room_number: true,
              floor: true,
              building: {
                select: {
                  building_id: true,
                  name: true,
                },
              },
            },
          },

          // ================= APPROVER =================
          approver: {
            select: {
              user_id: true,
              full_name: true,
            },
          },
        },
      }),

      prisma.guest_registrations.count({ where }),
    ]);

    // ================= MAP guest_count =================
    const mappedRegistrations = registrations.map((r) => ({
      ...r,
      guest_count: r._count.guest_details,
      _count: undefined,
    }));

    return {
      registrations: mappedRegistrations,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Update guest registration (only by tenant who created it, and only if status is pending)
  async updateGuestRegistration(registrationId, tenantUserId, data) {
    const {
      guest_count,
      room_id,
      arrival_date,
      departure_date,
      note,
      guest_details,
    } = data;

    // Find existing registration
    const existing = await prisma.guest_registrations.findUnique({
      where: { registration_id: registrationId },
      include: {
        guest_details: true,
      },
    });

    if (!existing) {
      throw new Error("Guest registration not found");
    }

    // Check authorization
    if (existing.host_user_id !== tenantUserId) {
      throw new Error("Unauthorized to update this registration");
    }

    // Can only update if status is pending
    if (existing.status !== "pending") {
      throw new Error(
        `Cannot update registration with status: ${existing.status}`
      );
    }

    // If room_id provided, verify it exists
    if (room_id) {
      const room = await prisma.rooms.findUnique({
        where: { room_id },
      });

      if (!room) {
        throw new Error("Room not found");
      }
    }

    // Validate dates
    if (arrival_date && departure_date) {
      const arrival = new Date(arrival_date);
      const departure = new Date(departure_date);

      if (departure <= arrival) {
        throw new Error("Departure date must be after arrival date");
      }
    }

    // Validate guest_count vs guest_details if both provided
    if (guest_details && guest_details.length > 0) {
      if (guest_count && guest_count !== guest_details.length) {
        throw new Error(
          `Guest count (${guest_count}) does not match number of guest details (${guest_details.length})`
        );
      }
    }

    // Use transaction for complex update
    const updated = await prisma.$transaction(async (tx) => {
      // Calculate final guest count
      const finalGuestCount =
        guest_details && guest_details.length > 0
          ? guest_details.length
          : guest_count !== undefined
            ? guest_count
            : existing.guest_count;

      // Update main registration
      await tx.guest_registrations.update({
        where: { registration_id: registrationId },
        data: {
          guest_count: finalGuestCount,
          room_id: room_id !== undefined ? room_id : undefined,
          arrival_date: arrival_date ? new Date(arrival_date) : undefined,
          departure_date: departure_date ? new Date(departure_date) : undefined,
          note: note !== undefined ? note : undefined,
        },
      });

      // Update guest details if provided
      if (guest_details && guest_details.length > 0) {
        // Delete old details
        await tx.guest_details.deleteMany({
          where: { registration_id: registrationId },
        });

        // Create new details
        await tx.guest_details.createMany({
          data: guest_details.map((detail) => ({
            registration_id: registrationId,
            full_name: detail.full_name,
            id_type: detail.id_type || "national_id",
            id_number: detail.id_number,
            date_of_birth: detail.date_of_birth
              ? new Date(detail.date_of_birth)
              : null,
            nationality: detail.nationality,
            gender: detail.gender,
            relationship: detail.relationship,
            note: detail.note,
          })),
        });
      }

      // Return updated registration with details
      return await tx.guest_registrations.findUnique({
        where: { registration_id: registrationId },
        include: {
          host: {
            include: {
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
          room: {
            select: {
              room_id: true,
              room_number: true,
              floor: true,
              building: {
                select: {
                  building_id: true,
                  name: true,
                },
              },
            },
          },
          guest_details: {
            orderBy: {
              detail_id: "asc",
            },
          },
        },
      });
    });

    return updated;
  }

  // Approve guest registration (Manager/Owner only)
  async approveGuestRegistration(registrationId, approvedBy) {
    const registration = await prisma.guest_registrations.findUnique({
      where: { registration_id: registrationId },
      include: {
        room: {
          select: {
            room_number: true,
          },
        },
      },
    });

    if (!registration) {
      throw new Error("Guest registration not found");
    }

    if (registration.status !== "pending") {
      throw new Error(
        `Cannot approve registration with status: ${registration.status}`
      );
    }

    const approved = await prisma.guest_registrations.update({
      where: { registration_id: registrationId },
      data: {
        status: "approved",
        approved_by: approvedBy,
        approved_at: new Date(),
      },
      include: {
        host: {
          include: {
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
        room: {
          select: {
            room_id: true,
            room_number: true,
            floor: true,
          },
        },
        approver: {
          select: {
            user_id: true,
            full_name: true,
            email: true,
          },
        },
        guest_details: {
          orderBy: {
            detail_id: "asc",
          },
        },
      },
    });

    // Send notification to tenant
    try {
      const roomInfo = registration.rooms?.room_number
        ? ` cho phòng ${registration.rooms.room_number}`
        : "";

      await NotificationService.createNotification(
        approvedBy, // sender (manager/owner)
        registration.host_user_id, // recipient (tenant)
        "Đơn đăng ký khách đã được chấp nhận",
        `Đơn đăng ký khách${roomInfo} của bạn đã được chấp nhận. Số lượng khách: ${registration.guest_count}`,
        {
          type: "guest_registration_approved",
          registration_id: registrationId,
          link: `/guest-registrations/${registrationId}`,
        }
      );
    } catch (notificationError) {
      console.error("Error sending approval notification:", notificationError);
      // Don't fail the approval if notification fails
    }

    return approved;
  }

  // Reject guest registration (Manager/Owner only)
  async rejectGuestRegistration(registrationId, approvedBy, rejectionReason) {
    const registration = await prisma.guest_registrations.findUnique({
      where: { registration_id: registrationId },
      include: {
        room: {
          select: {
            room_number: true,
          },
        },
      },
    });

    if (!registration) {
      throw new Error("Guest registration not found");
    }

    if (registration.status !== "pending") {
      throw new Error(
        `Cannot reject registration with status: ${registration.status}`
      );
    }

    const rejected = await prisma.guest_registrations.update({
      where: { registration_id: registrationId },
      data: {
        status: "rejected",
        approved_by: approvedBy,
        approved_at: new Date(),
        cancellation_reason: rejectionReason, // Store reason in cancellation_reason field
      },
      include: {
        host: {
          include: {
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
        room: {
          select: {
            room_id: true,
            room_number: true,
            floor: true,
          },
        },
        approver: {
          select: {
            user_id: true,
            full_name: true,
            email: true,
          },
        },
        guest_details: {
          orderBy: {
            detail_id: "asc",
          },
        },
      },
    });

    // Send notification to tenant
    try {
      const roomInfo = registration.rooms?.room_number
        ? ` cho phòng ${registration.rooms.room_number}`
        : "";

      const reasonText = rejectionReason ? ` Lý do: ${rejectionReason}` : "";

      await NotificationService.createNotification(
        approvedBy, // sender (manager/owner)
        registration.host_user_id, // recipient (tenant)
        "Đơn đăng ký khách đã bị từ chối",
        `Đơn đăng ký khách${roomInfo} của bạn đã bị từ chối.${reasonText}`,
        {
          type: "guest_registration_rejected",
          registration_id: registrationId,
          reason: rejectionReason,
          link: `/guest-registrations/${registrationId}`,
        }
      );
    } catch (notificationError) {
      console.error("Error sending rejection notification:", notificationError);
      // Don't fail the rejection if notification fails
    }

    return rejected;
  }

  // Cancel guest registration
  async cancelGuestRegistration(
    registrationId,
    userId,
    userRole,
    cancellationReason
  ) {
    const registration = await prisma.guest_registrations.findUnique({
      where: { registration_id: registrationId },
    });

    if (!registration) {
      throw new Error("Không tìm thấy báo cáo khách");
    }

    // Tenant can only cancel their own pending registrations
    if (userRole === "TENANT") {
      if (registration.host_user_id !== userId) {
        throw new Error("Không có quyền hủy báo cáo này");
      }
      if (registration.status == "cancelled" || registration.status == "expired") {
        throw new Error("Báo cáo đã được hủy hoặc hết hạn, không thể hủy lạ");
      }
    }

    const cancelled = await prisma.guest_registrations.update({
      where: { registration_id: registrationId },
      data: {
        status: "cancelled",
        cancelled_by: userId,
        cancelled_at: new Date(),
        cancellation_reason: cancellationReason,
      },
      include: {
        host: {
          include: {
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
        room: {
          select: {
            room_id: true,
            room_number: true,
            floor: true,
          },
        },
        canceller: {
          select: {
            user_id: true,
            full_name: true,
            email: true,
          },
        },
        guest_details: {
          orderBy: {
            detail_id: "asc",
          },
        },
      },
    });

    return cancelled;
  }

  // Delete guest registration (soft delete - only pending ones)
  async deleteGuestRegistration(registrationId, tenantUserId) {
    const registration = await prisma.guest_registrations.findUnique({
      where: { registration_id: registrationId },
    });

    if (!registration) {
      throw new Error("Không tìm thấy báo cáo khách");
    }

    // Check authorization
    if (registration.host_user_id !== tenantUserId) {
      throw new Error("Unauthorized to delete this registration");
    }

    // Can only delete if status is pending or cancelled
    if (!["pending", "cancelled"].includes(registration.status)) {
      throw new Error(
        `Cannot delete registration with status: ${registration.status}`
      );
    }

    // Delete will cascade to guest_details
    await prisma.guest_registrations.delete({
      where: { registration_id: registrationId },
    });

    return true;
  }

  // Get statistics for dashboard
  async getGuestRegistrationStats(userId, userRole) {
    const where = {};

    // Filter by tenant if role is TENANT
    if (userRole === "TENANT") {
      where.host_user_id = userId;
    }

    const [total, pending, approved, rejected, cancelled, expired] =
      await Promise.all([
        prisma.guest_registrations.count({ where }),
        prisma.guest_registrations.count({
          where: { ...where, status: "pending" },
        }),
        prisma.guest_registrations.count({
          where: { ...where, status: "approved" },
        }),
        prisma.guest_registrations.count({
          where: { ...where, status: "rejected" },
        }),
        prisma.guest_registrations.count({
          where: { ...where, status: "cancelled" },
        }),
        prisma.guest_registrations.count({
          where: { ...where, status: "expired" },
        }),
      ]);

    // // Get total guests count (sum of guest_count)
    // const guestCountResult = await prisma.guest_registrations.aggregate({
    //   where,
    //   _sum: {
    //     guest_count: true,
    //   },
    // });

    return {
      total,
      pending,
      approved,
      rejected,
      cancelled,
      expired,
      totalGuests: registrations.reduce(
        (sum, r) => sum + (r.guest_details?.length || 0),
        0
      ),
    };
  }
}

module.exports = new GuestService();
