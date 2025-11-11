// Updated: 2025-10-24
// by: DatNB
// Modified: Added notifications for approval/rejection

const prisma = require('../config/prisma');
const NotificationService = require('./notification.service');

class GuestService {
    // Tenant creates a guest registration with multiple guests
    async createGuestRegistration(tenantUserId, data) {
        const {
            guest_count,
            room_id,
            arrival_date,
            departure_date,
            note,
            guest_details
        } = data;

        // Verify tenant exists
        const tenant = await prisma.tenants.findUnique({
            where: { user_id: tenantUserId }
        });

        if (!tenant) {
            throw new Error('Tenant not found');
        }

        // If room_id provided, verify it exists
        if (room_id) {
            const room = await prisma.rooms.findUnique({
                where: { room_id }
            });

            if (!room) {
                throw new Error('Room not found');
            }
        }

        // Validate dates
        if (arrival_date && departure_date) {
            const arrival = new Date(arrival_date);
            const departure = new Date(departure_date);

            if (departure <= arrival) {
                throw new Error('Departure date must be after arrival date');
            }
        }

        // Validate guest_details is required and not empty
        if (!guest_details || guest_details.length === 0) {
            throw new Error('Guest details are required. At least one guest must be specified.');
        }

        // Validate guest_count vs guest_details
        if (guest_count && guest_count !== guest_details.length) {
            throw new Error(`Guest count (${guest_count}) does not match number of guest details (${guest_details.length})`);
        }

        // Calculate final guest count from guest_details
        const finalGuestCount = guest_details.length;

        // Create guest registration with details
        const registration = await prisma.guest_registrations.create({
            data: {
                host_user_id: tenantUserId,
                guest_count: finalGuestCount,
                room_id,
                arrival_date: arrival_date ? new Date(arrival_date) : null,
                departure_date: departure_date ? new Date(departure_date) : null,
                status: 'pending',
                note,
                submitted_at: new Date(),
                // Create guest details
                guest_details: {
                    create: guest_details.map(detail => ({
                        full_name: detail.full_name,
                        id_type: detail.id_type || 'national_id',
                        id_number: detail.id_number,
                        date_of_birth: detail.date_of_birth ? new Date(detail.date_of_birth) : null,
                        nationality: detail.nationality,
                        gender: detail.gender,
                        relationship: detail.relationship,
                        note: detail.note
                    }))
                }
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
                        }
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
                },
                guest_details: {
                    orderBy: {
                        detail_id: 'asc'
                    }
                }
            }
        });

        return registration;
    }

    // Get guest registration by ID
    async getGuestRegistrationById(registrationId, userId, userRole) {
        const registration = await prisma.guest_registrations.findUnique({
            where: { registration_id: registrationId },
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
                        }
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
                },
                users_guest_registrations_approved_byTousers: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true
                    }
                },
                users_guest_registrations_cancelled_byTousers: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true
                    }
                },
                guest_details: {
                    orderBy: {
                        detail_id: 'asc'
                    }
                }
            }
        });

        if (!registration) {
            throw new Error('Guest registration not found');
        }

        // Check authorization
        if (userRole === 'TENANT' && registration.host_user_id !== userId) {
            throw new Error('Unauthorized to view this registration');
        }

        return registration;
    }

    // Get all guest registrations with filters
    async getGuestRegistrations(filters, userId, userRole) {
        const {
            status,
            host_user_id,
            room_id,
            arrival_date_from,
            arrival_date_to,
            page = 1,
            limit = 10
        } = filters;

        const where = {};

        // Apply role-based filtering
        if (userRole === 'TENANT') {
            where.host_user_id = userId;
        } else if (host_user_id) {
            where.host_user_id = host_user_id;
        }

        if (status) {
            where.status = status;
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
                take: parseInt(limit),
                orderBy: { created_at: 'desc' },
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
                            }
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
                    },
                    users_guest_registrations_approved_byTousers: {
                        select: {
                            user_id: true,
                            full_name: true
                        }
                    },
                    guest_details: {
                        orderBy: {
                            detail_id: 'asc'
                        }
                    }
                }
            }),
            prisma.guest_registrations.count({ where })
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

    // Update guest registration (only by tenant who created it, and only if status is pending)
    async updateGuestRegistration(registrationId, tenantUserId, data) {
        const {
            guest_count,
            room_id,
            arrival_date,
            departure_date,
            note,
            guest_details
        } = data;

        // Find existing registration
        const existing = await prisma.guest_registrations.findUnique({
            where: { registration_id: registrationId },
            include: {
                guest_details: true
            }
        });

        if (!existing) {
            throw new Error('Guest registration not found');
        }

        // Check authorization
        if (existing.host_user_id !== tenantUserId) {
            throw new Error('Unauthorized to update this registration');
        }

        // Can only update if status is pending
        if (existing.status !== 'pending') {
            throw new Error(`Cannot update registration with status: ${existing.status}`);
        }

        // If room_id provided, verify it exists
        if (room_id) {
            const room = await prisma.rooms.findUnique({
                where: { room_id }
            });

            if (!room) {
                throw new Error('Room not found');
            }
        }

        // Validate dates
        if (arrival_date && departure_date) {
            const arrival = new Date(arrival_date);
            const departure = new Date(departure_date);

            if (departure <= arrival) {
                throw new Error('Departure date must be after arrival date');
            }
        }

        // Validate guest_count vs guest_details if both provided
        if (guest_details && guest_details.length > 0) {
            if (guest_count && guest_count !== guest_details.length) {
                throw new Error(`Guest count (${guest_count}) does not match number of guest details (${guest_details.length})`);
            }
        }

        // Use transaction for complex update
        const updated = await prisma.$transaction(async (tx) => {
            // Calculate final guest count
            const finalGuestCount = guest_details && guest_details.length > 0
                ? guest_details.length
                : (guest_count !== undefined ? guest_count : existing.guest_count);

            // Update main registration
            await tx.guest_registrations.update({
                where: { registration_id: registrationId },
                data: {
                    guest_count: finalGuestCount,
                    room_id: room_id !== undefined ? room_id : undefined,
                    arrival_date: arrival_date ? new Date(arrival_date) : undefined,
                    departure_date: departure_date ? new Date(departure_date) : undefined,
                    note: note !== undefined ? note : undefined
                }
            });

            // Update guest details if provided
            if (guest_details && guest_details.length > 0) {
                // Delete old details
                await tx.guest_details.deleteMany({
                    where: { registration_id: registrationId }
                });

                // Create new details
                await tx.guest_details.createMany({
                    data: guest_details.map(detail => ({
                        registration_id: registrationId,
                        full_name: detail.full_name,
                        id_type: detail.id_type || 'national_id',
                        id_number: detail.id_number,
                        date_of_birth: detail.date_of_birth ? new Date(detail.date_of_birth) : null,
                        nationality: detail.nationality,
                        gender: detail.gender,
                        relationship: detail.relationship,
                        note: detail.note
                    }))
                });
            }

            // Return updated registration with details
            return await tx.guest_registrations.findUnique({
                where: { registration_id: registrationId },
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
                            }
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
                    },
                    guest_details: {
                        orderBy: {
                            detail_id: 'asc'
                        }
                    }
                }
            });
        });

        return updated;
    }

    // Approve guest registration (Manager/Owner only)
    async approveGuestRegistration(registrationId, approvedBy) {
        const registration = await prisma.guest_registrations.findUnique({
            where: { registration_id: registrationId },
            include: {
                rooms: {
                    select: {
                        room_number: true
                    }
                }
            }
        });

        if (!registration) {
            throw new Error('Guest registration not found');
        }

        if (registration.status !== 'pending') {
            throw new Error(`Cannot approve registration with status: ${registration.status}`);
        }

        const approved = await prisma.guest_registrations.update({
            where: { registration_id: registrationId },
            data: {
                status: 'approved',
                approved_by: approvedBy,
                approved_at: new Date()
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
                        }
                    }
                },
                rooms: {
                    select: {
                        room_id: true,
                        room_number: true,
                        floor: true
                    }
                },
                users_guest_registrations_approved_byTousers: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true
                    }
                },
                guest_details: {
                    orderBy: {
                        detail_id: 'asc'
                    }
                }
            }
        });

        // Send notification to tenant
        try {
            const roomInfo = registration.rooms?.room_number
                ? ` cho phòng ${registration.rooms.room_number}`
                : '';

            await NotificationService.createNotification(
                approvedBy, // sender (manager/owner)
                registration.host_user_id, // recipient (tenant)
                'Đơn đăng ký khách đã được chấp nhận',
                `Đơn đăng ký khách${roomInfo} của bạn đã được chấp nhận. Số lượng khách: ${registration.guest_count}`,
                {
                    type: 'guest_registration_approved',
                    registration_id: registrationId,
                    link: `/guest-registrations/${registrationId}`
                }
            );
        } catch (notificationError) {
            console.error('Error sending approval notification:', notificationError);
            // Don't fail the approval if notification fails
        }

        return approved;
    }

    // Reject guest registration (Manager/Owner only)
    async rejectGuestRegistration(registrationId, approvedBy, rejectionReason) {
        const registration = await prisma.guest_registrations.findUnique({
            where: { registration_id: registrationId },
            include: {
                rooms: {
                    select: {
                        room_number: true
                    }
                }
            }
        });

        if (!registration) {
            throw new Error('Guest registration not found');
        }

        if (registration.status !== 'pending') {
            throw new Error(`Cannot reject registration with status: ${registration.status}`);
        }

        const rejected = await prisma.guest_registrations.update({
            where: { registration_id: registrationId },
            data: {
                status: 'rejected',
                approved_by: approvedBy,
                approved_at: new Date(),
                cancellation_reason: rejectionReason // Store reason in cancellation_reason field
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
                        }
                    }
                },
                rooms: {
                    select: {
                        room_id: true,
                        room_number: true,
                        floor: true
                    }
                },
                users_guest_registrations_approved_byTousers: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true
                    }
                },
                guest_details: {
                    orderBy: {
                        detail_id: 'asc'
                    }
                }
            }
        });

        // Send notification to tenant
        try {
            const roomInfo = registration.rooms?.room_number
                ? ` cho phòng ${registration.rooms.room_number}`
                : '';

            const reasonText = rejectionReason
                ? ` Lý do: ${rejectionReason}`
                : '';

            await NotificationService.createNotification(
                approvedBy, // sender (manager/owner)
                registration.host_user_id, // recipient (tenant)
                'Đơn đăng ký khách đã bị từ chối',
                `Đơn đăng ký khách${roomInfo} của bạn đã bị từ chối.${reasonText}`,
                {
                    type: 'guest_registration_rejected',
                    registration_id: registrationId,
                    reason: rejectionReason,
                    link: `/guest-registrations/${registrationId}`
                }
            );
        } catch (notificationError) {
            console.error('Error sending rejection notification:', notificationError);
            // Don't fail the rejection if notification fails
        }

        return rejected;
    }

    // Cancel guest registration
    async cancelGuestRegistration(registrationId, userId, userRole, cancellationReason) {
        const registration = await prisma.guest_registrations.findUnique({
            where: { registration_id: registrationId }
        });

        if (!registration) {
            throw new Error('Guest registration not found');
        }

        // Tenant can only cancel their own pending registrations
        if (userRole === 'TENANT') {
            if (registration.host_user_id !== userId) {
                throw new Error('Unauthorized to cancel this registration');
            }
            if (registration.status !== 'pending') {
                throw new Error('Can only cancel pending registrations');
            }
        }

        // Manager/Owner can cancel any registration except completed ones
        if (['MANAGER', 'OWNER'].includes(userRole)) {
            if (registration.status === 'rejected' || registration.status === 'cancelled') {
                throw new Error(`Cannot cancel registration with status: ${registration.status}`);
            }
        }

        const cancelled = await prisma.guest_registrations.update({
            where: { registration_id: registrationId },
            data: {
                status: 'cancelled',
                cancelled_by: userId,
                cancelled_at: new Date(),
                cancellation_reason: cancellationReason
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
                        }
                    }
                },
                rooms: {
                    select: {
                        room_id: true,
                        room_number: true,
                        floor: true
                    }
                },
                users_guest_registrations_cancelled_byTousers: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true
                    }
                },
                guest_details: {
                    orderBy: {
                        detail_id: 'asc'
                    }
                }
            }
        });

        return cancelled;
    }

    // Delete guest registration (soft delete - only pending ones)
    async deleteGuestRegistration(registrationId, tenantUserId) {
        const registration = await prisma.guest_registrations.findUnique({
            where: { registration_id: registrationId }
        });

        if (!registration) {
            throw new Error('Guest registration not found');
        }

        // Check authorization
        if (registration.host_user_id !== tenantUserId) {
            throw new Error('Unauthorized to delete this registration');
        }

        // Can only delete if status is pending or cancelled
        if (!['pending', 'cancelled'].includes(registration.status)) {
            throw new Error(`Cannot delete registration with status: ${registration.status}`);
        }

        // Delete will cascade to guest_details
        await prisma.guest_registrations.delete({
            where: { registration_id: registrationId }
        });

        return true;
    }

    // Get statistics for dashboard
    async getGuestRegistrationStats(userId, userRole) {
        const where = {};

        // Filter by tenant if role is TENANT
        if (userRole === 'TENANT') {
            where.host_user_id = userId;
        }

        const [total, pending, approved, rejected, cancelled, expired] = await Promise.all([
            prisma.guest_registrations.count({ where }),
            prisma.guest_registrations.count({ where: { ...where, status: 'pending' } }),
            prisma.guest_registrations.count({ where: { ...where, status: 'approved' } }),
            prisma.guest_registrations.count({ where: { ...where, status: 'rejected' } }),
            prisma.guest_registrations.count({ where: { ...where, status: 'cancelled' } }),
            prisma.guest_registrations.count({ where: { ...where, status: 'expired' } })
        ]);

        // Get total guests count (sum of guest_count)
        const guestCountResult = await prisma.guest_registrations.aggregate({
            where,
            _sum: {
                guest_count: true
            }
        });

        return {
            total,
            pending,
            approved,
            rejected,
            cancelled,
            expired,
            totalGuests: guestCountResult._sum.guest_count || 0
        };
    }
}

module.exports = new GuestService();