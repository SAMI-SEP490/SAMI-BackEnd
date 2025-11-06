// Updated: 2025-11-06
// by: DatNB

const prisma = require('../config/prisma');

class VehicleService {
    // Tenant registers a vehicle
    async registerVehicle(tenantUserId, data) {
        const {
            type,
            license_plate,
            brand,
            color,
            note
        } = data;

        // Verify tenant exists
        const tenant = await prisma.tenants.findUnique({
            where: { user_id: tenantUserId }
        });

        if (!tenant) {
            throw new Error('Tenant not found');
        }

        // Check if license plate already exists
        if (license_plate) {
            const existing = await prisma.vehicles.findUnique({
                where: { license_plate }
            });

            if (existing) {
                throw new Error('License plate already registered');
            }
        }

        // Create vehicle
        const vehicle = await prisma.vehicles.create({
            data: {
                tenant_user_id: tenantUserId,
                type,
                license_plate,
                brand,
                color,
                status: 'requested',
                note,
                registered_at: new Date()
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

        return vehicle;
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
                users: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true
                    }
                },
                vehicle_slot_registration: {
                    orderBy: {
                        requested_at: 'desc'
                    },
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

        // Check authorization
        if (userRole === 'TENANT' && vehicle.tenant_user_id !== userId) {
            throw new Error('Unauthorized to view this vehicle');
        }

        return vehicle;
    }

    // Get all vehicles with filters
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

        // Exclude deactivated vehicles
        where.deactivated_at = null;

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
                    vehicle_slot_registration: {
                        where: {
                            status: 'approved'
                        },
                        orderBy: {
                            approved_at: 'desc'
                        },
                        take: 1
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

    // Update vehicle (only by tenant who owns it, and only if status is requested)
    async updateVehicle(vehicleId, tenantUserId, data) {
        const {
            type,
            license_plate,
            brand,
            color,
            note
        } = data;

        // Find existing vehicle
        const existing = await prisma.vehicles.findUnique({
            where: { vehicle_id: vehicleId }
        });

        if (!existing) {
            throw new Error('Vehicle not found');
        }

        // Check authorization
        if (existing.tenant_user_id !== tenantUserId) {
            throw new Error('Unauthorized to update this vehicle');
        }

        // Check if deactivated
        if (existing.deactivated_at) {
            throw new Error('Cannot update deactivated vehicle');
        }

        // Can only update if status is requested
        if (existing.status !== 'requested') {
            throw new Error(`Cannot update vehicle with status: ${existing.status}`);
        }

        // Check if license plate already exists (if changing)
        if (license_plate && license_plate !== existing.license_plate) {
            const duplicate = await prisma.vehicles.findUnique({
                where: { license_plate }
            });

            if (duplicate) {
                throw new Error('License plate already registered');
            }
        }

        // Update vehicle
        const updated = await prisma.vehicles.update({
            where: { vehicle_id: vehicleId },
            data: {
                type: type !== undefined ? type : undefined,
                license_plate: license_plate !== undefined ? license_plate : undefined,
                brand: brand !== undefined ? brand : undefined,
                color: color !== undefined ? color : undefined,
                note: note !== undefined ? note : undefined,
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

    // Approve vehicle registration (Manager/Owner only)
    async approveVehicle(vehicleId, approvedBy) {
        const vehicle = await prisma.vehicles.findUnique({
            where: { vehicle_id: vehicleId }
        });

        if (!vehicle) {
            throw new Error('Vehicle not found');
        }

        if (vehicle.deactivated_at) {
            throw new Error('Cannot approve deactivated vehicle');
        }

        if (vehicle.status !== 'requested') {
            throw new Error(`Cannot approve vehicle with status: ${vehicle.status}`);
        }

        const approved = await prisma.vehicles.update({
            where: { vehicle_id: vehicleId },
            data: {
                status: 'approved',
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
                                floor: true
                            }
                        }
                    }
                }
            }
        });

        return approved;
    }

    // Reject vehicle registration (Manager/Owner only)
    async rejectVehicle(vehicleId, rejectedBy) {
        const vehicle = await prisma.vehicles.findUnique({
            where: { vehicle_id: vehicleId }
        });

        if (!vehicle) {
            throw new Error('Vehicle not found');
        }

        if (vehicle.deactivated_at) {
            throw new Error('Cannot reject deactivated vehicle');
        }

        if (vehicle.status !== 'requested') {
            throw new Error(`Cannot reject vehicle with status: ${vehicle.status}`);
        }

        const rejected = await prisma.vehicles.update({
            where: { vehicle_id: vehicleId },
            data: {
                status: 'rejected',
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
                                floor: true
                            }
                        }
                    }
                }
            }
        });

        return rejected;
    }

    // Deactivate vehicle (Manager/Owner only)
    async deactivateVehicle(vehicleId, deactivatedBy) {
        const vehicle = await prisma.vehicles.findUnique({
            where: { vehicle_id: vehicleId }
        });

        if (!vehicle) {
            throw new Error('Vehicle not found');
        }

        if (vehicle.deactivated_at) {
            throw new Error('Vehicle is already deactivated');
        }

        // Deactivate vehicle and cancel all active slot registrations
        const deactivated = await prisma.$transaction(async (tx) => {
            // Cancel all active slot registrations
            await tx.vehicle_slot_registration.updateMany({
                where: {
                    vehicle_id: vehicleId,
                    status: {
                        in: ['requested', 'approved']
                    }
                },
                data: {
                    status: 'cancelled',
                    canceled_at: new Date(),
                    canceled_by: deactivatedBy,
                    reason: 'Vehicle deactivated'
                }
            });

            // Deactivate vehicle
            return await tx.vehicles.update({
                where: { vehicle_id: vehicleId },
                data: {
                    deactivated_at: new Date(),
                    deactivated_by: deactivatedBy,
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
        });

        return deactivated;
    }

    // Delete vehicle (soft delete - only requested or rejected ones)
    async deleteVehicle(vehicleId, tenantUserId) {
        const vehicle = await prisma.vehicles.findUnique({
            where: { vehicle_id: vehicleId },
            include: {
                vehicle_slot_registration: true
            }
        });

        if (!vehicle) {
            throw new Error('Vehicle not found');
        }

        // Check authorization
        if (vehicle.tenant_user_id !== tenantUserId) {
            throw new Error('Unauthorized to delete this vehicle');
        }

        // Can only delete if status is requested or rejected
        if (!['requested', 'rejected'].includes(vehicle.status)) {
            throw new Error(`Cannot delete vehicle with status: ${vehicle.status}`);
        }

        // Check if there are any slot registrations
        if (vehicle.vehicle_slot_registration.length > 0) {
            throw new Error('Cannot delete vehicle with slot registrations. Please cancel them first.');
        }

        // Delete vehicle
        await prisma.vehicles.delete({
            where: { vehicle_id: vehicleId }
        });

        return true;
    }

    // Get statistics for dashboard
    async getVehicleStats(userId, userRole) {
        const where = {
            deactivated_at: null
        };

        // Filter by tenant if role is TENANT
        if (userRole === 'TENANT') {
            where.tenant_user_id = userId;
        }

        const [total, requested, approved, rejected] = await Promise.all([
            prisma.vehicles.count({ where }),
            prisma.vehicles.count({ where: { ...where, status: 'requested' } }),
            prisma.vehicles.count({ where: { ...where, status: 'approved' } }),
            prisma.vehicles.count({ where: { ...where, status: 'rejected' } })
        ]);

        // Get statistics by vehicle type
        const byType = await prisma.vehicles.groupBy({
            by: ['type'],
            where,
            _count: {
                vehicle_id: true
            }
        });

        return {
            total,
            requested,
            approved,
            rejected,
            byType: byType.map(item => ({
                type: item.type,
                count: item._count.vehicle_id
            }))
        };
    }
}

module.exports = new VehicleService();