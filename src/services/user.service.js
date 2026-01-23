// Updated: 2025-24-10
// by: DatNB & MinhBH

const prisma = require("../config/prisma");
const { Role } = require("@prisma/client");

class UserService {
  /**
   * SYNCHRONOUS helper to get the correct note from a user object
   */
  _determineNoteFromUserObject(user) {
  if (!user) return null;

  // OWNER (nếu có)
  if (user.building_owner) return user.building_owner.notes ?? null;

  // MANAGER: building_managers có thể là array
  if (Array.isArray(user.building_managers)) {
    if (user.building_managers.length > 0) {
      return user.building_managers[0]?.note ?? null;
    }
  } else if (user.building_managers) {
    return user.building_managers.note ?? null;
  }

  // TENANT: tenants có thể là object hoặc array tùy schema
  if (Array.isArray(user.tenants)) {
    if (user.tenants.length > 0) {
      return user.tenants[0]?.note ?? null;
    }
  } else if (user.tenants) {
    return user.tenants.note ?? null;
  }

  return null;
}
  /**
   * Retrieves a list of all users (excluding OWNER).
   */
  async getAllUsers(requestingUserId) {
    const requestingUser = await prisma.users.findUnique({
      where: { user_id: requestingUserId },
      select: { role: true },
    });

    if (!requestingUser) {
      throw new Error("Requesting user not found");
    }

    let whereCondition = {
      role: { not: "OWNER" },
    };

    // 🔒 MANAGER: chỉ xem TENANT trong building của mình
    if (requestingUser.role === "MANAGER") {
      const assignment = await prisma.building_managers.findFirst({
        where: { user_id: requestingUserId },
        select: { building_id: true },
      });

      if (!assignment) {
        return [];
      }

      whereCondition = {
        role: "TENANT",
        tenants: {
          building_id: assignment.building_id,
        },
      };
    }

    const users = await prisma.users.findMany({
      where: whereCondition,

      select: {
        user_id: true,
        phone: true,
        email: true,
        full_name: true,
        gender: true,
        birthday: true,
        status: true,
        role: true,
        is_verified: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,

        // MANAGER → building trực tiếp
        building_managers: {
          select: {
            building_id: true,
            building: {
              select: { name: true },
            },
          },
        },

        // TENANT → building trực tiếp
        tenants: {
          select: {
            building_id: true,
            tenant_since: true,
            id_number: true,
            building: {
              select: { name: true },
            },
          },
        },
      },

      orderBy: { user_id: "asc" },
    });

    return users.map((user) => {
      const manager = user.building_managers?.[0] ?? null;
      const tenant = user.tenants ?? null;

      return {
        user_id: user.user_id,
        phone: user.phone,
        email: user.email,
        full_name: user.full_name,
        gender: user.gender,
        birthday: user.birthday,
        status: user.status,
        role: user.role,
        is_verified: user.is_verified,
        created_at: user.created_at,
        updated_at: user.updated_at,
        deleted_at: user.deleted_at,

        note: this._determineNoteFromUserObject(user),

        // TENANT
        tenant_since:
          user.role === "TENANT" ? (tenant?.tenant_since ?? null) : null,
        id_number: user.role === "TENANT" ? (tenant?.id_number ?? null) : null,

        // BUILDING
        building_id:
          user.role === "MANAGER"
            ? (manager?.building_id ?? null)
            : user.role === "TENANT"
              ? (tenant?.building_id ?? null)
              : null,

        building_name:
          user.role === "MANAGER"
            ? (manager?.building?.name ?? null)
            : user.role === "TENANT"
              ? (tenant?.building?.name ?? null)
              : null,
      };
    });
  }
  async getActiveTenants(requestingUserId) {
  const requestingUser = await prisma.users.findUnique({
    where: { user_id: requestingUserId },
    select: { role: true },
  });

  if (!requestingUser) {
    throw new Error("Requesting user not found");
  }

  let buildingCondition = {};

  // 🔒 MANAGER: chỉ xem tenant trong building của mình
  if (requestingUser.role === "MANAGER") {
    const assignment = await prisma.building_managers.findFirst({
      where: { user_id: requestingUserId },
      select: { building_id: true },
    });

    if (!assignment) return [];

    buildingCondition = {
      tenants: {
        building_id: assignment.building_id,
      },
    };
  }

  const users = await prisma.users.findMany({
    where: {
      role: "TENANT",
      status: "Active",

      ...buildingCondition,

      tenants: {
        is: {
          room_tenants_history: {
            some: {
              is_current: true,
              tenant_type: {
                in: ["primary", "secondary"],
              },
              room: {
                current_contract: {
                  is: {
                    status: "active",
                  },
                },
              },
            },
          },
        },
      },
    },

    select: {
      user_id: true,
      phone: true,
      email: true,
      full_name: true,
      gender: true,
      birthday: true,
      status: true,
      role: true,

      tenants: {
        select: {
          tenant_since: true,
          id_number: true,
          building_id: true,
          building: {
            select: { name: true },
          },
          room_tenants_history: {
            where: {
              is_current: true,
              tenant_type: {
                in: ["primary", "secondary"],
              },
            },
            select: {
              tenant_type: true,
              room: {
                select: {
                  room_id: true,
                  room_number: true,
                  current_contract: {
                    select: {
                      contract_id: true,
                      contract_number: true,
                      start_date: true,
                      end_date: true,
                      status: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    orderBy: { user_id: "asc" },
  });

  return users.map((u) => {
    const tenant = u.tenants;
    const roomInfo = tenant.room_tenants_history[0];

    return {
      user_id: u.user_id,
      phone: u.phone,
      email: u.email,
      full_name: u.full_name,
      gender: u.gender,
      birthday: u.birthday,
      status: u.status,
      role: u.role,

      // TENANT INFO
      tenant_since: tenant.tenant_since,
      id_number: tenant.id_number,
      tenant_type: roomInfo?.tenant_type ?? null,

      // BUILDING
      building_id: tenant.building_id,
      building_name: tenant.building?.name ?? null,

      // ROOM + CONTRACT
      room_id: roomInfo?.room.room_id ?? null,
      room_number: roomInfo?.room.room_number ?? null,
      contract_id: roomInfo?.room.current_contract?.contract_id ?? null,
      contract_number:
        roomInfo?.room.current_contract?.contract_number ?? null,
      contract_status:
        roomInfo?.room.current_contract?.status ?? null,
    };
  });
}
  /**
   * Retrieves the details for a single user by their ID (excluding OWNER).
   */
  async getUserById(userId) {
    const user = await prisma.users.findUnique({
      where: { user_id: userId },
      select: {
        user_id: true,
        phone: true,
        email: true,
        full_name: true,
        gender: true,
        birthday: true,
        status: true,
        role: true,
        is_verified: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,

        building_managers: {
          select: {
            note: true,
            building_id: true,
            building: {
              select: {
                building_id: true,
                name: true,
              },
            },
          },
        },

        tenants: {
          select: {
            note: true,
            tenant_since: true,
            id_number: true,
            building_id: true,
            building: {
              select: {
                building_id: true,
                name: true,
              },
            },
            room_tenants_history: {
              where: { is_current: true },
              take: 1,
              select: {
                room: {
                  select: {
                    room_id: true,
                    room_number: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) throw new Error("User not found");

    if (user.role === "OWNER") {
      const err = new Error("Access to owner accounts is not allowed");
      err.statusCode = 403;
      throw err;
    }

    const userObject = {
      user_id: user.user_id,
      phone: user.phone,
      email: user.email,
      full_name: user.full_name,
      gender: user.gender,
      birthday: user.birthday,
      status: user.status,
      role: user.role,
      is_verified: user.is_verified,
      created_at: user.created_at,
      updated_at: user.updated_at,
      deleted_at: user.deleted_at,

      note: this._determineNoteFromUserObject(user),

      // TENANT
      tenant_since: null,
      id_number: null,
      building_id: null,
      building_name: null,
      room_id: null,
      room_name: null,

      // MANAGER
      assigned_from: null,
      assigned_to: null,
    };

    // ===== TENANT =====
    if (user.role === "TENANT" && user.tenants) {
      const currentRoom = user.tenants.room_tenants_history?.[0]?.room ?? null;

      userObject.tenant_since = user.tenants.tenant_since;
      userObject.id_number = user.tenants.id_number;
      userObject.building_id = user.tenants.building_id;
      userObject.building_name = user.tenants.building?.name ?? null;
      userObject.room_id = currentRoom?.room_id ?? null;
      userObject.room_name = currentRoom?.room_number ?? null;
    }

    // ===== MANAGER =====
    if (user.role === "MANAGER" && user.building_managers?.length) {
      const manager = user.building_managers[0];

      userObject.building_id = manager.building_id;
      userObject.building_name = manager.building?.name ?? null;
      userObject.note = manager.note;
    }

    return userObject;
  }

  /**
   * Searches all users by full_name (excluding OWNER).
   */
  async searchUsersByName(nameQuery) {
    const users = await prisma.users.findMany({
      where: {
        full_name: {
          contains: nameQuery,
          mode: "insensitive",
        },
        role: { not: "OWNER" }, // Exclude OWNER
      },
      select: {
        user_id: true,
        phone: true,
        email: true,
        full_name: true,
        gender: true,
        birthday: true,
        status: true,
        role: true,
        is_verified: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
        building_managers: {
          select: {
            note: true,
            building_id: true,
            assigned_from: true,
            assigned_to: true,
          },
        },
        tenants: {
          select: {
            note: true,
            tenant_since: true,
            id_number: true,
          },
        },
      },
      orderBy: {
        full_name: "asc",
      },
    });

    return users.map((user) => {
      const userObject = {
        user_id: user.user_id,
        phone: user.phone,
        email: user.email,
        full_name: user.full_name,
        gender: user.gender,
        birthday: user.birthday,
        status: user.status,
        role: user.role,
        is_verified: user.is_verified,
        created_at: user.created_at,
        updated_at: user.updated_at,
        deleted_at: user.deleted_at,
        note: this._determineNoteFromUserObject(user),
        tenant_since: null,
        id_number: null,
        building_id: null,
        assigned_from: null,
        assigned_to: null,
      };

      // Add role-specific info
      if (user.role === "TENANT" && user.tenants) {
        userObject.tenant_since = user.tenants.tenant_since;
        userObject.id_number = user.tenants.id_number;
      } else if (user.role === "MANAGER" && user.building_managers) {
        userObject.building_id = user.building_managers.building_id;
        userObject.assigned_from = user.building_managers.assigned_from;
        userObject.assigned_to = user.building_managers.assigned_to;
      }

      return userObject;
    });
  }

  /**
   * Soft-deletes a user, with permissions (excluding OWNER).
   */
  async softDeleteUser(targetUserId, requestingUserId) {
    const requestingUserRole = await this._getUserRole(requestingUserId);
    const targetUserRole = await this._getUserRole(targetUserId);

    if (!targetUserRole) {
      throw new Error("User not found");
    }

    // Block deletion of OWNER
    if (targetUserRole === "OWNER") {
      const error = new Error("Cannot delete owner accounts");
      error.statusCode = 403;
      throw error;
    }

    // MANAGER can only handle TENANT
    if (requestingUserRole === "MANAGER" && targetUserRole !== "TENANT") {
      const error = new Error("Managers can only delete tenant accounts");
      error.statusCode = 403;
      throw error;
    }

    const targetUser = await prisma.users.findUnique({
      where: { user_id: targetUserId },
      select: { deleted_at: true },
    });

    if (targetUser.deleted_at) {
      const error = new Error("User is already deleted");
      error.statusCode = 400;
      throw error;
    }

    const deletedUser = await prisma.users.update({
      where: { user_id: targetUserId },
      data: {
        deleted_at: new Date(),
        status: "Inactive",
      },
      select: { user_id: true, deleted_at: true, status: true },
    });

    return deletedUser;
  }

  /**
   * Restores a soft-deleted user, with permissions (excluding OWNER).
   */
  async restoreUser(targetUserId, requestingUserId) {
    const requestingUserRole = await this._getUserRole(requestingUserId);
    const targetUserRole = await this._getUserRole(targetUserId);

    if (!targetUserRole) {
      throw new Error("User not found");
    }

    // Block restoration of OWNER
    if (targetUserRole === "OWNER") {
      const error = new Error("Cannot restore owner accounts");
      error.statusCode = 403;
      throw error;
    }

    // MANAGER can only handle TENANT
    if (requestingUserRole === "MANAGER" && targetUserRole !== "TENANT") {
      const error = new Error("Managers can only restore tenant accounts");
      error.statusCode = 403;
      throw error;
    }

    const targetUser = await prisma.users.findUnique({
      where: { user_id: targetUserId },
      select: { deleted_at: true },
    });

    if (targetUser.deleted_at === null) {
      const error = new Error("User is not deleted");
      error.statusCode = 400;
      throw error;
    }

    const restoredUser = await prisma.users.update({
      where: { user_id: targetUserId },
      data: {
        deleted_at: null,
        status: "Active",
      },
      select: { user_id: true, deleted_at: true, status: true },
    });

    return restoredUser;
  }

  /**
   * Retrieves a list of all soft-deleted users, with permissions (excluding OWNER).
   */
  async getDeletedUsers(requestingUserId) {
    const requestingUserRole = await this._getUserRole(requestingUserId);

    let whereClause = {
      deleted_at: { not: null },
      role: { not: "OWNER" }, // Exclude OWNER
    };

    // MANAGER can only handle TENANT
    if (requestingUserRole === "MANAGER") {
      whereClause.role = "TENANT";
    }

    const users = await prisma.users.findMany({
      where: whereClause,
      select: {
        user_id: true,
        phone: true,
        email: true,
        full_name: true,
        gender: true,
        birthday: true,
        status: true,
        role: true,
        is_verified: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
        // Relations still needed for the note
        building_managers: {
          select: {
            note: true,
            building_id: true,
            assigned_from: true,
            assigned_to: true,
          },
        },
        tenants: {
          select: {
            note: true,
            tenant_since: true,
            id_number: true,
          },
        },
      },
      orderBy: {
        deleted_at: "desc",
      },
    });

    return users.map((user) => {
      const userObject = {
        user_id: user.user_id,
        phone: user.phone,
        email: user.email,
        full_name: user.full_name,
        gender: user.gender,
        birthday: user.birthday,
        status: user.status,
        role: user.role,
        is_verified: user.is_verified,
        created_at: user.created_at,
        updated_at: user.updated_at,
        deleted_at: user.deleted_at,
        note: this._determineNoteFromUserObject(user),
        tenant_since: null,
        id_number: null,
        building_id: null,
        assigned_from: null,
        assigned_to: null,
      };

      // Add role-specific info
      if (user.role === "TENANT" && user.tenants) {
        userObject.tenant_since = user.tenants.tenant_since;
        userObject.id_number = user.tenants.id_number;
      } else if (user.role === "MANAGER" && user.building_managers) {
        userObject.building_id = user.building_managers.building_id;
        userObject.assigned_from = user.building_managers.assigned_from;
        userObject.assigned_to = user.building_managers.assigned_to;
      }

      return userObject;
    });
  }

  /**
   * Change user to TENANT role
   * UPDATED:
   * - Removed room_id (Tenant creates profile first, Room assigned via Contract later)
   * - Removed emergency_contact_phone (Not present in current Schema)
   */

  async changeToTenant(data) {
    const { userId, buildingId, idNumber, note } = data;

    const userIdInt = Number(userId);
    const buildingIdInt =
      buildingId !== undefined && buildingId !== null
        ? Number(buildingId)
        : null;

    const user = await prisma.users.findUnique({
      where: { user_id: userIdInt },
    });
    if (!user) throw new Error("Không tìm thấy người dùng");

    if (user.role === "OWNER") {
      const err = new Error("Không thể chuyển vai trò của chủ tòa nhà");
      err.statusCode = 403;
      throw err;
    }

    if (buildingIdInt !== null) {
      const building = await prisma.buildings.findUnique({
        where: { building_id: buildingIdInt },
      });
      if (!building) throw new Error("Không tìm thấy tòa nhà");
    }

    const existingTenant = await prisma.tenants.findUnique({
      where: { user_id: userIdInt },
    });
    if (existingTenant) {
      throw new Error("Người dùng đã là người thuê");
    }
    function validateIdNumber(idNumber, userBirthday) {
      if (!idNumber) {
        throw new Error("Số CCCD/CMND là bắt buộc");
      }

      if (!/^\d{12}$/.test(idNumber)) {
        throw new Error("Số CCCD phải gồm đúng 12 chữ số");
      }

      // 1️⃣ 3 số đầu: 001 - 096
      const provinceCode = Number(idNumber.slice(0, 3));
      if (provinceCode < 1 || provinceCode > 96) {
        throw new Error(
          "3 số đầu của CCCD phải nằm trong khoảng từ 001 đến 096",
        );
      }

      // 2️⃣ Số thứ 4: giới tính
      const genderCode = idNumber[3];
      if (!["0", "1", "2", "3"].includes(genderCode)) {
        throw new Error("Số thứ 4 của CCCD phải là 0, 1, 2 hoặc 3");
      }

      // 3️⃣ Năm sinh
      const birthYear = new Date(userBirthday).getFullYear();
      const birthYearShort = String(birthYear).slice(-2);
      const yearInId = idNumber.slice(4, 6);

      if (yearInId !== birthYearShort) {
        throw new Error(
          `2 số thứ 5 và thứ 6 của CCCD phải trùng với năm sinh (${birthYearShort})`,
        );
      }
    }

    /* =======================
     VALIDATE ID NUMBER
  ======================= */
    validateIdNumber(idNumber, user.birthday);

    return prisma.$transaction(async (tx) => {
      const updatedUser = await tx.users.update({
        where: { user_id: userIdInt },
        data: { role: Role.TENANT },
      });

      const tenant = await tx.tenants.create({
        data: {
          user_id: userIdInt,
          building_id: buildingIdInt,
          id_number: idNumber,
          tenant_since: new Date(),
          note,
        },
      });

      return {
        userId: updatedUser.user_id,
        role: updatedUser.role,
        tenant: {
          buildingId: tenant.building_id,
          idNumber: tenant.id_number,
        },
      };
    });
  }

  /**
   * Change user to MANAGER role
   */
  async changeToManager(data) {
    const { userId, buildingId, note } = data;

    /* =======================
     CHECK USER
  ======================= */
    const user = await prisma.users.findUnique({
      where: { user_id: userId },
    });

    if (!user) {
      throw new AppError("Không tìm thấy người dùng");
    }

    /* =======================
     BLOCK OWNER
  ======================= */
    if (user.role === "OWNER") {
      const error = new Error("Không thể thay đổi vai trò của chủ tòa nhà");
      error.statusCode = 403;
      throw error;
    }

    /* =======================
     CHECK BUILDING
  ======================= */
    const building = await prisma.buildings.findUnique({
      where: { building_id: buildingId },
    });

    if (!building) {
      throw new AppError("Không tìm thấy tòa nhà");
    }

    /* =======================
     CHECK EXISTING MANAGER
  ======================= */
    const existingManager = await prisma.building_managers.findFirst({
      where: {
        user_id: userId,
        building_id: buildingId,
      },
    });

    if (existingManager) {
      throw new AppError("Người dùng đã là quản lý của tòa nhà này");
    }

    /* =======================
     TRANSACTION
  ======================= */
    const result = await prisma.$transaction(async (tx) => {
      // Update user role
      const updatedUser = await tx.users.update({
        where: { user_id: userId },
        data: {
          role: Role.MANAGER,
          updated_at: new Date(),
        },
      });

      // Create building manager record
      const manager = await tx.building_managers.create({
        data: {
          user_id: userId,
          building_id: buildingId,
          note,
        },
      });

      return { updatedUser, manager };
    });

    /* =======================
     RESPONSE
  ======================= */
    return {
      userId: result.updatedUser.user_id,
      role: result.updatedUser.role,
      managerInfo: {
        buildingId: result.manager.building_id,
      },
    };
  }

  /**
   * Updates an user's information (excluding OWNER and email field).
   */
  async updateUser(targetUserId, requestingUserId, data) {
    const requestingUserRole = await this._getUserRole(requestingUserId);
    const targetUserRole = await this._getUserRole(targetUserId);

    if (!targetUserRole) {
      throw new Error("User not found");
    }

    // Block OWNER
    if (targetUserRole === "OWNER") {
      const error = new Error("Cannot update owner accounts");
      error.statusCode = 403;
      throw error;
    }

    // MANAGER chỉ được sửa TENANT
    if (requestingUserRole === "MANAGER" && targetUserRole !== "TENANT") {
      const error = new Error("Managers can only edit tenant accounts");
      error.statusCode = 403;
      throw error;
    }

    // Block email
    if (data.email) {
      const error = new Error("Email cannot be updated");
      error.statusCode = 400;
      throw error;
    }

    return prisma.$transaction(async (tx) => {
      let userDataToUpdate = {};
      let roleDataUpdated = false;

      /* ================= USER TABLE ================= */
      if (data.full_name !== undefined)
        userDataToUpdate.full_name = data.full_name;
      if (data.gender !== undefined) userDataToUpdate.gender = data.gender;
      if (data.birthday !== undefined)
        userDataToUpdate.birthday = data.birthday
          ? new Date(data.birthday)
          : null;
      if (data.status !== undefined) userDataToUpdate.status = data.status;
      if (data.phone !== undefined) userDataToUpdate.phone = data.phone;

      /* ================= TENANT ================= */
      if (targetUserRole === "TENANT") {
        let tenantData = {};

        if (data.note !== undefined) tenantData.note = data.note;
        if (data.id_number !== undefined) tenantData.id_number = data.id_number;
        if (data.tenant_since !== undefined)
          tenantData.tenant_since = data.tenant_since
            ? new Date(data.tenant_since)
            : null;

        // ❗ KHÔNG update room / building ở đây (room_tenants quản lý riêng)

        if (Object.keys(tenantData).length > 0) {
          await tx.tenants.update({
            where: { user_id: targetUserId },
            data: tenantData,
          });
          roleDataUpdated = true;
        }
      }

      /* ================= MANAGER ================= */
      if (targetUserRole === "MANAGER") {
        let managerData = {};

        if (data.note !== undefined) managerData.note = data.note;
        if (data.building_id !== undefined)
          managerData.building_id = data.building_id;

        if (Object.keys(managerData).length > 0) {
          await tx.building_managers.updateMany({
            where: { user_id: targetUserId },
            data: managerData,
          });
          roleDataUpdated = true;
        }
      }

      /* ================= FINAL USER UPDATE ================= */
      if (Object.keys(userDataToUpdate).length > 0 || roleDataUpdated) {
        userDataToUpdate.updated_at = new Date();

        return tx.users.update({
          where: { user_id: targetUserId },
          data: userDataToUpdate,
          select: {
            user_id: true,
            full_name: true,
            status: true,
            updated_at: true,
          },
        });
      }

      return { message: "No data was provided to update." };
    });
  }
}

module.exports = new UserService();
