// Updated: 2025-11-06
// by: DatNB
// Modified: Added notifications for approve/reject

const prisma = require('../config/prisma');
const NotificationService = require('./notification.service');

class VehicleRegistrationService {
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
                // Store vehicle info in note or create a JSON field
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
        } else if (requested_by) {
            where.requested_by = requested_by;
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
    async approveVehicleRegistration(registrationId, approvedBy) {
        const registration = await prisma.vehicle_registration.findUnique({
            where: { assignment_id: registrationId }
        });

        if (!registration) {
            throw new Error('Vehicle registration not found');
        }

        if (registration.status !== 'requested') {
            throw new Error(`Cannot approve registration with status: ${registration.status}`);
        }

        // Parse vehicle info from reason
        const vehicleInfo = JSON.parse(registration.reason);

        // Check license plate one more time
        if (vehicleInfo.license_plate) {
            const existing = await prisma.vehicles.findUnique({
                where: { license_plate: vehicleInfo.license_plate }
            });

            if (existing && !existing.deactivated_at) {
                throw new Error('License plate already registered');
            }
        }

        // Use transaction to approve registration and create vehicle
        const result = await prisma.$transaction(async (tx) => {
            // Approve registration
            const approved = await tx.vehicle_registration.update({
                where: { assignment_id: registrationId },
                data: {
                    status: 'approved',
                    approved_by: approvedBy,
                    approved_at: new Date()
                }
            });

            // Create vehicle
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

            // Return updated registration with vehicle
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
                    users: {
                        select: {
                            user_id: true,
                            full_name: true,
                            email: true
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
                approvedBy, // sender (manager/owner)
                registration.requested_by, // recipient (tenant)
                'Đăng ký xe đã được phê duyệt',
                `Đăng ký ${vehicleDesc} của bạn đã được chấp nhận. Xe đã được kích hoạt trong hệ thống.`,
                {
                    type: 'vehicle_registration_approved',
                    registration_id: registrationId,
                    vehicle_info: vehicleInfo,
                    link: `/vehicle-registrations/${registrationId}`
                }
            );
        } catch (notificationError) {
            console.error('Error sending vehicle approval notification:', notificationError);
        }

        return result;
    }

    // Reject vehicle registration (Manager/Owner only)
    async rejectVehicleRegistration(registrationId, rejectedBy, rejectionReason) {
        const registration = await prisma.vehicle_registration.findUnique({
            where: { assignment_id: registrationId }
        });

        if (!registration) {
            throw new Error('Vehicle registration not found');
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
                rejectedBy, // sender (manager/owner)
                registration.requested_by, // recipient (tenant)
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

        // Manager/Owner can cancel any registration except already cancelled ones
        if (['MANAGER', 'OWNER'].includes(userRole)) {
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
        }

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

        // Apply role-based filtering
        if (userRole === 'TENANT') {
            where.tenant_user_id = userId;
        } else if (tenant_user_id) {
            where.tenant_user_id = tenant_user_id;
        }

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

    // Get vehicle by ID
    async getVehicleById(vehicleId, userId, userRole) {
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
        if (userRole === 'TENANT' && vehicle.tenant_user_id !== userId) {
            throw new Error('Unauthorized to view this vehicle');
        }

        return vehicle;
    }
}

module.exports = new VehicleRegistrationService();