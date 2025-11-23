// Updated: 2025-23-11
// by: MinhBH

const TenantService = require('../services/tenant.service');

class TenantController {
    /**
     * Get a list of all tenants.
     */
    async getAllTenants(req, res, next) {
        try {
            const tenants = await TenantService.getAllTenants();
            res.status(200).json({
                success: true,
                message: 'Tenants retrieved successfully',
                data: tenants
            });
        } catch (err) {
            next(err);
        }
    }

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

    /**
     * Get occupancy analytics (vacant, occupied, rate).
     */
    async getOccupancyAnalytics(req, res, next) {
        try {
            const data = await TenantService.getOccupancyAnalytics();
            res.status(200).json({
                success: true,
                message: 'Occupancy analytics retrieved successfully',
                data: data,
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Get tenant count grouped by gender.
     */
    async getTenantGenderDistribution(req, res, next) {
        try {
            const data = await TenantService.getTenantGenderDistribution();
            res.status(200).json({
                success: true,
                message: 'Tenant gender distribution retrieved successfully',
                data: data,
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Get tenant count grouped by age.
     */
    async getTenantAgeDistribution(req, res, next) {
        try {
            const data = await TenantService.getTenantAgeDistribution();
            res.status(200).json({
                success: true,
                message: 'Tenant age distribution retrieved successfully',
                data: data,
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Get list of contracts expiring in the next 30 days.
     */
    async getExpiringContracts(req, res, next) {
        try {
            const data = await TenantService.getContractExpiredFor1Month();
            res.status(200).json({
                success: true,
                message: 'Expiring contracts retrieved successfully',
                data: data,
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Endpoint for the AI agent to get tenant context.
     */
    async getTenantChatbotContext(req, res, next) {
        try {
            // req.user.user_id comes from your 'authenticate' middleware
            const context = await TenantService.getTenantChatbotContext(req.user.user_id);
            res.status(200).json({ success: true, data: context });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Same thing but using the API key auth
     */
    async getTenantContextByBot(req, res, next) {
        try {
            // 1. Extract user ID from Query Params
            const { tenant_user_id } = req.query;

            if (!tenant_user_id) {
                return res.status(400).json({
                    success: false,
                    message: 'tenant_user_id is required as query parameter'
                });
            }

            // 2. Call the existing service
            const context = await TenantService.getTenantChatbotContext(parseInt(tenant_user_id));

            // 3. Return in standard Bot response format
            res.json({
                success: true,
                data: context,
                bot_info: {
                    accessed_by: req.bot.name, // From bot.middleware
                    timestamp: new Date()
                }
            });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new TenantController();
