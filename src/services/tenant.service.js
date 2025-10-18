// Updated: 2025-17-10
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
                // Include the user data we want to return
                users: {
                    select: {
                        user_id: true,
                        phone: true,
                        email: true,
                        full_name: true,
                        gender: true,
                        birthday: true,
                        status: true,
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
            created_at: tenant.users.created_at,
            updated_at: tenant.users.updated_at,
            deleted_at: tenant.users.deleted_at,
            note: tenant.note, // Get the note directly from the tenant record
        }));
    }
}

module.exports = new TenantService();
