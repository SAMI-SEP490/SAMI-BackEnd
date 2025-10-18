// Updated: 2025-17-10
// by: MinhBH

const prisma = require('../config/prisma');
const { Role } = require('@prisma/client');


class UserService {
    /**
     * SYNCHRONOUS helper to get the correct note from a user object
     */
    _determineNoteFromUserObject(user) {
        if (!user) return null;
        if (user.building_owner) return user.building_owner.notes;
        if (user.building_managers) return user.building_managers.note;
        if (user.tenants) return user.tenants.note;
        return null;
    }

    /**
     * ASYNC helper to get a user's role string by ID.
     */
    async _getUserRole(userId) {
        const user = await prisma.users.findUnique({
            where: { user_id: userId },
            select: { role: true },
        });
        if (!user) return null;
        return user.role;
    }

    /**
     * Retrieves a list of all users.
     */
    async getAllUsers() {
        const users = await prisma.users.findMany({
            select: {
                user_id: true,
                phone: true,
                email: true,
                full_name: true,
                gender: true,
                birthday: true,
                status: true,
                role: true,
                is_verified: true,
                created_at: true,
                updated_at: true,
                deleted_at: true,
                // Relations still needed for the note
                building_owner: { select: { notes: true } },
                building_managers: {
                    select: {
                        note: true,
                        building_id: true,
                        assigned_from: true,
                        assigned_to: true,
                    },
                },
                tenants: {
                    select: {
                        note: true,
                        tenant_since: true,
                        id_number: true,
                    },
                },
            },
            orderBy: {
                user_id: 'asc',
            },
        });

        return users.map(user => {
            const userObject = {
                user_id: user.user_id,
                phone: user.phone,
                email: user.email,
                full_name: user.full_name,
                gender: user.gender,
                birthday: user.birthday,
                status: user.status,
                role: user.role,
                is_verified: user.is_verified,
                created_at: user.created_at,
                updated_at: user.updated_at,
                deleted_at: user.deleted_at,
                note: this._determineNoteFromUserObject(user),
                tenant_since: null,
                id_number: null,
                building_id: null,
                assigned_from: null,
                assigned_to: null,
            };

            // Add role-specific info
            if (user.role === 'TENANT' && user.tenants) {
                userObject.tenant_since = user.tenants.tenant_since;
                userObject.id_number = user.tenants.id_number;
            } else if (user.role === 'MANAGER' && user.building_managers) {
                userObject.building_id = user.building_managers.building_id;
                userObject.assigned_from = user.building_managers.assigned_from;
                userObject.assigned_to = user.building_managers.assigned_to;
            }

            return userObject;
        });
    }

    /**
     * Retrieves the details for a single user by their ID.
     */
    async getUserById(userId) {
        const user = await prisma.users.findUnique({
            where: { user_id: userId },
            select: {
                user_id: true,
                phone: true,
                email: true,
                full_name: true,
                gender: true,
                birthday: true,
                status: true,
                role: true,
                is_verified: true,
                created_at: true,
                updated_at: true,
                deleted_at: true,
                // Relations still needed for note/emergency contact
                building_owner: { select: { notes: true } },
                building_managers: {
                    select: {
                        note: true,
                        building_id: true,
                        assigned_from: true,
                        assigned_to: true,
                    },
                },
                tenants: {
                    select: {
                        note: true,
                        emergency_contact_phone: true,
                        tenant_since: true,
                        id_number: true,
                    },
                },
            },
        });

        if (!user) {
            throw new Error('User not found');
        }

        const userObject = {
            user_id: user.user_id,
            phone: user.phone,
            email: user.email,
            full_name: user.full_name,
            gender: user.gender,
            birthday: user.birthday,
            status: user.status,
            role: user.role,
            is_verified: user.is_verified,
            created_at: user.created_at,
            updated_at: user.updated_at,
            deleted_at: user.deleted_at,
            note: this._determineNoteFromUserObject(user),
            emergency_contact_phone: null,
            tenant_since: null,
            id_number: null,
            building_id: null,
            assigned_from: null,
            assigned_to: null,
        };

        // Add role-specific info
        if (user.role === 'TENANT' && user.tenants) {
            userObject.emergency_contact_phone = user.tenants.emergency_contact_phone;
            userObject.tenant_since = user.tenants.tenant_since;
            userObject.id_number = user.tenants.id_number;
        } else if (user.role === 'MANAGER' && user.building_managers) {
            userObject.building_id = user.building_managers.building_id;
            userObject.assigned_from = user.building_managers.assigned_from;
            userObject.assigned_to = user.building_managers.assigned_to;
        }

        return userObject;
    }

    /**
     * Searches all users by full_name.
     */
    async searchUsersByName(nameQuery) {
        const users = await prisma.users.findMany({
            where: {
                full_name: {
                    contains: nameQuery,
                    mode: 'insensitive',
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
                role: true,
                is_verified: true,
                created_at: true,
                updated_at: true,
                deleted_at: true,
                // Relations still needed for the note
                building_owner: { select: { notes: true } },
                building_managers: {
                    select: {
                        note: true,
                        building_id: true,
                        assigned_from: true,
                        assigned_to: true,
                    },
                },
                tenants: {
                    select: {
                        note: true,
                        tenant_since: true,
                        id_number: true,
                    },
                },
            },
            orderBy: {
                full_name: 'asc',
            },
        });

        return users.map(user => {
            const userObject = {
                user_id: user.user_id,
                phone: user.phone,
                email: user.email,
                full_name: user.full_name,
                gender: user.gender,
                birthday: user.birthday,
                status: user.status,
                role: user.role,
                is_verified: user.is_verified,
                created_at: user.created_at,
                updated_at: user.updated_at,
                deleted_at: user.deleted_at,
                note: this._determineNoteFromUserObject(user),
                tenant_since: null,
                id_number: null,
                building_id: null,
                assigned_from: null,
                assigned_to: null,
            };

            // Add role-specific info
            if (user.role === 'TENANT' && user.tenants) {
                userObject.tenant_since = user.tenants.tenant_since;
                userObject.id_number = user.tenants.id_number;
            } else if (user.role === 'MANAGER' && user.building_managers) {
                userObject.building_id = user.building_managers.building_id;
                userObject.assigned_from = user.building_managers.assigned_from;
                userObject.assigned_to = user.building_managers.assigned_to;
            }

            return userObject;
        });
    }


    /**
     * Soft-deletes a user, with permissions.
     */
    async softDeleteUser(targetUserId, requestingUserId) {
        const requestingUserRole = await this._getUserRole(requestingUserId);
        const targetUserRole = await this._getUserRole(targetUserId);

        if (!targetUserRole) {
            throw new Error('User not found');
        }

        // Only handle tenant if user is MANAGER
        if (requestingUserRole === 'MANAGER' && targetUserRole !== 'TENANT') {
            const error = new Error('Managers can only delete tenant accounts');
            error.statusCode = 403;
            throw error;
        }

        const targetUser = await prisma.users.findUnique({
            where: { user_id: targetUserId },
            select: { deleted_at: true },
        });

        if (targetUser.deleted_at) {
            const error = new Error('User is already deleted');
            error.statusCode = 400;
            throw error;
        }

        const deletedUser = await prisma.users.update({
            where: { user_id: targetUserId },
            data: {
                deleted_at: new Date(),
                status: 'Deleted',
            },
            select: { user_id: true, deleted_at: true, status: true },
        });

        return deletedUser;
    }

    /**
     * Restores a soft-deleted user, with permissions.
     */
    async restoreUser(targetUserId, requestingUserId) {
        const requestingUserRole = await this._getUserRole(requestingUserId);
        const targetUserRole = await this._getUserRole(targetUserId);

        if (!targetUserRole) {
            throw new Error('User not found');
        }

        // Only handle tenant if user is MANAGER
        if (requestingUserRole === 'MANAGER' && targetUserRole !== 'TENANT') {
            const error = new Error('Managers can only restore tenant accounts');
            error.statusCode = 403;
            throw error;
        }

        const targetUser = await prisma.users.findUnique({
            where: { user_id: targetUserId },
            select: { deleted_at: true },
        });

        if (targetUser.deleted_at === null) {
            const error = new Error('User is not deleted');
            error.statusCode = 400;
            throw error;
        }

        const restoredUser = await prisma.users.update({
            where: { user_id: targetUserId },
            data: {
                deleted_at: null,
                status: 'Active',
            },
            select: { user_id: true, deleted_at: true, status: true },
        });

        return restoredUser;
    }

    /**
     * Retrieves a list of all soft-deleted users, with permissions.
     */
    async getDeletedUsers(requestingUserId) {
        const requestingUserRole = await this._getUserRole(requestingUserId);

        let whereClause = {
            deleted_at: { not: null },
        };

        // Only handle tenant if user is MANAGER
        if (requestingUserRole === 'MANAGER') {
            whereClause.role = 'TENANT';
        }

        const users = await prisma.users.findMany({
            where: whereClause,
            select: {
                user_id: true,
                phone: true,
                email: true,
                full_name: true,
                gender: true,
                birthday: true,
                status: true,
                role: true,
                is_verified: true,
                created_at: true,
                updated_at: true,
                deleted_at: true,
                // Relations still needed for the note
                building_owner: { select: { notes: true } },
                building_managers: {
                    select: {
                        note: true,
                        building_id: true,
                        assigned_from: true,
                        assigned_to: true,
                    },
                },
                tenants: {
                    select: {
                        note: true,
                        tenant_since: true,
                        id_number: true,
                    },
                },
            },
            orderBy: {
                deleted_at: 'desc',
            },
        });

        return users.map(user => {
            const userObject = {
                user_id: user.user_id,
                phone: user.phone,
                email: user.email,
                full_name: user.full_name,
                gender: user.gender,
                birthday: user.birthday,
                status: user.status,
                role: user.role,
                is_verified: user.is_verified,
                created_at: user.created_at,
                updated_at: user.updated_at,
                deleted_at: user.deleted_at,
                note: this._determineNoteFromUserObject(user),
                tenant_since: null,
                id_number: null,
                building_id: null,
                assigned_from: null,
                assigned_to: null,
            };

            // Add role-specific info
            if (user.role === 'TENANT' && user.tenants) {
                userObject.tenant_since = user.tenants.tenant_since;
                userObject.id_number = user.tenants.id_number;
            } else if (user.role === 'MANAGER' && user.building_managers) {
                userObject.building_id = user.building_managers.building_id;
                userObject.assigned_from = user.building_managers.assigned_from;
                userObject.assigned_to = user.building_managers.assigned_to;
            }

            return userObject;
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
