// Updated: 2025-16-10
// by: DatNB

const UserService = require('../services/user.service.service');

class UserController {
    async changeToTenant(req, res, next) {
        try {
            const result = await UserService.changeToTenant(req.body);

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



}

module.exports = new UserController();