// Updated: 2025-17-10
// by: MinhBH

const TenantService = require('../services/tenant.service');

class TenantController {
    /**
     * Controller to search only tenants by name.
     */
    async searchTenantsByName(req, res, next) {
        try {
            const { name } = req.query;
            if (!name) {
                return res.status(400).json({
                    success: false,
                    message: 'A name is required',
                });
            }
            const tenants = await TenantService.searchTenantsByName(name);
            res.status(200).json({
                success: true,
                message: 'Tenants retrieved successfully',
                data: tenants,
            });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new TenantController();
