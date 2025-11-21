// Updated: 2025-15-11
// by: DatNB
const prisma = require('../config/prisma');
const NotificationService = require('./notification.service');

class RegulationService {
    // CREATE - Tạo regulation mới
    async createRegulation(data, createdBy) {
        const {
            title,
            content,
            building_id,
            effective_date,
            status,
            target,
            note
        } = data;

        // Validate required fields
        if (!title) {
            throw new Error('Missing required field: title');
        }

        if (!createdBy) {
            throw new Error('Missing required field: created_by');
        }

        // Validate building_id if provided
        if (building_id) {
            const buildingIdInt = parseInt(building_id);
            if (isNaN(buildingIdInt)) {
                throw new Error('building_id must be a valid number');
            }

            const building = await prisma.buildings.findUnique({
                where: { building_id: buildingIdInt }
            });

            if (!building) {
                throw new Error('Building not found');
            }

            if (!building.is_active) {
                throw new Error('Cannot create regulation for inactive building');
            }
        }

        // Tìm version cao nhất cho regulation này
        const whereClause = building_id
            ? { building_id: parseInt(building_id), title: title.trim() }
            : { building_id: null, title: title.trim() };

        const latestRegulation = await prisma.regulations.findFirst({
            where: whereClause,
            orderBy: { version: 'desc' }
        });

        const newVersion = latestRegulation ? latestRegulation.version + 1 : 1;

        const regulation = await prisma.regulations.create({
            data: {
                title: title.trim(),
                content: content?.trim() || null,
                building_id: building_id ? parseInt(building_id) : null,
                effective_date: effective_date ? new Date(effective_date) : null,
                version: newVersion,
                status: status || 'draft',
                target: target || 'all',
                created_by: createdBy,
                note: note?.trim() || null,
                created_at: new Date(),
                updated_at: new Date()
            },
            include: {
                buildings: building_id ? {
                    select: {
                        building_id: true,
                        name: true,
                        address: true
                    }
                } : false,
                users: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true
                    }
                }
            }
        });

        return this.formatRegulationResponse(regulation);
    }

    // READ - Lấy thông tin regulation theo ID
    async getRegulationById(regulationId) {
        const regulation = await prisma.regulations.findUnique({
            where: { regulation_id: regulationId },
            include: {
                buildings: {
                    select: {
                        building_id: true,
                        name: true,
                        address: true
                    }
                },
                users: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true
                    }
                },
                regulation_feedbacks: {
                    include: {
                        users: {
                            select: {
                                user_id: true,
                                full_name: true,
                                email: true
                            }
                        }
                    },
                    orderBy: { created_at: 'desc' }
                }
            }
        });

        if (!regulation) {
            throw new Error('Regulation not found');
        }

        return this.formatRegulationDetailResponse(regulation);
    }

    // READ - Lấy danh sách regulations (có phân trang và filter)
    async getRegulations(filters = {}) {
        const {
            building_id,
            status,
            target,
            version,
            page = 1,
            limit = 20
        } = filters;

        const skip = (page - 1) * limit;
        const where = {};

        if (building_id !== undefined) {
            if (building_id === 'null' || building_id === null) {
                where.building_id = null;
            } else {
                const buildingId = parseInt(building_id);
                if (!isNaN(buildingId)) {
                    where.building_id = buildingId;
                }
            }
        }

        if (status) {
            where.status = status;
        }

        if (target) {
            where.target = target;
        }

        if (version !== undefined && version !== '') {
            const ver = parseInt(version);
            if (!isNaN(ver)) {
                where.version = ver;
            }
        }

        // Không hiển thị regulations đã bị xóa (archived)
        if (!filters.include_archived) {
            where.archived_at = null;
        }

        const [regulations, total] = await Promise.all([
            prisma.regulations.findMany({
                where,
                include: {
                    buildings: {
                        select: {
                            building_id: true,
                            name: true,
                            address: true
                        }
                    },
                    users: {
                        select: {
                            user_id: true,
                            full_name: true,
                            email: true
                        }
                    }
                },
                skip,
                take: limit,
                orderBy: [
                    { created_at: 'desc' }
                ]
            }),
            prisma.regulations.count({ where })
        ]);

        return {
            data: regulations.map(r => this.formatRegulationListResponse(r)),
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        };
    }

    // READ - Lấy regulations theo building
    async getRegulationsByBuilding(buildingId, filters = {}) {
        const {
            status,
            target,
            latest_only = false,
            page = 1,
            limit = 20
        } = filters;

        // Verify building exists
        if (buildingId !== null) {
            const building = await prisma.buildings.findUnique({
                where: { building_id: buildingId }
            });

            if (!building) {
                throw new Error('Building not found');
            }
        }

        const skip = (page - 1) * limit;
        const where = { building_id: buildingId, archived_at: null };

        if (status) {
            where.status = status;
        }

        if (target) {
            where.target = target;
        }

        // Nếu chỉ lấy version mới nhất
        if (latest_only === true || latest_only === 'true') {
            const allRegulations = await prisma.regulations.findMany({
                where,
                orderBy: [
                    { title: 'asc' },
                    { version: 'desc' }
                ],
                include: {
                    users: {
                        select: {
                            user_id: true,
                            full_name: true,
                            email: true
                        }
                    }
                }
            });

            // Lọc lấy version cao nhất cho mỗi title
            const latestRegulations = [];
            const seenTitles = new Set();

            for (const regulation of allRegulations) {
                if (!seenTitles.has(regulation.title)) {
                    latestRegulations.push(regulation);
                    seenTitles.add(regulation.title);
                }
            }

            return {
                data: latestRegulations.map(r => this.formatRegulationListResponse(r)),
                pagination: {
                    total: latestRegulations.length,
                    page: 1,
                    limit: latestRegulations.length,
                    pages: 1
                }
            };
        }

        const [regulations, total] = await Promise.all([
            prisma.regulations.findMany({
                where,
                include: {
                    users: {
                        select: {
                            user_id: true,
                            full_name: true,
                            email: true
                        }
                    }
                },
                skip,
                take: limit,
                orderBy: [
                    { created_at: 'desc' }
                ]
            }),
            prisma.regulations.count({ where })
        ]);

        return {
            data: regulations.map(r => this.formatRegulationListResponse(r)),
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        };
    }

    // UPDATE - Cập nhật regulation
    async updateRegulation(regulationId, data) {
        const { title, content, effective_date, status, target, note } = data;

        // Verify regulation exists
        const existingRegulation = await prisma.regulations.findUnique({
            where: { regulation_id: regulationId },
            include: {
                buildings: {
                    select: {
                        building_id: true,
                        name: true
                    }
                }
            }
        });

        if (!existingRegulation) {
            throw new Error('Regulation not found');
        }

        if (existingRegulation.archived_at) {
            throw new Error('Cannot update archived regulation');
        }

        if (existingRegulation.status === 'published' && status !== 'archived') {
            throw new Error('Cannot update published regulation. Archive it first or create a new version');
        }

        // Prepare update data
        const updateData = {
            updated_at: new Date()
        };

        if (title !== undefined) {
            updateData.title = title.trim();
        }

        if (content !== undefined) {
            updateData.content = content?.trim() || null;
        }

        if (effective_date !== undefined) {
            updateData.effective_date = effective_date ? new Date(effective_date) : null;
        }

        if (status !== undefined) {
            updateData.status = status;
        }

        if (target !== undefined) {
            updateData.target = target;
        }

        if (note !== undefined) {
            updateData.note = note?.trim() || null;
        }

        const regulation = await prisma.regulations.update({
            where: { regulation_id: regulationId },
            data: updateData,
            include: {
                buildings: {
                    select: {
                        building_id: true,
                        name: true,
                        address: true
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

        // GỬI THÔNG BÁO KHI CÓ CẬP NHẬT
        if (regulation.building_id) {
            const notificationTitle = `Cập nhật quy định: ${regulation.title}`;
            const notificationBody = `Quy định "${regulation.title}" đã được cập nhật. Vui lòng xem lại nội dung mới.`;
            const payload = {
                type: 'regulation_updated',
                regulation_id: regulation.regulation_id,
                building_id: regulation.building_id
            };

            // Gửi thông báo cho tất cả tenant trong tòa nhà
            await NotificationService.createBuildingBroadcast(
                regulation.created_by,
                regulation.building_id,
                notificationTitle,
                notificationBody,
                payload
            );
        }

        return this.formatRegulationResponse(regulation);
    }

    // PUBLISH - Publish regulation
    async publishRegulation(regulationId) {
        const regulation = await prisma.regulations.findUnique({
            where: { regulation_id: regulationId },
            include: {
                buildings: {
                    select: {
                        building_id: true,
                        name: true
                    }
                }
            }
        });

        if (!regulation) {
            throw new Error('Regulation not found');
        }

        if (regulation.archived_at) {
            throw new Error('Cannot publish archived regulation');
        }

        if (regulation.status === 'published') {
            throw new Error('Regulation is already published');
        }

        const published = await prisma.regulations.update({
            where: { regulation_id: regulationId },
            data: {
                status: 'published',
                updated_at: new Date()
            },
            include: {
                buildings: {
                    select: {
                        building_id: true,
                        name: true
                    }
                },
                users: {
                    select: {
                        user_id: true,
                        full_name: true
                    }
                }
            }
        });

        // GỬI THÔNG BÁO KHI PUBLISH
        if (published.building_id) {
            const notificationTitle = `Quy định mới: ${published.title}`;
            const notificationBody = `Quy định "${published.title}" đã được công bố. Vui lòng đọc và tuân thủ.`;
            const payload = {
                type: 'regulation_published',
                regulation_id: published.regulation_id,
                building_id: published.building_id
            };

            // Gửi thông báo cho tất cả tenant trong tòa nhà
            await NotificationService.createBuildingBroadcast(
                published.created_by,
                published.building_id,
                notificationTitle,
                notificationBody,
                payload
            );
        } else {
            // Nếu là quy định chung (không có building_id), gửi cho tất cả tenant
            const notificationTitle = `Quy định chung mới: ${published.title}`;
            const notificationBody = `Quy định chung "${published.title}" đã được công bố. Vui lòng đọc và tuân thủ.`;
            const payload = {
                type: 'regulation_published',
                regulation_id: published.regulation_id
            };

            await NotificationService.createBroadcastNotification(
                published.created_by,
                notificationTitle,
                notificationBody,
                payload
            );
        }

        return this.formatRegulationResponse(published);
    }

    // ARCHIVE - Archive regulation
    async archiveRegulation(regulationId) {
        const regulation = await prisma.regulations.findUnique({
            where: { regulation_id: regulationId },
            include: {
                buildings: {
                    select: {
                        building_id: true,
                        name: true
                    }
                }
            }
        });

        if (!regulation) {
            throw new Error('Regulation not found');
        }

        if (regulation.archived_at) {
            throw new Error('Regulation is already archived');
        }

        const archived = await prisma.regulations.update({
            where: { regulation_id: regulationId },
            data: {
                status: 'archived',
                archived_at: new Date(),
                updated_at: new Date()
            },
            include: {
                buildings: {
                    select: {
                        building_id: true,
                        name: true
                    }
                },
                users: {
                    select: {
                        user_id: true,
                        full_name: true
                    }
                }
            }
        });

        // GỬI THÔNG BÁO KHI ARCHIVE (nếu regulation đã được publish trước đó)
        if (regulation.status === 'published') {
            if (archived.building_id) {
                const notificationTitle = `Quy định đã lưu trữ: ${archived.title}`;
                const notificationBody = `Quy định "${archived.title}" đã được lưu trữ và không còn hiệu lực.`;
                const payload = {
                    type: 'regulation_archived',
                    regulation_id: archived.regulation_id,
                    building_id: archived.building_id
                };

                await NotificationService.createBuildingBroadcast(
                    archived.created_by,
                    archived.building_id,
                    notificationTitle,
                    notificationBody,
                    payload
                );
            } else {
                const notificationTitle = `Quy định chung đã lưu trữ: ${archived.title}`;
                const notificationBody = `Quy định chung "${archived.title}" đã được lưu trữ và không còn hiệu lực.`;
                const payload = {
                    type: 'regulation_archived',
                    regulation_id: archived.regulation_id
                };

                await NotificationService.createBroadcastNotification(
                    archived.created_by,
                    notificationTitle,
                    notificationBody,
                    payload
                );
            }
        }

        return this.formatRegulationResponse(archived);
    }

    // DELETE - Xóa regulation (soft delete)
    async deleteRegulation(regulationId) {
        const regulation = await prisma.regulations.findUnique({
            where: { regulation_id: regulationId },
            include: {
                buildings: {
                    select: {
                        building_id: true,
                        name: true
                    }
                }
            }
        });

        if (!regulation) {
            throw new Error('Regulation not found');
        }

        if (regulation.status === 'published') {
            throw new Error('Cannot delete published regulation. Archive it first');
        }

        await prisma.regulations.update({
            where: { regulation_id: regulationId },
            data: {
                status: 'deleted',
                archived_at: new Date()
            }
        });

        // GỬI THÔNG BÁO KHI XÓA (nếu regulation là draft nhưng có thể đã được share)
        if (regulation.building_id && regulation.status === 'draft') {
            const notificationTitle = `Quy định đã bị xóa: ${regulation.title}`;
            const notificationBody = `Quy định "${regulation.title}" (bản nháp) đã bị xóa.`;
            const payload = {
                type: 'regulation_deleted',
                regulation_id: regulation.regulation_id,
                building_id: regulation.building_id
            };

            await NotificationService.createBuildingBroadcast(
                regulation.created_by,
                regulation.building_id,
                notificationTitle,
                notificationBody,
                payload
            );
        }

        return { success: true, message: 'Regulation deleted successfully' };
    }

    // GET VERSIONS - Lấy tất cả versions của một regulation
    async getRegulationVersions(title, buildingId = null) {
        const whereClause = {
            title: title.trim(),
            building_id: buildingId ? parseInt(buildingId) : null
        };

        const versions = await prisma.regulations.findMany({
            where: whereClause,
            include: {
                users: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true
                    }
                }
            },
            orderBy: { version: 'desc' }
        });

        if (versions.length === 0) {
            throw new Error('No regulations found with this title');
        }

        return versions.map(v => this.formatRegulationListResponse(v));
    }

    // FEEDBACK - Thêm feedback cho regulation
    async addFeedback(regulationId, userId, comment) {
        // Verify regulation exists
        const regulation = await prisma.regulations.findUnique({
            where: { regulation_id: regulationId }
        });

        if (!regulation) {
            throw new Error('Regulation not found');
        }

        if (regulation.status !== 'published') {
            throw new Error('Can only add feedback to published regulations');
        }

        const feedback = await prisma.regulation_feedbacks.create({
            data: {
                regulation_id: regulationId,
                created_by: userId,
                comment: comment?.trim() || null,
                created_at: new Date()
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
        });

        return {
            feedback_id: feedback.feedback_id,
            regulation_id: feedback.regulation_id,
            comment: feedback.comment,
            created_by: {
                user_id: feedback.users.user_id,
                full_name: feedback.users.full_name,
                email: feedback.users.email
            },
            created_at: feedback.created_at
        };
    }

    // GET FEEDBACKS - Lấy feedbacks của regulation
    async getFeedbacks(regulationId, filters = {}) {
        const { page = 1, limit = 20 } = filters;
        const skip = (page - 1) * limit;

        const [feedbacks, total] = await Promise.all([
            prisma.regulation_feedbacks.findMany({
                where: { regulation_id: regulationId },
                include: {
                    users: {
                        select: {
                            user_id: true,
                            full_name: true,
                            email: true
                        }
                    }
                },
                skip,
                take: limit,
                orderBy: { created_at: 'desc' }
            }),
            prisma.regulation_feedbacks.count({
                where: { regulation_id: regulationId }
            })
        ]);

        return {
            data: feedbacks.map(f => ({
                feedback_id: f.feedback_id,
                regulation_id: f.regulation_id,
                comment: f.comment,
                created_by: {
                    user_id: f.users.user_id,
                    full_name: f.users.full_name,
                    email: f.users.email
                },
                created_at: f.created_at
            })),
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        };
    }

    // STATISTICS - Thống kê regulations
    async getRegulationStatistics(buildingId = null) {
        const where = buildingId ? { building_id: buildingId } : {};

        if (buildingId) {
            const building = await prisma.buildings.findUnique({
                where: { building_id: buildingId }
            });

            if (!building) {
                throw new Error('Building not found');
            }
        }

        const [
            totalRegulations,
            draftRegulations,
            publishedRegulations,
            archivedRegulations,
            totalFeedbacks
        ] = await Promise.all([
            prisma.regulations.count({
                where: { ...where, archived_at: null }
            }),
            prisma.regulations.count({
                where: { ...where, status: 'draft', archived_at: null }
            }),
            prisma.regulations.count({
                where: { ...where, status: 'published', archived_at: null }
            }),
            prisma.regulations.count({
                where: { ...where, status: 'archived' }
            }),
            prisma.regulation_feedbacks.count({
                where: buildingId ? {
                    regulations: { building_id: buildingId }
                } : {}
            })
        ]);

        const result = {
            total_regulations: totalRegulations,
            draft_regulations: draftRegulations,
            published_regulations: publishedRegulations,
            archived_regulations: archivedRegulations,
            total_feedbacks: totalFeedbacks
        };

        if (buildingId) {
            const building = await prisma.buildings.findUnique({
                where: { building_id: buildingId }
            });
            result.building_id = buildingId;
            result.building_name = building.name;
        }

        return result;
    }


    // ============ BOT METHODS ============

    /**
     * GET BY BOT - Bot lấy thông tin regulation
     */
    async getRegulationByBot(regulationId, tenantUserId = null, botInfo) {
        const regulation = await prisma.regulations.findUnique({
            where: { regulation_id: regulationId },
            include: {
                buildings: {
                    select: {
                        building_id: true,
                        name: true,
                        address: true
                    }
                },
                users: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true
                    }
                },
                regulation_feedbacks: {
                    include: {
                        users: {
                            select: {
                                user_id: true,
                                full_name: true,
                                email: true
                            }
                        }
                    },
                    orderBy: { created_at: 'desc' },
                    take: 10 // Limit feedbacks to latest 10
                }
            }
        });

        if (!regulation) {
            throw new Error('Regulation not found');
        }

        // If tenant_user_id is provided, verify tenant can access this regulation
        if (tenantUserId) {
            const tenant = await prisma.tenants.findUnique({
                where: { user_id: tenantUserId },
                include: {
                    rooms: {
                        where: { is_active: true },
                        select: {
                            building_id: true
                        }
                    }
                }
            });

            if (!tenant) {
                throw new Error('Tenant not found');
            }

            // Check if regulation applies to tenant
            // Regulation applies if:
            // 1. It's a general regulation (building_id = null)
            // 2. It's for the tenant's building
            const tenantBuildingIds = tenant.rooms.map(r => r.building_id);

            if (regulation.building_id && !tenantBuildingIds.includes(regulation.building_id)) {
                throw new Error('This regulation does not apply to the specified tenant');
            }

            // Check target
            if (regulation.target !== 'all' && regulation.target !== 'tenant') {
                throw new Error('This regulation does not apply to tenants');
            }
        }

        return this.formatRegulationDetailResponse(regulation);
    }

    /**
     * GET LIST BY BOT - Bot lấy danh sách regulations
     */
    async getRegulationsByBot(filters = {}, botInfo) {
        const {
            building_id,
            status,
            target,
            version,
            page = 1,
            limit = 20
        } = filters;

        const skip = (page - 1) * limit;
        const where = {
            archived_at: null
        };

        if (building_id !== undefined) {
            if (building_id === 'null' || building_id === null) {
                where.building_id = null;
            } else {
                const buildingId = parseInt(building_id);
                if (!isNaN(buildingId)) {
                    where.building_id = buildingId;
                }
            }
        }

        // Bot typically only shows published regulations
        if (status) {
            where.status = status;
        } else {
            where.status = 'published';
        }

        if (target) {
            where.target = target;
        }

        if (version !== undefined && version !== '') {
            const ver = parseInt(version);
            if (!isNaN(ver)) {
                where.version = ver;
            }
        }

        const [regulations, total] = await Promise.all([
            prisma.regulations.findMany({
                where,
                include: {
                    buildings: {
                        select: {
                            building_id: true,
                            name: true,
                            address: true
                        }
                    },
                    users: {
                        select: {
                            user_id: true,
                            full_name: true,
                            email: true
                        }
                    }
                },
                skip,
                take: limit,
                orderBy: [
                    { created_at: 'desc' }
                ]
            }),
            prisma.regulations.count({ where })
        ]);

        return {
            data: regulations.map(r => this.formatRegulationListResponse(r)),
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * GET BY BUILDING FOR BOT - Bot lấy regulations theo building
     */
    async getRegulationsByBuildingForBot(buildingId, filters = {}, botInfo) {
        const {
            status,
            target,
            latest_only = false,
            page = 1,
            limit = 20
        } = filters;

        // Verify building exists
        if (buildingId !== null) {
            const building = await prisma.buildings.findUnique({
                where: { building_id: buildingId }
            });

            if (!building) {
                throw new Error('Building not found');
            }
        }

        const skip = (page - 1) * limit;
        const where = {
            building_id: buildingId,
            archived_at: null,
            status: status || 'published' // Default to published for bot
        };

        if (target) {
            where.target = target;
        }

        // If only latest version
        if (latest_only === true || latest_only === 'true') {
            const allRegulations = await prisma.regulations.findMany({
                where,
                orderBy: [
                    { title: 'asc' },
                    { version: 'desc' }
                ],
                include: {
                    buildings: {
                        select: {
                            building_id: true,
                            name: true
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

            // Filter latest version for each title
            const latestRegulations = [];
            const seenTitles = new Set();

            for (const regulation of allRegulations) {
                if (!seenTitles.has(regulation.title)) {
                    latestRegulations.push(regulation);
                    seenTitles.add(regulation.title);
                }
            }

            return {
                data: latestRegulations.map(r => this.formatRegulationListResponse(r)),
                pagination: {
                    total: latestRegulations.length,
                    page: 1,
                    limit: latestRegulations.length,
                    pages: 1
                }
            };
        }

        const [regulations, total] = await Promise.all([
            prisma.regulations.findMany({
                where,
                include: {
                    buildings: {
                        select: {
                            building_id: true,
                            name: true
                        }
                    },
                    users: {
                        select: {
                            user_id: true,
                            full_name: true,
                            email: true
                        }
                    }
                },
                skip,
                take: limit,
                orderBy: [
                    { created_at: 'desc' }
                ]
            }),
            prisma.regulations.count({ where })
        ]);

        return {
            data: regulations.map(r => this.formatRegulationListResponse(r)),
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        };
    }


    /**
     * ADD FEEDBACK BY BOT - Bot thêm feedback thay mặt tenant
     */
    async addRegulationFeedbackByBot(regulationId, tenantUserId, comment, botInfo) {
        // Verify regulation exists and is published
        const regulation = await prisma.regulations.findUnique({
            where: { regulation_id: regulationId },
            include: {
                buildings: {
                    select: {
                        building_id: true,
                        name: true
                    }
                }
            }
        });

        if (!regulation) {
            throw new Error('Regulation not found');
        }

        if (regulation.status !== 'published') {
            throw new Error('Can only add feedback to published regulations');
        }

        // Verify tenant exists and is active
        const tenant = await prisma.tenants.findUnique({
            where: { user_id: tenantUserId },
            include: {
                users: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true,
                        status: true
                    }
                },
                rooms: {
                    where: { is_active: true },
                    select: {
                        building_id: true
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

        // Verify regulation applies to tenant
        if (regulation.building_id) {
            const tenantBuildingIds = tenant.rooms.map(r => r.building_id);
            if (!tenantBuildingIds.includes(regulation.building_id)) {
                throw new Error('This regulation does not apply to the specified tenant');
            }
        }

        // Check target
        if (regulation.target !== 'all' && regulation.target !== 'tenant') {
            throw new Error('This regulation does not apply to tenants');
        }

        // Add bot info to comment
        const botComment = [
            `🤖 Feedback from Bot`,
            `Bot: ${botInfo.name}`,
            `Submitted at: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
            `Tenant: ${tenant.users.full_name}`,
            '',
            comment
        ].join('\n');

        const feedback = await prisma.regulation_feedbacks.create({
            data: {
                regulation_id: regulationId,
                created_by: tenantUserId,
                comment: botComment,
                created_at: new Date()
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
        });

        // Send notification to regulation creator
        try {
            const regulationTitle = regulation.title;
            const buildingInfo = regulation.buildings?.name
                ? ` tại ${regulation.buildings.name}`
                : '';

            await NotificationService.createNotification(
                null, // Bot không có user_id
                regulation.created_by,
                'Phản hồi mới cho quy định',
                `Có phản hồi mới từ ${tenant.users.full_name} cho quy định "${regulationTitle}"${buildingInfo}.`,
                {
                    type: 'regulation_feedback_by_bot',
                    regulation_id: regulationId,
                    feedback_id: feedback.feedback_id,
                    link: `/regulations/${regulationId}`
                }
            );
        } catch (notificationError) {
            console.error('Error sending feedback notification:', notificationError);
        }

        return {
            feedback_id: feedback.feedback_id,
            regulation_id: feedback.regulation_id,
            comment: feedback.comment,
            created_by: {
                user_id: feedback.users.user_id,
                full_name: feedback.users.full_name,
                email: feedback.users.email
            },
            created_at: feedback.created_at
        };
    }

    /**
     * GET FEEDBACKS BY BOT - Bot lấy feedbacks của regulation
     */
    async getRegulationFeedbacksByBot(regulationId, filters = {}, botInfo) {
        const { page = 1, limit = 20 } = filters;
        const skip = (page - 1) * limit;

        // Verify regulation exists
        const regulation = await prisma.regulations.findUnique({
            where: { regulation_id: regulationId }
        });

        if (!regulation) {
            throw new Error('Regulation not found');
        }

        const [feedbacks, total] = await Promise.all([
            prisma.regulation_feedbacks.findMany({
                where: { regulation_id: regulationId },
                include: {
                    users: {
                        select: {
                            user_id: true,
                            full_name: true,
                            email: true
                        }
                    }
                },
                skip,
                take: limit,
                orderBy: { created_at: 'desc' }
            }),
            prisma.regulation_feedbacks.count({
                where: { regulation_id: regulationId }
            })
        ]);

        return {
            data: feedbacks.map(f => ({
                feedback_id: f.feedback_id,
                regulation_id: f.regulation_id,
                comment: f.comment,
                created_by: {
                    user_id: f.users.user_id,
                    full_name: f.users.full_name,
                    email: f.users.email
                },
                created_at: f.created_at
            })),
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * GET VERSIONS BY BOT - Bot lấy versions của regulation
     */
    async getRegulationVersionsByBot(title, buildingId = null, botInfo) {
        const whereClause = {
            title: title.trim(),
            building_id: buildingId ? parseInt(buildingId) : null,
            status: 'published' // Only show published versions to bot
        };

        const versions = await prisma.regulations.findMany({
            where: whereClause,
            include: {
                buildings: {
                    select: {
                        building_id: true,
                        name: true
                    }
                },
                users: {
                    select: {
                        user_id: true,
                        full_name: true,
                        email: true
                    }
                }
            },
            orderBy: { version: 'desc' }
        });

        if (versions.length === 0) {
            throw new Error('No published regulations found with this title');
        }

        return versions.map(v => this.formatRegulationListResponse(v));
    }



    // Helper functions - Format response
    formatRegulationResponse(regulation) {
        return {
            regulation_id: regulation.regulation_id,
            title: regulation.title,
            content: regulation.content,
            building_id: regulation.building_id,
            building_name: regulation.buildings?.name,
            building_address: regulation.buildings?.address,
            effective_date: regulation.effective_date,
            version: regulation.version,
            status: regulation.status,
            target: regulation.target,
            created_by: {
                user_id: regulation.users?.user_id,
                full_name: regulation.users?.full_name,
                email: regulation.users?.email
            },
            note: regulation.note,
            created_at: regulation.created_at,
            updated_at: regulation.updated_at,
            archived_at: regulation.archived_at
        };
    }

    formatRegulationListResponse(regulation) {
        return {
            regulation_id: regulation.regulation_id,
            title: regulation.title,
            building_id: regulation.building_id,
            building_name: regulation.buildings?.name,
            effective_date: regulation.effective_date,
            version: regulation.version,
            status: regulation.status,
            target: regulation.target,
            created_by: {
                user_id: regulation.users?.user_id,
                full_name: regulation.users?.full_name
            },
            created_at: regulation.created_at,
            updated_at: regulation.updated_at
        };
    }

    formatRegulationDetailResponse(regulation) {
        return {
            regulation_id: regulation.regulation_id,
            title: regulation.title,
            content: regulation.content,
            building: regulation.building_id ? {
                building_id: regulation.buildings?.building_id,
                name: regulation.buildings?.name,
                address: regulation.buildings?.address
            } : null,
            effective_date: regulation.effective_date,
            version: regulation.version,
            status: regulation.status,
            target: regulation.target,
            created_by: {
                user_id: regulation.users?.user_id,
                full_name: regulation.users?.full_name,
                email: regulation.users?.email
            },
            note: regulation.note,
            feedbacks: regulation.regulation_feedbacks?.map(f => ({
                feedback_id: f.feedback_id,
                comment: f.comment,
                created_by: {
                    user_id: f.users.user_id,
                    full_name: f.users.full_name,
                    email: f.users.email
                },
                created_at: f.created_at
            })) || [],
            created_at: regulation.created_at,
            updated_at: regulation.updated_at,
            archived_at: regulation.archived_at
        };
    }
}

module.exports = new RegulationService();