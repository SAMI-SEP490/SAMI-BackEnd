// Updated: 2025-01-11
// by: DatNB
const prisma = require('../config/prisma');

class FloorPlanService {
    // CREATE - Tạo floor plan mới
    async createFloorPlan(data, createdBy) {
        const { building_id, name, floor_number, layout, file_url, is_published, note } = data;

        // Validate required fields
        if (!building_id) {
            throw new Error('Missing required field: building_id');
        }

        if (!createdBy) {
            throw new Error('Missing required field: created_by');
        }

        const buildingId = parseInt(building_id);
        if (isNaN(buildingId)) {
            throw new Error('building_id must be a valid number');
        }

        // Kiểm tra building tồn tại
        const building = await prisma.buildings.findUnique({
            where: { building_id: buildingId }
        });

        if (!building) {
            throw new Error('Building not found');
        }

        if (!building.is_active) {
            throw new Error('Cannot create floor plan for inactive building');
        }

        // Validate floor_number
        if (floor_number !== undefined && floor_number !== null) {
            const floor = parseInt(floor_number);
            if (isNaN(floor)) {
                throw new Error('floor_number must be a valid number');
            }
        }

        // Tìm version cao nhất cho building và floor này
        const latestPlan = await prisma.floor_plans.findFirst({
            where: {
                building_id: buildingId,
                floor_number: floor_number ? parseInt(floor_number) : null
            },
            orderBy: { version: 'desc' }
        });

        const newVersion = latestPlan ? latestPlan.version + 1 : 1;

        const floorPlan = await prisma.floor_plans.create({
            data: {
                building_id: buildingId,
                name: name?.trim() || null,
                floor_number: floor_number ? parseInt(floor_number) : null,
                version: newVersion,
                layout: layout || null,
                file_url: file_url?.trim() || null,
                is_published: is_published === false || is_published === 'flase',
                created_by: createdBy,
                note: note?.trim() || null,
                created_at: new Date(),
                updated_at: new Date()
            },
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

        return this.formatFloorPlanResponse(floorPlan);
    }

    // READ - Lấy thông tin floor plan theo ID
    async getFloorPlanById(planId) {
        const floorPlan = await prisma.floor_plans.findUnique({
            where: { plan_id: planId },
            include: {
                buildings: {
                    select: {
                        building_id: true,
                        name: true,
                        address: true,
                        number_of_floors: true
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

        if (!floorPlan) {
            throw new Error('Floor plan not found');
        }

        return this.formatFloorPlanDetailResponse(floorPlan);
    }

    // READ - Lấy danh sách floor plans (có phân trang và filter)
    async getFloorPlans(filters = {}) {
        const {
            building_id,
            floor_number,
            is_published,
            version,
            page = 1,
            limit = 20
        } = filters;

        const skip = (page - 1) * limit;
        const where = {};

        if (building_id) {
            const buildingId = parseInt(building_id);
            if (!isNaN(buildingId)) {
                where.building_id = buildingId;
            }
        }

        if (floor_number !== undefined && floor_number !== '') {
            const floor = parseInt(floor_number);
            if (!isNaN(floor)) {
                where.floor_number = floor;
            }
        }

        if (is_published !== undefined) {
            where.is_published = is_published === 'true' || is_published === true;
        }

        if (version !== undefined && version !== '') {
            const ver = parseInt(version);
            if (!isNaN(ver)) {
                where.version = ver;
            }
        }

        const [floorPlans, total] = await Promise.all([
            prisma.floor_plans.findMany({
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
                    { building_id: 'asc' },
                    { floor_number: 'asc' },
                    { version: 'desc' }
                ]
            }),
            prisma.floor_plans.count({ where })
        ]);

        return {
            data: floorPlans.map(fp => this.formatFloorPlanListResponse(fp)),
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        };
    }

    // READ - Lấy floor plans theo building
    async getFloorPlansByBuilding(buildingId, filters = {}) {
        const {
            floor_number,
            is_published,
            latest_only = false,
            page = 1,
            limit = 20
        } = filters;

        // Verify building exists
        const building = await prisma.buildings.findUnique({
            where: { building_id: buildingId }
        });

        if (!building) {
            throw new Error('Building not found');
        }

        const skip = (page - 1) * limit;
        const where = { building_id: buildingId };

        if (floor_number !== undefined && floor_number !== '') {
            const floor = parseInt(floor_number);
            if (!isNaN(floor)) {
                where.floor_number = floor;
            }
        }

        if (is_published !== undefined) {
            where.is_published = is_published === 'true' || is_published === true;
        }

        // Nếu chỉ lấy version mới nhất
        if (latest_only === true || latest_only === 'true') {
            const allPlans = await prisma.floor_plans.findMany({
                where,
                orderBy: [
                    { floor_number: 'asc' },
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

            // Lọc lấy version cao nhất cho mỗi floor
            const latestPlans = [];
            const seenFloors = new Set();

            for (const plan of allPlans) {
                const floorKey = plan.floor_number?.toString() || 'null';
                if (!seenFloors.has(floorKey)) {
                    latestPlans.push(plan);
                    seenFloors.add(floorKey);
                }
            }

            return {
                data: latestPlans.map(fp => this.formatFloorPlanListResponse(fp)),
                pagination: {
                    total: latestPlans.length,
                    page: 1,
                    limit: latestPlans.length,
                    pages: 1
                }
            };
        }

        const [floorPlans, total] = await Promise.all([
            prisma.floor_plans.findMany({
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
                    { floor_number: 'asc' },
                    { version: 'desc' }
                ]
            }),
            prisma.floor_plans.count({ where })
        ]);

        return {
            data: floorPlans.map(fp => this.formatFloorPlanListResponse(fp)),
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        };
    }

    // UPDATE - Cập nhật floor plan
    async updateFloorPlan(planId, data) {
        const { name, layout, file_url, is_published, note } = data;

        // Verify floor plan exists
        const existingPlan = await prisma.floor_plans.findUnique({
            where: { plan_id: planId }
        });

        if (!existingPlan) {
            throw new Error('Floor plan not found');
        }

        // Prepare update data
        const updateData = {
            updated_at: new Date()
        };

        if (name !== undefined) {
            updateData.name = name?.trim() || null;
        }

        if (layout !== undefined) {
            updateData.layout = layout || null;
        }

        if (file_url !== undefined) {
            updateData.file_url = file_url?.trim() || null;
        }

        if (is_published !== undefined) {
            updateData.is_published = is_published === 'true' || is_published === true;
        }

        if (note !== undefined) {
            updateData.note = note?.trim() || null;
        }

        const floorPlan = await prisma.floor_plans.update({
            where: { plan_id: planId },
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

        return this.formatFloorPlanResponse(floorPlan);
    }

    // PUBLISH - Publish floor plan
    async publishFloorPlan(planId) {
        const floorPlan = await prisma.floor_plans.findUnique({
            where: { plan_id: planId }
        });

        if (!floorPlan) {
            throw new Error('Floor plan not found');
        }

        if (floorPlan.is_published) {
            throw new Error('Floor plan is already published');
        }

        const published = await prisma.floor_plans.update({
            where: { plan_id: planId },
            data: {
                is_published: true,
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

        return this.formatFloorPlanResponse(published);
    }

    // UNPUBLISH - Unpublish floor plan
    async unpublishFloorPlan(planId) {
        const floorPlan = await prisma.floor_plans.findUnique({
            where: { plan_id: planId }
        });

        if (!floorPlan) {
            throw new Error('Floor plan not found');
        }

        if (!floorPlan.is_published) {
            throw new Error('Floor plan is already unpublished');
        }

        const unpublished = await prisma.floor_plans.update({
            where: { plan_id: planId },
            data: {
                is_published: false,
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

        return this.formatFloorPlanResponse(unpublished);
    }

    // DELETE - Xóa floor plan
    async deleteFloorPlan(planId) {
        const floorPlan = await prisma.floor_plans.findUnique({
            where: { plan_id: planId }
        });

        if (!floorPlan) {
            throw new Error('Floor plan not found');
        }

        if (floorPlan.is_published) {
            throw new Error('Cannot delete published floor plan. Unpublish it first');
        }

        await prisma.floor_plans.delete({
            where: { plan_id: planId }
        });

        return { success: true, message: 'Floor plan deleted successfully' };
    }

    // GET VERSIONS - Lấy tất cả versions của một floor
    async getFloorPlanVersions(buildingId, floorNumber) {
        const buildingIdInt = parseInt(buildingId);
        const floorNumberInt = parseInt(floorNumber);

        if (isNaN(buildingIdInt)) {
            throw new Error('building_id must be a valid number');
        }

        if (isNaN(floorNumberInt)) {
            throw new Error('floor_number must be a valid number');
        }

        // Verify building exists
        const building = await prisma.buildings.findUnique({
            where: { building_id: buildingIdInt }
        });

        if (!building) {
            throw new Error('Building not found');
        }

        const versions = await prisma.floor_plans.findMany({
            where: {
                building_id: buildingIdInt,
                floor_number: floorNumberInt
            },
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

        return versions.map(v => this.formatFloorPlanListResponse(v));
    }

    // STATISTICS - Thống kê floor plans
    async getFloorPlanStatistics(buildingId) {
        const building = await prisma.buildings.findUnique({
            where: { building_id: buildingId }
        });

        if (!building) {
            throw new Error('Building not found');
        }

        const [totalPlans, publishedPlans, unpublishedPlans, uniqueFloors] = await Promise.all([
            prisma.floor_plans.count({
                where: { building_id: buildingId }
            }),
            prisma.floor_plans.count({
                where: {
                    building_id: buildingId,
                    is_published: true
                }
            }),
            prisma.floor_plans.count({
                where: {
                    building_id: buildingId,
                    is_published: false
                }
            }),
            prisma.floor_plans.findMany({
                where: { building_id: buildingId },
                select: { floor_number: true },
                distinct: ['floor_number']
            })
        ]);

        return {
            building_id: buildingId,
            building_name: building.name,
            total_plans: totalPlans,
            published_plans: publishedPlans,
            unpublished_plans: unpublishedPlans,
            total_floors_with_plans: uniqueFloors.length
        };
    }

    // Helper functions - Format response
    formatFloorPlanResponse(floorPlan) {
        return {
            plan_id: floorPlan.plan_id,
            building_id: floorPlan.building_id,
            building_name: floorPlan.buildings?.name,
            building_address: floorPlan.buildings?.address,
            name: floorPlan.name,
            floor_number: floorPlan.floor_number,
            version: floorPlan.version,
            layout: floorPlan.layout,
            file_url: floorPlan.file_url,
            is_published: floorPlan.is_published,
            created_by: {
                user_id: floorPlan.users?.user_id,
                full_name: floorPlan.users?.full_name,
                email: floorPlan.users?.email
            },
            note: floorPlan.note,
            created_at: floorPlan.created_at,
            updated_at: floorPlan.updated_at
        };
    }

    formatFloorPlanListResponse(floorPlan) {
        return {
            plan_id: floorPlan.plan_id,
            building_id: floorPlan.building_id,
            building_name: floorPlan.buildings?.name,
            name: floorPlan.name,
            floor_number: floorPlan.floor_number,
            version: floorPlan.version,
            is_published: floorPlan.is_published,
            created_by: {
                user_id: floorPlan.users?.user_id,
                full_name: floorPlan.users?.full_name
            },
            created_at: floorPlan.created_at,
            updated_at: floorPlan.updated_at
        };
    }

    formatFloorPlanDetailResponse(floorPlan) {
        return {
            plan_id: floorPlan.plan_id,
            building: {
                building_id: floorPlan.buildings?.building_id,
                name: floorPlan.buildings?.name,
                address: floorPlan.buildings?.address,
                number_of_floors: floorPlan.buildings?.number_of_floors
            },
            name: floorPlan.name,
            floor_number: floorPlan.floor_number,
            version: floorPlan.version,
            layout: floorPlan.layout,
            file_url: floorPlan.file_url,
            is_published: floorPlan.is_published,
            created_by: {
                user_id: floorPlan.users?.user_id,
                full_name: floorPlan.users?.full_name,
                email: floorPlan.users?.email
            },
            note: floorPlan.note,
            created_at: floorPlan.created_at,
            updated_at: floorPlan.updated_at
        };
    }
}

module.exports = new FloorPlanService();