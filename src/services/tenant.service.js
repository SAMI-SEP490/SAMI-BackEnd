// Updated: 2025-18-10
// by: MinhBH

const prisma = require('../config/prisma');

class TenantService {
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

    /**
     * Gets all non-draft/cancelled bills for a specific tenant.
     */
    async getAllTenantBills(tenantUserId) {
        return prisma.bills.findMany({
            where: {
                tenant_user_id: tenantUserId,
                // Exclude templates ('master') and cancelled bills
                status: { notIn: ['master', 'draft', 'cancelled'] },
                deleted_at: null,
            },
            orderBy: {
                billing_period_start: 'desc', // Show most recent first
            },
            select: {
                bill_id: true,
                bill_number: true,
                billing_period_start: true,
                billing_period_end: true,
                due_date: true,
                total_amount: true,
                paid_amount: true,
                penalty_amount: true,
                status: true,
                description: true, 
            }
        });
    }

    /**
     * Gets all unpaid bills for a specific tenant.
     */
    async getAllUnpaidTenantBills(tenantUserId) {
        return prisma.bills.findMany({
            where: {
                tenant_user_id: tenantUserId,
                status: { in: ['issued', 'overdue'] },
                deleted_at: null,
            },
            orderBy: {
                due_date: 'asc', // Show most urgent first
            },
            select: {
                bill_id: true,
                bill_number: true,
                billing_period_start: true,
                billing_period_end: true,
                due_date: true,
                total_amount: true,
                paid_amount: true,
                penalty_amount: true,
                status: true,
                description: true,
            }
        });
    }
}

module.exports = new TenantService();
