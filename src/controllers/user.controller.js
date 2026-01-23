// Updated: 2025-18-10
// by: DatNB & MinhBH

const UserService = require('../services/user.service');

class UserController {
    async getAllUsers(req, res, next) {
  try {
    const users = await UserService.getAllUsers(req.user.user_id);

    res.status(200).json({
      success: true,
      data: users,
    });
  } catch (err) {
    next(err);
  }
}
async getActiveTenants(req, res, next) {
  try {
    const tenants = await UserService.getActiveTenants(req.user.user_id);

    res.status(200).json({
      success: true,
      data: tenants,
    });
  } catch (err) {
    next(err);
  }
}

    async getUserById(req, res, next) {
        try {
            const userId = parseInt(req.params.id, 10);

            // Basic validation for the ID
            if (isNaN(userId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid User ID provided',
                });
            }

            const user = await UserService.getUserById(userId);

            res.status(200).json({
                success: true,
                message: 'User details retrieved successfully',
                data: user,
            });
        } catch (err) {
            next(err);
        }
    }

    async searchUsersByName(req, res, next) {
        try {
            const { name } = req.query;
            if (!name) {
                return res.status(400).json({
                    success: false,
                    message: 'A name is required',
                });
            }
            const users = await UserService.searchUsersByName(name);
            res.status(200).json({
                success: true,
                message: 'Users retrieved successfully',
                data: users,
            });
        } catch (err) {
            next(err);
        }
    }

    async softDeleteUser(req, res, next) {
        try {
            const targetUserId = parseInt(req.params.id, 10);
            const requestingUserId = req.user.user_id;

            if (isNaN(targetUserId)) {
                return res.status(400).json({ /* ... */ });
            }

            const result = await UserService.softDeleteUser(targetUserId, requestingUserId);

            res.status(200).json({
                success: true,
                message: 'User soft-deleted successfully',
                data: result,
            });
        } catch (err) {
            next(err);
        }
    }

    async restoreUser(req, res, next) {
        try {
            const targetUserId = parseInt(req.params.id, 10);
            const requestingUserId = req.user.user_id;

            if (isNaN(targetUserId)) {
                return res.status(400).json({ /* ... */ });
            }

            const result = await UserService.restoreUser(targetUserId, requestingUserId);

            res.status(200).json({
                success: true,
                message: 'User restored successfully',
                data: result,
            });
        } catch (err) {
            next(err);
        }
    }

    async getDeletedUsers(req, res, next) {
        try {
            const requestingUserId = req.user.user_id;
            const users = await UserService.getDeletedUsers(requestingUserId);
            
            res.status(200).json({
                success: true,
                message: 'Deleted users retrieved successfully',
                data: users,
            });
        } catch (err) {
            next(err);
        }
    }

    async changeToTenant(req, res, next) {
        try {
            const result = await UserService.changeToTenant(req.body);
console.log(req.body);
            res.status(200).json({
                success: true,
                message: 'User role changed to TENANT successfully',
                data: result
            });
        } catch (err) {
            next(err);
        }
    }

    async changeToManager(req, res, next) {
        try {
            const result = await UserService.changeToManager(req.body);

            res.status(200).json({
                success: true,
                message: 'User role changed to MANAGER successfully',
                data: result
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Controller to update user details by ID.
     */
    async updateUser(req, res, next) {
        try {
            const targetUserId = parseInt(req.params.id, 10);
            const requestingUserId = req.user.user_id;

            if (isNaN(targetUserId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid User ID provided',
                });
            }

            const result = await UserService.updateUser(targetUserId, requestingUserId, req.body);

            res.status(200).json({
                success: true,
                message: 'User updated successfully',
                data: result,
            });
        } catch (err) {
            next(err);
        }
    }

}

module.exports = new UserController();