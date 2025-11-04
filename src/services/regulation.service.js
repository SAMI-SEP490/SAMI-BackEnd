// Updated: 2025-05-11
// by: DatNB
const prisma = require('../config/prisma');

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
            where: { regulation_id: regulationId }
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

        return this.formatRegulationResponse(regulation);
    }

    // PUBLISH - Publish regulation
    async publishRegulation(regulationId) {
        const regulation = await prisma.regulations.findUnique({
            where: { regulation_id: regulationId }
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

        return this.formatRegulationResponse(published);
    }

    // ARCHIVE - Archive regulation
    async archiveRegulation(regulationId) {
        const regulation = await prisma.regulations.findUnique({
            where: { regulation_id: regulationId }
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

        return this.formatRegulationResponse(archived);
    }

    // DELETE - Xóa regulation (soft delete)
    async deleteRegulation(regulationId) {
        const regulation = await prisma.regulations.findUnique({
            where: { regulation_id: regulationId }
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