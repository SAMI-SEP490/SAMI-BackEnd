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

    async getTenantChatbotContext(tenantUserId) {
        // 1. Find owners (Global contacts)
        const owners = await prisma.users.findMany({
            where: { role: 'OWNER', deleted_at: null },
            select: { full_name: true, phone: true }
        });
        
        // 2. Find tenant and all related data
        const tenantInfo = await prisma.tenants.findUnique({
            where: { user_id: tenantUserId },
            include: {
                users: { select: { full_name: true, user_id: true, gender: true, birthday: true } },
                
                // --- Bill History (Last 12 items) ---
                bills: {
                    where: { 
                        deleted_at: null,
                        status: { not: 'draft' } // Exclude drafts, keep everything else
                    },
                    select: { 
                        bill_id: true, 
                        bill_number: true, 
                        due_date: true, 
                        total_amount: true, 
                        penalty_amount: true, 
                        description: true,
                        status: true // Need status to tell Paid vs Unpaid
                    },
                    orderBy: { billing_period_start: 'desc' }, // Newest first
                    take: 12 // Limit to last 1 year
                },
                // -------------------------------------------------

                // Direct Room Link
                rooms: {
                    select: {
                        room_id: true,
                        room_number: true,
                        buildings: {
                            select: {
                                name: true,
                                // Get managers for this specific building
                                building_managers: {
                                    include: { users: { select: { full_name: true, phone: true } } }
                                }
                            }
                        }
                    }
                },

                // --- Active Contract with Addendums ---
                contracts: {
                    where: { 
                        // Fetch 'active' OR 'pending' (e.g. renewal pending)
                        status: { in: ['active', 'pending'] }, 
                        deleted_at: null 
                    },
                    // We need 'include' (or select) to get addendums + s3_key
                    select: {
                        contract_id: true,
                        start_date: true,
                        end_date: true,
                        rent_amount: true,
                        deposit_amount: true,
                        status: true,
                        s3_key: true, // Need this to check if PDF exists
                        contract_addendums: {
                            orderBy: { version: 'desc' },
                            take: 1,
                            select: { summary: true, changes: true }
                        }
                    },
                    orderBy: { created_at: 'desc' },
                    take: 1
                },
                // ------------------------------------------------

                // Pending Maintenance
                maintenance_requests: {
                    where: { status: { in: ['pending', 'in_progress'] } },
                    select: { request_id: true, title: true, status: true, created_at: true },
                    orderBy: { created_at: 'desc' }
                },

                // Vehicle Registrations
                vehicle_registration: {
                    where: { status: { in: ['requested', 'rejected'] } },
                    select: { assignment_id: true, status: true, reason: true, requested_at: true },
                    orderBy: { requested_at: 'desc' }
                },

                // Active Vehicles
                vehicles: {
                    where: { deactivated_at: null, status: 'active' }, 
                    select: { vehicle_id: true, type: true, license_plate: true, brand: true, color: true, status: true },
                    orderBy: { registered_at: 'desc' }
                }
            }
        });

        if (!tenantInfo) {
            const error = new Error('Tenant not found');
            error.statusCode = 404;
            throw error;
        }

        // --- FORMAT DATA FOR AI ---
        
        // 1. Bill History
        const bill_history = tenantInfo.bills.map(bill => ({
            bill_id: bill.bill_id,
            bill_number: bill.bill_number || `ID: ${bill.bill_id}`,
            description: bill.description,
            total_due: (Number(bill.total_amount) || 0) + (Number(bill.penalty_amount) || 0),
            status: bill.status, 
            due_date: bill.due_date
        }));

        // 2. UPDATED: Contract Info
        let active_contract = null;
        if (tenantInfo.contracts.length > 0) {
            const c = tenantInfo.contracts[0];
            const latestAddendum = c.contract_addendums[0];

            // Calculate effective end date if addendum changed it
            // Assuming 'changes' JSON might contain { new_end_date: "..." }
            const addendumEndDate = latestAddendum?.changes?.new_end_date;

            active_contract = {
                contract_id: c.contract_id,
                start_date: c.start_date,
                original_end_date: c.end_date,
                current_end_date: addendumEndDate ? new Date(addendumEndDate) : c.end_date,
                rent_amount: Number(c.rent_amount),
                deposit_amount: Number(c.deposit_amount),
                status: c.status,
                has_file: !!c.s3_key, // True if PDF exists
                addendum_note: latestAddendum ? `Có phụ lục: ${latestAddendum.summary}` : null
            };
        }

        // 3. Contacts
        const contacts = [];
        if (tenantInfo.rooms?.buildings?.building_managers) {
            tenantInfo.rooms.buildings.building_managers.forEach(mgr => {
                contacts.push({ role: 'Manager', name: mgr.users.full_name, phone: mgr.users.phone });
            });
        }
        owners.forEach(owner => {
            contacts.push({ role: 'Owner', name: owner.full_name, phone: owner.phone });
        });
        
        // 4. Maintenance
        const pending_maintenance = tenantInfo.maintenance_requests.map(req => ({
            request_id: req.request_id,
            title: req.title,
            status: req.status,
            created_at: req.created_at
        }));

        // 5. Pending Registrations
        const pending_registrations = tenantInfo.vehicle_registration.map(reg => {
            let info = {};
            try { info = JSON.parse(reg.reason || '{}'); } catch (e) { info = { note: "Error parsing" }; }
            return {
                registration_id: reg.assignment_id,
                status: reg.status,
                requested_at: reg.requested_at,
                type: info.type,
                license_plate: info.license_plate,
                brand: info.brand,
                color: info.color
            };
        });
        
        // 6. Active Vehicles
        const active_vehicles = tenantInfo.vehicles.map(v => ({
            vehicle_id: v.vehicle_id,
            type: v.type,
            license_plate: v.license_plate,
            brand: v.brand,
            color: v.color,
            status: v.status
        }));

        // Calculate age
        const birthDate = tenantInfo.users.birthday ? new Date(tenantInfo.users.birthday) : new Date();
        const age = new Date().getFullYear() - birthDate.getFullYear();

        // --- FINAL JSON RESPONSE ---
        return {
            tenant_user_id: tenantInfo.users.user_id,
            tenant_name: tenantInfo.users.full_name,
            tenant_gender: tenantInfo.users.gender,
            tenant_age: age,
            room_id: tenantInfo.room_id,
            room_number: tenantInfo.rooms?.room_number || "N/A",
            building_name: tenantInfo.rooms?.buildings?.name || "N/A",
            current_date: new Date().toISOString(),
            bill_history: bill_history,             
            contract_info: active_contract, // Renamed to match Dify Schema
            contacts: contacts,
            pending_maintenance: pending_maintenance,
            pending_vehicle_registrations: pending_registrations,
            active_vehicles: active_vehicles
        };
    }

    async findBestMatchTenant(searchData) {
        const { tenant_name, tenant_phone, tenant_id_number, room_number } = searchData;

        // Validate: Cần ít nhất 1 thông tin để tìm kiếm
        if (!tenant_name && !tenant_phone && !tenant_id_number && !room_number) {
            const error = new Error('At least one search parameter is required');
            error.statusCode = 400;
            throw error;
        }

        // Build dynamic where conditions
        const whereConditions = {
            AND: [],
            users: {
                status: 'Active' // Chỉ lấy tenant có status active
            }
        };

        // 1. ID Number - Độ ưu tiên cao nhất (unique identifier)
        if (tenant_id_number && tenant_id_number.trim()) {
            whereConditions.AND.push({
                id_number: {
                    equals: tenant_id_number.trim()
                }
            });
        }

        // 2. Phone - Độ ưu tiên cao (thường unique)
        if (tenant_phone && tenant_phone.trim()) {
            // Chuẩn hóa số điện thoại (bỏ dấu cách, dấu gạch ngang)
            const normalizedPhone = tenant_phone.replace(/[\s\-]/g, '');
            whereConditions.AND.push({
                users: {
                    phone: {
                        contains: normalizedPhone
                    }
                }
            });
        }

        // 3. Name - Tìm kiếm linh hoạt (case-insensitive, partial match)
        if (tenant_name && tenant_name.trim()) {
            whereConditions.AND.push({
                users: {
                    full_name: {
                        contains: tenant_name.trim(),
                        mode: 'insensitive'
                    }
                }
            });
        }

        // 4. Room Number - Có thể không chính xác nên dùng để lọc/scoring
        if (room_number && room_number.trim()) {
            const normalizedRoomNumber = room_number.trim().toUpperCase();
            whereConditions.AND.push({
                rooms: {
                    room_number: {
                        contains: normalizedRoomNumber,
                        mode: 'insensitive'
                    }
                }
            });
        }

        // Nếu không có điều kiện AND nào, chỉ lọc theo status active
        const finalWhere = whereConditions.AND.length > 0
            ? whereConditions
            : { users: { status: 'Active' } };

        // Query database
        const candidates = await prisma.tenants.findMany({
            where: finalWhere,
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
                        avatar_url: true
                    }
                },
                rooms: {
                    select: {
                        room_id: true,
                        room_number: true,
                        floor: true
                    }
                },

            }
        });

        // Không tìm thấy kết quả nào
        if (candidates.length === 0) {
            return null;
        }

        // Nếu chỉ có 1 kết quả, trả về luôn
        if (candidates.length === 1) {
            return this._formatTenantResult(candidates[0]);
        }

        // Có nhiều kết quả -> Tính điểm để chọn kết quả tốt nhất
        const scoredCandidates = candidates.map(candidate => {
            let score = 0;
            const matchDetails = {
                id_number_match: false,
                phone_match: false,
                name_match: false,
                room_match: false
            };

            // 1. ID Number match (50 điểm - quan trọng nhất)
            if (tenant_id_number && candidate.id_number === tenant_id_number.trim()) {
                score += 50;
                matchDetails.id_number_match = true;
            }

            // 2. Phone match (30 điểm - rất quan trọng)
            if (tenant_phone && candidate.users.phone) {
                const normalizedInputPhone = tenant_phone.replace(/[\s\-]/g, '');
                const normalizedDbPhone = candidate.users.phone.replace(/[\s\-]/g, '');

                if (normalizedDbPhone.includes(normalizedInputPhone) ||
                    normalizedInputPhone.includes(normalizedDbPhone)) {
                    score += 30;
                    matchDetails.phone_match = true;
                }
            }

            // 3. Name match (15 điểm - có thể có lỗi chính tả)
            if (tenant_name && candidate.users.full_name) {
                const inputName = tenant_name.trim().toLowerCase();
                const dbName = candidate.users.full_name.toLowerCase();

                // Exact match
                if (dbName === inputName) {
                    score += 15;
                    matchDetails.name_match = true;
                }
                // Partial match (tính điểm theo % khớp)
                else if (dbName.includes(inputName) || inputName.includes(dbName)) {
                    const similarity = Math.min(inputName.length, dbName.length) /
                        Math.max(inputName.length, dbName.length);
                    score += Math.round(15 * similarity);
                    matchDetails.name_match = true;
                }
            }

            // 4. Room number match (5 điểm - thông tin phụ)
            if (room_number && candidate.rooms) {
                const normalizedInput = room_number.trim().toUpperCase();
                const normalizedRoom = candidate.rooms.room_number.toUpperCase();

                if (normalizedRoom.includes(normalizedInput) ||
                    normalizedInput.includes(normalizedRoom)) {
                    score += 5;
                    matchDetails.room_match = true;
                }
            }

            return {
                tenant: candidate,
                score,
                matchDetails
            };
        });

        // Sắp xếp theo điểm giảm dần
        scoredCandidates.sort((a, b) => b.score - a.score);

        // Lấy kết quả tốt nhất
        const bestMatch = scoredCandidates[0];

        // Kiểm tra ngưỡng tin cậy (tùy chọn)
        // Nếu điểm quá thấp (< 30), có thể cảnh báo
        const confidenceThreshold = 30;
        const isHighConfidence = bestMatch.score >= confidenceThreshold;

        return {
            ...this._formatTenantResult(bestMatch.tenant),
            // Thêm metadata về độ tin cậy
            _match_metadata: {
                confidence_score: bestMatch.score,
                max_possible_score: 100,
                is_high_confidence: isHighConfidence,
                match_details: bestMatch.matchDetails,
                total_candidates_found: candidates.length
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
