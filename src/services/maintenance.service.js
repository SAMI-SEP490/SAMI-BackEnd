// Updated: 2025-30-10
// by: DatNB

const prisma = require('../config/prisma');

class MaintenanceService {
    // CREATE - Tạo yêu cầu bảo trì mới
    async createMaintenanceRequest(data, currentUser) {
        const { room_id, title, description, category, priority, note } = data;

        // Validate required fields
        if (!title) {
            throw new Error('Missing required field: title');
        }

        // Parse room_id if provided
        const roomId = room_id ? parseInt(room_id) : null;

        // Check if room exists if room_id is provided
        if (roomId) {
            const room = await prisma.rooms.findUnique({
                where: { room_id: roomId }
            });

            if (!room || !room.is_active) {
                throw new Error('Room not found or is inactive');
            }
        }

        // Nếu là tenant, lấy tenant_user_id từ currentUser
        let tenantUserId;
        if (currentUser.role === 'TENANT') {
            const tenant = await prisma.tenants.findUnique({
                where: { user_id: currentUser.user_id }
            });

            if (!tenant) {
                throw new Error('Tenant information not found');
            }

            tenantUserId = tenant.user_id;
        } else {
            throw new Error('Only tenants can create maintenance requests');
        }

        // Create maintenance request
        const maintenanceRequest = await prisma.maintenance_requests.create({
            data: {
                tenant_user_id: tenantUserId,
                room_id: roomId,
                title,
                description,
                category: category || null,
                priority: priority || 'normal',
                status: 'pending',
                note,
                created_at: new Date(),
                updated_at: new Date()
            },
            include: {
                rooms: {
                    select: {
                        room_number: true,
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
                                full_name: true,
                                email: true,
                                phone: true
                            }
                        }
                    }
                },
                users: {
                    select: {
                        full_name: true,
                        email: true
                    }
                }
            }
        });

        return this.formatMaintenanceResponse(maintenanceRequest);
    }

    // READ - Lấy yêu cầu bảo trì theo ID
    async getMaintenanceRequestById(requestId, currentUser) {
        const maintenanceRequest = await prisma.maintenance_requests.findUnique({
            where: { request_id: requestId },
            include: {
                rooms: {
                    include: {
                        buildings: true
                    }
                },
                tenants: {
                    include: {
                        users: true
                    }
                },
                users: {
                    select: {
                        full_name: true,
                        email: true
                    }
                }
            }
        });

        if (!maintenanceRequest) {
            throw new Error('Maintenance request not found');
        }

        // Check permission: Tenant chỉ xem được yêu cầu của mình
        if (currentUser.role === 'TENANT' && maintenanceRequest.tenant_user_id !== currentUser.user_id) {
            throw new Error('You do not have permission to view this maintenance request');
        }

        return this.formatMaintenanceResponse(maintenanceRequest);
    }

    // READ - Lấy danh sách yêu cầu bảo trì (có phân trang và filter)
    async getMaintenanceRequests(filters = {}, currentUser) {
        const {
            room_id,
            tenant_user_id,
            category,
            priority,
            status,
            page = 1,
            limit = 20,
            approved_by
        } = filters;

        const skip = (page - 1) * limit;
        const where = {};

        // Nếu là tenant, chỉ lấy yêu cầu của mình
        if (currentUser.role === 'TENANT') {
            where.tenant_user_id = currentUser.user_id;
        } else {
            // Owner/Manager có thể filter theo tenant_user_id
            if (tenant_user_id) where.tenant_user_id = parseInt(tenant_user_id);
        }

        if (room_id) where.room_id = parseInt(room_id);
        if (category) where.category = category;
        if (priority) where.priority = priority;
        if (status) where.status = status;
        if (approved_by) where.approved_by = parseInt(approved_by);

        const [requests, total] = await Promise.all([
            prisma.maintenance_requests.findMany({
                where,
                include: {
                    rooms: {
                        select: {
                            room_number: true,
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
                                    full_name: true,
                                    email: true,
                                    phone: true
                                }
                            }
                        }
                    },
                    users: {
                        select: {
                            full_name: true,
                            email: true
                        }
                    }
                },
                skip,
                take: limit,
                orderBy: { created_at: 'desc' }
            }),
            prisma.maintenance_requests.count({ where })
        ]);

        return {
            data: requests.map(r => this.formatMaintenanceResponse(r)),
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        };
    }

    // UPDATE - Cập nhật yêu cầu bảo trì
    async updateMaintenanceRequest(requestId, data, currentUser) {
        const { title, description, category, priority, status, note } = data;

        // Verify request exists
        const existingRequest = await prisma.maintenance_requests.findUnique({
            where: { request_id: requestId }
        });

        if (!existingRequest) {
            throw new Error('Maintenance request not found');
        }

        // Check permission
        if (currentUser.role === 'TENANT') {
            // Tenant chỉ có thể cập nhật yêu cầu của mình và chỉ một số trường
            if (existingRequest.tenant_user_id !== currentUser.user_id) {
                throw new Error('You do not have permission to update this maintenance request');
            }

            // Tenant không thể thay đổi status
            if (status !== undefined) {
                throw new Error('Tenants cannot update status');
            }
        }

        // Prepare update data
        const updateData = {
        };

        if (title !== undefined) updateData.title = title;
        if (priority !== undefined) updateData.priority = priority;
        if (description !== undefined) updateData.description = description;
        if (category !== undefined) updateData.category = category;
        if (note !== undefined) updateData.note = note;

        // Only manager/owner can update these fields
        if (currentUser.role === 'MANAGER' || currentUser.role === 'OWNER') {
            if (status) {
                updateData.status = status;

                // Set resolved_at when status changes to resolved or completed
                if ((status === 'resolved' || status === 'completed') &&
                    !existingRequest.resolved_at) {
                    updateData.resolved_at = new Date();
                }
            }


        }

        const maintenanceRequest = await prisma.maintenance_requests.update({
            where: { request_id: requestId },
            data: updateData,
            include: {
                rooms: {
                    include: {
                        buildings: true
                    }
                },
                tenants: {
                    include: {
                        users: true
                    }
                },
                users: {
                    select: {
                        full_name: true,
                        email: true
                    }
                }
            }
        });

        return this.formatMaintenanceResponse(maintenanceRequest);
    }

    // DELETE - Xóa yêu cầu bảo trì (chỉ tenant có thể xóa yêu cầu của mình khi status là pending)
    async deleteMaintenanceRequest(requestId, currentUser) {
        const maintenanceRequest = await prisma.maintenance_requests.findUnique({
            where: { request_id: requestId }
        });

        if (!maintenanceRequest) {
            throw new Error('Maintenance request not found');
        }

        // Check permission
        if (currentUser.role === 'TENANT') {
            if (maintenanceRequest.tenant_user_id !== currentUser.user_id) {
                throw new Error('You do not have permission to delete this maintenance request');
            }

            // Tenant chỉ có thể xóa yêu cầu đang pending
            if (maintenanceRequest.status !== 'pending') {
                throw new Error('Can only delete pending maintenance requests');
            }
        }

        await prisma.maintenance_requests.delete({
            where: { request_id: requestId }
        });

        return { success: true, message: 'Maintenance request deleted successfully' };
    }

    // APPROVE - Phê duyệt yêu cầu bảo trì
    async approveMaintenanceRequest(requestId, currentUser) {
        // Only manager/owner can approve
        if (currentUser.role !== 'MANAGER' && currentUser.role !== 'OWNER') {
            throw new Error('Only managers and owners can approve maintenance requests');
        }

        const maintenanceRequest = await prisma.maintenance_requests.findUnique({
            where: { request_id: requestId }
        });

        if (!maintenanceRequest) {
            throw new Error('Maintenance request not found');
        }

        if (maintenanceRequest.status !== 'pending') {
            throw new Error('Only pending requests can be approved');
        }

        const approved = await prisma.maintenance_requests.update({
            where: { request_id: requestId },
            data: {
                approved_by: currentUser.user_id,
                approved_at: new Date(),
                status: 'in_progress',
                updated_at: new Date()
            },
            include: {
                rooms: {
                    include: {
                        buildings: true
                    }
                },
                tenants: {
                    include: {
                        users: true
                    }
                },
                users: {
                    select: {
                        full_name: true,
                        email: true
                    }
                }
            }
        });

        return this.formatMaintenanceResponse(approved);
    }

    // REJECT - Từ chối yêu cầu bảo trì
    async rejectMaintenanceRequest(requestId, reason, currentUser) {
        // Only manager/owner can reject
        if (currentUser.role !== 'MANAGER' && currentUser.role !== 'OWNER') {
            throw new Error('Only managers and owners can reject maintenance requests');
        }

        const maintenanceRequest = await prisma.maintenance_requests.findUnique({
            where: { request_id: requestId }
        });

        if (!maintenanceRequest) {
            throw new Error('Maintenance request not found');
        }

        if (maintenanceRequest.status !== 'pending') {
            throw new Error('Only pending requests can be rejected');
        }

        const rejected = await prisma.maintenance_requests.update({
            where: { request_id: requestId },
            data: {
                status: 'rejected',
                approved_by: currentUser.user_id,
                approved_at: new Date(),
                note: reason ? `${maintenanceRequest.note || ''}\nRejection reason: ${reason}` : maintenanceRequest.note,
                updated_at: new Date()
            },
            include: {
                rooms: {
                    include: {
                        buildings: true
                    }
                },
                tenants: {
                    include: {
                        users: true
                    }
                },
                users: {
                    select: {
                        full_name: true,
                        email: true
                    }
                }
            }
        });

        return this.formatMaintenanceResponse(rejected);
    }

    // RESOLVE - Đánh dấu đã giải quyết
    async resolveMaintenanceRequest(requestId, currentUser) {
        // Only manager/owner can resolve
        if (currentUser.role !== 'MANAGER' && currentUser.role !== 'OWNER') {
            throw new Error('Only managers and owners can resolve maintenance requests');
        }

        const maintenanceRequest = await prisma.maintenance_requests.findUnique({
            where: { request_id: requestId }
        });

        if (!maintenanceRequest) {
            throw new Error('Maintenance request not found');
        }

        if (maintenanceRequest.status === 'resolved' || maintenanceRequest.status === 'completed') {
            throw new Error('Maintenance request is already resolved');
        }

        if (maintenanceRequest.status === 'pending') {
            throw new Error('Cannot resolve a pending request. Please approve it first');
        }

        const updateData = {
            status: 'resolved',
            resolved_at: new Date(),
            updated_at: new Date()
        };


        const resolved = await prisma.maintenance_requests.update({
            where: { request_id: requestId },
            data: updateData,
            include: {
                rooms: {
                    include: {
                        buildings: true
                    }
                },
                tenants: {
                    include: {
                        users: true
                    }
                },
                users: {
                    select: {
                        full_name: true,
                        email: true
                    }
                }
            }
        });

        return this.formatMaintenanceResponse(resolved);
    }

    // COMPLETE - Đánh dấu hoàn thành
    async completeMaintenanceRequest(requestId, currentUser) {
        // Only manager/owner can complete
        if (currentUser.role !== 'MANAGER' && currentUser.role !== 'OWNER') {
            throw new Error('Only managers and owners can complete maintenance requests');
        }

        const maintenanceRequest = await prisma.maintenance_requests.findUnique({
            where: { request_id: requestId }
        });

        if (!maintenanceRequest) {
            throw new Error('Maintenance request not found');
        }

        if (maintenanceRequest.status !== 'resolved') {
            throw new Error('Only resolved requests can be marked as completed');
        }

        const completed = await prisma.maintenance_requests.update({
            where: { request_id: requestId },
            data: {
                status: 'completed',
                updated_at: new Date()
            },
            include: {
                rooms: {
                    include: {
                        buildings: true
                    }
                },
                tenants: {
                    include: {
                        users: true
                    }
                },
                users: {
                    select: {
                        full_name: true,
                        email: true
                    }
                }
            }
        });

        return this.formatMaintenanceResponse(completed);
    }

    // GET ROOM HISTORY - Lấy lịch sử bảo trì của một phòng
    async getRoomMaintenanceHistory(roomId, filters = {}, currentUser) {
        const {
            category,
            priority,
            status,
            page = 1,
            limit = 20,
            from_date,
            to_date
        } = filters;

        // Verify room exists
        const room = await prisma.rooms.findUnique({
            where: { room_id: roomId },
            include: {
                buildings: {
                    select: {
                        name: true,
                        address: true
                    }
                }
            }
        });

        if (!room) {
            throw new Error('Room not found');
        }

        const skip = (page - 1) * limit;
        const where = { room_id: roomId };

        // Apply filters
        if (category) where.category = category;
        if (priority) where.priority = priority;
        if (status) where.status = status;

        // Date range filter
        if (from_date || to_date) {
            where.created_at = {};
            if (from_date) {
                where.created_at.gte = new Date(from_date);
            }
            if (to_date) {
                where.created_at.lte = new Date(to_date);
            }
        }

        const [requests, total, statistics] = await Promise.all([
            prisma.maintenance_requests.findMany({
                where,
                include: {
                    tenants: {
                        include: {
                            users: {
                                select: {
                                    full_name: true,
                                    email: true,
                                    phone: true
                                }
                            }
                        }
                    },
                    users: {
                        select: {
                            full_name: true,
                            email: true
                        }
                    }
                },
                skip,
                take: limit,
                orderBy: { created_at: 'desc' }
            }),
            prisma.maintenance_requests.count({ where }),
            // Get statistics
            prisma.maintenance_requests.groupBy({
                by: ['status'],
                where: { room_id: roomId },
                _count: true
            })
        ]);

        // Calculate statistics
        const stats = {
            total_requests: total,
            by_status: {},
            by_category: {},
        };

        statistics.forEach(stat => {
            stats.by_status[stat.status] = stat._count;
        });

        // Get category statistics
        const categoryStats = await prisma.maintenance_requests.groupBy({
            by: ['category'],
            where: { room_id: roomId },
            _count: true
        });

        categoryStats.forEach(stat => {
            if (stat.category) {
                stats.by_category[stat.category] = stat._count;
            }
        });

        return {
            room_info: {
                room_id: room.room_id,
                room_number: room.room_number,
                floor: room.floor,
                building_name: room.buildings?.name,
                building_address: room.buildings?.address
            },
            statistics: stats,
            data: requests.map(r => this.formatMaintenanceResponse(r)),
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        };
    }

    // GET STATISTICS - Thống kê tổng quan maintenance
    async getMaintenanceStatistics(filters = {}, currentUser) {
        const {
            room_id,
            building_id,
            from_date,
            to_date
        } = filters;

        const where = {};

        // Apply filters
        if (room_id) where.room_id = parseInt(room_id);

        if (building_id) {
            // Get all rooms in building
            const rooms = await prisma.rooms.findMany({
                where: { building_id: parseInt(building_id) },
                select: { room_id: true }
            });
            where.room_id = { in: rooms.map(r => r.room_id) };
        }

        // Date range filter
        if (from_date || to_date) {
            where.created_at = {};
            if (from_date) {
                where.created_at.gte = new Date(from_date);
            }
            if (to_date) {
                where.created_at.lte = new Date(to_date);
            }
        }

        // Tenant can only see their own requests
        if (currentUser.role === 'TENANT') {
            where.tenant_user_id = currentUser.user_id;
        }

        const [
            total,
            byStatus,
            byCategory,
            byPriority,
            avgResolutionTime
        ] = await Promise.all([
            // Total requests
            prisma.maintenance_requests.count({ where }),

            // Group by status
            prisma.maintenance_requests.groupBy({
                by: ['status'],
                where,
                _count: true
            }),

            // Group by category
            prisma.maintenance_requests.groupBy({
                by: ['category'],
                where,
                _count: true
            }),

            // Group by priority
            prisma.maintenance_requests.groupBy({
                by: ['priority'],
                where,
                _count: true
            }),


            // Get resolved requests for avg time calculation
            prisma.maintenance_requests.findMany({
                where: {
                    ...where,
                    resolved_at: { not: null }
                },
                select: {
                    created_at: true,
                    resolved_at: true
                }
            })
        ]);

        // Calculate average resolution time (in hours)
        let avgTime = 0;
        if (avgResolutionTime.length > 0) {
            const totalTime = avgResolutionTime.reduce((sum, req) => {
                const diff = new Date(req.resolved_at) - new Date(req.created_at);
                return sum + (diff / (1000 * 60 * 60)); // Convert to hours
            }, 0);
            avgTime = totalTime / avgResolutionTime.length;
        }

        return {
            total_requests: total,
            by_status: byStatus.reduce((acc, item) => {
                acc[item.status] = item._count;
                return acc;
            }, {}),
            by_category: byCategory.reduce((acc, item) => {
                if (item.category) acc[item.category] = item._count;
                return acc;
            }, {}),
            by_priority: byPriority.reduce((acc, item) => {
                acc[item.priority] = item._count;
                return acc;
            }, {}),
            average_resolution_time_hours: Math.round(avgTime * 100) / 100
        };
    }

    // Helper function - Format response
    formatMaintenanceResponse(request) {
        return {
            request_id: request.request_id,
            tenant_user_id: request.tenant_user_id,
            tenant_name: request.tenants?.users?.full_name,
            tenant_email: request.tenants?.users?.email,
            tenant_phone: request.tenants?.users?.phone,
            room_id: request.room_id,
            room_number: request.rooms?.room_number,
            building_name: request.rooms?.buildings?.name,
            title: request.title,
            description: request.description,
            category: request.category,
            priority: request.priority,
            status: request.status,
            approved_by: request.approved_by,
            approved_by_name: request.users?.full_name,
            approved_by_email: request.users?.email,
            note: request.note,
            created_at: request.created_at,
            updated_at: request.updated_at,
            approved_at: request.approved_at,
            resolved_at: request.resolved_at
        };
    }
}

module.exports = new MaintenanceService();