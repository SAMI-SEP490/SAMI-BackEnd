// Updated: 2025-28-10
// by: MinhBH

const { applyOverduePenalties, generateRecurringBills } = require('../scripts/dailyBillRunner'); // Adjust path if needed

class ScriptsController {
    async runPenalties(req, res, next) {
        try {
            console.log('API triggered: Running applyOverduePenalties...');
            // We don't need to await here if we want to send the response immediately
            // But awaiting ensures we can report success/failure
            await applyOverduePenalties();
            console.log('API triggered: applyOverduePenalties finished.');
            res.status(200).json({
                success: true,
                message: 'Overdue penalty check initiated successfully.',
            });
        } catch (err) {
            console.error('API Error running penalties:', err);
            next(err);
        }
    }

    async runRenewals(req, res, next) {
        try {
            console.log('API triggered: Running generateRecurringBills...');
            await generateRecurringBills();
            console.log('API triggered: generateRecurringBills finished.');
            res.status(200).json({
                success: true,
                message: 'Recurring bill generation initiated successfully.',
            });
        } catch (err) {
            console.error('API Error running renewals:', err);
            next(err);
        }
    }
}

module.exports = new ScriptsController();
