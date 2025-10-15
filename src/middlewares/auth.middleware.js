// Updated: 2024-12-10
// by: DatNB

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
const ROLE_MAP = {
    owner: 'OWNER',
    manager: 'MANAGER',
    tenant: 'TENANT',
    user: 'USER'
};
function normalizeRoleInput(input) {
    if (!input) return [];
    const arr = Array.isArray(input) ? input : [input];
    return arr
        .map(r => String(r).trim().toLowerCase())
        .map(r => ROLE_MAP[r] || r.toUpperCase());
}

const requireRole = (roles) => {
    const allowedRoles = normalizeRoleInput(roles);

    return async (req, res, next) => {
        try {
            const userId = req.user && req.user.user_id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthenticated'
                });
            }

            // Lấy role thực tế từ DB để tránh bị giả mạo từ client token
            const user = await prisma.users.findUnique({
                where: { user_id: userId },
                select: { role: true }
            });

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: 'User not found'
                });
            }

            const userRole = (user.role || 'USER').toString().toUpperCase();

            // Nếu allowedRoles rỗng => không giới hạn, hoặc nếu có 'ANY' trong allowedRoles thì cho qua
            if (allowedRoles.length === 0 || allowedRoles.includes('ANY')) {
                return next();
            }

            if (allowedRoles.includes(userRole)) {
                return next();
            }

            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions'
            });
        } catch (err) {
            console.error('Authorization error:', err);
            return res.status(500).json({
                success: false,
                message: 'Authorization error'
            });
        }
    };
};

module.exports = {
    authenticate,
    requireRole
};