// Updated: 2025-12-08
// by: Assistant
// Modified: Added building-based filtering for Manager role

const prisma = require('../config/prisma');
const NotificationService = require('./notification.service');

class VehicleRegistrationService {
    static async cleanupExpiredVehicles() {
        const now = new Date();

        return prisma.$transaction(async (tx) => {

            // 1. Lấy danh sách xe đã hết hạn registration
            const expiredVehicles = await tx.vehicles.findMany({
                where: {
                    registration: {
                        end_date: {
                            lt: now
                        }
                    }
                },
                select: {
                    vehicle_id: true,
                    slot_id: true,
                    registration: {
                        select: { registration_id: true }
                    }
                }
            });

            if (!expiredVehicles.length) {
                return 0;
            }

            const vehicleIds = expiredVehicles.map(v => v.vehicle_id);
            const slotIds = expiredVehicles
                .filter(v => v.slot_id)
                .map(v => v.slot_id);

            const registrationIds = expiredVehicles
                .filter(v => v.registration)
                .map(v => v.registration.registration_id);

            // 2. Nhả parking slots
            if (slotIds.length) {
                await tx.parking_slots.updateMany({
                    where: {
                        slot_id: { in: slotIds }
                    },
                    data: {
                        is_available: true
                    }
                });
            }

            // 3. Xóa registrations
            if (registrationIds.length) {
                await tx.vehicle_registrations.deleteMany({
                    where: {
                        registration_id: { in: registrationIds }
                    }
                });
            }

            // 4. Xóa vehicles
            const deleted = await tx.vehicles.deleteMany({
                where: {
                    vehicle_id: { in: vehicleIds }
                }
            });

            return deleted.count;
        });
    }
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
            throw new Error('Không tìm thấy tòa nhà');
        }

        if (!['two_wheeler', 'four_wheeler'].includes(vehicleType)) {
            throw new Error('Lọại xe không hợp lệ');
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
            throw new Error("Không tìm thấy người thuê");
        }

        if (!tenant.building_id) {
            throw new Error("Người thuê không thuộc tòa nhà nào");
        }
        // Validate active contract
        const roomTenant = await prisma.room_tenants.findFirst({
            where: {
                tenant_user_id: tenantUserId,
                is_current: true
            },
            select: {
                room_id: true
            }
        });

        if (!roomTenant) {
            throw new Error("Người thuê hiện không ở phòng nào");
        }
        const activeContracts = await prisma.contracts.findMany({
            where: {
                room_id: roomTenant.room_id,
                status: "active",
                deleted_at: null
            },
            select: {
                start_date: true,
                end_date: true
            }
        });

        if (activeContracts.length === 0) {
            throw new Error("Phòng hiện tại không có hợp đồng hoạt động");
        }
        // 2️⃣ Validate vehicle type
        if (!["two_wheeler", "four_wheeler"].includes(vehicle_type)) {
            throw new Error("Lọại xe không hợp lệ");
        }

        // 3️⃣ Check license plate uniqueness (active only)
        if (license_plate) {
            const existedVehicle = await prisma.vehicles.findFirst({
                where: {
                    license_plate,
                    status: "active"
                }

            });
            const existedRegistration = await prisma.vehicle_registrations.findFirst({
                where: {
                    license_plate,
                    status: { not: 'rejected' }
                }
            });
            if (existedVehicle || existedRegistration) {
                throw new Error("Biển số xe đã được đăng ký");
            }
        }

        // 4️⃣ Validate date logic
        const regStart = new Date(start_date);
        const regEnd = end_date ? new Date(end_date) : regStart;

        if (regEnd <= regStart) {
            throw new Error("End date must be after start date");
        }
        const contractStart = new Date(
            Math.min(...activeContracts.map(c => new Date(c.start_date)))
        );
        const contractEnd = new Date(
            Math.max(...activeContracts.map(c => new Date(c.end_date)))
        );
        // normalize về 00:00 để tránh lệch giờ
        contractStart.setHours(0, 0, 0, 0);
        contractEnd.setHours(23, 59, 59, 999);
        if (regStart < contractStart || regEnd > contractEnd) {
            throw new Error("Đăng ký xe phải trong khoảng thời gian của hợp đồng thuê");
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
            building_id
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
                    registrations: []
                };
            }

            // 🔒 HARD LOCK THE BUILDING
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

        // 👉 OPTIONAL: filter theo start_date nếu sau này dùng
        if (start_date_from || start_date_to) {
            where.start_date = {};

            if (start_date_from) {
                where.start_date.gte = new Date(start_date_from);
            }

            if (start_date_to) {
                where.start_date.lte = new Date(start_date_to);
            }
        }

        const registrations = await prisma.vehicle_registrations.findMany({
            where,
            orderBy: { requested_at: "desc" },
            select: {
                registration_id: true,
                vehicle_type: true,
                license_plate: true,
                brand: true,
                color: true,
                start_date: true,
                end_date: true,
                status: true,
                requested_at: true,
                reason: true,
                note: true, // ✅ note của registration

                requester: {
                    select: {
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
                    select: {
                        vehicle_id: true,
                        status: true,
                        note: true, // ✅ note của vehicle
                        slot: {
                            select: {
                                slot_id: true,
                                slot_number: true,
                                slot_type: true,
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
        });
        return {
            registrations
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
        const roomTenant = await prisma.room_tenants.findFirst({
            where: {
                tenant_user_id: tenantUserId,
                is_current: true
            },
            select: {
                room_id: true
            }
        });

        if (!roomTenant) {
            throw new Error("Người thuê hiện không ở phòng nào");
        }
        const activeContracts = await prisma.contracts.findMany({
            where: {
                room_id: roomTenant.room_id,
                status: "active",
                deleted_at: null
            },
            select: {
                start_date: true,
                end_date: true
            }
        });

        if (activeContracts.length === 0) {
            throw new Error("Phòng hiện tại không có hợp đồng hoạt động");
        }
        const existing = await prisma.vehicle_registrations.findUnique({
            where: { registration_id: Number(registrationId) }
        });

        if (!existing) {
            throw new Error("Không tìm thấy đăng ký xe");
        }

        if (existing.requested_by !== tenantUserId) {
            throw new Error("Không có quyền cập nhật đăng ký xe này");
        }

        if (existing.status !== "requested") {
            throw new Error(
                `Không thể cập nhật đăng ký xe có trạng thái: ${existing.status}`
            );
        }
        //  Validate vehicle type
        if (
            vehicle_type &&
            !["two_wheeler", "four_wheeler"].includes(vehicle_type)
        ) {
            throw new Error("Invalid vehicle type");
        }
        //  Check license plate uniqueness (only active vehicles)
        if (license_plate && license_plate !== existing.license_plate) {
            const existedVehicle = await prisma.vehicles.findFirst({
                where: {
                    license_plate,
                    status: "active"
                }
            });
            const existedRegistration = await prisma.vehicle_registrations.findFirst({
                where: {
                    license_plate,
                    status: { not: 'rejected' }
                }
            });
            if (existedVehicle || existedRegistration) {
                throw new Error("Biển số xe đã được đăng ký");
            }
        }

        const regStart = new Date(start_date ?? existing.start_date);
        const regEnd = end_date
            ? new Date(end_date)
            : existing.end_date
                ? new Date(existing.end_date)
                : regStart;

        if (regEnd <= regStart) {
            throw new Error("Ngày kết thúc phải sau ngày bắt đầu");
        }

        const contractStart = new Date(
            Math.min(...activeContracts.map(c => new Date(c.start_date)))
        );
        const contractEnd = new Date(
            Math.max(...activeContracts.map(c => new Date(c.end_date)))
        );

        contractStart.setHours(0, 0, 0, 0);
        contractEnd.setHours(23, 59, 59, 999);

        if (regStart < contractStart || regEnd > contractEnd) {
            throw new Error("Đăng ký xe phải trong khoảng thời gian của hợp đồng thuê");
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
        if (!slotId) throw new Error("Chỗ đậu xe là bắt buộc");
        // 1. Load registration + tenant + building
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
        if (!registration) throw new Error("Không tìm thấy đăng ký xe");
        if (registration.status !== "requested") {
            throw new Error(`Không thể phê duyệt trạng thái ${registration.status}`);
        }
        const buildingId = registration.requester.building_id;
        if (!buildingId) throw new Error("Không tìm thấy tòa nhà của người thuê");
        // 2. Authorization
        if (userRole === "MANAGER") {
            const allowed = await this.isRegistrationInManagerBuilding(
                registrationId,
                approvedBy
            );
            if (!allowed) throw new Error("Không có quyền phê duyệt");
        }

        return prisma.$transaction(async (tx) => {
            // Lock & validate slot
            const slot = await tx.parking_slots.findFirst({
                where: {
                    slot_id: slotId,
                    building_id: buildingId,
                    slot_type: registration.vehicle_type,
                    is_available: true
                }
            });

            if (!slot) throw new Error("Chỗ đậu xe không hợp lệ hoặc không còn trống");

            // License plate uniqueness
            const existedVehicle = await tx.vehicles.findFirst({
                where: {
                    registration: {
                        license_plate: registration.license_plate
                    },
                    status: "active"
                }
            });

            if (existedVehicle) {
                throw new Error("Biển số xe đã được đăng ký");
            }

            // Building quota
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
                throw new Error("Đạt giới hạn chỗ đậu xe cho loại xe này trong tòa nhà");
            }

            // Approve registration
            await tx.vehicle_registrations.update({
                where: { registration_id: registrationId },
                data: {
                    status: "approved",
                    approved_by: approvedBy,
                    approved_at: new Date()
                }
            });
            console.log("🔥 USING PRISMA CLIENT AT", __filename);

            // Create vehicle (WITH relation)
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

            // Lock slot
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
            select: {
                registration_id: true,
                requested_by: true,
                status: true,
                vehicle_type: true,
                license_plate: true,
                brand: true,
                color: true,
                requester: {
                    select: {
                        user_id: true,
                        building_id: true
                    }
                }
            }
        });

        if (!registration) {
            throw new Error('Không tìm thấy đăng ký xe');
        }

        if (registration.status !== 'requested') {
            throw new Error(`Không thể từ chối đăng ký với trạng thái: ${registration.status}`);
        }

        if (userRole === 'MANAGER') {
            const allowed = await this.isRegistrationInManagerBuilding(
                registrationId,
                rejectedBy
            );
            if (!allowed) {
                throw new Error('Không có quyền từ chối đăng ký này');
            }
        }

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
            const vehicleTypeLabel = {
                two_wheeler: 'xe 2 bánh',
                four_wheeler: 'xe 4 bánh'
            };
            const recipientUserId = rejected.requester.user.user_id;
            const vehicleDesc = `${vehicleTypeLabel[registration.vehicle_type] || 'xe'}`
                + `${registration.brand ? ` ${registration.brand}` : ''}`
                + `${registration.license_plate ? ` (${registration.license_plate})` : ''}`;

            await NotificationService.createNotification(
                rejectedBy,
                recipientUserId,
                'Đăng ký xe bị từ chối',
                `Đăng ký ${vehicleDesc} của bạn đã bị từ chối. Lý do: ${rejectionReason}`,
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

    async cancelVehicleRegistration(registrationId, userId, userRole) {
        // ===== ONLY TENANT =====
        if (userRole !== 'TENANT') {
            throw new Error('Chỉ người thuê mới có thể hủy đăng ký xe');
        }

        const registration = await prisma.vehicle_registrations.findUnique({
            where: { registration_id: registrationId }
        });

        if (!registration) {
            throw new Error('Không tìm thấy đăng ký xe');
        }

        // ===== OWNERSHIP =====
        if (registration.requested_by !== userId) {
            throw new Error('Không có quyền hủy đăng ký xe này');
        }

        // ===== STATUS CHECK =====
        if (registration.status !== 'requested') {
            throw new Error(
                'Chỉ những đăng ký có trạng thái "requested" mới có thể bị hủy'
            );
        }

        // ===== DELETE HARD =====
        await prisma.vehicle_registrations.delete({
            where: { registration_id: registrationId }
        });

        return {
            success: true,
            message: 'Hủy đăng ký xe thành công'
        };
    }

    // Delete vehicle registration (only requested or rejected ones)
    async deleteVehicleRegistration(registrationId, tenantUserId) {
        const registration = await prisma.vehicle_registrations.findUnique({
            where: { registration_id: registrationId }
        });

        if (!registration) {
            throw new Error('Không tìm thấy đăng ký xe');
        }

        // Authorization
        if (registration.requested_by !== tenantUserId) {
            throw new Error('Không có quyền hủy đăng ký xe này');
        }

        // Only requested or rejected
        if (!['requested', 'rejected'].includes(registration.status)) {
            throw new Error(`Không thể xóa đăng ký có trạng thái: ${registration.status}`);
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
            throw new Error('Không có quyền thay đổi chỗ đậu xe');
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

            if (!vehicle) throw new Error('Không tìm thấy xe');
            if (vehicle.status !== 'active') {
                throw new Error('Chỉ có thể thay đổi chỗ đậu cho xe đang hoạt động');
            }

            const oldSlotId = vehicle.slot_id;

            const newSlot = await tx.parking_slots.findUnique({
                where: { slot_id: newSlotId }
            });

            if (!newSlot) throw new Error('Không tìm thấy chỗ đậu xe mới');
            if (!newSlot.is_available) {
                throw new Error('Chỗ đậu xe mới không khả dụng');
            }

            // ĐÚNG vehicle type
            if (newSlot.slot_type !== vehicle.registration.vehicle_type) {
                throw new Error('Chỗ đậu xe không phù hợp với loại xe');
            }

            const buildingId =
                vehicle.tenant?.room_tenants_history?.[0]?.room?.building_id;

            if (!buildingId) {
                throw new Error('Tenant has no active room');
            }

            if (newSlot.building_id !== buildingId) {
                throw new Error('Slot is not in the same building as vehicle');
            }

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
                throw new Error('Chôỗ đậu xe mới không khả dụng');
            }

            // CHỈ UPDATE VEHICLE
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
            building_id
        } = filters;

        const where = {};

        /* ========= BASIC FILTER ========= */
        if (status) {
            where.status = status;
        }

        /* ========= ROLE BASED ========= */

        // TENANT
        if (userRole === "TENANT") {
            where.tenant_user_id = userId;
        }

        // MANAGER
        if (userRole === "MANAGER") {
            const managerBuildingIds = await this.getManagerBuildingIds(userId);

            if (!managerBuildingIds?.length) {
                return { vehicles: [] };
            }

            where.tenant = {
                building_id: { in: managerBuildingIds }
            };
        }

        // OWNER
        if (userRole === "OWNER") {
            if (tenant_user_id) {
                where.tenant_user_id = Number(tenant_user_id);
            }

            if (building_id) {
                where.tenant = {
                    building_id: Number(building_id)
                };
            }
        }

        /* ========= FILTER QUA REGISTRATION ========= */
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

        /* ========= QUERY ========= */
        const vehicles = await prisma.vehicles.findMany({
            where,
            orderBy: { registered_at: "desc" },
            include: {
                slot: {
                    select: {
                        slot_id: true,
                        slot_number: true,
                        slot_type: true,
                        building_id: true,
                        building: { select: { name: true } }
                    }
                },
                tenant: {
                    select: {
                        user_id: true,
                        building_id: true,
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
                        start_date: true,
                        end_date: true,
                        vehicle_type: true,
                        license_plate: true
                    }
                }
            }
        });

        return { vehicles };
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
            throw new Error('Không tìm thấy xe');
        }

        // ===============================
        // AUTHORIZATION
        // ===============================
        if (userRole === 'TENANT' && vehicle.tenant_user_id !== userId) {
            throw new Error('Không có quyền xem xe này');
        }

        if (userRole === 'MANAGER') {
            const managerBuildingIds = await this.getManagerBuildingIds(userId);

            if (!vehicle.slot) {
                throw new Error('Phương tiện không có chỗ đậu xe liên kết');
            }

            const slotBuildingId = vehicle.slot.building_id;

            if (!managerBuildingIds.includes(slotBuildingId)) {
                throw new Error('Không có quyền xem xe này');
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
                throw new Error('Không tìm thấy xe');
            }

            if (vehicle.status !== 'active') {
                throw new Error('Xe đang không hoạt động');
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
            // CANCEL VEHICLE REGISTRATION
            // ===============================
            await tx.vehicle_registrations.update({
                where: { registration_id: vehicle.registration_id },
                data: {
                    status: 'cancelled',
                    cancelled_by: deactivatedBy,
                    cancelled_at: new Date()
                }
            });
            // ===============================
            // DEACTIVATE VEHICLE
            // ===============================
            await tx.vehicles.update({
                where: { vehicle_id: vehicleId },
                data: {
                    status: 'deactivated',
                    slot_id: null,
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

            if (!vehicle) throw new Error('Không tìm thấy xe');
            if (vehicle.status !== 'deactivated') {
                throw new Error('Chỉ có thể kích hoạt lại xe đã tắt hoạt động');
            }

            const buildingId =
                vehicle.tenant?.room_tenants_history?.[0]?.room?.building_id;

            if (!buildingId) {
                throw new Error('Người thuê không có phòng hoạt động');
            }

            if (!slotId) {
                throw new Error('Chỗ đậu xe là bắt buộc');
            }

            const slot = await tx.parking_slots.findUnique({
                where: { slot_id: slotId }
            });

            if (!slot) throw new Error('Không tìm thấy chỗ đậu xe');
            if (!slot.is_available) throw new Error('Chỗ đậu xe không khả dụng');
            if (slot.slot_type !== vehicle.registration.vehicle_type) {
                throw new Error('Loại chỗ đậu xe không phù hợp với loại xe');
            }
            if (slot.building_id !== buildingId) {
                throw new Error('Chỗ đậu xe không thuộc cùng tòa nhà với xe');
            }

            await tx.parking_slots.update({
                where: { slot_id: slot.slot_id },
                data: { is_available: false }
            });
            await tx.vehicle_registrations.update({
                where: { registration_id: vehicle.registration_id },
                data: {
                    status: 'approved',
                    approved_by: reactivatedBy,
                    approved_at: new Date(),
                    cancelled_by: null,
                    cancelled_at: null
                }
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

        if (!tenant) throw new Error('Không tìm thấy người thuê');
        if (tenant.user.status !== 'Active') throw new Error('Tài khoản người thuê không hoạt động');
        if (tenant.room_tenants_history.length === 0) throw new Error('Người thuê không có phòng hoạt động');

        // 2. Check License Plate Uniqueness
        if (license_plate) {
            const existingVehicle = await prisma.vehicles.findFirst({
                where: {
                    license_plate,
                    status: 'active'
                }
            });
            const existingRegistration = await prisma.vehicle_registrations.findFirst({
                where: {
                    license_plate,
                    status: { not: 'rejected' }
                }
            });

            if (existingVehicle || existingRegistration) {
                throw new Error('Biển số xe đã được đăng ký');
            }
        }

        // 3. Prepare Bot Note
        const botNote = [
            note || '',
            `---`,
            `🤖 Được tạo bởi trợ lý ảo (${botInfo.name})`
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
                    registration_id: String(registration.registration_id)
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

        if (!existing) throw new Error('Không tìm thấy đăng ký xe');
        if (existing.requested_by !== tenantUserId) throw new Error('Không có quyền cập nhật đăng ký xe này');
        if (existing.status !== 'requested') throw new Error('Chỉ có thể cập nhật đăng ký ở trạng thái "requested"');

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

        if (!existing) throw new Error('Không tìm thấy đăng ký xe');
        if (existing.requested_by !== tenantUserId) throw new Error('Không có quyền cập nhật đăng ký xe này');
        if (existing.status === 'cancelled') throw new Error('Xe đã bị hủy trước đó');

        // Note: Bot can cancel 'approved' ones too if needed, but safer to restrict to 'requested'
        // unless your business logic allows tenants to self-cancel active parking.
        // For now, let's allow cancelling 'requested' immediately.
        if (existing.status !== 'requested') throw new Error('Bot chỉ có thể hủy đăng ký ở trạng thái "requested"');

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