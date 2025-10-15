// Updated: 2025-16-10
// by: DatNB

const prisma = require('../config/prisma');
const { Role } = require('@prisma/client');


class UserRoleService {
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

module.exports = new UserRoleService();