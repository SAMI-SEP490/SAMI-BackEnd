// Updated: 2025-12-08
// by: Assistant
// Modified: Added building-based filtering for Manager role

const prisma = require('../config/prisma');
const NotificationService = require('./notification.service');

class VehicleRegistrationService {
    // Helper function to get manager's building IDs
    async getManagerBuildingIds(userId) {
        const manager = await prisma.building_managers.findUnique({
            where: { user_id: userId },
            select: { building_id: true }
        });

        return manager ? [manager.building_id] : [];
    }

    // Helper function to check if registration is in manager's building
    async isRegistrationInManagerBuilding(registrationId, managerId) {
        const registration = await prisma.vehicle_registration.findUnique({
            where: { assignment_id: registrationId },
            include: {
                tenants: {
                    include: {
                        rooms: {
                            select: { building_id: true }
                        }
                    }
                }
            }
        });

        if (!registration) return false;

        const managerBuildingIds = await this.getManagerBuildingIds(managerId);
        const tenantBuildingId = registration.tenants?.rooms?.building_id;

        return managerBuildingIds.includes(tenantBuildingId);
    }

    // Tenant creates a vehicle registration request
    async createVehicleRegistration(tenantUserId, data) {
        const {
            type,
            license_plate,
            brand,
            color,
            start_date,
            end_date,
            note
        } = data;

        // Verify tenant exists
        const tenant = await prisma.tenants.findUnique({
            where: { user_id: tenantUserId }
        });

        if (!tenant) {
            throw new Error('Tenant not found');
        }

        // Check if license plate already exists in active vehicles
        if (license_plate) {
            const existing = await prisma.vehicles.findUnique({
                where: { license_plate }
            });

            if (existing && !existing.deactivated_at) {
                throw new Error('License plate already registered');
            }
        }

        // Validate dates if provided
        if (start_date && end_date) {
            const start = new Date(start_date);
            const end = new Date(end_date);

            if (end <= start) {
                throw new Error('End date must be after start date');
            }
        }

        // Create vehicle registration request
        const registration = await prisma.vehicle_registration.create({
            data: {
                requested_by: tenantUserId,
                status: 'requested',
                start_date: start_date ? new Date(start_date) : null,
                end_date: end_date ? new Date(end_date) : null,
                note,
                requested_at: new Date(),
                reason: JSON.stringify({
                    type,
                    license_plate,
                    brand,
                    color
                })
            },
            include: {
                tenants: {
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
                                floor: true,
                                buildings: {
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

        return registration;
    }

    // Get vehicle registration by ID
    async getVehicleRegistrationById(registrationId, userId, userRole) {
        const registration = await prisma.vehicle_registration.findUnique({
            where: { assignment_id: registrationId },
            include: {
                tenants: {
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
                                floor: true,
                                buildings: {
                                    select: {
                                        building_id: true,
                                        name: true,
                                        address: true
                                    }
                                }
                            }
                        }
                    }
                },
                users: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true
                    }
                },
                vehicles: {
                    where: {
                        deactivated_at: null
                    }
                }
            }
        });

        if (!registration) {
            throw new Error('Vehicle registration not found');
        }

        // Check authorization
        if (userRole === 'TENANT' && registration.requested_by !== userId) {
            throw new Error('Unauthorized to view this registration');
        }

        // Manager can only view registrations in their building
        if (userRole === 'MANAGER') {
            const isInBuilding = await this.isRegistrationInManagerBuilding(registrationId, userId);
            if (!isInBuilding) {
                throw new Error('Unauthorized to view this registration');
            }
        }

        return registration;
    }

    // Get all vehicle registrations with filters
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

        // Apply role-based filtering
        if (userRole === 'TENANT') {
            where.requested_by = userId;
        } else if (userRole === 'MANAGER') {
            // Manager chỉ xem registrations trong tòa nhà của mình
            const managerBuildingIds = await this.getManagerBuildingIds(userId);

            if (managerBuildingIds.length === 0) {
                // Manager không có tòa nhà nào
                return {
                    registrations: [],
                    pagination: {
                        total: 0,
                        page: parseInt(page),
                        limit: parseInt(limit),
                        totalPages: 0
                    }
                };
            }

            where.tenants = {
                rooms: {
                    building_id: {
                        in: managerBuildingIds
                    }
                }
            };
        } else if (userRole === 'OWNER') {
            // Owner xem được tất cả
            if (requested_by) {
                where.requested_by = requested_by;
            }
        } else {
            // Các role khác
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
            prisma.vehicle_registration.findMany({
                where,
                skip,
                take: parseInt(limit),
                orderBy: { requested_at: 'desc' },
                include: {
                    tenants: {
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
                                    floor: true,
                                    buildings: {
                                        select: {
                                            building_id: true,
                                            name: true
                                        }
                                    }
                                }
                            }
                        }
                    },
                    users: {
                        select: {
                            user_id: true,
                            full_name: true
                        }
                    },
                    vehicles: {
                        where: {
                            deactivated_at: null
                        },
                        select: {
                            vehicle_id: true,
                            license_plate: true,
                            type: true,
                            status: true
                        }
                    }
                }
            }),
            prisma.vehicle_registration.count({ where })
        ]);

        return {
            registrations,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    // Update vehicle registration (only by tenant who created it, and only if status is requested)
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

        // Find existing registration
        const existing = await prisma.vehicle_registration.findUnique({
            where: { assignment_id: registrationId }
        });

        if (!existing) {
            throw new Error('Vehicle registration not found');
        }

        // Check authorization
        if (existing.requested_by !== tenantUserId) {
            throw new Error('Unauthorized to update this registration');
        }

        // Can only update if status is requested
        if (existing.status !== 'requested') {
            throw new Error(`Cannot update registration with status: ${existing.status}`);
        }

        // Check if license plate already exists (if changing)
        if (license_plate) {
            const existingVehicle = await prisma.vehicles.findUnique({
                where: { license_plate }
            });

            if (existingVehicle && !existingVehicle.deactivated_at) {
                const currentInfo = JSON.parse(existing.reason);
                if (currentInfo.license_plate !== license_plate) {
                    throw new Error('License plate already registered');
                }
            }
        }

        // Validate dates
        if (start_date && end_date) {
            const start = new Date(start_date);
            const end = new Date(end_date);

            if (end <= start) {
                throw new Error('End date must be after start date');
            }
        }

        // Get current vehicle info from reason
        const currentInfo = JSON.parse(existing.reason);

        // Update registration
        const updated = await prisma.vehicle_registration.update({
            where: { assignment_id: registrationId },
            data: {
                start_date: start_date ? new Date(start_date) : undefined,
                end_date: end_date ? new Date(end_date) : undefined,
                note: note !== undefined ? note : undefined,
                reason: JSON.stringify({
                    type: type !== undefined ? type : currentInfo.type,
                    license_plate: license_plate !== undefined ? license_plate : currentInfo.license_plate,
                    brand: brand !== undefined ? brand : currentInfo.brand,
                    color: color !== undefined ? color : currentInfo.color
                }),
                updated_at: new Date()
            },
            include: {
                tenants: {
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
                                floor: true,
                                buildings: {
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

        return updated;
    }

    // Approve vehicle registration and create vehicle (Manager/Owner only)
    async approveVehicleRegistration(registrationId, approvedBy, userRole, slotId) {
        const registration = await prisma.vehicle_registration.findUnique({
            where: { assignment_id: registrationId },
            include: {
                tenants: {
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

        // Manager can only approve registrations in their building
        if (userRole === 'MANAGER') {
            const isInBuilding = await this.isRegistrationInManagerBuilding(
                registrationId,
                approvedBy
            );
            if (!isInBuilding) {
                throw new Error('Unauthorized to approve this registration');
            }
        }

        if (registration.status !== 'requested') {
            throw new Error(`Cannot approve registration with status: ${registration.status}`);
        }

        // Parse vehicle info
        const vehicleInfo = JSON.parse(registration.reason || '{}');

        // Check license plate again
        if (vehicleInfo.license_plate) {
            const existing = await prisma.vehicles.findUnique({
                where: { license_plate: vehicleInfo.license_plate }
            });

            if (existing && !existing.deactivated_at) {
                throw new Error('License plate already registered');
            }
        }

        // ===============================
        // VALIDATE PARKING SLOT
        // ===============================
        if (!slotId) {
            throw new Error('Parking slot is required when approving registration');
        }

        const slot = await prisma.parking_slots.findUnique({
            where: { slot_id: parseInt(slotId) }
        });

        if (!slot) {
            throw new Error('Parking slot not found');
        }

        if (!slot.is_available) {
            throw new Error('Parking slot is not available');
        }

        if (slot.slot_type !== vehicleInfo.type) {
            throw new Error('Parking slot type does not match vehicle type');
        }

        const buildingId = registration.tenants.rooms.building_id;
        if (slot.building_id !== buildingId) {
            throw new Error('Parking slot does not belong to this building');
        }

        // ===============================
        // TRANSACTION
        // ===============================
        const result = await prisma.$transaction(async (tx) => {

            // Approve registration
            await tx.vehicle_registration.update({
                where: { assignment_id: registrationId },
                data: {
                    status: 'approved',
                    approved_by: approvedBy,
                    approved_at: new Date()
                }
            });

            // Create vehicle and assign slot
            const vehicle = await tx.vehicles.create({
                data: {
                    tenant_user_id: registration.requested_by,
                    registration_id: registrationId,
                    type: vehicleInfo.type,
                    license_plate: vehicleInfo.license_plate,
                    brand: vehicleInfo.brand,
                    color: vehicleInfo.color,
                    status: 'active',
                    note: registration.note,
                    registered_at: new Date()
                }
            });

            // GÁN SLOT QUA SERVICE LOGIC
            await tx.parking_slots.update({
                where: { slot_id: slot.slot_id },
                data: {
                    is_available: false,
                    vehicle_id: vehicle.vehicle_id
                }
            });

            await tx.vehicles.update({
                where: { vehicle_id: vehicle.vehicle_id },
                data: {
                    parking_slot_id: slot.slot_id
                }
            });
            // Return updated registration
            return tx.vehicle_registration.findUnique({
                where: { assignment_id: registrationId },
                include: {
                    tenants: {
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
                    users: {
                        select: {
                            user_id: true,
                            full_name: true,
                            email: true
                        }
                    },
                    vehicles: {
                        include: {
                            parking_slots: {
                                select: {
                                    slot_number: true,
                                    slot_type: true
                                }
                            }
                        }
                    }
                }
            });
        });

        // ===============================
        // SEND NOTIFICATION (BEST-EFFORT)
        // ===============================
        try {
            const vehicleDesc =
                `${vehicleInfo.type || 'xe'} ${vehicleInfo.brand || ''} (${vehicleInfo.license_plate || 'N/A'})`.trim();

            await NotificationService.createNotification(
                approvedBy,
                registration.requested_by,
                'Đăng ký xe đã được phê duyệt',
                `Đăng ký ${vehicleDesc} của bạn đã được chấp nhận. Xe đã được gán chỗ đậu ${slot.slot_number}.`,
                {
                    type: 'vehicle_registration_approved',
                    registration_id: registrationId,
                    slot_id: slot.slot_id,
                    vehicle_info: vehicleInfo,
                    link: `/vehicle-registrations/${registrationId}`
                }
            );
        } catch (err) {
            console.error('Error sending vehicle approval notification:', err);
        }

        return result;
    }

    // Reject vehicle registration (Manager/Owner only)
    async rejectVehicleRegistration(registrationId, rejectedBy, rejectionReason, userRole) {
        const registration = await prisma.vehicle_registration.findUnique({
            where: { assignment_id: registrationId },
            include: {
                tenants: {
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

        // Manager can only reject registrations in their building
        if (userRole === 'MANAGER') {
            const isInBuilding = await this.isRegistrationInManagerBuilding(registrationId, rejectedBy);
            if (!isInBuilding) {
                throw new Error('Unauthorized to reject this registration');
            }
        }

        if (registration.status !== 'requested') {
            throw new Error(`Cannot reject registration with status: ${registration.status}`);
        }

        // Parse vehicle info for notification
        const vehicleInfo = JSON.parse(registration.reason);

        const rejected = await prisma.vehicle_registration.update({
            where: { assignment_id: registrationId },
            data: {
                status: 'rejected',
                approved_by: rejectedBy,
                approved_at: new Date(),
                note: rejectionReason ? `${registration.note || ''}\nRejection reason: ${rejectionReason}` : registration.note
            },
            include: {
                tenants: {
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
                users: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true
                    }
                }
            }
        });

        // Send notification to tenant
        try {
            const vehicleDesc = `${vehicleInfo.type || 'xe'} ${vehicleInfo.brand || ''} (${vehicleInfo.license_plate || 'N/A'})`.trim();
            const reasonText = rejectionReason ? ` Lý do: ${rejectionReason}` : '';

            await NotificationService.createNotification(
                rejectedBy,
                registration.requested_by,
                'Đăng ký xe đã bị từ chối',
                `Đăng ký ${vehicleDesc} của bạn đã bị từ chối.${reasonText}`,
                {
                    type: 'vehicle_registration_rejected',
                    registration_id: registrationId,
                    vehicle_info: vehicleInfo,
                    reason: rejectionReason,
                    link: `/vehicle-registrations/${registrationId}`
                }
            );
        } catch (notificationError) {
            console.error('Error sending vehicle rejection notification:', notificationError);
        }

        return rejected;
    }

    // Cancel vehicle registration
    async cancelVehicleRegistration(registrationId, userId, userRole, cancellationReason) {
        const registration = await prisma.vehicle_registration.findUnique({
            where: { assignment_id: registrationId },
            include: {
                vehicles: {
                    where: {
                        deactivated_at: null
                    }
                },
                tenants: {
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

        // Tenant can only cancel their own requested registrations
        if (userRole === 'TENANT') {
            if (registration.requested_by !== userId) {
                throw new Error('Unauthorized to cancel this registration');
            }
            if (registration.status !== 'requested') {
                throw new Error('Can only cancel requested registrations');
            }
        }

        // Manager can cancel registrations in their building
        if (userRole === 'MANAGER') {
            const isInBuilding = await this.isRegistrationInManagerBuilding(registrationId, userId);
            if (!isInBuilding) {
                throw new Error('Unauthorized to cancel this registration');
            }
            if (registration.status === 'cancelled') {
                throw new Error('Registration is already cancelled');
            }
        }

        // Owner can cancel any registration except already cancelled ones
        if (userRole === 'OWNER') {
            if (registration.status === 'cancelled') {
                throw new Error('Registration is already cancelled');
            }
        }

        // If registration is approved and has active vehicle, deactivate the vehicle
        const cancelled = await prisma.$transaction(async (tx) => {
            // Cancel registration
            const updated = await tx.vehicle_registration.update({
                where: { assignment_id: registrationId },
                data: {
                    status: 'cancelled',
                    canceled_by: userId,
                    canceled_at: new Date(),
                    reason: cancellationReason || registration.reason
                }
            });

            // Deactivate associated vehicles if any
            if (registration.vehicles.length > 0) {
                await tx.vehicles.updateMany({
                    where: {
                        registration_id: registrationId,
                        deactivated_at: null
                    },
                    data: {
                        deactivated_at: new Date(),
                        deactivated_by: userId,
                        status: 'deactivated'
                    }
                });
            }

            return await tx.vehicle_registration.findUnique({
                where: { assignment_id: registrationId },
                include: {
                    tenants: {
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

        return cancelled;
    }

    // Delete vehicle registration (only requested or rejected ones)
    async deleteVehicleRegistration(registrationId, tenantUserId) {
        const registration = await prisma.vehicle_registration.findUnique({
            where: { assignment_id: registrationId },
            include: {
                vehicles: true
            }
        });

        if (!registration) {
            throw new Error('Vehicle registration not found');
        }

        // Check authorization
        if (registration.requested_by !== tenantUserId) {
            throw new Error('Unauthorized to delete this registration');
        }

        // Can only delete if status is requested or rejected
        if (!['requested', 'rejected'].includes(registration.status)) {
            throw new Error(`Cannot delete registration with status: ${registration.status}`);
        }

        // Check if there are any vehicles
        if (registration.vehicles.length > 0) {
            throw new Error('Cannot delete registration with associated vehicles');
        }

        await prisma.vehicle_registration.delete({
            where: { assignment_id: registrationId }
        });

        return true;
    }

    // Get statistics for dashboard
    async getVehicleRegistrationStats(userId, userRole) {
        const where = {};

        // Filter by tenant if role is TENANT
        if (userRole === 'TENANT') {
            where.requested_by = userId;
        } else if (userRole === 'MANAGER') {
            // Manager chỉ thống kê registrations trong tòa nhà của mình
            const managerBuildingIds = await this.getManagerBuildingIds(userId);

            if (managerBuildingIds.length > 0) {
                where.tenants = {
                    rooms: {
                        building_id: {
                            in: managerBuildingIds
                        }
                    }
                };
            }
        }
        // Owner xem tất cả (không filter)

        const [total, requested, approved, rejected, cancelled] = await Promise.all([
            prisma.vehicle_registration.count({ where }),
            prisma.vehicle_registration.count({ where: { ...where, status: 'requested' } }),
            prisma.vehicle_registration.count({ where: { ...where, status: 'approved' } }),
            prisma.vehicle_registration.count({ where: { ...where, status: 'rejected' } }),
            prisma.vehicle_registration.count({ where: { ...where, status: 'cancelled' } })
        ]);

        // Get statistics of active vehicles
        const vehicleWhere = {
            deactivated_at: null
        };

        if (userRole === 'TENANT') {
            vehicleWhere.tenant_user_id = userId;
        } else if (userRole === 'MANAGER') {
            const managerBuildingIds = await this.getManagerBuildingIds(userId);

            if (managerBuildingIds.length > 0) {
                vehicleWhere.tenants = {
                    rooms: {
                        building_id: {
                            in: managerBuildingIds
                        }
                    }
                };
            }
        }
        // Owner xem tất cả

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
    async assignVehicleToSlot(vehicleId, slotId, userId, userRole) {
        if (!['MANAGER', 'OWNER'].includes(userRole)) {
            throw new Error('Permission denied');
        }

        const vehicle = await prisma.vehicles.findUnique({
            where: { vehicle_id: vehicleId }
        });

        if (!vehicle) {
            throw new Error('Vehicle not found');
        }

        if (vehicle.status !== 'active') {
            throw new Error('Only active vehicle can be assigned to slot');
        }

        const slot = await prisma.parking_slots.findUnique({
            where: { slot_id: slotId }
        });

        if (!slot) {
            throw new Error('Parking slot not found');
        }

        if (!slot.is_available) {
            throw new Error('Parking slot is not available');
        }

        if (slot.slot_type !== vehicle.type) {
            throw new Error('Slot type does not match vehicle type');
        }
        const tenant = await prisma.tenants.findUnique({
            where: { user_id: vehicle.tenant_user_id },
            include: { rooms: true }
        });
        if (userRole === 'MANAGER') {
            const managerBuildingIds = await this.getManagerBuildingIds(userId);
            if (!managerBuildingIds.includes(slot.building_id)) {
                throw new Error('Manager cannot assign slot outside their building');
            }
        }

        if (slot.building_id !== tenant.rooms.building_id) {
            throw new Error('Slot is not in the same building as vehicle');
        }
        return prisma.$transaction(async (tx) => {
            // Nếu vehicle đã có slot → thả slot cũ
            if (vehicle.parking_slot_id) {
                await tx.parking_slots.update({
                    where: { slot_id: vehicle.parking_slot_id },
                    data: {
                        is_available: true,
                        vehicle_id: null
                    }
                });
            }

            // Gán slot mới
            await tx.parking_slots.update({
                where: { slot_id: slotId },
                data: {
                    is_available: false,
                    vehicle_id: vehicleId
                }
            });

            return tx.vehicles.update({
                where: { vehicle_id: vehicleId },
                data: {
                    parking_slot_id: slotId
                }
            });
        });
    }
    async changeVehicleSlot(vehicleId, newSlotId) {
        return prisma.$transaction(async (tx) => {

            const vehicle = await tx.vehicles.findUnique({
                where: { vehicle_id: vehicleId }
            });

            if (!vehicle) {
                throw new Error('Vehicle not found');
            }

            if (!vehicle.parking_slot_id) {
                throw new Error('Vehicle does not have a parking slot');
            }

            const oldSlotId = vehicle.parking_slot_id;

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

            const tenant = await tx.tenants.findUnique({
                where: { user_id: vehicle.tenant_user_id },
                include: { rooms: true }
            });

            if (newSlot.building_id !== tenant.rooms.building_id) {
                throw new Error('Slot is not in the same building as vehicle');
            }
            // free old slot
            await tx.parking_slots.update({
                where: { slot_id: oldSlotId },
                data: {
                    is_available: true,
                    vehicle_id: null
                }
            });

            // assign new slot
            await tx.parking_slots.update({
                where: { slot_id: newSlotId },
                data: {
                    is_available: false,
                    vehicle_id: vehicleId
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

    // Get all vehicles (for viewing only)
    async getVehicles(filters, userId, userRole) {
        const {
            status,
            type,
            tenant_user_id,
            license_plate,
            page = 1,
            limit = 10
        } = filters;

        const where = {
            deactivated_at: null
        };

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

            where.parking_slots = {
                some: {
                    building_id: { in: managerBuildingIds }
                }
            };
        }

        if (userRole === 'OWNER' && tenant_user_id) {
            where.tenant_user_id = tenant_user_id;
        }

        if (status) where.status = status;
        if (type) where.type = type;

        if (license_plate) {
            where.license_plate = {
                contains: license_plate,
                mode: 'insensitive'
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
                    parking_slots: {
                        select: {
                            slot_id: true,
                            slot_number: true,
                            slot_type: true,
                            building_id: true,
                            buildings: {
                                select: {
                                    name: true
                                }
                            }
                        }
                    },
                    tenants: {
                        include: {
                            users: {
                                select: {
                                    user_id: true,
                                    full_name: true,
                                    email: true,
                                    phone: true
                                }
                            }
                        }
                    },
                    vehicle_registration: {
                        select: {
                            assignment_id: true,
                            status: true,
                            requested_at: true,
                            approved_at: true,
                            start_date: true,
                            end_date: true
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
                totalPages: Math.ceil(total / limit)
            }
        };
    }
    // Get vehicle by ID
    async getVehicleById(vehicleId, userId, userRole) {
        const vehicle = await prisma.vehicles.findUnique({
            where: { vehicle_id: vehicleId },
            include: {
                parking_slots: {
                    include: {
                        buildings: {
                            select: {
                                building_id: true,
                                name: true,
                                address: true
                            }
                        }
                    }
                },
                tenants: {
                    include: {
                        users: {
                            select: {
                                user_id: true,
                                full_name: true,
                                email: true,
                                phone: true
                            }
                        }
                    }
                },
                vehicle_registration: {
                    include: {
                        users: {
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
            if (!vehicle.parking_slots) {
                throw new Error('Vehicle is not assigned to any building');
            }
            const slotBuildingId = vehicle.parking_slots?.building_id;

            if (!managerBuildingIds.includes(slotBuildingId)) {
                throw new Error('Unauthorized to view this vehicle');
            }
        }

        return vehicle;
    }
    async deactivateVehicle(vehicleId, deactivatedBy) {
        return prisma.$transaction(async (tx) => {

            const vehicle = await tx.vehicles.findUnique({
                where: { vehicle_id: vehicleId }
            });

            if (!vehicle) {
                throw new Error('Vehicle not found');
            }

            if (vehicle.status !== 'active') {
                throw new Error('Vehicle is not active');
            }

            // ===============================
            // FREE PARKING SLOT (IF EXISTS)
            // ===============================
            if (vehicle.parking_slot_id) {
                await tx.parking_slots.update({
                    where: { slot_id: vehicle.parking_slot_id },
                    data: {
                        is_available: true,
                        vehicle_id: null
                    }
                });
            }

            // ===============================
            // DEACTIVATE VEHICLE
            // ===============================
            await tx.vehicles.update({
                where: { vehicle_id: vehicleId },
                data: {
                    status: 'deactivated',
                    parking_slot_id: null,
                    deactivated_at: new Date(),
                    deactivated_by: deactivatedBy
                }
            });

            return tx.vehicles.findUnique({
                where: { vehicle_id: vehicleId },
                include: {
                    parking_slots: true,
                    tenants: {
                        include: {
                            users: {
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
            // GET VEHICLE
            // ===============================
            const vehicle = await tx.vehicles.findUnique({
                where: { vehicle_id: vehicleId },
                include: {
                    tenants: {
                        include: {
                            rooms: {
                                select: {
                                    building_id: true
                                }
                            }
                        }
                    }
                }
            });

            if (!vehicle) {
                throw new Error('Vehicle not found');
            }

            if (vehicle.status !== 'deactivated') {
                throw new Error('Only deactivated vehicles can be reactivated');
            }

            if (!slotId) {
                throw new Error('Parking slot is required to reactivate vehicle');
            }

            // ===============================
            // GET SLOT
            // ===============================
            const slot = await tx.parking_slots.findUnique({
                where: { slot_id: slotId }
            });

            if (!slot) {
                throw new Error('Parking slot not found');
            }

            if (!slot.is_available) {
                throw new Error('Parking slot is not available');
            }

            if (slot.slot_type !== vehicle.type) {
                throw new Error('Parking slot type does not match vehicle type');
            }

            // ===============================
            // BUILDING VALIDATION
            // ===============================
            const vehicleBuildingId = vehicle.tenants?.rooms?.building_id;

            if (!vehicleBuildingId) {
                throw new Error('Vehicle building not found');
            }

            if (slot.building_id !== vehicleBuildingId) {
                throw new Error('Cannot assign slot from another building');
            }

            // ===============================
            // REACTIVATE VEHICLE
            // ===============================
            await tx.vehicles.update({
                where: { vehicle_id: vehicleId },
                data: {
                    status: 'active',
                    parking_slot_id: slot.slot_id,
                    deactivated_at: null,
                    deactivated_by: null
                }
            });

            // ===============================
            // LOCK SLOT
            // ===============================
            await tx.parking_slots.update({
                where: { slot_id: slot.slot_id },
                data: {
                    is_available: false,
                    vehicle_id: vehicle.vehicle_id
                }
            });

            return tx.vehicles.findUnique({
                where: { vehicle_id: vehicleId },
                include: {
                    parking_slots: {
                        include: {
                            buildings: {
                                select: {
                                    building_id: true,
                                    name: true
                                }
                            }
                        }
                    },
                    tenants: {
                        include: {
                            users: {
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


    // ============ BOT METHODS ============

    /**
     * CREATE BY BOT - Bot tạo vehicle registration thay mặt tenant
     */
    async createVehicleRegistrationByBot(tenantUserId, data, botInfo) {
        const {
            type,
            license_plate,
            brand,
            color,
            start_date,
            end_date,
            note
        } = data;

        // Verify tenant exists and is active
        const tenant = await prisma.tenants.findUnique({
            where: { user_id: tenantUserId },
            include: {
                users: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true,
                        phone: true,
                        status: true
                    }
                }
            }
        });

        if (!tenant) {
            throw new Error('Tenant not found');
        }

        if (tenant.users.status !== 'Active') {
            throw new Error('Tenant account is not active');
        }

        // Check if license plate already exists in active vehicles
        if (license_plate) {
            const existing = await prisma.vehicles.findUnique({
                where: { license_plate }
            });

            if (existing && !existing.deactivated_at) {
                throw new Error('License plate already registered');
            }
        }

        // Validate dates if provided
        if (start_date && end_date) {
            const start = new Date(start_date);
            const end = new Date(end_date);

            if (end <= start) {
                throw new Error('End date must be after start date');
            }
        }

        // Create note with bot info
        const botNote = [
            `🤖 Request created by Bot`,
            `Bot: ${botInfo.name}`,
            `Created at: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
            '',
            note || ''
        ].join('\n');

        // Create vehicle registration request
        const registration = await prisma.vehicle_registration.create({
            data: {
                requested_by: tenantUserId,
                status: 'requested',
                start_date: start_date ? new Date(start_date) : null,
                end_date: end_date ? new Date(end_date) : null,
                note: botNote,
                requested_at: new Date(),
                reason: JSON.stringify({
                    type,
                    license_plate,
                    brand,
                    color
                })
            },
            include: {
                tenants: {
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
                                floor: true,
                                buildings: {
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

        // Send notification to tenant
        try {
            const vehicleDesc = `${type || 'xe'} ${brand || ''} (${license_plate || 'N/A'})`.trim();

            await NotificationService.createNotification(
                null, // Bot không có user_id
                tenantUserId,
                'Đăng ký xe đã được tạo',
                `Bot đã tạo yêu cầu đăng ký ${vehicleDesc} cho bạn. Vui lòng kiểm tra và bổ sung thông tin nếu cần.`,
                {
                    type: 'vehicle_registration_created_by_bot',
                    registration_id: registration.assignment_id,
                    vehicle_info: { type, license_plate, brand, color },
                    link: `/vehicle-registrations/${registration.assignment_id}`
                }
            );
        } catch (notificationError) {
            console.error('Error sending bot vehicle creation notification:', notificationError);
        }

        return registration;
    }

    /**
     * UPDATE BY BOT - Bot cập nhật vehicle registration thay mặt tenant
     */
    async updateVehicleRegistrationByBot(registrationId, tenantUserId, data, botInfo) {
        const {
            type,
            license_plate,
            brand,
            color,
            start_date,
            end_date,
            note
        } = data;

        // Find existing registration
        const existing = await prisma.vehicle_registration.findUnique({
            where: { assignment_id: registrationId },
            include: {
                tenants: {
                    include: {
                        users: {
                            select: {
                                status: true,
                                full_name: true
                            }
                        }
                    }
                }
            }
        });

        if (!existing) {
            throw new Error('Vehicle registration not found');
        }

        // Check authorization
        if (existing.requested_by !== tenantUserId) {
            throw new Error('This vehicle registration does not belong to the specified tenant');
        }

        // Verify tenant account is active
        if (existing.tenants?.users?.status !== 'Active') {
            throw new Error('Tenant account is not active');
        }

        // Can only update if status is requested
        if (existing.status !== 'requested') {
            throw new Error('Bot can only update requested vehicle registrations');
        }

        // Check if license plate already exists (if changing)
        if (license_plate) {
            const existingVehicle = await prisma.vehicles.findUnique({
                where: { license_plate }
            });

            if (existingVehicle && !existingVehicle.deactivated_at) {
                const currentInfo = JSON.parse(existing.reason);
                if (currentInfo.license_plate !== license_plate) {
                    throw new Error('License plate already registered');
                }
            }
        }

        // Validate dates
        if (start_date && end_date) {
            const start = new Date(start_date);
            const end = new Date(end_date);

            if (end <= start) {
                throw new Error('End date must be after start date');
            }
        }

        // Get current vehicle info from reason
        const currentInfo = JSON.parse(existing.reason);

        // Prepare update data
        const updateData = {
            updated_at: new Date()
        };

        if (start_date !== undefined) {
            updateData.start_date = start_date ? new Date(start_date) : null;
        }

        if (end_date !== undefined) {
            updateData.end_date = end_date ? new Date(end_date) : null;
        }

        // Update note with bot info
        if (note !== undefined) {
            const botUpdateNote = [
                existing.note || '',
                '',
                `[Bot Update - ${new Date().toLocaleString('vi-VN')}]: ${note}`
            ].join('\n');
            updateData.note = botUpdateNote;
        }

        // Update vehicle info in reason
        updateData.reason = JSON.stringify({
            type: type !== undefined ? type : currentInfo.type,
            license_plate: license_plate !== undefined ? license_plate : currentInfo.license_plate,
            brand: brand !== undefined ? brand : currentInfo.brand,
            color: color !== undefined ? color : currentInfo.color
        });

        // Perform update
        const updated = await prisma.vehicle_registration.update({
            where: { assignment_id: registrationId },
            data: updateData,
            include: {
                tenants: {
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
                                floor: true,
                                buildings: {
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

        // Send notification to tenant
        try {
            const vehicleInfo = JSON.parse(updated.reason);
            const vehicleDesc = `${vehicleInfo.type || 'xe'} ${vehicleInfo.brand || ''} (${vehicleInfo.license_plate || 'N/A'})`.trim();

            await NotificationService.createNotification(
                null,
                tenantUserId,
                'Đăng ký xe đã được cập nhật',
                `Bot đã cập nhật yêu cầu đăng ký ${vehicleDesc}.`,
                {
                    type: 'vehicle_registration_updated_by_bot',
                    registration_id: registrationId,
                    link: `/vehicle-registrations/${registrationId}`
                }
            );
        } catch (notificationError) {
            console.error('Error sending bot vehicle update notification:', notificationError);
        }

        return updated;
    }

    /**
     * DELETE BY BOT - Bot xóa vehicle registration thay mặt tenant
     */
    async deleteVehicleRegistrationByBot(registrationId, tenantUserId, botInfo) {
        const registration = await prisma.vehicle_registration.findUnique({
            where: { assignment_id: registrationId },
            include: {
                vehicles: true,
                tenants: {
                    include: {
                        users: {
                            select: {
                                status: true,
                                full_name: true
                            }
                        }
                    }
                }
            }
        });

        if (!registration) {
            throw new Error('Vehicle registration not found');
        }

        // Check authorization
        if (registration.requested_by !== tenantUserId) {
            throw new Error('This vehicle registration does not belong to the specified tenant');
        }

        // Verify tenant account is active
        if (registration.tenants?.users?.status !== 'Active') {
            throw new Error('Tenant account is not active');
        }

        // Can only delete if status is requested or rejected
        if (!['requested', 'rejected'].includes(registration.status)) {
            throw new Error('Bot can only delete requested or rejected vehicle registrations');
        }

        // Check if there are any vehicles
        if (registration.vehicles.length > 0) {
            throw new Error('Cannot delete registration with associated vehicles');
        }

        // Parse vehicle info for notification
        const vehicleInfo = JSON.parse(registration.reason);

        await prisma.vehicle_registration.delete({
            where: { assignment_id: registrationId }
        });

        // Send notification to tenant
        try {
            const vehicleDesc = `${vehicleInfo.type || 'xe'} ${vehicleInfo.brand || ''} (${vehicleInfo.license_plate || 'N/A'})`.trim();

            await NotificationService.createNotification(
                null,
                tenantUserId,
                'Đăng ký xe đã được xóa',
                `Bot đã xóa yêu cầu đăng ký ${vehicleDesc}.`,
                {
                    type: 'vehicle_registration_deleted_by_bot',
                    registration_id: registrationId
                }
            );
        } catch (notificationError) {
            console.error('Error sending bot vehicle delete notification:', notificationError);
        }

        return {
            success: true,
            deleted_registration: {
                assignment_id: registrationId,
                tenant_name: registration.tenants?.users?.full_name,
                vehicle_info: vehicleInfo
            }
        };
    }

    /**
     * CANCEL BY BOT - Bot cancel vehicle registration thay mặt tenant
     */
    async cancelVehicleRegistrationByBot(registrationId, tenantUserId, cancellationReason, botInfo) {
        const registration = await prisma.vehicle_registration.findUnique({
            where: { assignment_id: registrationId },
            include: {
                vehicles: {
                    where: {
                        deactivated_at: null
                    }
                },
                tenants: {
                    include: {
                        users: {
                            select: {
                                status: true,
                                full_name: true
                            }
                        }
                    }
                }
            }
        });

        if (!registration) {
            throw new Error('Vehicle registration not found');
        }

        // Check authorization
        if (registration.requested_by !== tenantUserId) {
            throw new Error('This vehicle registration does not belong to the specified tenant');
        }

        // Verify tenant account is active
        if (registration.tenants?.users?.status !== 'Active') {
            throw new Error('Tenant account is not active');
        }

        // Bot can only cancel requested registrations
        if (registration.status !== 'requested') {
            throw new Error('Bot can only cancel requested vehicle registrations');
        }

        // Parse vehicle info
        const vehicleInfo = JSON.parse(registration.reason);

        // Add bot info to cancellation reason
        const botCancellationReason = [
            `🤖 Cancelled by Bot`,
            `Bot: ${botInfo.name}`,
            `Cancelled at: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
            '',
            cancellationReason || 'No reason provided'
        ].join('\n');

        // Cancel registration
        const cancelled = await prisma.$transaction(async (tx) => {
            // Cancel registration
            const updated = await tx.vehicle_registration.update({
                where: { assignment_id: registrationId },
                data: {
                    status: 'cancelled',
                    canceled_by: tenantUserId,
                    canceled_at: new Date(),
                    reason: botCancellationReason
                }
            });

            // Deactivate associated vehicles if any
            if (registration.vehicles.length > 0) {
                await tx.vehicles.updateMany({
                    where: {
                        registration_id: registrationId,
                        deactivated_at: null
                    },
                    data: {
                        deactivated_at: new Date(),
                        deactivated_by: tenantUserId,
                        status: 'deactivated'
                    }
                });
            }

            return await tx.vehicle_registration.findUnique({
                where: { assignment_id: registrationId },
                include: {
                    tenants: {
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

        // Send notification to tenant
        try {
            const vehicleDesc = `${vehicleInfo.type || 'xe'} ${vehicleInfo.brand || ''} (${vehicleInfo.license_plate || 'N/A'})`.trim();

            await NotificationService.createNotification(
                null,
                tenantUserId,
                'Đăng ký xe đã được hủy',
                `Bot đã hủy yêu cầu đăng ký ${vehicleDesc}.`,
                {
                    type: 'vehicle_registration_cancelled_by_bot',
                    registration_id: registrationId,
                    reason: cancellationReason,
                    link: `/vehicle-registrations/${registrationId}`
                }
            );
        } catch (notificationError) {
            console.error('Error sending bot vehicle cancel notification:', notificationError);
        }

        return cancelled;
    }

    /**
     * GET BY BOT - Bot lấy thông tin vehicle registration
     */
    async getVehicleRegistrationByBot(registrationId, tenantUserId, botInfo) {
        const registration = await prisma.vehicle_registration.findUnique({
            where: { assignment_id: registrationId },
            include: {
                tenants: {
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
                                floor: true,
                                buildings: {
                                    select: {
                                        building_id: true,
                                        name: true,
                                        address: true
                                    }
                                }
                            }
                        }
                    }
                },
                users: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true
                    }
                },
                vehicles: {
                    where: {
                        deactivated_at: null
                    }
                }
            }
        });

        if (!registration) {
            throw new Error('Vehicle registration not found');
        }

        // Check authorization
        if (registration.requested_by !== tenantUserId) {
            throw new Error('This vehicle registration does not belong to the specified tenant');
        }

        return registration;
    }

    /**
     * GET LIST BY BOT - Bot lấy danh sách vehicle registrations của tenant
     */
    async getVehicleRegistrationsByBot(tenantUserId, filters, botInfo) {
        const {
            status,
            start_date_from,
            start_date_to,
            page = 1,
            limit = 10
        } = filters;

        // Verify tenant exists
        const tenant = await prisma.tenants.findUnique({
            where: { user_id: tenantUserId }
        });

        if (!tenant) {
            throw new Error('Tenant not found');
        }

        const where = {
            requested_by: tenantUserId
        };

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
            prisma.vehicle_registration.findMany({
                where,
                skip,
                take: parseInt(limit),
                orderBy: { requested_at: 'desc' },
                include: {
                    tenants: {
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
                                    floor: true,
                                    buildings: {
                                        select: {
                                            building_id: true,
                                            name: true
                                        }
                                    }
                                }
                            }
                        }
                    },
                    users: {
                        select: {
                            user_id: true,
                            full_name: true
                        }
                    },
                    vehicles: {
                        where: {
                            deactivated_at: null
                        },
                        select: {
                            vehicle_id: true,
                            license_plate: true,
                            type: true,
                            status: true
                        }
                    }
                }
            }),
            prisma.vehicle_registration.count({ where })
        ]);

        return {
            registrations,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * GET VEHICLES BY BOT - Bot lấy danh sách vehicles của tenant
     */
    async getVehiclesByBot(tenantUserId, filters, botInfo) {
        const {
            status,
            type,
            license_plate,
            page = 1,
            limit = 10
        } = filters;

        // Verify tenant exists
        const tenant = await prisma.tenants.findUnique({
            where: { user_id: tenantUserId }
        });

        if (!tenant) {
            throw new Error('Tenant not found');
        }

        const where = {
            tenant_user_id: tenantUserId,
            deactivated_at: null
        };

        if (status) {
            where.status = status;
        }

        if (type) {
            where.type = type;
        }

        if (license_plate) {
            where.license_plate = {
                contains: license_plate,
                mode: 'insensitive'
            };
        }

        const skip = (page - 1) * limit;

        const [vehicles, total] = await Promise.all([
            prisma.vehicles.findMany({
                where,
                skip,
                take: parseInt(limit),
                orderBy: { registered_at: 'desc' },
                include: {
                    tenants: {
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
                                    floor: true,
                                    buildings: {
                                        select: {
                                            building_id: true,
                                            name: true
                                        }
                                    }
                                }
                            }
                        }
                    },
                    vehicle_registration: {
                        select: {
                            assignment_id: true,
                            status: true,
                            requested_at: true,
                            approved_at: true,
                            start_date: true,
                            end_date: true
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
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * GET VEHICLE BY BOT - Bot lấy thông tin chi tiết vehicle
     */
    async getVehicleByBot(vehicleId, tenantUserId, botInfo) {
        const vehicle = await prisma.vehicles.findUnique({
            where: { vehicle_id: vehicleId },
            include: {
                tenants: {
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
                                floor: true,
                                buildings: {
                                    select: {
                                        building_id: true,
                                        name: true,
                                        address: true
                                    }
                                }
                            }
                        }
                    }
                },
                vehicle_registration: {
                    include: {
                        users: {
                            select: {
                                user_id: true,
                                full_name: true,
                                email: true
                            }
                        }
                    }
                },
                users: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true
                    }
                }
            }
        });

        if (!vehicle) {
            throw new Error('Vehicle not found');
        }

        // Check authorization
        if (vehicle.tenant_user_id !== tenantUserId) {
            throw new Error('This vehicle does not belong to the specified tenant');
        }

        return vehicle;
    }

    /**
     * GET STATS BY BOT - Bot lấy thống kê vehicle registration của tenant
     */
    async getVehicleStatsByBot(tenantUserId, botInfo) {
        // Verify tenant exists
        const tenant = await prisma.tenants.findUnique({
            where: { user_id: tenantUserId }
        });

        if (!tenant) {
            throw new Error('Tenant not found');
        }

        const where = {
            requested_by: tenantUserId
        };

        const [total, requested, approved, rejected, cancelled] = await Promise.all([
            prisma.vehicle_registration.count({ where }),
            prisma.vehicle_registration.count({ where: { ...where, status: 'requested' } }),
            prisma.vehicle_registration.count({ where: { ...where, status: 'approved' } }),
            prisma.vehicle_registration.count({ where: { ...where, status: 'rejected' } }),
            prisma.vehicle_registration.count({ where: { ...where, status: 'cancelled' } })
        ]);

        // Get statistics of active vehicles
        const vehicleWhere = {
            tenant_user_id: tenantUserId,
            deactivated_at: null
        };

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
}

module.exports = new VehicleRegistrationService();