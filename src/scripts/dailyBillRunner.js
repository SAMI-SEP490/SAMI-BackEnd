// Updated: 2025-28-10
// by: MinhBH

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');

/**
 * Calculates the start date for the next billing cycle.
 * @param {Date} createdAt The creation date of the master template.
 * @param {billing_cycle} cycle The billing cycle.
 * @param {number} cyclesDone The number of cycles already generated.
 * @returns {Date} The calculated start date of the next cycle.
 */
function calculateNextBillingStartDate(createdAt, cycle, cyclesDone) {
    const startDate = new Date(createdAt);

    switch (cycle) {
        case 'WEEKLY':
            startDate.setDate(startDate.getDate() + cyclesDone * 7);
            break;
        case 'MONTHLY':
            startDate.setMonth(startDate.getMonth() + cyclesDone);
            break;
        case 'EVERY_2_MONTHS':
            startDate.setMonth(startDate.getMonth() + cyclesDone * 2);
            break;
        case 'HALF_A_YEAR':
            startDate.setMonth(startDate.getMonth() + cyclesDone * 6);
            break;
        case 'YEARLY':
            startDate.setFullYear(startDate.getFullYear() + cyclesDone);
            break;
        default:
            return null; 
    }

    return startDate;
}

async function applyOverduePenalties() {
    console.log('Checking for overdue bills...');
    const today = new Date();

    // Find bills that are still 'issued' but their due date has passed
    const billsToMarkOverdue = await prisma.bills.findMany({
        where: {
            status: 'issued',
            due_date: { lt: today },
        }
    });

    if (billsToMarkOverdue.length === 0) {
        console.log('No newly overdue bills found.');
        return;
    }

    for (const bill of billsToMarkOverdue) {
        await prisma.bills.update({
            where: { bill_id: bill.bill_id },
            data: {
                status: 'overdue',
                updated_at: new Date()
            }
        });
        console.log(`Marked bill ${bill.bill_number || bill.bill_id} as overdue.`);
    }
}

async function generateRecurringBills() {
    console.log('Finding active master templates for recurring bills...');
    const today = new Date();

    const templates = await prisma.bills.findMany({
        where: {
            is_recurring: true,
            status: 'master',
            deleted_at: null
        }
    });

    if (templates.length === 0) {
        console.log('No active master templates found.');
        return;
    }

    console.log(`Found ${templates.length} active master templates.`);

    for (const template of templates) {
        if (!template.billing_cycle) {
             console.log(`Skipping master template ID ${template.bill_id} due to missing billing_cycle.`);
             continue;
        }

        if (!template.created_at) {
             console.log(`Skipping master template ID ${template.bill_id} due to missing created_at.`);
             continue;
        }

        const cyclesDone = template.bills_cycled || 0;

        // 1. Calculate when the *next* bill *should* start
        const nextBillingStartDate = calculateNextBillingStartDate(
            template.created_at,
            template.billing_cycle,
            cyclesDone
        );

        if (!nextBillingStartDate) {
            console.log(`Skipping master template ID ${template.bill_id} due to invalid cycle.`);
            continue;
        }

        // 2. Check if today is on or after the day the next bill should be created
        if (today >= nextBillingStartDate) {
            // 3. Check if this exact bill (based on start date) already exists
            const existingBill = await prisma.bills.findFirst({
                where: {
                    tenant_user_id: template.tenant_user_id,
                    description: template.description,
                    billing_period_start: nextBillingStartDate // Use the calculated start date
                }
            });

            if (!existingBill) {
                // 4. Calculate end date and due date based on the *actual* start date
                let billEndDate;
                let dueDate;
                const startDateForCalc = new Date(nextBillingStartDate); // Use a copy

                switch (template.billing_cycle) {
                    case 'WEEKLY':
                        billEndDate = new Date(startDateForCalc);
                        billEndDate.setDate(startDateForCalc.getDate() + 6);
                        dueDate = new Date(startDateForCalc);
                        dueDate.setDate(startDateForCalc.getDate() + 4); // Due 5 days after start
                        break;
                    case 'MONTHLY':
                        billEndDate = new Date(startDateForCalc.getFullYear(), startDateForCalc.getMonth() + 1, 0);
                        dueDate = new Date(startDateForCalc.getFullYear(), startDateForCalc.getMonth() + 1, 5); // Due 5th next month
                        break;
                    case 'EVERY_2_MONTHS':
                        billEndDate = new Date(startDateForCalc.getFullYear(), startDateForCalc.getMonth() + 2, 0);
                        dueDate = new Date(startDateForCalc.getFullYear(), startDateForCalc.getMonth() + 1, 5); // Due 5th of month following start
                        break;
                    case 'HALF_A_YEAR':
                         billEndDate = new Date(startDateForCalc.getFullYear(), startDateForCalc.getMonth() + 6, 0);
                         dueDate = new Date(startDateForCalc.getFullYear(), startDateForCalc.getMonth(), 5); // Due 5th of start month
                         break;
                    case 'YEARLY':
                         billEndDate = new Date(startDateForCalc.getFullYear(), 11, 31);
                         dueDate = new Date(startDateForCalc.getFullYear(), 0, 5); // Due Jan 5th
                         break;
                }

                // Generate Bill Number
                const timestampPart = Date.now().toString();
                const randomPart = crypto.randomBytes(1).toString('hex');
                const uniqueNum = (timestampPart + randomPart).slice(-6).padStart(6, '0');
                const yearForBillNum = startDateForCalc.getFullYear(); // Year of the billing period
                const monthForBillNum = startDateForCalc.getMonth() + 1; // Month of the billing period
                const newBillNumber = `B-${yearForBillNum}-${monthForBillNum}-GEN-${uniqueNum}`;

                // 5. Create the new bill AND update the master template in a transaction
                try {
                     await prisma.$transaction([
                         // Create the new issued bill
                         prisma.bills.create({
                             data: {
                                 tenant_user_id: template.tenant_user_id,
                                 total_amount: template.total_amount,
                                 description: template.description,
                                 created_by: template.created_by,
                                 bill_number: newBillNumber,
                                 status: 'issued',
                                 is_recurring: true,
                                 billing_cycle: null,
                                 billing_period_start: nextBillingStartDate, // Use calculated start date
                                 billing_period_end: billEndDate,
                                 due_date: dueDate,
                                 penalty_amount: template.penalty_amount
                             }
                         }),
                         // Increment the counter on the master template
                         prisma.bills.update({
                             where: { bill_id: template.bill_id },
                             data: { bills_cycled: cyclesDone + 1 }
                         })
                     ]);
                     console.log(`Cloned ${template.billing_cycle} bill (Number: ${newBillNumber}) from master ${template.bill_id} for tenant ${template.tenant_user_id}. Cycle count updated to ${cyclesDone + 1}.`);

                } catch (error) {
                     console.error(`Transaction failed for master template ${template.bill_id}:`, error);
                     // Decide how to handle errors (e.g., retry later, log specific failure)
                }

            } else {
                 console.log(`Bill for period starting ${nextBillingStartDate.toISOString().split('T')[0]} already generated for master template ${template.bill_id}. Skipping.`);
            }
        }
    }
}

module.exports = {
    applyOverduePenalties,
    generateRecurringBills
};

// For testing execution
// async function main() {
//     await applyOverduePenalties();
//     await generateRecurringBills();
// }

// main()
//     .catch(e => {
//         console.error(e);
//         process.exit(1);
//     })
//     .finally(async () => {
//         await prisma.$disconnect();
//     });
