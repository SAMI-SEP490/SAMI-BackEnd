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
    if (user.building_owner) return user.building_owner.notes;
    if (user.building_managers) return user.building_managers.note;
    if (user.tenants) return user.tenants.note;
    return null;
  }

  /**
   * ASYNC helper to get a user's role string by ID.
   */
  async _getUserRole(userId) {
    const user = await prisma.users.findUnique({
      where: { user_id: userId },
      select: { role: true },
    });
    if (!user) return null;
    return user.role;
  }

  /**
   * Retrieves a list of all users (excluding OWNER).
   */
 async getAllUsers(buildingId = null) {
  const users = await prisma.users.findMany({
    where: {
      role: { not: "OWNER" },

      ...(buildingId && {
        OR: [
          // MANAGER thuộc building
          {
            role: "MANAGER",
            building_managers: {
              some: {
                building_id: Number(buildingId),
              },
            },
          },

          // TENANT có room hiện tại thuộc building
          {
            role: "TENANT",
            tenants: {
              room_tenants_history: {
                some: {
                  is_current: true,
                  room: {
                    building_id: Number(buildingId),
                  },
                },
              },
            },
          },

          // USER: không gắn building → vẫn hiển thị
          {
            role: "USER",
          },
        ],
      }),
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
          building_id: true,
          building: {
            select: { name: true },
          },
        },
      },

      tenants: {
        select: {
          tenant_since: true,
          id_number: true,
          room_tenants_history: {
            where: { is_current: true },
            select: {
              room: {
                select: {
                  building_id: true,
                  building: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },

    orderBy: { user_id: "asc" },
  });

  return users.map((user) => {
    // MANAGER
    const manager = user.building_managers?.[0] ?? null;

    // TENANT current room
    const tenantRoom =
      user.tenants?.room_tenants_history?.[0]?.room ?? null;

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
        user.role === "TENANT" ? user.tenants?.tenant_since ?? null : null,
      id_number:
        user.role === "TENANT" ? user.tenants?.id_number ?? null : null,

      // BUILDING (cho cả MANAGER & TENANT)
      building_id:
        user.role === "MANAGER"
          ? manager?.building_id ?? null
          : user.role === "TENANT"
          ? tenantRoom?.building_id ?? null
          : null,

      building_name:
        user.role === "MANAGER"
          ? manager?.building?.name ?? null
          : user.role === "TENANT"
          ? tenantRoom?.building?.name ?? null
          : null,
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
            assigned_from: true,
            assigned_to: true,
            buildings: {
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
            emergency_contact_phone: true,
            tenant_since: true,
            id_number: true,
            room_id: true,
            rooms: {
              select: {
                room_id: true,
                room_number: true,
                building_id: true,
                buildings: {
                  select: {
                    building_id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new Error("User not found");
    }

    if (user.role === "OWNER") {
      const error = new Error("Access to owner accounts is not allowed");
      error.statusCode = 403;
      throw error;
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
      emergency_contact_phone: null,
      tenant_since: null,
      id_number: null,
      building_id: null,
      building_name: null,
      room_id: null,
      room_name: null,
      assigned_from: null,
      assigned_to: null,
    };

    if (user.role === "TENANT" && user.tenants) {
      userObject.emergency_contact_phone = user.tenants.emergency_contact_phone;
      userObject.tenant_since = user.tenants.tenant_since;
      userObject.id_number = user.tenants.id_number;
      userObject.room_id = user.tenants.room_id;
      userObject.room_name = user.tenants.rooms?.room_number || null;
      userObject.building_name = user.tenants.rooms?.buildings?.name || null;
    } else if (user.role === "MANAGER" && user.building_managers) {
      userObject.building_id = user.building_managers.building_id;
      userObject.building_name = user.building_managers.buildings?.name || null;
      userObject.assigned_from = user.building_managers.assigned_from;
      userObject.assigned_to = user.building_managers.assigned_to;
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
    // Loại bỏ roomId ra khỏi đầu vào vì chưa cần xếp phòng lúc này
    const { userId, idNumber, emergencyContactPhone, note } = data;

    // Check if user exists
    const user = await prisma.users.findUnique({
      where: { user_id: userId },
    });

    if (!user) {
      throw new Error("User not found");
    }

    // Block changing OWNER role
    if (user.role === "OWNER") {
      const error = new Error("Cannot change owner role");
      error.statusCode = 403;
      throw error;
    }

    // Check if already a tenant
    const existingTenant = await prisma.tenants.findUnique({
      where: { user_id: userId },
    });

    if (existingTenant) {
      throw new Error("User is already a tenant");
    }

    // Update user role and create tenant record in transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Update user role
      const updatedUser = await tx.users.update({
        where: { user_id: userId },
        data: {
          role: Role.TENANT,
          updated_at: new Date(),
        },
      });

      // 2. Create tenant record
      // NOTE: Không truyền room_id vào đây vì bảng tenants không có cột room_id
      const tenantData = {
        user_id: userId,
        id_number: idNumber,
        tenant_since: new Date(),
        note,
      };


      const tenant = await tx.tenants.create({
        data: tenantData,
      });

      return { updatedUser, tenant };
    });

    return {
      userId: result.updatedUser.user_id,
      role: result.updatedUser.role,
      tenantInfo: {
        idNumber: result.tenant.id_number,
        tenantSince: result.tenant.tenant_since,
      },
    };
  }

  /**
   * Change user to MANAGER role
   */
  async changeToManager(data) {
    const { userId, buildingId, assignedFrom, assignedTo, note } = data;

    // Check if user exists
    const user = await prisma.users.findUnique({
      where: { user_id: userId },
    });

    if (!user) {
      throw new AppError("User not found");
    }

    // Block changing OWNER role
    if (user.role === "OWNER") {
      const error = new Error("Cannot change owner role");
      error.statusCode = 403;
      throw error;
    }

    // Check if building exists
    const building = await prisma.buildings.findUnique({
      where: { building_id: buildingId },
    });

    if (!building) {
      throw new AppError("Building not found");
    }

    // Check if already a manager for this building
    const existingManager = await prisma.building_managers.findFirst({
  where: {
    user_id: userId,
    building_id: buildingId
  }
});

    if (existingManager) {
      throw new AppError("User is already a manager");
    }

    // Update user role and create manager record in transaction
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

    // Block updating OWNER
    if (targetUserRole === "OWNER") {
      const error = new Error("Cannot update owner accounts");
      error.statusCode = 403;
      throw error;
    }

    // MANAGER can only handle TENANT
    if (requestingUserRole === "MANAGER" && targetUserRole !== "TENANT") {
      const error = new Error("Managers can only edit tenant accounts");
      error.statusCode = 403;
      throw error;
    }

    // Block email update
    if (data.email) {
      const error = new Error("Email cannot be updated");
      error.statusCode = 400;
      throw error;
    }

    return prisma.$transaction(async (tx) => {
      let userDataToUpdate = {};
      let roleDataUpdated = false;

      // 1. Prepare User table data (excluding email)
      if (data.full_name) userDataToUpdate.full_name = data.full_name;
      if (data.gender) userDataToUpdate.gender = data.gender;
      if (data.birthday) userDataToUpdate.birthday = new Date(data.birthday);
      if (data.status) userDataToUpdate.status = data.status;
      if (data.phone) userDataToUpdate.phone = data.phone;

      // 2. Prepare and execute role-specific table update
      if (targetUserRole === "TENANT") {
        let tenantData = {};
        if (data.note) tenantData.note = data.note;
        if (data.tenant_since)
          tenantData.tenant_since = new Date(data.tenant_since);
        if (data.emergency_contact_phone)
          tenantData.emergency_contact_phone = data.emergency_contact_phone;
        if (data.id_number) tenantData.id_number = data.id_number;

        if (Object.keys(tenantData).length > 0) {
          await tx.tenants.update({
            where: { user_id: targetUserId },
            data: tenantData,
          });
          roleDataUpdated = true;
        }
      } else if (targetUserRole === "MANAGER") {
        let managerData = {};
        if (data.note) managerData.note = data.note;
        if (data.building_id) managerData.building_id = data.building_id;
        if (data.assigned_from)
          managerData.assigned_from = new Date(data.assigned_from);
        if (data.assigned_to)
          managerData.assigned_to = new Date(data.assigned_to);

        if (Object.keys(managerData).length > 0) {
          await tx.building_managers.update({
            where: { user_id: targetUserId },
            data: managerData,
          });
          roleDataUpdated = true;
        }
      }

      // 3. Update User table (if data or role data changed)
      if (Object.keys(userDataToUpdate).length > 0 || roleDataUpdated) {
        // Set the updated_at timestamp
        userDataToUpdate.updated_at = new Date();

        const updatedUser = await tx.users.update({
          where: { user_id: targetUserId },
          data: userDataToUpdate,
          select: {
            user_id: true,
            updated_at: true,
            full_name: true,
            status: true,
          },
        });
        return updatedUser;
      }

      return { message: "No data was provided to update." };
    });
  }
}

module.exports = new UserService();
