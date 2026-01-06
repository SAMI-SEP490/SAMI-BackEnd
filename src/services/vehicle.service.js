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

        const tenant = await prisma.tenants.findUnique({
            where: { user_id: tenantUserId }
        });

        if (!tenant) {
            throw new Error('Tenant not found');
        }

        const currentRoom = await prisma.room_tenants.findFirst({
            where: {
                tenant_user_id: tenantUserId,
                is_current: true
            }
        });

        if (!currentRoom) {
            throw new Error('Tenant has no active room');
        }

        const existing = await prisma.vehicle_registrations.findFirst({
            where: {
                license_plate,
                vehicle: {
                    is: {
                        status: 'active'
                    }
                }
            }
        });

        if (existing) {
            throw new Error('License plate already registered');
        }

        if (start_date && end_date && new Date(end_date) <= new Date(start_date)) {
            throw new Error('End date must be after start date');
        }

        return prisma.vehicle_registrations.create({
            data: {
                requested_by: tenantUserId,
                vehicle_type,
                license_plate,
                brand,
                color,
                start_date: new Date(start_date),
                end_date: end_date ? new Date(end_date) : null,
                status: 'requested',
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
        const {
            status,
            requested_by,
            start_date_from,
            start_date_to,
            page = 1,
            limit = 10
        } = filters;

        const where = {};

        // Role-based filtering
        if (userRole === 'TENANT') {
            where.requested_by = userId;
        }

        else if (userRole === 'MANAGER') {
            const managerBuildingIds = await this.getManagerBuildingIds(userId);

            if (managerBuildingIds.length === 0) {
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

            where.requester = {
                room_tenants_history: {
                    some: {
                        is_current: true,
                        room: {
                            building_id: {
                                in: managerBuildingIds
                            }
                        }
                    }
                }
            };
        }

        else {
            if (requested_by) {
                where.requested_by = requested_by;
            }
        }

        if (status) {
            where.status = status;
        }

        if (start_date_from || start_date_to) {
            where.start_date = {};
            if (start_date_from) {
                where.start_date.gte = new Date(start_date_from);
            }
            if (start_date_to) {
                where.start_date.lte = new Date(start_date_to);
            }
        }

        const skip = (page - 1) * limit;

        const [registrations, total] = await Promise.all([
            prisma.vehicle_registrations.findMany({
                where,
                skip,
                take: Number(limit),
                orderBy: { requested_at: 'desc' },
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
                                                    name: true
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    approver: {
                        select: { user_id: true, full_name: true }
                    },
                    rejector: {
                        select: { user_id: true, full_name: true }
                    },
                    vehicle: true
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
            type,
            license_plate,
            brand,
            color,
            start_date,
            end_date,
            note
        } = data;

        const existing = await prisma.vehicle_registrations.findUnique({
            where: { assignment_id: registrationId }
        });

        if (!existing) throw new Error('Vehicle registration not found');
        if (existing.requested_by !== tenantUserId) throw new Error('Unauthorized');
        if (existing.status !== 'requested') {
            throw new Error(`Cannot update registration with status: ${existing.status}`);
        }

        let currentInfo;
        try {
            currentInfo = JSON.parse(existing.reason);
        } catch {
            throw new Error('Invalid vehicle data');
        }

        if (type && !['two_wheeler', 'four_wheeler'].includes(type)) {
            throw new Error('Invalid vehicle type');
        }

        if (license_plate && license_plate !== currentInfo.license_plate) {
            const existingVehicle = await prisma.vehicles.findUnique({
                where: { license_plate }
            });

            if (existingVehicle && !existingVehicle.deactivated_at) {
                throw new Error('License plate already registered');
            }
        }

        if (start_date && end_date) {
            if (new Date(end_date) <= new Date(start_date)) {
                throw new Error('End date must be after start date');
            }
        }

        return prisma.vehicle_registrations.update({
            where: { assignment_id: registrationId },
            data: {
                start_date: start_date ? new Date(start_date) : undefined,
                end_date: end_date ? new Date(end_date) : undefined,
                note: note !== undefined ? note : undefined,
                reason: JSON.stringify({
                    type: type ?? currentInfo.type,
                    license_plate: license_plate ?? currentInfo.license_plate,
                    brand: brand ?? currentInfo.brand,
                    color: color ?? currentInfo.color
                })
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

        const buildingId =
            registration.requester.room_tenants_history[0]?.room.building_id;

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

            // ===============================
            // 5️⃣ Create vehicle (WITH relation)
            // ===============================
            const vehicle = await tx.vehicles.create({
                data: {
                    tenant_user_id: registration.requested_by,
                    slot_id: slotId,
                    status: "active",
                    registered_at: new Date(),

                    registration: {
                        connect: {
                            registration_id: registration.registration_id
                        }
                    },

                    tenant: {
                        connect: {
                            user_id: registration.requested_by
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
            where: {
                registration_id: registrationId
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
                                        building_id: true
                                    }
                                }
                            }
                        }
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

        // ===== PERMISSION =====
        if (!['MANAGER', 'OWNER'].includes(userRole)) {
            throw new Error('Permission denied');
        }

        return prisma.$transaction(async (tx) => {

            // ===== VEHICLE =====
            const vehicle = await tx.vehicles.findUnique({
                where: { vehicle_id: vehicleId }
            });

            if (!vehicle) {
                throw new Error('Vehicle not found');
            }

            if (vehicle.status !== 'active') {
                throw new Error('Only active vehicle can change parking slot');
            }

            if (!vehicle.parking_slot_id) {
                throw new Error('Vehicle does not have a parking slot');
            }

            // đổi đúng slot hiện tại → không làm gì
            if (vehicle.parking_slot_id === newSlotId) {
                return vehicle;
            }

            const oldSlotId = vehicle.parking_slot_id;

            // ===== NEW SLOT =====
            const newSlot = await tx.parking_slots.findUnique({
                where: { slot_id: newSlotId }
            });

            if (!newSlot) {
                throw new Error('New parking slot not found');
            }

            if (!newSlot.is_available) {
                throw new Error('New parking slot is not available');
            }

            if (newSlot.slot_type !== vehicle.type) {
                throw new Error('Slot type does not match vehicle type');
            }

            // ===== TENANT / BUILDING =====
            const tenant = await tx.tenants.findUnique({
                where: { user_id: vehicle.tenant_user_id },
                include: { rooms: true }
            });

            if (!tenant || !tenant.rooms) {
                throw new Error('Tenant or room not found');
            }

            const buildingId = tenant.rooms.building_id;

            // Manager chỉ thao tác trong building của mình
            if (userRole === 'MANAGER') {
                const managerBuildingIds = await this.getManagerBuildingIds(userId);
                if (!managerBuildingIds.includes(buildingId)) {
                    throw new Error('Manager cannot change slot outside their building');
                }
            }

            // Slot phải thuộc building của tenant
            if (newSlot.building_id !== buildingId) {
                throw new Error('Slot is not in the same building as vehicle');
            }

            /**
             * KHÔNG CHECK CAPACITY
             * vì đây chỉ là đổi slot (oldSlot → newSlot)
             */

            // ===== TRANSACTION SAFE UPDATE =====

            // lock new slot (chống race condition)
            const locked = await tx.parking_slots.updateMany({
                where: {
                    slot_id: newSlotId,
                    is_available: true
                },
                data: {
                    is_available: false,
                    vehicle_id: vehicleId
                }
            });

            if (locked.count === 0) {
                throw new Error('New parking slot is no longer available');
            }

            // free old slot
            await tx.parking_slots.update({
                where: { slot_id: oldSlotId },
                data: {
                    is_available: true,
                    vehicle_id: null
                }
            });

            // update vehicle
            await tx.vehicles.update({
                where: { vehicle_id: vehicleId },
                data: {
                    parking_slot_id: newSlotId
                }
            });

            return tx.vehicles.findUnique({
                where: { vehicle_id: vehicleId },
                include: {
                    parking_slots: true
                }
            });
        });
    }

    async getVehicles(filters, userId, userRole) {
        const {
            status,
            type,
            tenant_user_id,
            license_plate,
            page = 1,
            limit = 10
        } = filters;

        const where = {};
        if (status) {
            where.status = status;   // active | deactivated | inactive
        }
        // ===============================
        // ROLE-BASED FILTERING
        // ===============================
        if (userRole === 'TENANT') {
            where.tenant_user_id = userId;
        }

        if (userRole === 'MANAGER') {
            const managerBuildingIds = await this.getManagerBuildingIds(userId);

            if (managerBuildingIds.length === 0) {
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

            where.tenant = {
                room_tenants_history: {
                    some: {
                        is_current: true,
                        room: {
                            building_id: { in: managerBuildingIds }
                        }
                    }
                }
            };
        }

        if (userRole === 'OWNER' && tenant_user_id) {
            where.tenant_user_id = tenant_user_id;
        }

        if (status) {
            where.status = status;
        }

        // ===============================
        // FILTER QUA REGISTRATION
        // ===============================
        if (type) {
            where.registration = {
                vehicle_type: type
            };
        }

        if (license_plate) {
            where.registration = {
                ...(where.registration || {}),
                license_plate: {
                    contains: license_plate,
                    mode: 'insensitive'
                }
            };
        }

        const skip = (page - 1) * limit;

        const [vehicles, total] = await Promise.all([
            prisma.vehicles.findMany({
                where,
                skip,
                take: Number(limit),
                orderBy: { registered_at: 'desc' },
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

            // ===============================
            // GET VEHICLE + REGISTRATION + BUILDING
            // ===============================
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

            buildingId =
                vehicle.tenant.room_tenants_history[0]?.room.building_id;

            if (!buildingId) throw new Error("Tenant has no active room");

            if (!vehicle) throw new Error('Vehicle not found');

            if (vehicle.status !== 'deactivated') {
                throw new Error('Only deactivated vehicles can be reactivated');
            }

            if (!slotId) {
                throw new Error('Parking slot is required to reactivate vehicle');
            }

            const buildingId = vehicle.tenant?.rooms?.building_id;
            if (!buildingId) {
                throw new Error('Vehicle building not found');
            }

            // ===============================
            // GET SLOT (LOCKED BY TRANSACTION)
            // ===============================
            const slot = await tx.parking_slots.findUnique({
                where: { slot_id: slotId }
            });

            if (!slot) throw new Error('Parking slot not found');
            if (!slot.is_available) throw new Error('Parking slot is not available');
            if (slot.slot_type !== vehicle.registration.vehicle_type) {
                throw new Error('Parking slot type does not match vehicle type');
            }
            if (slot.building_id !== buildingId) {
                throw new Error('Cannot assign slot from another building');
            }

            // ===============================
            // CHECK BUILDING CAPACITY
            // ===============================
            const hasCapacity = await this.checkBuildingCapacity(
                buildingId,
                vehicle.registration.vehicle_type
            );

            if (!hasCapacity) {
                throw new Error('Building has reached maximum parking capacity for this vehicle type');
            }

            // ===============================
            // LOCK SLOT FIRST
            // ===============================
            await tx.parking_slots.update({
                where: {
                    slot_id: slot.slot_id,
                    is_available: true
                },
                data: {
                    is_available: false
                }
            });

            // ===============================
            // REACTIVATE VEHICLE
            // ===============================
            await tx.vehicles.update({
                where: { vehicle_id: vehicleId },
                data: {
                    status: 'active',
                    slot_id: slot.slot_id,     // 👈 đúng schema
                    deactivated_at: null,
                    deactivated_by: null,
                    updated_at: new Date()
                }
            });

            return tx.vehicles.findUnique({
                where: { vehicle_id: vehicleId },
                include: {
                    slot: {
                        include: {
                            building: {
                                select: {
                                    building_id: true,
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
                                    email: true
                                }
                            }
                        }
                    }
                }
            });
        });
    }

    //     // ============ BOT METHODS ============

    //     /**
    //      * CREATE BY BOT - Bot tạo vehicle registration thay mặt tenant
    //      */
    //     async createVehicleRegistrationByBot(tenantUserId, data, botInfo) {
    //         const {
    //             type,
    //             license_plate,
    //             brand,
    //             color,
    //             start_date,
    //             end_date,
    //             note
    //         } = data;

    //         // Verify tenant exists and is active
    //         const tenant = await prisma.tenants.findUnique({
    //             where: { user_id: tenantUserId },
    //             include: {
    //                 users: {
    //                     select: {
    //                         user_id: true,
    //                         full_name: true,
    //                         email: true,
    //                         phone: true,
    //                         status: true
    //                     }
    //                 }
    //             }
    //         });

    //         if (!tenant) {
    //             throw new Error('Tenant not found');
    //         }

    //         if (tenant.users.status !== 'Active') {
    //             throw new Error('Tenant account is not active');
    //         }

    //         // Check if license plate already exists in active vehicles
    //         if (license_plate) {
    //             const existing = await prisma.vehicles.findUnique({
    //                 where: { license_plate }
    //             });

    //             if (existing && !existing.deactivated_at) {
    //                 throw new Error('License plate already registered');
    //             }
    //         }

    //         // Validate dates if provided
    //         if (start_date && end_date) {
    //             const start = new Date(start_date);
    //             const end = new Date(end_date);

    //             if (end <= start) {
    //                 throw new Error('End date must be after start date');
    //             }
    //         }

    //         // Create note with bot info
    //         const botNote = [
    //             `🤖 Request created by Bot`,
    //             `Bot: ${botInfo.name}`,
    //             `Created at: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
    //             '',
    //             note || ''
    //         ].join('\n');

    //         // Create vehicle registration request
    //         const registration = await prisma.vehicle_registrations.create({
    //             data: {
    //                 requested_by: tenantUserId,
    //                 status: 'requested',
    //                 start_date: start_date ? new Date(start_date) : null,
    //                 end_date: end_date ? new Date(end_date) : null,
    //                 note: botNote,
    //                 requested_at: new Date(),
    //                 reason: JSON.stringify({
    //                     type,
    //                     license_plate,
    //                     brand,
    //                     color
    //                 })
    //             },
    //             include: {
    //                 tenants: {
    //                     include: {
    //                         users: {
    //                             select: {
    //                                 user_id: true,
    //                                 full_name: true,
    //                                 email: true,
    //                                 phone: true
    //                             }
    //                         },
    //                         rooms: {
    //                             select: {
    //                                 room_id: true,
    //                                 room_number: true,
    //                                 floor: true,
    //                                 buildings: {
    //                                     select: {
    //                                         building_id: true,
    //                                         name: true
    //                                     }
    //                                 }
    //                             }
    //                         }
    //                     }
    //                 }
    //             }
    //         });

    //         // Send notification to tenant
    //         try {
    //             const vehicleDesc = `${type || 'xe'} ${brand || ''} (${license_plate || 'N/A'})`.trim();

    //             await NotificationService.createNotification(
    //                 null, // Bot không có user_id
    //                 tenantUserId,
    //                 'Đăng ký xe đã được tạo',
    //                 `Bot đã tạo yêu cầu đăng ký ${vehicleDesc} cho bạn. Vui lòng kiểm tra và bổ sung thông tin nếu cần.`,
    //                 {
    //                     type: 'vehicle_registration_created_by_bot',
    //                     registration_id: registration.assignment_id,
    //                     vehicle_info: { type, license_plate, brand, color },
    //                     link: `/vehicle-registrations/${registration.assignment_id}`
    //                 }
    //             );
    //         } catch (notificationError) {
    //             console.error('Error sending bot vehicle creation notification:', notificationError);
    //         }

    //         return registration;
    //     }

    //     /**
    //      * UPDATE BY BOT - Bot cập nhật vehicle registration thay mặt tenant
    //      */
    //     async updateVehicleRegistrationByBot(registrationId, tenantUserId, data, botInfo) {
    //         const {
    //             type,
    //             license_plate,
    //             brand,
    //             color,
    //             start_date,
    //             end_date,
    //             note
    //         } = data;

    //         // Find existing registration
    //         const existing = await prisma.vehicle_registrations.findUnique({
    //             where: { assignment_id: registrationId },
    //             include: {
    //                 tenants: {
    //                     include: {
    //                         users: {
    //                             select: {
    //                                 status: true,
    //                                 full_name: true
    //                             }
    //                         }
    //                     }
    //                 }
    //             }
    //         });

    //         if (!existing) {
    //             throw new Error('Vehicle registration not found');
    //         }

    //         // Check authorization
    //         if (existing.requested_by !== tenantUserId) {
    //             throw new Error('This vehicle registration does not belong to the specified tenant');
    //         }

    //         // Verify tenant account is active
    //         if (existing.tenants?.users?.status !== 'Active') {
    //             throw new Error('Tenant account is not active');
    //         }

    //         // Can only update if status is requested
    //         if (existing.status !== 'requested') {
    //             throw new Error('Bot can only update requested vehicle registrations');
    //         }

    //         // Check if license plate already exists (if changing)
    //         if (license_plate) {
    //             const existingVehicle = await prisma.vehicles.findUnique({
    //                 where: { license_plate }
    //             });

    //             if (existingVehicle && !existingVehicle.deactivated_at) {
    //                 const currentInfo = JSON.parse(existing.reason);
    //                 if (currentInfo.license_plate !== license_plate) {
    //                     throw new Error('License plate already registered');
    //                 }
    //             }
    //         }

    //         // Validate dates
    //         if (start_date && end_date) {
    //             const start = new Date(start_date);
    //             const end = new Date(end_date);

    //             if (end <= start) {
    //                 throw new Error('End date must be after start date');
    //             }
    //         }

    //         // Get current vehicle info from reason
    //         const currentInfo = JSON.parse(existing.reason);

    //         // Prepare update data
    //         const updateData = {
    //             updated_at: new Date()
    //         };

    //         if (start_date !== undefined) {
    //             updateData.start_date = start_date ? new Date(start_date) : null;
    //         }

    //         if (end_date !== undefined) {
    //             updateData.end_date = end_date ? new Date(end_date) : null;
    //         }

    //         // Update note with bot info
    //         if (note !== undefined) {
    //             const botUpdateNote = [
    //                 existing.note || '',
    //                 '',
    //                 `[Bot Update - ${new Date().toLocaleString('vi-VN')}]: ${note}`
    //             ].join('\n');
    //             updateData.note = botUpdateNote;
    //         }

    //         // Update vehicle info in reason
    //         updateData.reason = JSON.stringify({
    //             type: type !== undefined ? type : currentInfo.type,
    //             license_plate: license_plate !== undefined ? license_plate : currentInfo.license_plate,
    //             brand: brand !== undefined ? brand : currentInfo.brand,
    //             color: color !== undefined ? color : currentInfo.color
    //         });

    //         // Perform update
    //         const updated = await prisma.vehicle_registrations.update({
    //             where: { assignment_id: registrationId },
    //             data: updateData,
    //             include: {
    //                 tenants: {
    //                     include: {
    //                         users: {
    //                             select: {
    //                                 user_id: true,
    //                                 full_name: true,
    //                                 email: true,
    //                                 phone: true
    //                             }
    //                         },
    //                         rooms: {
    //                             select: {
    //                                 room_id: true,
    //                                 room_number: true,
    //                                 floor: true,
    //                                 buildings: {
    //                                     select: {
    //                                         building_id: true,
    //                                         name: true
    //                                     }
    //                                 }
    //                             }
    //                         }
    //                     }
    //                 }
    //             }
    //         });

    //         // Send notification to tenant
    //         try {
    //             const vehicleInfo = JSON.parse(updated.reason);
    //             const vehicleDesc = `${vehicleInfo.type || 'xe'} ${vehicleInfo.brand || ''} (${vehicleInfo.license_plate || 'N/A'})`.trim();

    //             await NotificationService.createNotification(
    //                 null,
    //                 tenantUserId,
    //                 'Đăng ký xe đã được cập nhật',
    //                 `Bot đã cập nhật yêu cầu đăng ký ${vehicleDesc}.`,
    //                 {
    //                     type: 'vehicle_registration_updated_by_bot',
    //                     registration_id: registrationId,
    //                     link: `/vehicle-registrations/${registrationId}`
    //                 }
    //             );
    //         } catch (notificationError) {
    //             console.error('Error sending bot vehicle update notification:', notificationError);
    //         }

    //         return updated;
    //     }

    //     /**
    //      * DELETE BY BOT - Bot xóa vehicle registration thay mặt tenant
    //      */
    //     async deleteVehicleRegistrationByBot(registrationId, tenantUserId, botInfo) {
    //         const registration = await prisma.vehicle_registrations.findUnique({
    //             where: { assignment_id: registrationId },
    //             include: {
    //                 vehicles: true,
    //                 tenants: {
    //                     include: {
    //                         users: {
    //                             select: {
    //                                 status: true,
    //                                 full_name: true
    //                             }
    //                         }
    //                     }
    //                 }
    //             }
    //         });

    //         if (!registration) {
    //             throw new Error('Vehicle registration not found');
    //         }

    //         // Check authorization
    //         if (registration.requested_by !== tenantUserId) {
    //             throw new Error('This vehicle registration does not belong to the specified tenant');
    //         }

    //         // Verify tenant account is active
    //         if (registration.tenants?.users?.status !== 'Active') {
    //             throw new Error('Tenant account is not active');
    //         }

    //         // Can only delete if status is requested or rejected
    //         if (!['requested', 'rejected'].includes(registration.status)) {
    //             throw new Error('Bot can only delete requested or rejected vehicle registrations');
    //         }

    //         // Check if there are any vehicles
    //         if (registration.vehicles.length > 0) {
    //             throw new Error('Cannot delete registration with associated vehicles');
    //         }

    //         // Parse vehicle info for notification
    //         const vehicleInfo = JSON.parse(registration.reason);

    //         await prisma.vehicle_registrations.delete({
    //             where: { assignment_id: registrationId }
    //         });

    //         // Send notification to tenant
    //         try {
    //             const vehicleDesc = `${vehicleInfo.type || 'xe'} ${vehicleInfo.brand || ''} (${vehicleInfo.license_plate || 'N/A'})`.trim();

    //             await NotificationService.createNotification(
    //                 null,
    //                 tenantUserId,
    //                 'Đăng ký xe đã được xóa',
    //                 `Bot đã xóa yêu cầu đăng ký ${vehicleDesc}.`,
    //                 {
    //                     type: 'vehicle_registration_deleted_by_bot',
    //                     registration_id: registrationId
    //                 }
    //             );
    //         } catch (notificationError) {
    //             console.error('Error sending bot vehicle delete notification:', notificationError);
    //         }

    //         return {
    //             success: true,
    //             deleted_registration: {
    //                 assignment_id: registrationId,
    //                 tenant_name: registration.tenants?.users?.full_name,
    //                 vehicle_info: vehicleInfo
    //             }
    //         };
    //     }

    //     /**
    //      * CANCEL BY BOT - Bot cancel vehicle registration thay mặt tenant
    //      */
    //     async cancelVehicleRegistrationByBot(registrationId, tenantUserId, cancellationReason, botInfo) {
    //         const registration = await prisma.vehicle_registrations.findUnique({
    //             where: { assignment_id: registrationId },
    //             include: {
    //                 vehicles: {
    //                     where: {
    //                         deactivated_at: null
    //                     }
    //                 },
    //                 tenants: {
    //                     include: {
    //                         users: {
    //                             select: {
    //                                 status: true,
    //                                 full_name: true
    //                             }
    //                         }
    //                     }
    //                 }
    //             }
    //         });

    //         if (!registration) {
    //             throw new Error('Vehicle registration not found');
    //         }

    //         // Check authorization
    //         if (registration.requested_by !== tenantUserId) {
    //             throw new Error('This vehicle registration does not belong to the specified tenant');
    //         }

    //         // Verify tenant account is active
    //         if (registration.tenants?.users?.status !== 'Active') {
    //             throw new Error('Tenant account is not active');
    //         }

    //         // Bot can only cancel requested registrations
    //         if (registration.status !== 'requested') {
    //             throw new Error('Bot can only cancel requested vehicle registrations');
    //         }

    //         // Parse vehicle info
    //         const vehicleInfo = JSON.parse(registration.reason);

    //         // Add bot info to cancellation reason
    //         const botCancellationReason = [
    //             `🤖 Cancelled by Bot`,
    //             `Bot: ${botInfo.name}`,
    //             `Cancelled at: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
    //             '',
    //             cancellationReason || 'No reason provided'
    //         ].join('\n');

    //         // Cancel registration
    //         const cancelled = await prisma.$transaction(async (tx) => {
    //             // Cancel registration
    //             const updated = await tx.vehicle_registrations.update({
    //                 where: { assignment_id: registrationId },
    //                 data: {
    //                     status: 'cancelled',
    //                     canceled_by: tenantUserId,
    //                     canceled_at: new Date(),
    //                     reason: botCancellationReason
    //                 }
    //             });

    //             // Deactivate associated vehicles if any
    //             if (registration.vehicles.length > 0) {
    //                 await tx.vehicles.updateMany({
    //                     where: {
    //                         registration_id: registrationId,
    //                         deactivated_at: null
    //                     },
    //                     data: {
    //                         deactivated_at: new Date(),
    //                         deactivated_by: tenantUserId,
    //                         status: 'deactivated'
    //                     }
    //                 });
    //             }

    //             return await tx.vehicle_registrations.findUnique({
    //                 where: { assignment_id: registrationId },
    //                 include: {
    //                     tenants: {
    //                         include: {
    //                             users: {
    //                                 select: {
    //                                     user_id: true,
    //                                     full_name: true,
    //                                     email: true,
    //                                     phone: true
    //                                 }
    //                             },
    //                             rooms: {
    //                                 select: {
    //                                     room_id: true,
    //                                     room_number: true,
    //                                     floor: true
    //                                 }
    //                             }
    //                         }
    //                     },
    //                     vehicles: true
    //                 }
    //             });
    //         });

    //         // Send notification to tenant
    //         try {
    //             const vehicleDesc = `${vehicleInfo.type || 'xe'} ${vehicleInfo.brand || ''} (${vehicleInfo.license_plate || 'N/A'})`.trim();

    //             await NotificationService.createNotification(
    //                 null,
    //                 tenantUserId,
    //                 'Đăng ký xe đã được hủy',
    //                 `Bot đã hủy yêu cầu đăng ký ${vehicleDesc}.`,
    //                 {
    //                     type: 'vehicle_registration_cancelled_by_bot',
    //                     registration_id: registrationId,
    //                     reason: cancellationReason,
    //                     link: `/vehicle-registrations/${registrationId}`
    //                 }
    //             );
    //         } catch (notificationError) {
    //             console.error('Error sending bot vehicle cancel notification:', notificationError);
    //         }

    //         return cancelled;
    //     }

    //     /**
    //      * GET BY BOT - Bot lấy thông tin vehicle registration
    //      */
    //     async getVehicleRegistrationByBot(registrationId, tenantUserId, botInfo) {
    //         const registration = await prisma.vehicle_registration.findUnique({
    //             where: { assignment_id: registrationId },
    //             include: {
    //                 tenants: {
    //                     include: {
    //                         users: {
    //                             select: {
    //                                 user_id: true,
    //                                 full_name: true,
    //                                 email: true,
    //                                 phone: true
    //                             }
    //                         },
    //                         rooms: {
    //                             select: {
    //                                 room_id: true,
    //                                 room_number: true,
    //                                 floor: true,
    //                                 buildings: {
    //                                     select: {
    //                                         building_id: true,
    //                                         name: true,
    //                                         address: true
    //                                     }
    //                                 }
    //                             }
    //                         }
    //                     }
    //                 },
    //                 users: {
    //                     select: {
    //                         user_id: true,
    //                         full_name: true,
    //                         email: true
    //                     }
    //                 },
    //                 vehicles: {
    //                     where: {
    //                         deactivated_at: null
    //                     }
    //                 }
    //             }
    //         });

    //         if (!registration) {
    //             throw new Error('Vehicle registration not found');
    //         }

    //         // Check authorization
    //         if (registration.requested_by !== tenantUserId) {
    //             throw new Error('This vehicle registration does not belong to the specified tenant');
    //         }

    //         return registration;
    //     }

    //     /**
    //      * GET LIST BY BOT - Bot lấy danh sách vehicle registrations của tenant
    //      */
    //     async getVehicleRegistrationsByBot(tenantUserId, filters, botInfo) {
    //         const {
    //             status,
    //             start_date_from,
    //             start_date_to,
    //             page = 1,
    //             limit = 10
    //         } = filters;

    //         // Verify tenant exists
    //         const tenant = await prisma.tenants.findUnique({
    //             where: { user_id: tenantUserId }
    //         });

    //         if (!tenant) {
    //             throw new Error('Tenant not found');
    //         }

    //         const where = {
    //             requested_by: tenantUserId
    //         };

    //         if (status) {
    //             where.status = status;
    //         }

    //         if (start_date_from || start_date_to) {
    //             where.start_date = {};
    //             if (start_date_from) {
    //                 where.start_date.gte = new Date(start_date_from);
    //             }
    //             if (start_date_to) {
    //                 where.start_date.lte = new Date(start_date_to);
    //             }
    //         }

    //         const skip = (page - 1) * limit;

    //         const [registrations, total] = await Promise.all([
    //             prisma.vehicle_registrations.findMany({
    //                 where,
    //                 skip,
    //                 take: parseInt(limit),
    //                 orderBy: { requested_at: 'desc' },
    //                 include: {
    //                     tenants: {
    //                         include: {
    //                             users: {
    //                                 select: {
    //                                     user_id: true,
    //                                     full_name: true,
    //                                     email: true,
    //                                     phone: true
    //                                 }
    //                             },
    //                             rooms: {
    //                                 select: {
    //                                     room_id: true,
    //                                     room_number: true,
    //                                     floor: true,
    //                                     buildings: {
    //                                         select: {
    //                                             building_id: true,
    //                                             name: true
    //                                         }
    //                                     }
    //                                 }
    //                             }
    //                         }
    //                     },
    //                     users: {
    //                         select: {
    //                             user_id: true,
    //                             full_name: true
    //                         }
    //                     },
    //                     vehicles: {
    //                         where: {
    //                             deactivated_at: null
    //                         },
    //                         select: {
    //                             vehicle_id: true,
    //                             license_plate: true,
    //                             type: true,
    //                             status: true
    //                         }
    //                     }
    //                 }
    //             }),
    //             prisma.vehicle_registrations.count({ where })
    //         ]);

    //         return {
    //             registrations,
    //             pagination: {
    //                 total,
    //                 page: parseInt(page),
    //                 limit: parseInt(limit),
    //                 totalPages: Math.ceil(total / limit)
    //             }
    //         };
    //     }

    //     /**
    //      * GET VEHICLES BY BOT - Bot lấy danh sách vehicles của tenant
    //      */
    //     async getVehiclesByBot(tenantUserId, filters, botInfo) {
    //         const {
    //             status,
    //             type,
    //             license_plate,
    //             page = 1,
    //             limit = 10
    //         } = filters;

    //         // Verify tenant exists
    //         const tenant = await prisma.tenants.findUnique({
    //             where: { user_id: tenantUserId }
    //         });

    //         if (!tenant) {
    //             throw new Error('Tenant not found');
    //         }

    //         const where = {
    //             tenant_user_id: tenantUserId,
    //             deactivated_at: null
    //         };

    //         if (status) {
    //             where.status = status;
    //         }

    //         if (type) {
    //             where.type = type;
    //         }

    //         if (license_plate) {
    //             where.license_plate = {
    //                 contains: license_plate,
    //                 mode: 'insensitive'
    //             };
    //         }

    //         const skip = (page - 1) * limit;

    //         const [vehicles, total] = await Promise.all([
    //             prisma.vehicles.findMany({
    //                 where,
    //                 skip,
    //                 take: parseInt(limit),
    //                 orderBy: { registered_at: 'desc' },
    //                 include: {
    //                     tenants: {
    //                         include: {
    //                             users: {
    //                                 select: {
    //                                     user_id: true,
    //                                     full_name: true,
    //                                     email: true,
    //                                     phone: true
    //                                 }
    //                             },
    //                             rooms: {
    //                                 select: {
    //                                     room_id: true,
    //                                     room_number: true,
    //                                     floor: true,
    //                                     buildings: {
    //                                         select: {
    //                                             building_id: true,
    //                                             name: true
    //                                         }
    //                                     }
    //                                 }
    //                             }
    //                         }
    //                     },
    //                     vehicle_registrations: {
    //                         select: {
    //                             assignment_id: true,
    //                             status: true,
    //                             requested_at: true,
    //                             approved_at: true,
    //                             start_date: true,
    //                             end_date: true
    //                         }
    //                     }
    //                 }
    //             }),
    //             prisma.vehicles.count({ where })
    //         ]);

    //         return {
    //             vehicles,
    //             pagination: {
    //                 total,
    //                 page: parseInt(page),
    //                 limit: parseInt(limit),
    //                 totalPages: Math.ceil(total / limit)
    //             }
    //         };
    //     }

    //     /**
    //      * GET VEHICLE BY BOT - Bot lấy thông tin chi tiết vehicle
    //      */
    //     async getVehicleByBot(vehicleId, tenantUserId, botInfo) {
    //         const vehicle = await prisma.vehicles.findUnique({
    //             where: { vehicle_id: vehicleId },
    //             include: {
    //                 tenants: {
    //                     include: {
    //                         users: {
    //                             select: {
    //                                 user_id: true,
    //                                 full_name: true,
    //                                 email: true,
    //                                 phone: true
    //                             }
    //                         },
    //                         rooms: {
    //                             select: {
    //                                 room_id: true,
    //                                 room_number: true,
    //                                 floor: true,
    //                                 buildings: {
    //                                     select: {
    //                                         building_id: true,
    //                                         name: true,
    //                                         address: true
    //                                     }
    //                                 }
    //                             }
    //                         }
    //                     }
    //                 },
    //                 vehicle_registrations: {
    //                     include: {
    //                         users: {
    //                             select: {
    //                                 user_id: true,
    //                                 full_name: true,
    //                                 email: true
    //                             }
    //                         }
    //                     }
    //                 },
    //                 users: {
    //                     select: {
    //                         user_id: true,
    //                         full_name: true,
    //                         email: true
    //                     }
    //                 }
    //             }
    //         });

    //         if (!vehicle) {
    //             throw new Error('Vehicle not found');
    //         }

    //         // Check authorization
    //         if (vehicle.tenant_user_id !== tenantUserId) {
    //             throw new Error('This vehicle does not belong to the specified tenant');
    //         }

    //         return vehicle;
    //     }

    //     /**
    //      * GET STATS BY BOT - Bot lấy thống kê vehicle registration của tenant
    //      */
    //     async getVehicleStatsByBot(tenantUserId, botInfo) {
    //         // Verify tenant exists
    //         const tenant = await prisma.tenants.findUnique({
    //             where: { user_id: tenantUserId }
    //         });

    //         if (!tenant) {
    //             throw new Error('Tenant not found');
    //         }

    //         const where = {
    //             requested_by: tenantUserId
    //         };

    //         const [total, requested, approved, rejected, cancelled] = await Promise.all([
    //             prisma.vehicle_registrations.count({ where }),
    //             prisma.vehicle_registrations.count({ where: { ...where, status: 'requested' } }),
    //             prisma.vehicle_registrations.count({ where: { ...where, status: 'approved' } }),
    //             prisma.vehicle_registrations.count({ where: { ...where, status: 'rejected' } }),
    //             prisma.vehicle_registrations.count({ where: { ...where, status: 'cancelled' } })
    //         ]);

    //         // Get statistics of active vehicles
    //         const vehicleWhere = {
    //             tenant_user_id: tenantUserId,
    //             deactivated_at: null
    //         };

    //         const [totalVehicles, activeVehicles] = await Promise.all([
    //             prisma.vehicles.count({ where: vehicleWhere }),
    //             prisma.vehicles.count({ where: { ...vehicleWhere, status: 'active' } })
    //         ]);

    //         return {
    //             registrations: {
    //                 total,
    //                 requested,
    //                 approved,
    //                 rejected,
    //                 cancelled
    //             },
    //             vehicles: {
    //                 total: totalVehicles,
    //                 active: activeVehicles
    //             }
    //         };
    //     }
}

module.exports = new VehicleRegistrationService();