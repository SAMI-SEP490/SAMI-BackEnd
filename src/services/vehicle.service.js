// Updated: 2025-12-08
// by: Assistant
// Modified: Added building-based filtering for Manager role

const prisma = require('../config/prisma');
const NotificationService = require('./notification.service');

class VehicleRegistrationService {
    // Helper function to get manager's building IDs
    async getManagerBuildingIds(userId) {
        const managers = await prisma.building_managers.findMany({
            where: { user_id: userId },
            select: { building_id: true }
        });

        return managers.map(m => m.building_id);
    }

    // Helper function to check if registration is in manager's building
    async isRegistrationInManagerBuilding(registrationId, managerUserId) {
        const registration = await prisma.vehicle_registrations.findUnique({
            where: { registration_id: registrationId },
            select: {
                requester: {
                    select: {
                        room_tenants_history: {
                            where: { is_current: true },
                            select: {
                                room: {
                                    select: {
                                        building_id: true
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        if (!registration) return false;

        const managerBuildingIds = await this.getManagerBuildingIds(managerUserId);

        const tenantBuildingIds =
            registration.requester.room_tenants_history.map(
                rt => rt.room.building_id
            );

        return tenantBuildingIds.some(bid =>
            managerBuildingIds.includes(bid)
        );
    }
    async checkBuildingCapacity(buildingId, vehicleType) {
        const building = await prisma.buildings.findUnique({
            where: { building_id: buildingId },
            select: {
                max_2_wheel_slot: true,
                max_4_wheel_slot: true
            }
        });

        if (!building) {
            throw new Error('Building not found');
        }

        if (!['two_wheeler', 'four_wheeler'].includes(vehicleType)) {
            throw new Error('Invalid vehicle type');
        }

        const maxSlots =
            vehicleType === 'two_wheeler'
                ? building.max_2_wheel_slot
                : building.max_4_wheel_slot;

        if (!maxSlots || maxSlots <= 0) {
            return false;
        }

        const usedSlots = await prisma.vehicles.count({
            where: {
                status: 'active',
                slot: {
                    building_id: buildingId,
                    slot_type: vehicleType
                }
            }
        });

        return usedSlots < maxSlots;
    }

async createVehicleRegistration(tenantUserId, data) {
  const {
    vehicle_type,
    license_plate,
    brand,
    color,
    start_date,
    end_date,
    note
  } = data;

  // 1️⃣ Validate tenant
  const tenant = await prisma.tenants.findUnique({
    where: { user_id: tenantUserId },
    select: {
      user_id: true,
      building_id: true
    }
  });

  if (!tenant) {
    throw new Error("Tenant not found");
  }

  if (!tenant.building_id) {
    throw new Error("Tenant has no building assigned");
  }

  // 2️⃣ Validate vehicle type
  if (!["two_wheeler", "four_wheeler"].includes(vehicle_type)) {
    throw new Error("Invalid vehicle type");
  }

  // 3️⃣ Check license plate uniqueness (active only)
  if (license_plate) {
    const existedVehicle = await prisma.vehicles.findFirst({
      where: {
        license_plate,
        status: "active"
      }
    });

    if (existedVehicle) {
      throw new Error("License plate already registered");
    }
  }

  // 4️⃣ Validate date
  if (start_date && end_date) {
    if (new Date(end_date) <= new Date(start_date)) {
      throw new Error("End date must be after start date");
    }
  }

  // 5️⃣ Create registration
  return prisma.vehicle_registrations.create({
    data: {
      requested_by: tenantUserId,
      vehicle_type,
      license_plate,
      brand,
      color,
      start_date: new Date(start_date),
      end_date: end_date ? new Date(end_date) : null,
      status: "requested",
      note
    }
  });
}

    async getVehicleRegistrationById(registrationId, userId, userRole) {
        const registration = await prisma.vehicle_registrations.findUnique({
            where: { registration_id: registrationId },
            include: {
                requester: {
                    include: {
                        user: {
                            select: {
                                user_id: true,
                                full_name: true,
                                email: true,
                                phone: true
                            }
                        },
                        room_tenants_history: {
                            where: { is_current: true },
                            include: {
                                room: {
                                    include: {
                                        building: {
                                            select: {
                                                building_id: true,
                                                name: true,
                                                address: true
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                approver: {
                    select: { user_id: true, full_name: true, email: true }
                },
                rejector: {
                    select: { user_id: true, full_name: true, email: true }
                },
                vehicle: true
            }
        });

        if (!registration) {
            throw new Error('Vehicle registration not found');
        }

        if (userRole === 'TENANT' && registration.requested_by !== userId) {
            throw new Error('Unauthorized to view this registration');
        }

        if (userRole === 'MANAGER') {
            const allowed = await this.isRegistrationInManagerBuilding(registrationId, userId);
            if (!allowed) {
                throw new Error('Unauthorized to view this registration');
            }
        }

        return registration;
    }

    async getVehicleRegistrations(filters, userId, userRole) {
        console.log("🔥 VEHICLE REG ROLE:", userRole, "USER:", userId);
        const {
            status,
            requested_by,
            start_date_from,
            start_date_to,
            building_id,     // 👈 thêm
            page = 1,
            limit = 10
        } = filters;

        const where = {};

        /* ================= TENANT ================= */
        if (userRole === 'TENANT') {
            where.requested_by = userId;
        }

        /* ================= MANAGER ================= */
        else if (userRole === 'MANAGER') {
            const managerBuilding = await prisma.building_managers.findFirst({
                where: { user_id: userId },
                select: { building_id: true }
            });

            if (!managerBuilding) {
                return {
                    registrations: [],
                    pagination: {
                        total: 0,
                        page: Number(page),
                        limit: Number(limit),
                        totalPages: 0
                    }
                };
            }

            // 🔒 HARD LOCK
            where.requester = {
                room_tenants_history: {
                    some: {
                        is_current: true,
                        room: {
                            building_id: managerBuilding.building_id
                        }
                    }
                }
            };
        }
        /* ================= OWNER ================= */
        else if (userRole === "OWNER") {
            if (requested_by) {
                where.requested_by = requested_by;
            }

            if (building_id) {
                where.requester = {
                    building_id: Number(building_id)
                };
            }
        }

        /* ================= COMMON ================= */
        if (status) {
            where.status = status;
        }

        const skip = (page - 1) * limit;

        const [registrations, total] = await Promise.all([
            prisma.vehicle_registrations.findMany({
                where,
                skip,
                take: Number(limit),
                orderBy: { requested_at: "desc" },
                include: {
                    requester: {
                        include: {
                            user: {
                                select: {
                                    user_id: true,
                                    full_name: true,
                                    email: true,
                                    phone: true
                                }
                            },
                            building: {
                                select: {
                                    building_id: true,
                                    name: true
                                }
                            }
                        }
                    },
                    vehicle: {
                        include: {
                            slot: {
                                include: {
                                    building: {
                                        select: { building_id: true, name: true }
                                    }
                                }
                            }
                        }
                    }
                }
            }),
            prisma.vehicle_registrations.count({ where })
        ]);

        return {
            registrations,
            pagination: {
                total,
                page: Number(page),
                limit: Number(limit),
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async updateVehicleRegistration(registrationId, tenantUserId, data) {
        const {
            vehicle_type,
            license_plate,
            brand,
            color,
            start_date,
            end_date,
            note
        } = data;

        const existing = await prisma.vehicle_registrations.findUnique({
            where: { registration_id: Number(registrationId) }
        });

        if (!existing) {
            throw new Error("Vehicle registration not found");
        }

        if (existing.requested_by !== tenantUserId) {
            throw new Error("Unauthorized");
        }

        if (existing.status !== "requested") {
            throw new Error(
                `Cannot update registration with status: ${existing.status}`
            );
        }

        // ✅ Validate vehicle type
        if (
            vehicle_type &&
            !["two_wheeler", "four_wheeler"].includes(vehicle_type)
        ) {
            throw new Error("Invalid vehicle type");
        }

        // ✅ Check license plate uniqueness (only active vehicles)
        if (license_plate && license_plate !== existing.license_plate) {
            const existedVehicle = await prisma.vehicles.findFirst({
                where: {
                    license_plate,
                    status: "active"
                }
            });

            if (existedVehicle) {
                throw new Error("License plate already registered");
            }
        }

        // ✅ Validate date
        if (start_date && end_date) {
            if (new Date(end_date) <= new Date(start_date)) {
                throw new Error("End date must be after start date");
            }
        }

        return prisma.vehicle_registrations.update({
            where: { registration_id: Number(registrationId) },
            data: {
                vehicle_type: vehicle_type ?? undefined,
                license_plate: license_plate ?? undefined,
                brand: brand ?? undefined,
                color: color ?? undefined,
                start_date: start_date ? new Date(start_date) : undefined,
                end_date: end_date ? new Date(end_date) : undefined,
                note: note ?? undefined
            }
        });
    }

    async approveVehicleRegistration(registrationId, approvedBy, userRole, slotId) {
        if (!slotId) throw new Error("Parking slot required");

        // 🔹 1. Load registration + tenant + building
        const registration = await prisma.vehicle_registrations.findUnique({
            where: { registration_id: registrationId },
            include: {
                requester: {
                    include: {
                        room_tenants_history: {
                            where: { is_current: true },
                            include: {
                                room: { select: { building_id: true } }
                            }
                        }
                    }
                }
            }
        });

        if (!registration) throw new Error("Vehicle registration not found");
        if (registration.status !== "requested") {
            throw new Error(`Cannot approve status ${registration.status}`);
        }

        const buildingId = registration.requester.building_id;
        if (!buildingId) throw new Error("Tenant building not found");

        if (!buildingId) throw new Error("Tenant building not found");

        // 🔹 2. Authorization
        if (userRole === "MANAGER") {
            const allowed = await this.isRegistrationInManagerBuilding(
                registrationId,
                approvedBy
            );
            if (!allowed) throw new Error("Unauthorized");
        }

        return prisma.$transaction(async (tx) => {

            // ===============================
            // 1️⃣ Lock & validate slot
            // ===============================
            const slot = await tx.parking_slots.findFirst({
                where: {
                    slot_id: slotId,
                    building_id: buildingId,
                    slot_type: registration.vehicle_type,
                    is_available: true
                }
            });

            if (!slot) throw new Error("Slot not available or invalid");

            // ===============================
            // 2️⃣ License plate uniqueness
            // ===============================
            const existedVehicle = await tx.vehicles.findFirst({
                where: {
                    registration: {
                        license_plate: registration.license_plate
                    },
                    status: "active"
                }
            });

            if (existedVehicle) {
                throw new Error("License plate already registered");
            }

            // ===============================
            // 3️⃣ Building quota
            // ===============================
            const usedSlots = await tx.parking_slots.count({
                where: {
                    building_id: buildingId,
                    slot_type: registration.vehicle_type,
                    is_available: false
                }
            });

            const building = await tx.buildings.findUnique({
                where: { building_id: buildingId }
            });

            const max =
                registration.vehicle_type === "two_wheeler"
                    ? building.max_2_wheel_slot
                    : building.max_4_wheel_slot;

            if (usedSlots >= max) {
                throw new Error("Building capacity exceeded");
            }

            // ===============================
            // 4️⃣ Approve registration
            // ===============================
            await tx.vehicle_registrations.update({
                where: { registration_id: registrationId },
                data: {
                    status: "approved",
                    approved_by: approvedBy,
                    approved_at: new Date()
                }
            });
            console.log("🔥 USING PRISMA CLIENT AT", __filename);
            // ===============================
            // 5️⃣ Create vehicle (WITH relation)
            // ===============================
            const vehicle = await tx.vehicles.create({
                data: {
                    status: "active",
                    registered_at: new Date(),
                    license_plate: registration.license_plate,

                    registration: {
                        connect: {
                            registration_id: registration.registration_id
                        }
                    },

                    tenant: {
                        connect: {
                            user_id: registration.requested_by
                        }
                    },

                    slot: {
                        connect: {
                            slot_id: slotId
                        }
                    }
                }
            });

            // ===============================
            // 6️⃣ Lock slot
            // ===============================
            await tx.parking_slots.update({
                where: { slot_id: slotId },
                data: { is_available: false }
            });

            return vehicle;
        });
    }


    async rejectVehicleRegistration(registrationId, rejectedBy, rejectionReason, userRole) {
        const registration = await prisma.vehicle_registrations.findUnique({
            where: { registration_id: registrationId },
            include: {
                requester: {
                    select: {
                        user_id: true,
                        building_id: true
                    }
                }
            }
        });

        if (!registration) {
            throw new Error('Vehicle registration not found');
        }

        if (registration.status !== 'requested') {
            throw new Error(`Cannot reject registration with status: ${registration.status}`);
        }

        if (userRole === 'MANAGER') {
            const allowed = await this.isRegistrationInManagerBuilding(
                registrationId,
                rejectedBy
            );
            if (!allowed) {
                throw new Error('Unauthorized to reject this registration');
            }
        }

        let vehicleInfo = {};
        try {
            vehicleInfo = JSON.parse(registration.reason || '{}');
        } catch { }

        const rejected = await prisma.vehicle_registrations.update({
            where: { registration_id: registrationId },
            data: {
                status: 'rejected',
                rejected_by: rejectedBy,
                rejected_at: new Date(),
                reason: rejectionReason ?? registration.reason
            },
            include: {
                requester: {
                    include: {
                        user: {
                            select: {
                                user_id: true,
                                full_name: true,
                                email: true,
                                phone: true
                            }
                        },
                        room_tenants_history: {
                            where: { is_current: true },
                            include: {
                                room: {
                                    select: {
                                        room_id: true,
                                        room_number: true,
                                        floor: true
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        // Notify tenant (best-effort)
        try {
            const vehicleDesc = `${vehicleInfo.type || 'xe'} ${vehicleInfo.brand || ''} (${vehicleInfo.license_plate || 'N/A'})`.trim();

            await NotificationService.createNotification(
                rejectedBy,
                registration.requested_by,
                'Đăng ký xe bị từ chối',
                `Đăng ký ${vehicleDesc} của bạn đã bị từ chối.${rejectionReason ? ` Lý do: ${rejectionReason}` : ''}`,
                {
                    type: 'vehicle_registration_rejected',
                    registration_id: registrationId
                }
            );
        } catch (err) {
            console.error('Reject notification error:', err);
        }

        return rejected;
    }

    async cancelVehicleRegistration(registrationId, userId, userRole, cancellationReason) {
        const registration = await prisma.vehicle_registrations.findUnique({
            where: { registration_id: registrationId },
            include: {
                vehicles: {
                    where: { deactivated_at: null }
                },
                requester: {
                    include: {
                        rooms: {
                            select: { building_id: true }
                        }
                    }
                }
            }
        });

        if (!registration) {
            throw new Error('Vehicle registration not found');
        }

        // ===== AUTHORIZATION =====
        if (userRole === 'TENANT') {
            if (registration.requested_by !== userId) {
                throw new Error('Unauthorized');
            }
            if (registration.status !== 'requested') {
                throw new Error('Tenant can only cancel requested registrations');
            }
        }

        if (userRole === 'MANAGER') {
            const allowed = await this.isRegistrationInManagerBuilding(registrationId, userId);
            if (!allowed) throw new Error('Unauthorized');
        }

        if (registration.status === 'cancelled') {
            throw new Error('Registration already cancelled');
        }

        // ===== TRANSACTION =====
        return prisma.$transaction(async (tx) => {
            // Cancel registration
            await tx.vehicle_registrations.update({
                where: { assignment_id: registrationId },
                data: {
                    status: 'cancelled',
                    cancelled_by: userId,
                    cancelled_at: new Date(),
                    reason: cancellationReason
                        ? `${registration.reason || ''}\nCancelled: ${cancellationReason}`
                        : registration.reason
                }
            });

            // If approved & active vehicle exists → deactivate & free slot
            for (const vehicle of registration.vehicles) {
                if (vehicle.slot_id) {
                    await tx.parking_slots.update({
                        where: { slot_id: vehicle.slot_id },
                        data: { is_available: true }
                    });
                }

                await tx.vehicles.update({
                    where: { vehicle_id: vehicle.vehicle_id },
                    data: {
                        status: 'deactivated',
                        deactivated_at: new Date(),
                        deactivated_by: userId
                    }
                });
            }

            return tx.vehicle_registrations.findUnique({
                where: { registration_id: registrationId },
                include: {
                    requester: {
                        include: {
                            users: {
                                select: {
                                    user_id: true,
                                    full_name: true,
                                    email: true,
                                    phone: true
                                }
                            },
                            rooms: {
                                select: {
                                    room_id: true,
                                    room_number: true,
                                    floor: true
                                }
                            }
                        }
                    },
                    vehicles: true
                }
            });
        });
    }

    // Delete vehicle registration (only requested or rejected ones)
    async deleteVehicleRegistration(registrationId, tenantUserId) {
        const registration = await prisma.vehicle_registrations.findUnique({
            where: { registration_id: registrationId }
        });

        if (!registration) {
            throw new Error('Vehicle registration not found');
        }

        // Authorization
        if (registration.requested_by !== tenantUserId) {
            throw new Error('Unauthorized to delete this registration');
        }

        // Only requested or rejected
        if (!['requested', 'rejected'].includes(registration.status)) {
            throw new Error(`Cannot delete registration with status: ${registration.status}`);
        }

        await prisma.vehicle_registrations.delete({
            where: { registration_id: registrationId }
        });

        return true;
    }

    // Get statistics for dashboard
    async getVehicleRegistrationStats(userId, userRole) {
        const registrationWhere = {};

        if (userRole === 'TENANT') {
            registrationWhere.requested_by = userId;
        }

        if (userRole === 'MANAGER') {
            const buildingIds = await this.getManagerBuildingIds(userId);

            if (buildingIds.length === 0) {
                return {
                    registrations: {
                        total: 0,
                        requested: 0,
                        approved: 0,
                        rejected: 0,
                        cancelled: 0
                    },
                    vehicles: {
                        total: 0,
                        active: 0
                    }
                };
            }

            registrationWhere.requester = {
                room_tenants_history: {
                    some: {
                        is_current: true,
                        room: {
                            building_id: { in: buildingIds }
                        }
                    }
                }
            };
        }

        const [total, requested, approved, rejected, cancelled] = await Promise.all([
            prisma.vehicle_registrations.count({ where: registrationWhere }),
            prisma.vehicle_registrations.count({ where: { ...registrationWhere, status: 'requested' } }),
            prisma.vehicle_registrations.count({ where: { ...registrationWhere, status: 'approved' } }),
            prisma.vehicle_registrations.count({ where: { ...registrationWhere, status: 'rejected' } }),
            prisma.vehicle_registrations.count({ where: { ...registrationWhere, status: 'cancelled' } })
        ]);

        // ===== VEHICLES =====
        const vehicleWhere = {};

        if (userRole === 'TENANT') {
            vehicleWhere.tenant_user_id = userId;
        }

        if (userRole === 'MANAGER') {
            const buildingIds = await this.getManagerBuildingIds(userId);

            vehicleWhere.slot = {
                building_id: { in: buildingIds }
            };
        }

        const [totalVehicles, activeVehicles] = await Promise.all([
            prisma.vehicles.count({ where: vehicleWhere }),
            prisma.vehicles.count({ where: { ...vehicleWhere, status: 'active' } })
        ]);

        return {
            registrations: {
                total,
                requested,
                approved,
                rejected,
                cancelled
            },
            vehicles: {
                total: totalVehicles,
                active: activeVehicles
            }
        };
    }

    async changeVehicleSlot(vehicleId, newSlotId, userId, userRole) {
        if (!['MANAGER', 'OWNER'].includes(userRole)) {
            throw new Error('Permission denied');
        }

        return prisma.$transaction(async (tx) => {

            const vehicle = await tx.vehicles.findUnique({
                where: { vehicle_id: vehicleId },
                include: {
                    registration: true,
                    tenant: {
                        include: {
                            room_tenants_history: {
                                where: { is_current: true },
                                include: {
                                    room: { select: { building_id: true } }
                                }
                            }
                        }
                    }
                }
            });

            if (!vehicle) throw new Error('Vehicle not found');
            if (vehicle.status !== 'active') {
                throw new Error('Only active vehicle can change parking slot');
            }

            const oldSlotId = vehicle.slot_id;

            const newSlot = await tx.parking_slots.findUnique({
                where: { slot_id: newSlotId }
            });

            if (!newSlot) throw new Error('New parking slot not found');
            if (!newSlot.is_available) {
                throw new Error('New parking slot is not available');
            }

            // ✅ ĐÚNG vehicle type
            if (newSlot.slot_type !== vehicle.registration.vehicle_type) {
                throw new Error('Slot type does not match vehicle type');
            }

            const buildingId =
                vehicle.tenant?.room_tenants_history?.[0]?.room?.building_id;

            if (!buildingId) {
                throw new Error('Tenant has no active room');
            }

            if (newSlot.building_id !== buildingId) {
                throw new Error('Slot is not in the same building as vehicle');
            }

            // ===== UPDATE =====

            // free old slot
            if (oldSlotId) {
                await tx.parking_slots.update({
                    where: { slot_id: oldSlotId },
                    data: { is_available: true }
                });
            }

            // lock new slot
            const locked = await tx.parking_slots.updateMany({
                where: {
                    slot_id: newSlotId,
                    is_available: true
                },
                data: { is_available: false }
            });

            if (locked.count === 0) {
                throw new Error('New parking slot is no longer available');
            }

            // ✅ CHỈ UPDATE VEHICLE
            await tx.vehicles.update({
                where: { vehicle_id: vehicleId },
                data: { slot_id: newSlotId }
            });

            return true;
        });
    }

    async getVehicles(filters, userId, userRole) {
        const {
            status,
            type,
            tenant_user_id,
            license_plate,
            building_id,
            page = 1,
            limit = 10
        } = filters;

        console.log("🚗 VEHICLE FILTER:", { userRole, userId, building_id });

        const where = {};
        const tenantWhere = {};

        // ===============================
        // BASIC FILTER
        // ===============================
        if (status) {
            where.status = status;
        }

        // ===============================
        // ROLE-BASED FILTERING
        // ===============================

        // TENANT: chỉ thấy xe của mình
        if (userRole === "TENANT") {
            where.tenant_user_id = userId;
        }

        // MANAGER: thấy xe của tenant thuộc building mình quản lý
        if (userRole === "MANAGER") {
            const managerBuildingIds = await this.getManagerBuildingIds(userId);

            if (!managerBuildingIds || managerBuildingIds.length === 0) {
                return {
                    vehicles: [],
                    pagination: {
                        total: 0,
                        page: Number(page),
                        limit: Number(limit),
                        totalPages: 0
                    }
                };
            }

            tenantWhere.room_tenants_history = {
                some: {
                    is_current: true,
                    room: {
                        building_id: { in: managerBuildingIds }
                    }
                }
            };
        }

        // OWNER: có thể filter theo tenant hoặc building
        if (userRole === "OWNER") {
            if (tenant_user_id) {
                where.tenant_user_id = tenant_user_id;
            }

            if (building_id) {
                tenantWhere.room_tenants_history = {
                    some: {
                        is_current: true,
                        room: {
                            building_id: Number(building_id)
                        }
                    }
                };
            }
        }

        // GẮN TENANT FILTER 1 LẦN DUY NHẤT
        if (Object.keys(tenantWhere).length > 0) {
            where.tenant = tenantWhere;
        }

        // ===============================
        // FILTER QUA REGISTRATION
        // ===============================
        if (type || license_plate) {
            where.registration = {};

            if (type) {
                where.registration.vehicle_type = type;
            }

            if (license_plate) {
                where.registration.license_plate = {
                    contains: license_plate,
                    mode: "insensitive"
                };
            }
        }

        // ===============================
        // PAGINATION
        // ===============================
        const skip = (Number(page) - 1) * Number(limit);

        // DEBUG (nếu cần)
        // console.dir(where, { depth: null });

        const [vehicles, total] = await Promise.all([
            prisma.vehicles.findMany({
                where,
                skip,
                take: Number(limit),
                orderBy: { registered_at: "desc" },
                include: {
                    slot: {
                        select: {
                            slot_id: true,
                            slot_number: true,
                            slot_type: true,
                            building_id: true,
                            building: {
                                select: {
                                    name: true
                                }
                            }
                        }
                    },
                    tenant: {
                        include: {
                            user: {
                                select: {
                                    user_id: true,
                                    full_name: true,
                                    email: true,
                                    phone: true
                                }
                            }
                        }
                    },
                    registration: {
                        select: {
                            registration_id: true,
                            status: true,
                            requested_at: true,
                            approved_at: true,
                            start_date: true,
                            end_date: true,
                            vehicle_type: true,
                            license_plate: true
                        }
                    }
                }
            }),
            prisma.vehicles.count({ where })
        ]);

        return {
            vehicles,
            pagination: {
                total,
                page: Number(page),
                limit: Number(limit),
                totalPages: Math.ceil(total / Number(limit))
            }
        };
    }
    // Get vehicle by ID
    async getVehicleById(vehicleId, userId, userRole) {
        const vehicle = await prisma.vehicles.findUnique({
            where: { vehicle_id: vehicleId },
            include: {
                slot: {
                    include: {
                        building: {
                            select: {
                                building_id: true,
                                name: true,
                                address: true
                            }
                        }
                    }
                },
                tenant: {
                    include: {
                        user: {
                            select: {
                                user_id: true,
                                full_name: true,
                                email: true,
                                phone: true
                            }
                        }
                    }
                },
                registration: {
                    include: {
                        approver: {
                            select: {
                                user_id: true,
                                full_name: true,
                                email: true
                            }
                        }
                    }
                }
            }
        });

        if (!vehicle) {
            throw new Error('Vehicle not found');
        }

        // ===============================
        // AUTHORIZATION
        // ===============================
        if (userRole === 'TENANT' && vehicle.tenant_user_id !== userId) {
            throw new Error('Unauthorized to view this vehicle');
        }

        if (userRole === 'MANAGER') {
            const managerBuildingIds = await this.getManagerBuildingIds(userId);

            if (!vehicle.slot) {
                throw new Error('Vehicle is not assigned to any building');
            }

            const slotBuildingId = vehicle.slot.building_id;

            if (!managerBuildingIds.includes(slotBuildingId)) {
                throw new Error('Unauthorized to view this vehicle');
            }
        }

        return vehicle;
    }

    // Deactivate vehicle and free parking slot
    async deactivateVehicle(vehicleId, deactivatedBy) {
        return prisma.$transaction(async (tx) => {

            const vehicle = await tx.vehicles.findUnique({
                where: { vehicle_id: vehicleId },
                include: {
                    slot: true,
                    tenant: {
                        include: {
                            user: true
                        }
                    }
                }
            });

            if (!vehicle) {
                throw new Error('Vehicle not found');
            }

            if (vehicle.status !== 'active') {
                throw new Error('Vehicle is not active');
            }

            // ===============================
            // FREE PARKING SLOT
            // ===============================
            if (vehicle.slot_id) {
                await tx.parking_slots.update({
                    where: { slot_id: vehicle.slot_id },
                    data: { is_available: true }
                });
            }

            // ===============================
            // DEACTIVATE VEHICLE
            // ===============================
            await tx.vehicles.update({
                where: { vehicle_id: vehicleId },
                data: {
                    status: 'deactivated',
                    slot_id: null,                 // 👈 giờ hợp lệ
                    deactivated_at: new Date(),
                    deactivated_by: deactivatedBy
                }
            });

            return tx.vehicles.findUnique({
                where: { vehicle_id: vehicleId },
                include: {
                    slot: {
                        include: {
                            building: true
                        }
                    },
                    tenant: {
                        include: {
                            user: {
                                select: {
                                    user_id: true,
                                    full_name: true,
                                    email: true,
                                    phone: true
                                }
                            }
                        }
                    }
                }
            });
        });
    }

    async reactivateVehicle(vehicleId, slotId, reactivatedBy) {
        return prisma.$transaction(async (tx) => {

            const vehicle = await tx.vehicles.findUnique({
                where: { vehicle_id: vehicleId },
                include: {
                    registration: true,
                    tenant: {
                        include: {
                            room_tenants_history: {
                                where: { is_current: true },
                                include: {
                                    room: { select: { building_id: true } }
                                }
                            }
                        }
                    }
                }
            });

            if (!vehicle) throw new Error('Vehicle not found');
            if (vehicle.status !== 'deactivated') {
                throw new Error('Only deactivated vehicles can be reactivated');
            }

            const buildingId =
                vehicle.tenant?.room_tenants_history?.[0]?.room?.building_id;

            if (!buildingId) {
                throw new Error('Tenant has no active room');
            }

            if (!slotId) {
                throw new Error('Parking slot is required');
            }

            const slot = await tx.parking_slots.findUnique({
                where: { slot_id: slotId }
            });

            if (!slot) throw new Error('Parking slot not found');
            if (!slot.is_available) throw new Error('Parking slot is not available');
            if (slot.slot_type !== vehicle.registration.vehicle_type) {
                throw new Error('Parking slot type does not match vehicle type');
            }
            if (slot.building_id !== buildingId) {
                throw new Error('Slot is not in tenant building');
            }

            await tx.parking_slots.update({
                where: { slot_id: slot.slot_id },
                data: { is_available: false }
            });

            await tx.vehicles.update({
                where: { vehicle_id: vehicleId },
                data: {
                    status: 'active',
                    slot_id: slot.slot_id,
                    deactivated_at: null,
                    deactivated_by: null
                }
            });

            return true;
        });
    }


    /* =================================================================
     * BOT OPERATIONS
     * ================================================================= */

    /**
     * CREATE BY BOT
     */
    async createVehicleRegistrationByBot(tenantUserId, data, botInfo) {
        const { type, license_plate, brand, color, start_date, end_date, note } = data;

        // 1. Validate Tenant & Active Residency
        const tenant = await prisma.tenants.findUnique({
            where: { user_id: tenantUserId },
            include: {
                user: { select: { status: true } },
                // Check if they currently live somewhere
                room_tenants_history: {
                    where: { is_current: true },
                    take: 1
                }
            }
        });

        if (!tenant) throw new Error('Tenant not found');
        if (tenant.user.status !== 'Active') throw new Error('Tenant account is not active');
        if (tenant.room_tenants_history.length === 0) throw new Error('Tenant has no active room assignment');

        // 2. Check License Plate Uniqueness (Active Vehicles)
        if (license_plate) {
            const existing = await prisma.vehicles.findFirst({
                where: {
                    license_plate,
                    status: 'active'
                }
            });
            if (existing) throw new Error('License plate already registered and active');
        }

        // 3. Prepare Bot Note
        const botNote = [
            note || '',
            `---`,
            `🤖 Created by AI Assistant (${botInfo.name})`
        ].join('\n');

        // Before 4, if type is car or motorcycle we should convert it
        let mappedType = type;
        if (type === 'car') mappedType = 'four_wheeler';
        if (type === 'motorcycle' || type === 'bike') mappedType = 'two_wheeler';

        // 4. Create Registration
        const registration = await prisma.vehicle_registrations.create({
            data: {
                requested_by: tenantUserId,
                vehicle_type: mappedType, // 'two_wheeler' or 'four_wheeler'
                license_plate,
                brand,
                color,
                start_date: start_date ? new Date(start_date) : new Date(),
                end_date: end_date ? new Date(end_date) : null,
                status: 'requested',
                note: botNote,
                requested_at: new Date()
            },
            include: {
                requester: {
                    include: { user: { select: { full_name: true } } }
                }
            }
        });

        // 5. Notify (Optional)
        try {
            await NotificationService.createNotification(
                null,
                tenantUserId,
                '✅ Đăng ký xe đã được tạo',
                `Chatbot đã tạo yêu cầu đăng ký xe ${brand} (${license_plate}) cho bạn.`,
                {
                    type: 'vehicle_bot_created',
                    registration_id: registration.registration_id
                }
            );
        } catch (e) { console.error("[Bot] Failed to notify:", e.message); }

        return registration;
    }

    /**
     * UPDATE BY BOT
     */
    async updateVehicleRegistrationByBot(registrationId, tenantUserId, data, botInfo) {
        const { type, license_plate, brand, color, start_date, end_date } = data;

        // 1. Verify Ownership & Status
        const existing = await prisma.vehicle_registrations.findUnique({
            where: { registration_id: registrationId }
        });

        if (!existing) throw new Error('Registration not found');
        if (existing.requested_by !== tenantUserId) throw new Error('Unauthorized access');
        if (existing.status !== 'requested') throw new Error('Can only update pending requests');

        // 2. Prepare Update Data
        const updateData = { updated_at: new Date() };
        if (type) updateData.vehicle_type = type;
        if (license_plate) updateData.license_plate = license_plate;
        if (brand) updateData.brand = brand;
        if (color) updateData.color = color;
        if (start_date) updateData.start_date = new Date(start_date);
        if (end_date) updateData.end_date = new Date(end_date);

        // 3. Execute
        const updated = await prisma.vehicle_registrations.update({
            where: { registration_id: registrationId },
            data: updateData
        });

        return updated;
    }

    /**
     * CANCEL BY BOT
     */
    async cancelVehicleRegistrationByBot(registrationId, tenantUserId, reason, botInfo) {
        const existing = await prisma.vehicle_registrations.findUnique({
            where: { registration_id: registrationId }
        });

        if (!existing) throw new Error('Registration not found');
        if (existing.requested_by !== tenantUserId) throw new Error('Unauthorized access');
        if (existing.status === 'cancelled') throw new Error('Already cancelled');

        // Note: Bot can cancel 'approved' ones too if needed, but safer to restrict to 'requested'
        // unless your business logic allows tenants to self-cancel active parking.
        // For now, let's allow cancelling 'requested' immediately.
        if (existing.status !== 'requested') throw new Error('Bot can currently only cancel pending requests');

        const cancelled = await prisma.vehicle_registrations.update({
            where: { registration_id: registrationId },
            data: {
                status: 'cancelled',
                cancelled_by: tenantUserId, // Mark as self-cancelled
                cancelled_at: new Date(),
                reason: `${reason || 'Cancelled by User'}\n(via Chatbot)`
            }
        });

        return cancelled;
    }

}

module.exports = new VehicleRegistrationService();