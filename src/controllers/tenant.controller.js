// Updated: 2025-18-10
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
}

module.exports = new TenantController();
