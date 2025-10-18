// Updated: 2025-17-10
// by: MinhBH

const prisma = require('../config/prisma');
const { Role } = require('@prisma/client');


class UserService {
    /**
     * Retrieves a list of all users and formats their data.
     * The role is determined dynamically by checking related tables.
     */
    async getAllUsers() {
        const users = await prisma.users.findMany({
            // Select all the user fields you need, plus the related role tables
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
                // Include related models to determine the role and find the note
                building_owner: {
                    select: {
                        notes: true,
                    },
                },
                building_managers: {
                    select: {
                        note: true,
                    },
                },
                tenants: {
                    select: {
                        note: true,
                    },
                },
            },
            orderBy: {
                user_id: 'asc',
            },
        });

        // Map the results to create a clean, flat list with the dynamic role
        const formattedUsers = users.map(user => {
            let role = 'USER'; // Default role
            let note = null;

            // Dynamically determine role and note based on which related table has an entry.
            // The order here matters if a user can have multiple roles (e.g., an owner who is also a manager).
            // We prioritize Owner > Manager > Tenant.
            if (user.building_owner) {
                role = 'OWNER';
                note = user.building_owner.notes;
            } else if (user.building_managers) {
                role = 'MANAGER';
                note = user.building_managers.note;
            } else if (user.tenants) {
                role = 'TENANT';
                note = user.tenants.note;
            }

            // Return a clean object with the determined role and note
            return {
                user_id: user.user_id,
                phone: user.phone,
                email: user.email,
                full_name: user.full_name,
                gender: user.gender,
                birthday: user.birthday,
                status: user.status,
                role, // The dynamically determined role
                created_at: user.created_at,
                updated_at: user.updated_at,
                deleted_at: user.deleted_at,
                note, // The note from the corresponding role table
            };
        });

        return formattedUsers;
    }

    /**
     * Retrieves the details for a single user by their ID.
     * Determines role dynamically and includes tenant-specific details.
     */
    async getUserById(userId) {
        // Find the user and include all relevant role-specific data
        const user = await prisma.users.findUnique({
            where: {
                user_id: userId,
            },
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
                // Select from all potential role tables
                building_owner: {
                    select: {
                        notes: true,
                    },
                },
                building_managers: {
                    select: {
                        note: true,
                    },
                },
                tenants: {
                    select: {
                        note: true,
                        emergency_contact_phone: true, // Specific field for tenant
                    },
                },
            },
        });

        // If no user is found, throw an error
        if (!user) {
            const error = new Error('User not found');
            error.statusCode = 404;
            throw error;
        }

        // Determine role, note, and other role-specific fields
        let role = 'USER';
        let note = null;
        let emergency_contact_phone = null;

        if (user.building_owner) {
            role = 'OWNER';
            note = user.building_owner.notes;
        } else if (user.building_managers) {
            role = 'MANAGER';
            note = user.building_managers.note;
        } else if (user.tenants) {
            role = 'TENANT';
            note = user.tenants.note;
            emergency_contact_phone = user.tenants.emergency_contact_phone;
        }

        // Return the final, formatted object
        return {
            user_id: user.user_id,
            phone: user.phone,
            email: user.email,
            full_name: user.full_name,
            gender: user.gender,
            birthday: user.birthday,
            status: user.status,
            role,
            created_at: user.created_at,
            updated_at: user.updated_at,
            deleted_at: user.deleted_at,
            note,
            emergency_contact_phone, // This will be null for non-tenants
        };
    }

    async searchUsersByName(nameQuery) {
        const users = await prisma.users.findMany({
            where: {
                full_name: {
                    contains: nameQuery,
                    mode: 'insensitive', // Case-insensitive search
                },
            },
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
                // Include related models to determine role and note
                building_owner: { select: { notes: true } },
                building_managers: { select: { note: true } },
                tenants: { select: { note: true } },
            },
            orderBy: {
                full_name: 'asc',
            },
        });

        // Map the results to format the output
        return users.map(user => {
            let role = 'USER';
            let note = null;

            if (user.building_owner) {
                role = 'OWNER';
                note = user.building_owner.notes;
            } else if (user.building_managers) {
                role = 'MANAGER';
                note = user.building_managers.note;
            } else if (user.tenants) {
                role = 'TENANT';
                note = user.tenants.note;
            }

            // Return the clean object
            return {
                user_id: user.user_id,
                phone: user.phone,
                email: user.email,
                full_name: user.full_name,
                gender: user.gender,
                birthday: user.birthday,
                status: user.status,
                role,
                created_at: user.created_at,
                updated_at: user.updated_at,
                deleted_at: user.deleted_at,
                note,
            };
        });
    }

    async softDeleteUser(userId) {
        // First, check if the user exists
        const user = await prisma.users.findUnique({
            where: { user_id: userId },
            select: { deleted_at: true } // Only need to check this field
        });

        if (!user) {
            const error = new Error('User not found');
            error.statusCode = 404;
            throw error;
        }

        // Check if user is already soft-deleted
        if (user.deleted_at) {
            const error = new Error('User is already deleted');
            error.statusCode = 400;
            throw error;
        }

        // Perform the soft delete (which is an update)
        const deletedUser = await prisma.users.update({
            where: {
                user_id: userId,
            },
            data: {
                deleted_at: new Date(),
                status: 'Deleted', // It's good practice to update status as well
            },
            select: {
                user_id: true,
                deleted_at: true,
                status: true
            }
        });

        return deletedUser;
    }

    async restoreUser(userId) {
        // First, check if the user exists
        const user = await prisma.users.findUnique({
            where: { user_id: userId },
            select: { deleted_at: true }
        });

        if (!user) {
            const error = new Error('User not found');
            error.statusCode = 404;
            throw error;
        }

        // Check if user is actually deleted
        if (user.deleted_at === null) {
            const error = new Error('User is not deleted');
            error.statusCode = 400; // 400 Bad Request
            throw error;
        }

        // Perform the restore (which is an update)
        const restoredUser = await prisma.users.update({
            where: {
                user_id: userId,
            },
            data: {
                deleted_at: null,
                status: 'Active', // Set status back to Active
            },
            select: {
                user_id: true,
                deleted_at: true,
                status: true
            }
        });

        return restoredUser;
    }

    async getDeletedUsers() {
        const users = await prisma.users.findMany({
            where: {
                deleted_at: {
                    not: null, // The key filter
                },
            },
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
                // Include related models to determine role and note
                building_owner: { select: { notes: true } },
                building_managers: { select: { note: true } },
                tenants: { select: { note: true } },
            },
            orderBy: {
                deleted_at: 'desc', // Show the most recently deleted first
            },
        });

        // Map the results to format the output
        return users.map(user => {
            let role = 'USER';
            let note = null;

            if (user.building_owner) {
                role = 'OWNER';
                note = user.building_owner.notes;
            } else if (user.building_managers) {
                role = 'MANAGER';
                note = user.building_managers.note;
            } else if (user.tenants) {
                role = 'TENANT';
                note = user.tenants.note;
            }

            // Return the clean object
            return {
                user_id: user.user_id,
                phone: user.phone,
                email: user.email,
                full_name: user.full_name,
                gender: user.gender,
                birthday: user.birthday,
                status: user.status,
                role,
                created_at: user.created_at,
                updated_at: user.updated_at,
                deleted_at: user.deleted_at,
                note,
            };
        });
    }

    /**
     * Change user to TENANT role
     */
    async changeToTenant(data) {
        const { userId, idNumber, emergencyContactPhone, note } = data;

        // Check if user exists
        const user = await prisma.users.findUnique({
            where: { user_id: userId }
        });

        if (!user) {
            throw new AppError('User not found');
        }

        // Check if already a tenant
        const existingTenant = await prisma.tenants.findUnique({
            where: { user_id: userId }
        });

        if (existingTenant) {
            throw new AppError('User is already a tenant');
        }

        // Update user role and create tenant record in transaction
        const result = await prisma.$transaction(async (tx) => {
            // Update user role
            const updatedUser = await tx.users.update({
                where: { user_id: userId },
                data: {
                    role: Role.TENANT,
                    updated_at: new Date()
                }
            });

            // Create tenant record
            const tenant = await tx.tenants.create({
                data: {
                    user_id: userId,
                    id_number: idNumber,
                    emergency_contact_phone: emergencyContactPhone,
                    tenant_since: new Date(),
                    note
                }
            });

            return { updatedUser, tenant };
        });

        return {
            userId: result.updatedUser.user_id,
            role: result.updatedUser.role,
            tenantInfo: {
                idNumber: result.tenant.id_number,
                tenantSince: result.tenant.tenant_since
            }
        };
    }

    /**
     * Change user to MANAGER role
     */
    async changeToManager(data) {
        const { userId, buildingId, assignedFrom, assignedTo, note } = data;

        // Check if user exists
        const user = await prisma.users.findUnique({
            where: { user_id: userId }
        });

        if (!user) {
            throw new AppError('User not found');
        }

        // Check if building exists
        const building = await prisma.buildings.findUnique({
            where: { building_id: buildingId }
        });

        if (!building) {
            throw new AppError('Building not found');
        }

        // Check if already a manager for this building
        const existingManager = await prisma.building_managers.findUnique({
            where: { user_id: userId }
        });

        if (existingManager) {
            throw new AppError('User is already a manager');
        }

        // Update user role and create manager record in transaction
        const result = await prisma.$transaction(async (tx) => {
            // Update user role
            const updatedUser = await tx.users.update({
                where: { user_id: userId },
                data: {
                    role: Role.MANAGER,
                    updated_at: new Date()
                }
            });

            // Create building manager record
            const manager = await tx.building_managers.create({
                data: {
                    user_id: userId,
                    building_id: buildingId,
                    assigned_from: assignedFrom || new Date(),
                    assigned_to: assignedTo || null,
                    note
                }
            });

            return { updatedUser, manager };
        });

        return {
            userId: result.updatedUser.user_id,
            role: result.updatedUser.role,
            managerInfo: {
                buildingId: result.manager.building_id,
                assignedFrom: result.manager.assigned_from,
                assignedTo: result.manager.assigned_to
            }
        };
    }

}

module.exports = new UserService();
