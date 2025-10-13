// src/middlewares/auth.middleware.js

const { verifyAccessToken } = require('../utils/jwt');
const prisma = require('../config/prisma');

const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'No token provided'
            });
        }

        const token = authHeader.substring(7);
        const decoded = verifyAccessToken(token);

        if (!decoded) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }

        const user = await prisma.users.findUnique({
            where: { user_id: decoded.userId },
            select: {
                user_id: true,
                email: true,
                phone: true,
                full_name: true,
                gender: true,
                birthday: true,
                avatar_url: true,
                status: true,
                deleted_at: true
            }
        });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'User not found'
            });
        }

        if (user.deleted_at) {
            return res.status(403).json({
                success: false,
                message: 'Account has been deleted'
            });
        }

        if (user.status !== 'Active') {
            return res.status(403).json({
                success: false,
                message: 'Account is not active'
            });
        }

        req.user = user;
        next();
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: 'Authentication error'
        });
    }
};

const requireRole = (roles) => {
    return async (req, res, next) => {
        try {
            const userId = req.user.user_id;

            // Check if user has any of the required roles
            const hasRole = await checkUserRole(userId, roles);

            if (!hasRole) {
                return res.status(403).json({
                    success: false,
                    message: 'Insufficient permissions'
                });
            }

            next();
        } catch (err) {
            return res.status(500).json({
                success: false,
                message: 'Authorization error'
            });
        }
    };
};

// Helper function to check user roles based on schema tables
async function checkUserRole(userId, roles) {
    for (const role of roles) {
        switch (role) {
            case 'owner':
                const owner = await prisma.building_owner.findUnique({
                    where: { user_id: userId }
                });
                if (owner) return true;
                break;

            case 'manager':
                const manager = await prisma.building_managers.findFirst({
                    where: { user_id: userId }
                });
                if (manager) return true;
                break;

            case 'tenant':
                const tenant = await prisma.tenants.findUnique({
                    where: { user_id: userId }
                });
                if (tenant) return true;
                break;

            default:
                break;
        }
    }
    return false;
}

module.exports = {
    authenticate,
    requireRole
};