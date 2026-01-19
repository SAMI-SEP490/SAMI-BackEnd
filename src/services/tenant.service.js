// Updated: 2025-23-11
// by: MinhBH

const prisma = require('../config/prisma');

class TenantService {
    /**
     * Gets a list of all tenants with their user and room details.
     */
    async getAllTenants() {
        const tenants = await prisma.tenants.findMany({
            orderBy: {
                users: { full_name: 'asc' } // Order tenants alphabetically by name
            },
            include: {
                users: { // Include the user data (name, phone, email, etc.)
                    select: {
                        user_id: true,
                        full_name: true,
                        phone: true,
                        email: true,
                        status: true,
                        is_verified: true,
                        created_at: true,
                        avatar_url: true,
                    }
                },
                rooms: { // Include the room they are linked to
                    select: {
                        room_id: true,
                        room_number: true,
                        floor: true
                    }
                }
            }
        });

        // Format the data to be a clean, flat list for the frontend
        return tenants.map(tenant => ({
            // User info
            user_id: tenant.users.user_id,
            full_name: tenant.users.full_name,
            phone: tenant.users.phone,
            email: tenant.users.email,
            status: tenant.users.status,
            is_verified: tenant.users.is_verified,
            avatar_url: tenant.users.avatar_url,
            created_at: tenant.users.created_at, // User account creation date
            
            // Tenant-specific info
            id_number: tenant.id_number,
            tenant_since: tenant.tenant_since,
            emergency_contact_phone: tenant.emergency_contact_phone,
            note: tenant.note,
            
            // Room info
            room: tenant.rooms ? {
                room_id: tenant.rooms.room_id,
                room_number: tenant.rooms.room_number,
                floor: tenant.rooms.floor
            } : null // Handle if tenant is not linked to a room
        }));
    }

    /**
     * Searches only tenants by full_name.
     */
    async searchTenantsByName(nameQuery) {
        // We query the 'tenants' table and join the 'users' data
        const tenants = await prisma.tenants.findMany({
            where: {
                // Filter on the related user's full_name
                users: {
                    full_name: {
                        contains: nameQuery,
                        mode: 'insensitive',
                    },
                },
            },
            include: {
                users: {
                    select: {
                        user_id: true,
                        phone: true,
                        email: true,
                        full_name: true,
                        gender: true,
                        birthday: true,
                        status: true,
                        is_verified: true,
                        created_at: true,
                        updated_at: true,
                        deleted_at: true,
                    },
                },
            },
            orderBy: {
                users: {
                    full_name: 'asc'
                }
            }
        });

        // Map the result to the desired flat structure
        return tenants.map(tenant => ({
            user_id: tenant.users.user_id,
            phone: tenant.users.phone,
            email: tenant.users.email,
            full_name: tenant.users.full_name,
            gender: tenant.users.gender,
            birthday: tenant.users.birthday,
            status: tenant.users.status,
            role: 'TENANT', // Role is known to be TENANT
            is_verified: tenant.users.is_verified,
            created_at: tenant.users.created_at,
            updated_at: tenant.users.updated_at,
            deleted_at: tenant.users.deleted_at,
            note: tenant.note,
            tenant_since: tenant.tenant_since,
            id_number: tenant.id_number,
        }));
    }

    /**
     * Calculates vacant rooms and occupancy rate.
     */
    async getOccupancyAnalytics() {
        // Run in a transaction to ensure consistent data
        return prisma.$transaction(async (tx) => {
            // 1. Get total number of active rooms in the system
            const totalRooms = await tx.rooms.count({
                where: { is_active: true },
            });

            // 2. Get count of unique rooms that have an 'active' contract
            const occupiedRoomsQuery = await tx.contracts.groupBy({
                by: ['room_id'],
                where: {
                    status: 'active',
                    rooms: { is_active: true },
                },
            });
            
            // The count is the length of the grouped array
            const occupiedRooms = occupiedRoomsQuery.length;

            if (totalRooms === 0) {
                return {
                    totalRooms: 0,
                    occupiedRooms: 0,
                    vacantRooms: 0,
                    occupancyRate: 0,
                };
            }

            // 3. Calculate analytics
            const vacantRooms = totalRooms - occupiedRooms;
            const occupancyRate = (occupiedRooms / totalRooms) * 100;

            return {
                totalRooms,
                occupiedRooms,
                vacantRooms,
                occupancyRate: parseFloat(occupancyRate.toFixed(2)), // Format to 2 decimal places
            };
        });
    }

    /**
     * Counts tenants grouped by gender.
     */
    async getTenantGenderDistribution() {
        const genderGroups = await prisma.users.groupBy({
            by: ['gender'],
            where: {
                role: 'TENANT',
            },
            _count: {
                user_id: true,
            },
        });

        // Format the result for a cleaner API response
        return genderGroups.map(group => ({
            gender: group.gender || 'Unknown',
            count: group._count.user_id,
        }));
    }

    /**
     * Counts tenants by age distribution.
     */
    async getTenantAgeDistribution() {
        // Age brackets
        const ageDistribution = await prisma.$queryRaw`
            SELECT
                CASE
                    WHEN age < 18 THEN 'Under 18'
                    WHEN age BETWEEN 18 AND 25 THEN '18-25'
                    WHEN age BETWEEN 26 AND 35 THEN '26-35'
                    WHEN age BETWEEN 36 AND 50 THEN '36-50'
                    WHEN age > 50 THEN 'Over 50'
                    ELSE 'Unknown'
                END as age_range,
                COUNT(*) as count
            FROM (
                SELECT EXTRACT(YEAR FROM AGE(NOW(), "birthday")) as age
                FROM "users" u
                -- Join to ensure we only count tenants
                INNER JOIN "tenants" t ON u."user_id" = t."user_id"
                WHERE u."birthday" IS NOT NULL
            ) as age_data
            GROUP BY age_range
            ORDER BY age_range;
        `;

        // The queryRaw result needs to be cast (BigInt -> Number)
        return ageDistribution.map(group => ({
            age_range: group.age_range,
            count: Number(group.count),
        }));
    }

    /**
     * Gets contracts that will expire within the next 30 days.
     */
    async getContractExpiredFor1Month() {
        const today = new Date();
        const in30Days = new Date();
        in30Days.setDate(today.getDate() + 30);

        const expiringContracts = await prisma.contracts.findMany({
            where: {
                status: 'active',
                deleted_at: null, // Ensure we don't get deleted contracts
                end_date: {
                    gte: today, // Greater than or equal to today
                    lte: in30Days, // Less than or equal to 30 days from now
                },
            },
            select: {
                contract_id: true,
                start_date: true,
                end_date: true,
                // Include tenant and room info
                tenants: {
                    select: {
                        user_id: true,
                        id_number: true,
                        users: {
                            select: {
                                full_name: true,
                                phone: true,
                                email: true,
                            },
                        },
                    },
                },
                rooms: {
                    select: {
                        room_id: true,
                        room_number: true,
                    },
                },
            },
            orderBy: {
                end_date: 'asc', // Show the ones expiring soonest first
            },
        });

        // Format the result for a cleaner API response
        return expiringContracts.map(contract => ({
            contract_id: contract.contract_id,
            start_date: contract.start_date,
            end_date: contract.end_date,
            room: contract.rooms,
            tenant: {
                user_id: contract.tenants.user_id,
                full_name: contract.tenants.users.full_name,
                phone: contract.tenants.users.phone,
                email: contract.tenants.users.email,
                id_number: contract.tenants.id_number,
            },
        }));
    }
    async getTenantsByRoomId(roomId) {
        const pRoomId = parseInt(roomId);

        // Validate
        if (isNaN(pRoomId)) {
            const error = new Error('Invalid Room ID');
            error.statusCode = 400;
            throw error;
        }

        const tenants = await prisma.tenants.findMany({
            where: {
                room_id: pRoomId,
                users: {
                    status: 'Active' // (Tuỳ chọn) Chỉ lấy những người đang Active
                },
                contracts: {
                    none: {} // Lọc những tenant KHÔNG có bất kỳ hợp đồng nào
                }
            },
            include: {
                users: {
                    select: {
                        user_id: true,
                        full_name: true,
                        phone: true,
                        email: true,
                        gender: true,
                        birthday: true,
                        status: true,
                        is_verified: true,
                        avatar_url: true,
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
        });

        // Reuse hàm _formatTenantResult có sẵn để nhất quán data trả về
        return tenants.map(tenant => this._formatTenantResult(tenant));
    }
    async getTenantsByRoomId2(roomId) {
        const pRoomId = parseInt(roomId);

        // Validate
        if (isNaN(pRoomId)) {
            const error = new Error('Invalid Room ID');
            error.statusCode = 400;
            throw error;
        }

        const tenants = await prisma.tenants.findMany({
            where: {
                room_id: pRoomId,
                users: {
                    status: 'Active' // (Tuỳ chọn) Chỉ lấy những người đang Active
                }
            },
            include: {
                users: {
                    select: {
                        user_id: true,
                        full_name: true,
                        phone: true,
                        email: true,
                        gender: true,
                        birthday: true,
                        status: true,
                        is_verified: true,
                        avatar_url: true,
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
        });

        // Reuse hàm _formatTenantResult có sẵn để nhất quán data trả về
        return tenants.map(tenant => this._formatTenantResult(tenant));
    }

    /**
     * Get Rich Context for Chatbot (RAG)
     */
    async getTenantChatbotContext(tenantUserId) {
        // 1. Fetch Tenant Basic Info
        const tenantUser = await prisma.users.findUnique({
            where: { user_id: tenantUserId },
            include: {
                tenants: true // Get tenant specific fields like ID number
            }
        });

        if (!tenantUser || tenantUser.role !== 'TENANT') {
            throw new Error('Tenant not found or invalid role');
        }

        // 2. Fetch Active Residences (Rooms via Contracts or RoomTenants)
        // We use contracts as the primary source for "Active" rentals
        const activeContracts = await prisma.contracts.findMany({
            where: {
                tenant_user_id: tenantUserId,
                status: { in: ['active', 'pending'] },
                deleted_at: null
            },
            include: {
                room_history: { // The room associated with contract
                    include: {
                        building: {
                            include: {
                                building_managers: {
                                    include: { user: { select: { full_name: true, phone: true } } }
                                }
                            }
                        }
                    }
                },
                contract_addendums: {
                    orderBy: { addendum_number: 'desc' }, // Latest addendum
                    take: 1
                }
            }
        });

        // 3. Fetch Global Owners (Backup contact)
        const owners = await prisma.users.findMany({
            where: { role: 'OWNER', status: 'Active' },
            select: { full_name: true, phone: true }
        });

        // 4. Fetch Last 12 Bills (All Types)
        const recentBills = await prisma.bills.findMany({
            where: {
                tenant_user_id: tenantUserId,
                status: { not: 'draft' },
                deleted_at: null
            },
            orderBy: { due_date: 'desc' },
            take: 12,
            select: {
                bill_id: true,
                bill_number: true,
                bill_type: true,
                total_amount: true,
                status: true,
                due_date: true,
                description: true
            }
        });

        // 5. Fetch Maintenance History (All Statuses)
        const maintenanceHistory = await prisma.maintenance_requests.findMany({
            where: {
                tenant_user_id: tenantUserId,
            },
            orderBy: { created_at: 'desc' },
            take: 12, // Increased to 12 as requested
            select: {
                request_id: true,
                title: true,
                status: true,
                priority: true,
                created_at: true,
                updated_at: true,
                room: { select: { room_number: true } }
            }
        });

        // 6. Fetch Vehicle Data (Registrations + Active Vehicles)
        // A. Pending Registrations
        const pendingRegistrations = await prisma.vehicle_registrations.findMany({
            where: {
                requested_by: tenantUserId,
                status: 'requested'
            },
            orderBy: { requested_at: 'desc' },
            select: {
                registration_id: true,
                vehicle_type: true,
                license_plate: true,
                brand: true,
                status: true,
                requested_at: true
            }
        });

        // B. Active Vehicles (Approved & Parking)
        const activeVehicles = await prisma.vehicles.findMany({
            where: {
                tenant_user_id: tenantUserId,
                status: 'active'
            },
            include: {
                slot: { // Include parking slot info
                    include: { building: { select: { name: true } } }
                }
            }
        });

        // --- DATA TRANSFORMATION ---

        // Contacts List (Unique list of Managers + Owners)
        const contactsMap = new Map();

        // Add Owners
        owners.forEach(o => contactsMap.set(o.phone, { name: o.full_name, role: 'Owner', phone: o.phone }));

        // Add Managers from Active Buildings
        activeContracts.forEach(c => {
            const managers = c.room_history?.building?.building_managers || [];
            managers.forEach(m => {
                if (m.user) {
                    contactsMap.set(m.user.phone, { name: m.user.full_name, role: 'Manager', phone: m.user.phone });
                }
            });
        });

        // Format Contracts & Rooms
        const rentedSpaces = activeContracts.map(c => {
            const addendum = c.contract_addendums[0];
            return {
                contract_id: c.contract_id,
                status: c.status,
                room_number: c.room_history?.room_number || "Unknown",
                building_name: c.room_history?.building?.name || "Unknown",
                rent_amount: Number(c.rent_amount),
                end_date: c.end_date, // Or calculate from addendum if needed
                has_active_addendum: !!addendum
            };
        });

        // Time Info
        const now = new Date();
        const vnTime = new Intl.DateTimeFormat('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh',
            dateStyle: 'full',
            timeStyle: 'medium'
        }).format(now);

        const currentHour = parseInt(new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Ho_Chi_Minh',
            hour: 'numeric',
            hour12: false
        }).format(now));

        return {
            meta: {
                query_time: vnTime,
                current_hour: currentHour,
                tenant_name: tenantUser.full_name,
                tenant_id: tenantUser.user_id
            },
            residency: {
                active_contracts_count: activeContracts.length,
                spaces: rentedSpaces
            },
            finance: {
                unpaid_bills_count: recentBills.filter(b => b.status === 'issued' || b.status === 'overdue').length,
                history: recentBills.map(b => ({
                    id: b.bill_id,
                    type: b.bill_type,
                    amount: Number(b.total_amount),
                    status: b.status,
                    due: b.due_date ? b.due_date.toISOString().split('T')[0] : null
                }))
            },
            maintenance: {
                history: maintenanceHistory.map(m => ({
                    id: m.request_id,
                    title: m.title,
                    status: m.status,
                    priority: m.priority,
                    room: m.room?.room_number,
                    created_at: m.created_at ? m.created_at.toISOString().split('T')[0] : null
                }))
            },
            vehicles: {
                pending_registrations: pendingRegistrations,
                active_vehicles: activeVehicles.map(v => ({
                    plate: v.license_plate,
                    brand: v.brand || 'Vehicle',
                    parking_slot: v.slot ? `${v.slot.slot_number} (${v.slot.building?.name})` : 'No Slot Assigned'
                }))
            },
            contacts: Array.from(contactsMap.values())
        };
    }

    async lookupTenantByExactInfo(identifier, buildingId = null) {
        if (!identifier) return null;

        const cleanId = identifier.trim();

        // [UPDATE] Xây dựng điều kiện Where cơ bản
        const whereCondition = {
            OR: [
                { user: { phone: cleanId } },
                { id_number: cleanId }
            ]
        };


        if (buildingId) {
            whereCondition.building_id = parseInt(buildingId);
        }

        const tenant = await prisma.tenants.findFirst({
            where: whereCondition, // Sử dụng điều kiện đã build
            include: {
                user: {
                    select: {
                        user_id: true,
                        full_name: true,
                        phone: true,
                        email: true,
                        gender: true,
                        birthday: true,
                        status: true,
                        is_verified: true,
                        avatar_url: true,
                    }
                },
                room_tenants_history: {
                    where: { is_current: true },
                    take: 1,
                    include: {
                        room: {
                            select: {
                                room_id: true,
                                room_number: true,
                                floor: true,
                                building_id: true,
                                building: { select: { name: true } }
                            }
                        }
                    }
                }
            }
        });

        if (!tenant) return null;

        const currentRoom = tenant.room_tenants_history[0]?.room || null;

        const formattedTenantData = {
            ...tenant,
            users: tenant.user,
            rooms: currentRoom
        };

        return this._formatTenantResult(formattedTenantData);
    }

    async findBestMatchTenant(searchData) {
        const { tenant_name, tenant_phone, tenant_id_number, room_number } = searchData;

        // Validate input
        if (!tenant_name && !tenant_phone && !tenant_id_number && !room_number) {
            const error = new Error('At least one search parameter is required');
            error.statusCode = 400;
            throw error;
        }

        // --- SỬA ĐỔI CHÍNH: Dùng OR thay vì AND để lấy nhiều ứng viên tiềm năng ---
        const orConditions = [];

        // 1. ID Number (Khớp chính xác)
        if (tenant_id_number?.trim()) {
            orConditions.push({
                id_number: { equals: tenant_id_number.trim() }
            });
        }

        // 2. Phone (Tìm kiếm tương đối)
        if (tenant_phone?.trim()) {
            const normalizedInputPhone = tenant_phone.replace(/[\s\-]/g, '');
            orConditions.push({
                users: {
                    phone: { contains: normalizedInputPhone }
                }
            });
        }

        // 3. Name (Tìm kiếm tương đối)
        if (tenant_name?.trim()) {
            orConditions.push({
                users: {
                    full_name: { contains: tenant_name.trim(), mode: 'insensitive' }
                }
            });
        }

        // Lưu ý: Room number thường không dùng làm điều kiện OR chính vì nó không định danh con người,
        // nhưng nếu bạn muốn tìm "người ở phòng X" thì có thể thêm vào, hoặc dùng nó làm bộ lọc phụ (AND).
        // Ở đây tôi để nó tham gia vào việc tìm kiếm ứng viên luôn.
        if (room_number?.trim()) {
            orConditions.push({
                rooms: {
                    room_number: { contains: room_number.trim(), mode: 'insensitive' }
                }
            });
        }

        // Query Database
        const candidates = await prisma.tenants.findMany({
            where: {
                users: { status: 'Active' }, // Luôn bắt buộc Active
                OR: orConditions.length > 0 ? orConditions : undefined
            },
            include: {
                users: {
                    select: {
                        user_id: true,
                        full_name: true,
                        phone: true,
                        // ... các trường khác
                    }
                },
                rooms: {
                    select: {
                        room_id: true,
                        room_number: true
                    }
                }
            },
            // Giới hạn số lượng để tránh query quá nặng nếu data lớn
            take: 20
        });

        if (candidates.length === 0) return null;

        // --- PHẦN TÍNH ĐIỂM (Giữ nguyên logic của bạn, chỉ tinh chỉnh nhỏ) ---
        const scoredCandidates = candidates.map(candidate => {
            let score = 0;
            const matchDetails = {
                id_number_match: false,
                phone_match: false,
                name_match: false,
                room_match: false
            };

            // 1. ID Check
            if (tenant_id_number && candidate.id_number === tenant_id_number.trim()) {
                score += 50;
                matchDetails.id_number_match = true;
            }

            // 2. Phone Check (Chuẩn hóa cả 2 đầu để so sánh chính xác hơn)
            if (tenant_phone && candidate.users.phone) {
                const inputPhone = tenant_phone.replace(/\D/g, ''); // Xóa tất cả ký tự không phải số
                const dbPhone = candidate.users.phone.replace(/\D/g, '');

                // Logic: Nếu số này chứa số kia hoặc ngược lại
                if (inputPhone && dbPhone && (dbPhone.includes(inputPhone) || inputPhone.includes(dbPhone))) {
                    score += 30;
                    matchDetails.phone_match = true;
                }
            }

            // 3. Name Check
            if (tenant_name && candidate.users.full_name) {
                const inputName = tenant_name.trim().toLowerCase();
                const dbName = candidate.users.full_name.toLowerCase();
                if (dbName === inputName) {
                    score += 15;
                    matchDetails.name_match = true;
                } else if (dbName.includes(inputName) || inputName.includes(dbName)) {
                    // Tính điểm partial match đơn giản hơn
                    score += 10;
                    matchDetails.name_match = true;
                }
            }

            // 4. Room Check
            if (room_number && candidate.rooms?.room_number) {
                const inputRoom = room_number.trim().toLowerCase();
                const dbRoom = candidate.rooms.room_number.toLowerCase();
                if(dbRoom.includes(inputRoom) || inputRoom.includes(dbRoom)) {
                    score += 5;
                    matchDetails.room_match = true;
                }
            }

            return { tenant: candidate, score, matchDetails };
        });

        // Sort và lấy kết quả cao nhất
        scoredCandidates.sort((a, b) => b.score - a.score);
        const bestMatch = scoredCandidates[0];

        // Ngưỡng tin cậy: Ví dụ phải khớp ít nhất 1 cái gì đó quan trọng (Score >= 10)
        if (bestMatch.score < 10) return null;

        return {
            ...this._formatTenantResult(bestMatch.tenant),
            _match_metadata: {
                confidence_score: bestMatch.score,
                match_details: bestMatch.matchDetails
            }
        };
    }
    /**
     * Helper method để format kết quả tenant
     */
    _formatTenantResult(tenant) {
        return {
            // User info
            user_id: tenant.users.user_id,
            full_name: tenant.users.full_name,
            phone: tenant.users.phone,
            email: tenant.users.email,
            gender: tenant.users.gender,
            birthday: tenant.users.birthday,
            status: tenant.users.status,
            is_verified: tenant.users.is_verified,
            avatar_url: tenant.users.avatar_url,

            // Tenant info
            id_number: tenant.id_number,
            tenant_since: tenant.tenant_since,
            emergency_contact_phone: tenant.emergency_contact_phone,
            note: tenant.note,

            // Room info
            room: tenant.rooms ? {
                room_id: tenant.rooms.room_id,
                room_number: tenant.rooms.room_number,
                floor: tenant.rooms.floor
            } : null
        };
    }
}
module.exports = new TenantService();
