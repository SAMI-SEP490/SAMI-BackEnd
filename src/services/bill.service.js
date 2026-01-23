// src/services/bill.service.js
// Updated: 2026-01-20
// Features: Auto-Billing, Bulk Billing, Draft Workflow (Strict Types), (Rent/Utility), Rent Cap, Overdue Extension, New Schema Support

const prisma = require('../config/prisma');
const crypto = require('crypto');
const NotificationService = require('./notification.service');
const { getVietnamDay } = require('../utils/datevn');

// Helper: Generate unique bill number (e.g., B-RNT-202601-1234AB)
function generateBillNumber(year, month, type) {
  const timestampPart = Date.now().toString().slice(-4);
  const randomPart = crypto.randomBytes(2).toString('hex').toUpperCase();
  const typeCode = type === 'monthly_rent' ? 'RNT' : (type === 'utilities' ? 'UTL' : 'OTH');
  const monthStr = String(month).padStart(2, '0');
  return `B-${typeCode}-${year}${monthStr}-${timestampPart}${randomPart}`;
}

class BillService {

  // ==========================================
  // 1. AUTO-GENERATION (CRON JOB)
  // ==========================================

  /**
   * MASTER CRON FUNCTION
   * Checks for bills that need to be created 10 days from now.
   */
  async autoCreateMonthlyBills() {
    const today = getVietnamDay();
    // Normalize today to start of day for comparison
    today.setHours(0, 0, 0, 0);

    // Default Deadline: 10 days from creation
    const paymentDeadline = new Date(today);
    paymentDeadline.setDate(today.getDate() + 10);

    console.log(`[AutoBill] --- Starting Scan for ${today.toLocaleDateString('vi-VN')} ---`);

    // --- A. RENT BILLS ---
    // Fetch active contracts with ALL necessary fields
    const activeContracts = await prisma.contracts.findMany({
      where: {
        status: 'active',
        deleted_at: null
      },
      include: { room_current: true }
    });

    let rentCount = 0;
    let rentSkipped = 0;

    for (const contract of activeContracts) {
      try {
        // [LOGIC] Determine the next billing period start date
        // This ensures we stick to the contract's timeline (e.g. 31st), not the "run date" (1st)
        const targetDate = await this._calculateNextRentDate(contract);

        // If no target date found (e.g., future) or contract expired, skip
        if (!targetDate) continue;

        const contractEnd = new Date(contract.end_date);
        if (targetDate > contractEnd) {
          console.log(`[AutoBill] 🛑 Contract ${contract.contract_number} expired. Stopping rent bills.`);
          continue;
        }

        // Create the bill
        await this.createRentBill({
          contract_id: contract.contract_id,
          tenant_user_id: contract.tenant_user_id,
          amount: contract.rent_amount,
          periodStart: targetDate,
          dueDate: paymentDeadline,
          cycleMonths: contract.payment_cycle_months || 1 // [DEBUG] Fallback Logged inside
        });

        console.log(`[AutoBill] ✅ Created Rent Bill for Contract ${contract.contract_number} (Start: ${targetDate.toLocaleDateString()})`);
        rentCount++;

      } catch (error) {
        if (error.statusCode === 409) {
          // Not an error, just means we are up to date
          rentSkipped++;
        } else {
          console.error(`[AutoBill] ❌ ERROR Rent for Contract ${contract.contract_number}:`, error.message);
        }
      }
    }

    // --- B. UTILITY BILLS ---
    // (This part remains unchanged from previous step, assuming it's working)
    const currentDayOfMonth = getVietnamDay().getDate(); // Use actual current day for closing check
    const buildingsDue = await prisma.buildings.findMany({
      where: { is_active: true, bill_closing_day: currentDayOfMonth }
    });

    let utilityCount = 0;
    for (const building of buildingsDue) {
      if (building.bill_closing_day && building.bill_closing_day > 28) continue;
      // Note: Passing paymentDeadline calculated at start of function
      const result = await this._processUtilityBillsForBuilding(building, paymentDeadline);
      utilityCount += result.created;
    }

    console.log(`[AutoBill] --- Scan Complete (Rent: ${rentCount}, Util: ${utilityCount}) ---`);
    return { rent_created: rentCount, rent_skipped: rentSkipped, utility_created: utilityCount };
  }

  /**
   * Helper: Logic to find the correct "Anniversary Date"
   */
  async _calculateNextRentDate(contract) {
    // 1. Find the latest rent bill created for this contract
    const lastBill = await prisma.bills.findFirst({
      where: {
        contract_id: contract.contract_id,
        bill_type: 'monthly_rent',
        status: { not: 'cancelled' }
      },
      orderBy: { billing_period_end: 'desc' }
    });

    let nextStart;

    if (lastBill) {
      // If bill exists, next period starts the day after the last one ended
      const lastEnd = new Date(lastBill.billing_period_end);
      nextStart = new Date(lastEnd);
      nextStart.setDate(nextStart.getDate() + 1);
    } else {
      // First bill: Start on Contract Start Date
      nextStart = new Date(contract.start_date);
    }

    // 2. Check if this date is "Due" (i.e., today or in the past)
    // We allow generating bills up to 3 days early if needed, or strictly on/after date.
    // User said "refresh bill on 1/2 is still possible" -> implies we catch up on past dates.
    const today = getVietnamDay();
    today.setHours(23, 59, 59, 999); // Compare against end of today

    if (nextStart <= today) {
      return nextStart;
    }

    return null; // Not due yet
  }

  /**
   * Helper: Process Utilities
   */
  async _processUtilityBillsForBuilding(building, dueDate) {
    // Current "Period" logic:
    // If today is the Closing Day (e.g. Jan 25), we are billing for Jan.
    const today = getVietnamDay();
    const billingMonth = today.getMonth() + 1; // 1-12
    const billingYear = today.getFullYear();

    const rooms = await prisma.rooms.findMany({
      where: { building_id: building.building_id, current_contract_id: { not: null } },
      include: { current_contract: true }
    });

    let created = 0;
    for (const room of rooms) {
      const reading = await prisma.utility_readings.findUnique({
        where: {
          room_id_billing_month_billing_year: {
            room_id: room.room_id,
            billing_month: billingMonth,
            billing_year: billingYear
          }
        }
      });

      if (reading && !reading.bill_id) {
        // [SAFETY] Check Negative Usage before creating bill
        if (reading.curr_electric < reading.prev_electric || reading.curr_water < reading.prev_water) {
          console.error(`[AutoBill] ❌ ERROR Room ${room.room_number}: Negative usage detected. Manager must check/reset readings.`);
          continue;
        }

        try {
          const bill = await this.createUtilityBill(room, building, reading, dueDate);
          if (bill) { // Check if bill was actually created
            console.log(`[AutoBill] ✅ Created Utility Bill for Room ${room.room_number}`);
            created++;
          }
        } catch (error) {
          if (error.statusCode === 409) {
            console.log(`[AutoBill] ⏭️ SKIPPED Utility for Room ${room.room_number}: Bill exists.`);
          } else {
            console.error(`[AutoBill] ❌ ERROR Utility for Room ${room.room_number}:`, error.message);
          }
        }
      }
    }
    return { created };
  }

  // ==========================================
  // 2. CREATION LOGIC (Used by Cron & Manual)
  // ==========================================

  // Used by Cron
  async createRentBill({ contract_id, tenant_user_id, amount, periodStart, dueDate, cycleMonths }) {
    // [DEBUG] Check cycle
    if (!cycleMonths) {
      console.warn(`[BillService] ⚠️ Warning: cycleMonths missing for Contract ${contract_id}, defaulting to 1.`);
      cycleMonths = 1;
    }

    const contract = await prisma.contracts.findUnique({ where: { contract_id } });

    // Amount Check
    if (Number(amount) > Number(contract.rent_amount)) throw new Error(`Bill amount exceeds contract rent`);

    // Date Logic: periodStart is passed in from _calculateNextRentDate, so it is trusted.
    // Just ensure it's not before contract start (safety net)
    if (new Date(periodStart) < new Date(contract.start_date)) {
      // This might happen if DB is messy, fix it to start_date
      console.warn("[BillService] Adjusted periodStart to contract start date");
      periodStart = new Date(contract.start_date);
    }

    // Calculate End Date: Start + Cycle Months
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + cycleMonths);
    // Standardize: If start is Jan 31, +1 month -> Feb 28/29.
    // Subtract 1 day to make it disjoint? Usually "Jan 1 to Jan 31".
    // So if Start is Jan 1, +1 Month is Feb 1. End should be Jan 31.
    periodEnd.setDate(periodEnd.getDate() - 1);

    // Calculate Total Bill Amount
    // If cycle is 3 months, Total = Monthly Rent * 3
    const totalBillAmount = Number(amount) * cycleMonths;

    // Overlap Check
    await this._checkBillOverlap(contract.room_id, periodStart, periodEnd, null, 'monthly_rent');

    const billNumber = generateBillNumber(periodStart.getFullYear(), periodStart.getMonth() + 1, 'monthly_rent');

    return prisma.bills.create({
      data: {
        bill_number: billNumber,
        contract_id,
        tenant_user_id,
        bill_type: 'monthly_rent',
        billing_period_start: periodStart,
        billing_period_end: periodEnd,
        due_date: dueDate,
        total_amount: totalBillAmount,
        status: 'issued',
        description: `Tiền thuê phòng ${cycleMonths} tháng (Từ ${periodStart.toLocaleDateString('vi-VN')} đến ${periodEnd.toLocaleDateString('vi-VN')})`,
        service_charges: {
          create: [{
            service_type: 'Tiền thuê phòng',
            quantity: cycleMonths,
            unit_price: amount,
            amount: amount,
            description: `Chu kỳ ${cycleMonths} tháng`
          }]
        }
      }
    });
  }

  async createUtilityBill(room, building, reading, due_date, created_by) {
    const closingDay = building.bill_closing_day || 28; // Default 28 if null

    // Period Calculation:
    // Billing Month: 2 (Feb). Closing Day: 25.
    // End: Feb 25 (Year, Month-1, ClosingDay)
    // Start: Jan 26 (End - 1 Month + 1 Day)

    const periodEnd = new Date(reading.billing_year, reading.billing_month - 1, closingDay);

    const periodStartCalc = new Date(periodEnd);
    periodStartCalc.setMonth(periodStartCalc.getMonth() - 1);
    periodStartCalc.setDate(periodStartCalc.getDate() + 1);

    // Dynamic Start Logic (Contract check)
    let periodStart = periodStartCalc;

    let contractStart = null;
    if (room.current_contract && room.current_contract.start_date) {
      contractStart = new Date(room.current_contract.start_date);
    } else if (room.current_contract_id) {
      const c = await prisma.contracts.findUnique({ where: { contract_id: room.current_contract_id }, select: { start_date: true } });
      if (c) contractStart = new Date(c.start_date);
    }

    if (contractStart && contractStart > periodStart && contractStart <= periodEnd) {
      periodStart = contractStart;
      console.log(`[BillLogic] Adjusted Start for Room ${room.room_number}: ${periodStartCalc.toISOString().split('T')[0]} -> ${periodStart.toISOString().split('T')[0]}`);
    }

    // --- FAIR BILLING LOGIC ---

    // 1. Calculate Duration (Days)
    const diffTime = Math.abs(periodEnd - periodStart);
    const billableDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // Include start day

    // 2. Determine Service Fee
    // Rule: Only charge service fee if stay is >= 20 days
    let serviceFee = Number(building.service_fee || 0);

    if (billableDays < 20) {
      console.log(`[BillLogic] Waiving Service Fee for Room ${room.room_number} (Only ${billableDays} days).`);
      serviceFee = 0;
    }

    // 3. Calculate Utility Usage
    const electricUsed = reading.curr_electric - reading.prev_electric;
    const waterUsed = reading.curr_water - reading.prev_water;

    // Safety check again
    if (electricUsed < 0 || waterUsed < 0) {
      throw new Error(`Negative usage detected (E: ${electricUsed}, W: ${waterUsed}). Check meter readings.`);
    }

    // 4. Zero Bill Skip Logic
    // If no utilities used AND no service fee -> Skip creating bill
    if (electricUsed === 0 && waterUsed === 0 && serviceFee === 0) {
      console.log(`[BillLogic] Skipping Zero Bill for Room ${room.room_number} (No usage, No service fee).`);
      return null; // Return null to indicate no bill created
    }

    // 5. Calculate Final Costs
    const electricCost = electricUsed * Number(reading.electric_price);
    const waterCost = waterUsed * Number(reading.water_price);
    const totalAmount = electricCost + waterCost + serviceFee;

    // 6. Overlap Check
    await this._checkBillOverlap(room.room_id, periodStart, periodEnd, null, 'utilities');

    const billNumber = generateBillNumber(reading.billing_year, reading.billing_month, 'utilities');

    return prisma.$transaction(async (tx) => {
      const newBill = await tx.bills.create({
        data: {
          bill_number: billNumber,
          contract_id: room.current_contract_id,
          tenant_user_id: room.current_contract.tenant_user_id,
          bill_type: 'utilities',
          billing_period_start: periodStart,
          billing_period_end: periodEnd,
          due_date: due_date,
          total_amount: totalAmount,
          status: 'issued',
          description: `Điện nước kỳ ${reading.billing_month}/${reading.billing_year} (${billableDays} ngày)`,
          created_by: created_by || null,
          service_charges: {
            create: [
              { service_type: 'Điện', quantity: electricUsed, unit_price: reading.electric_price, amount: electricCost, description: `${reading.prev_electric} - ${reading.curr_electric}` },
              { service_type: 'Nước', quantity: waterUsed, unit_price: reading.water_price, amount: waterCost, description: `${reading.prev_water} - ${reading.curr_water}` },
              // Only add service fee line item if it's > 0
              ...(serviceFee > 0 ? [{ service_type: 'Dịch vụ chung', quantity: 1, unit_price: serviceFee, amount: serviceFee, description: 'Vệ sinh, thang máy, rác' }] : [])
            ]
          },
          utilityReadings: {
            connect: { reading_id: reading.reading_id }
          }
        }
      });

      // Mark reading as billed to prevent re-use by the auto-scanner
      await tx.utility_readings.update({
        where: { reading_id: reading.reading_id },
        data: { bill_id: newBill.bill_id }
      });

      return newBill;
    });
  }

  // ==========================================
  // 3. MANUAL BILL MANAGEMENT
  // ==========================================

  /**
   * Create a Draft Bill
   * Only allows 'other'
   */
  async createDraftBill(data, createdById) {
    if (!['other', 'utilities'].includes(data.bill_type)) {
      throw new Error("Manual creation is only allowed for 'other' or 'utilities' bills.");
    }

    const todayVN = getVietnamDay();

    // [FIX] Relaxed Date Logic for 'Other' Bills
    let billingStart, billingEnd;

    if (data.bill_type === 'other' && (!data.billing_period_start || !data.billing_period_end)) {
      // Default to Today if missing
      billingStart = todayVN;
      billingEnd = todayVN;
    } else {
      // Strict parsing for other types or if provided
      billingStart = new Date(data.billing_period_start);
      billingEnd = new Date(data.billing_period_end);
    }

    // Fetch Contract
    const contract = await prisma.contracts.findUnique({ where: { contract_id: data.contract_id } });
    if (!contract) throw new Error("Contract not found");

    const dueDate = new Date(data.due_date);
    const contractStart = new Date(contract.start_date);
    const contractEnd = new Date(contract.end_date);

    // [VALIDATION 1] Start Date vs Contract Start
    if (billingStart < contractStart) {
      throw new Error(`Billing period start (${billingStart.toISOString().split('T')[0]}) cannot be before contract start (${contractStart.toISOString().split('T')[0]}).`);
    }

    // [VALIDATION 2] End Date vs Contract End
    if (billingEnd > contractEnd) {
      throw new Error(`Billing period end (${billingEnd.toISOString().split('T')[0]}) cannot exceed contract end date (${contractEnd.toISOString().split('T')[0]}).`);
    }

    // [VALIDATION 3] Due Date vs Billing End
    if (dueDate < billingEnd) {
      throw new Error("Due date must be after or equal to the billing period end date.");
    }

    const billNumber = generateBillNumber(
      todayVN.getFullYear(),
      todayVN.getMonth() + 1,
      data.bill_type
    );

    return prisma.bills.create({
      data: {
        ...data,
        bill_number: billNumber,
        status: 'draft',
        created_by: createdById,
        billing_period_start: billingStart, // Use processed dates
        billing_period_end: billingEnd,     // Use processed dates
        due_date: dueDate,
        service_charges: data.service_charges ? {
          create: data.service_charges.map(charge => ({
            service_type: charge.service_type,
            quantity: charge.quantity,
            unit_price: charge.unit_price,
            amount: charge.amount,
            description: charge.description
          }))
        } : undefined
      },
      include: { service_charges: true }
    });
  }

  /**
   * Update Draft Bill (Edit OR Publish)
   */
  async updateDraftBill(billId, data) {
    const originalDraft = await prisma.bills.findUnique({
      where: { bill_id: billId },
      include: { contract: true }
    });

    if (!originalDraft || originalDraft.status !== "draft") {
      const error = new Error("Only draft bills can be updated here.");
      error.statusCode = 403;
      throw error;
    }

    // Validate Dates if they are being updated
    // We merge with original data to ensure the full set is valid
    const billingStart = data.billing_period_start ? new Date(data.billing_period_start) : new Date(originalDraft.billing_period_start);
    const billingEnd = data.billing_period_end ? new Date(data.billing_period_end) : new Date(originalDraft.billing_period_end);
    const dueDate = data.due_date ? new Date(data.due_date) : new Date(originalDraft.due_date);
    const contractStart = new Date(originalDraft.contract.start_date);
    const contractEnd = new Date(originalDraft.contract.end_date);

    if (billingStart < contractStart) throw new Error("Billing period start cannot be before contract start date.");
    if (billingEnd > contractEnd) throw new Error("Billing period end cannot exceed contract end date.");
    if (dueDate < billingEnd) throw new Error("Due date must be after or equal to billing period end.");
    if (billingStart > billingEnd) throw new Error("Billing start date cannot be after end date.");

    // --- CASE A: PUBLISHING UTILITY BILL ---
    if (data.status === "issued" && originalDraft.bill_type === 'utilities') {
      return this._publishUtilityBillFromDraft(originalDraft, data);
    }

    // --- CASE B: STANDARD UPDATE/PUBLISH (Other) ---
    const { service_charges, ...mainData } = data;
    let updateData = { ...mainData, updated_at: getVietnamDay() };

    if (data.status === "issued") {
      const finalData = { ...originalDraft, ...data };
      await this._checkBillOverlap(
        (await this._getRoomIdFromContract(originalDraft.contract_id)),
        billingStart,
        billingEnd,
        billId,
        originalDraft.bill_type
      );

      updateData.bill_number = generateBillNumber(
        billingStart.getFullYear(),
        billingStart.getMonth() + 1,
        originalDraft.bill_type
      );
    }

    if (data.billing_period_start) updateData.billing_period_start = billingStart;
    if (data.billing_period_end) updateData.billing_period_end = billingEnd;
    if (data.due_date) updateData.due_date = dueDate;

    return prisma.$transaction(async (tx) => {
      const updatedBill = await tx.bills.update({
        where: { bill_id: billId },
        data: updateData,
      });

      if (service_charges && Array.isArray(service_charges)) {
        await tx.bill_service_charges.deleteMany({ where: { bill_id: billId } });
        await tx.bill_service_charges.createMany({
          data: service_charges.map(charge => ({
            bill_id: billId,
            service_type: charge.service_type,
            quantity: charge.quantity,
            unit_price: charge.unit_price,
            amount: charge.amount,
            description: charge.description
          }))
        });
      }
      return updatedBill;
    });
  }

  /**
   * Helper: Publish Utility Bill from Draft
   * Creates a proper utility bill and deletes the draft.
   */
  async _publishUtilityBillFromDraft(draft, newData) {
      // 1. Find the reading corresponding to this draft (if any)
      // Or find reading based on period in draft
      const periodStart = new Date(draft.billing_period_start);
      const billingMonth = periodStart.getMonth() + 1;
      const billingYear = periodStart.getFullYear();
      
      const roomId = await this._getRoomIdFromContract(draft.contract_id);

      // Find unbilled reading for this room/month
      const reading = await prisma.utility_readings.findUnique({
          where: {
              room_id_billing_month_billing_year: {
                  room_id: roomId,
                  billing_month: billingMonth,
                  billing_year: billingYear
              }
          }
      });

      if (!reading) {
          throw new Error(`Cannot issue utility bill: No reading found for Room (Contract ${draft.contract_id}) for ${billingMonth}/${billingYear}`);
      }
      if (reading.bill_id) {
          throw new Error("This reading has already been billed.");
      }

      // 2. Fetch required entities
      const room = await prisma.rooms.findUnique({
          where: { room_id: roomId },
          include: { current_contract: true }
      });
      const building = await prisma.buildings.findUnique({ where: { building_id: room.building_id } });

      // 3. Create the Real Bill
      // Use newData.due_date if updated, else draft's
      const dueDate = newData.due_date ? new Date(newData.due_date) : draft.due_date;
      
      const newBill = await this.createUtilityBill(room, building, reading, dueDate, draft.created_by);

      // 4. Delete the Draft
      await prisma.bills.delete({ where: { bill_id: draft.bill_id } });

      return newBill;
  }

  async _getRoomIdFromContract(contractId) {
      const c = await prisma.contracts.findUnique({ where: { contract_id: contractId }, select: { room_id: true }});
      return c?.room_id;
  }

  /**
   * BULK CREATE BILLS FOR A BUILDING
   * Handles 'utilities' (from readings) or 'other' (flat fee broadcast)
   */
  async createBulkBill(buildingId, data, createdByUserId) {
    const {
      bill_type,
      month,
      year,
      due_date,
      description,
      service_charges
    } = data;

    // 1. Get all occupied rooms in the building
    const rooms = await prisma.rooms.findMany({
      where: {
        building_id: buildingId,
        current_contract_id: { not: null }, // Only occupied rooms
        is_active: true
      },
      include: { current_contract: true }
    });

    if (rooms.length === 0) {
      throw new Error("No occupied rooms found in this building.");
    }

    const results = {
      success: 0,
      failed: 0,
      details: []
    };

    // SCENARIO A: Generate Utility Bills from Readings
    if (bill_type === 'utilities') {
      if (!month || !year) throw new Error("Month and Year required for utility bills");

      for (const room of rooms) {
        try {
          // Find the unbilled reading for this specific period
          const reading = await prisma.utility_readings.findUnique({
            where: {
              room_id_billing_month_billing_year: {
                room_id: room.room_id,
                billing_month: month,
                billing_year: year
              }
            }
          });

          if (!reading) {
            results.details.push({ room: room.room_number, status: 'skipped', reason: 'No reading found' });
            continue;
          }

          if (reading.bill_id) {
            results.details.push({ room: room.room_number, status: 'skipped', reason: 'Already billed' });
            continue;
          }

          // Create the bill using existing logic
          // We need to fetch the building config for service_fee
          const building = await prisma.buildings.findUnique({ where: { building_id: buildingId } });

          if (bill) {
            results.success++;
            results.details.push({ room: room.room_number, status: 'created' });
          } else {
            results.details.push({ room: room.room_number, status: 'skipped', reason: 'Zero usage & short stay' });
          }

        } catch (err) {
          console.error(`Bulk Utility Error Room ${room.room_number}:`, err);
          results.failed++;
          results.details.push({ room: room.room_number, status: 'failed', error: err.message });
        }
      }
    }

    // SCENARIO B: Generate Flat Fee Bills (e.g. "Other", "Service")
    else {
      // Validate input
      if (!service_charges || service_charges.length === 0) {
        throw new Error("Service charges details required for this bill type.");
      }

      // Calculate total once
      const totalAmount = service_charges.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

      const periodStart = getVietnamDay(); // Use current time as reference
      const periodEnd = getVietnamDay();

      for (const room of rooms) {
        try {
          // Construct bill data
          const billData = {
            contract_id: room.current_contract_id,
            tenant_user_id: room.current_contract.tenant_user_id,
            room_id: room.room_id,
            bill_type: bill_type,
            total_amount: totalAmount,
            billing_period_start: periodStart,
            billing_period_end: periodEnd,
            due_date: due_date,
            description: description || `Phí dịch vụ phòng ${room.room_number}`,
            service_charges: service_charges
          };

          // Reuse existing single-creation logic
          await this.createIssuedBill(billData, createdByUserId);

          results.success++;
          results.details.push({ room: room.room_number, status: 'created' });

        } catch (err) {
          // Start checking overlap error 409
          if (err.statusCode === 409) {
            results.details.push({ room: room.room_number, status: 'skipped', reason: 'Bill already exists' });
            continue;
          }
          console.error(`Bulk Other Error Room ${room.room_number}:`, err);
          results.failed++;
          results.details.push({ room: room.room_number, status: 'failed', error: err.message });
        }
      }
    }

    return results;
  }

  // ==========================================
  // 4. OVERDUE & EXTENSION
  // ==========================================

  async scanAndMarkOverdueBills() {
    const today = getVietnamDay();
    today.setHours(0, 0, 0, 0);

    const result = await prisma.bills.updateMany({
      where: {
        status: 'issued',
        due_date: { lt: today },
        deleted_at: null
      },
      data: {
        status: 'overdue',
        updated_at: getVietnamDay()
      }
    });
    return result.count;
  }

  /**
   * Extend an overdue bill (Re-assign)
   * Adds 5 days (default) and optional penalty.
   */
  async extendBill(billId, penaltyAmount = 0) {
    const bill = await prisma.bills.findUnique({
      where: { bill_id: billId }
    });

    if (!bill) throw new Error('Bill not found');
    if (bill.status !== 'overdue') throw new Error('Only overdue bills can be extended');

    const DAYS_TO_ADD = 5;
    const newDueDate = new Date(bill.due_date);
    newDueDate.setDate(newDueDate.getDate() + DAYS_TO_ADD);

    const currentPenalty = Number(bill.penalty_amount || 0);
    const additionalPenalty = Number(penaltyAmount);

    // Update: Set back to 'issued', update due date, update penalty
    return prisma.bills.update({
      where: { bill_id: billId },
      data: {
        status: 'issued', // Re-open
        due_date: newDueDate,
        penalty_amount: currentPenalty + additionalPenalty,
        // Add note about extension to description
        description: `${bill.description || ''} (Gia hạn ${DAYS_TO_ADD} ngày)`.trim(),
        updated_at: getVietnamDay()
      }
    });
  }

  // ==========================================
  // 5. LISTING & GETTERS
  // ==========================================

  /**
   * Get ALL visible bills for a tenant.
   * UPDATED: Includes 'service_charges' so tenant sees details.
   */
  async getBillsForTenant(tenantUserId) {
    // 1. Find the room this tenant currently lives in
    const currentLiving = await prisma.room_tenants.findFirst({
      where: { tenant_user_id: tenantUserId, is_current: true },
      select: { room_id: true }
    });

    // 2. Build Query
    const whereCondition = {
      status: { in: ["issued", "paid", "partially_paid", "overdue"] },
      deleted_at: null,
      OR: [
        { tenant_user_id: tenantUserId }, // Bills explicitly assigned to me
      ]
    };

    // If they live in a room, include bills for that room's contracts
    if (currentLiving) {
      whereCondition.OR.push({
        contract: { room_id: currentLiving.room_id }
      });
    }

    const bills = await prisma.bills.findMany({
      where: whereCondition,
      orderBy: { billing_period_start: "desc" },
      select: {
        bill_id: true,
        bill_number: true,
        tenant_user_id: true, // Needed for comparison
        billing_period_start: true,
        billing_period_end: true,
        due_date: true,
        total_amount: true,
        paid_amount: true,
        penalty_amount: true,
        status: true,
        description: true,
        bill_type: true,
        created_at: true,
        updated_at: true,
        // Include contract -> room info to show Room Number
        contract: {
          select: {
            room_current: { select: { room_number: true } },
            room_history: { select: { room_number: true } }
          }
        },
        service_charges: true
      }
    });

    // console.log(`bill tenant is: ${bills.tenant_user_id}`);
    // console.log(`passed tenant is: ${tenantUserId}`);
    // 3. [NEW] Transform Data: Add 'is_payer' flag
    return bills.map(bill => {
      // Determine Room Number (Handle nulls if contract history is messy)
      const roomNumber = bill.contract?.room_current?.room_number ||
        bill.contract?.room_history?.room_number ||
        "Unknown";

      const isPayer = bill.tenant_user_id === tenantUserId;
      console.log(`[UnpaidCheck] Bill #${bill.bill_id} | User: ${tenantUserId} vs Payer: ${bill.tenant_user_id} -> is_payer: ${isPayer}`);

      return {
        ...bill,
        room_number: roomNumber, // Flatten for easier Frontend use

        // THE MAGIC FLAG 🚩
        // true = I am Primary (Show "Pay" button)
        // false = I am Secondary (Hide "Pay" button)
        is_payer: bill.tenant_user_id === tenantUserId
      };
    });
  }

  /**
   * Get unpaid bills for a tenant.
   */
  async getUnpaidBillsForTenant(tenantUserId) {
    const currentLiving = await prisma.room_tenants.findFirst({
      where: { tenant_user_id: tenantUserId, is_current: true },
      select: { room_id: true }
    });

    const whereCondition = {
      status: { in: ["issued", "overdue"] },
      deleted_at: null,
      OR: [{ tenant_user_id: tenantUserId }]
    };

    if (currentLiving) {
      whereCondition.OR.push({
        contract: { room_id: currentLiving.room_id }
      });
    }

    return prisma.bills.findMany({
      where: whereCondition,
      orderBy: { due_date: "asc" },
      select: {
        bill_id: true,
        bill_number: true,
        billing_period_start: true,
        billing_period_end: true,
        due_date: true,
        total_amount: true,
        paid_amount: true,
        penalty_amount: true,
        status: true,
        description: true,
        bill_type: true,
        created_at: true,
        updated_at: true
      },
    });
  }

  /**
   * Get all bills (Admin/Manager).
   * UPDATED: Relations match new schema (tenants, users, rooms).
   */
  async getAllBills(filters = {}) {
    const bills = await prisma.bills.findMany({
      where: {
        status: { notIn: ["draft", "cancelled"] },
        deleted_at: null,
        ...filters,
      },
      orderBy: { created_at: "desc" },
      include: {
        // [FIX] Correct relation name
        tenant: {
          select: { user: { select: { user_id: true, full_name: true } } }
        },
        creator: { select: { user_id: true, full_name: true } },
        contract: { // To get Room Number
          select: {
            room_current: { select: { room_id: true, room_number: true, building_id: true } },
            room_history: { select: { room_id: true, room_number: true, building_id: true } }
          }
        }
      },
    });

    // Flatten for Frontend
    return bills.map(b => ({
      ...b,
      room: b.contract?.room_current || b.contract?.room_history
    }));
  }

  async getDraftBills() {
    const bills = await prisma.bills.findMany({
      where: { status: "draft", deleted_at: null },
      orderBy: { created_at: "desc" },
      include: {
        tenant: {
          select: { user: { select: { user_id: true, full_name: true } } }
        },
        creator: { select: { user_id: true, full_name: true } },
        contract: {
          select: {
            room_current: { select: { room_id: true, room_number: true, building_id: true } },
            room_history: { select: { room_id: true, room_number: true, building_id: true } }
          }
        }
      },
    });

    return bills.map(b => ({
      ...b,
      room: b.contract?.room_current || b.contract?.room_history
    }));
  }

  async getDeletedBills() {
    const bills = await prisma.bills.findMany({
      where: { deleted_at: { not: null } },
      orderBy: { deleted_at: "desc" },
      include: {
        tenant: {
          select: { user: { select: { user_id: true, full_name: true } } }
        },
        creator: { select: { user_id: true, full_name: true } },
        contract: {
          select: {
            room_current: { select: { room_id: true, room_number: true } },
            room_history: { select: { room_id: true, room_number: true } }
          }
        }
      },
    });

    return bills.map(b => ({
      ...b,
      room: b.contract?.room_current || b.contract?.room_history
    }));
  }

  /**
   * Get Bill Details.
   * UPDATED: Includes 'utilityReadings' and 'service_charges'.
   */
  async getBillById(billId) {
    return prisma.bills.findUnique({
      where: { bill_id: billId },
      include: {
        contract: { // To get Room info
          select: {
            room_current: { select: { room_id: true, room_number: true } },
            room_history: { select: { room_id: true, room_number: true } }
          }
        },
        tenant: {
          select: { user: { select: { user_id: true, full_name: true, phone: true } } }
        },
        creator: { select: { user_id: true, full_name: true } },
        service_charges: true,
        payment_details: { include: { payment: true } },
        utilityReadings: true
      }
    });
  }

  /**
   * Get rooms that haven't been billed for a specific period.
   * UPDATED: Uses 'current_contract' to find the actual active tenant.
   */
  async getUnbilledRooms(periodStartDate) {
    const targetDate = new Date(periodStartDate);

    // 1. Get all active rooms with contracts
    const rooms = await prisma.rooms.findMany({
      where: { is_active: true, current_contract_id: { not: null } },
      include: {
        current_contract: {
          include: {
            tenant: { include: { user: true } } // Get tenant name
          }
        }
      }
    });

    // 2. Find bills for this month
    // We can't easily do a "NOT IN" query across relations efficiently in one go without raw SQL or reverse relation.
    // But since we have 'contract_id' on bills, we can fetch all bills for these contracts in this period.

    const contractIds = rooms.map(r => r.current_contract_id);

    const existingBills = await prisma.bills.findMany({
      where: {
        contract_id: { in: contractIds },
        billing_period_start: targetDate,
        status: { not: 'cancelled' }
      },
      select: { contract_id: true }
    });

    const billedContractIds = new Set(existingBills.map(b => b.contract_id));

    // 3. Filter rooms whose contract is NOT in the billed set
    const unbilledRooms = rooms.filter(r => !billedContractIds.has(r.current_contract_id));

    return unbilledRooms.map(r => ({
      room_id: r.room_id,
      room_number: r.room_number,
      floor: r.floor,
      tenant_name: r.current_contract?.tenant?.user?.full_name || "Unknown"
    }));
  }

  async calculatePenalty(billId) {
    const bill = await prisma.bills.findUnique({
      where: { bill_id: billId },
      include: { contract: true }
    });

    if (!bill) throw new Error("Bill not found");

    // Get rate from contract (e.g., 5.00 for 5%)
    const penaltyRate = Number(bill.contract?.penalty_rate || 0);
    const totalAmount = Number(bill.total_amount);

    // Formula: Amount * (Rate / 100)
    const penaltyAmount = totalAmount * (penaltyRate / 100);

    return {
      bill_id: bill.bill_id,
      total_amount: totalAmount,
      penalty_rate_percent: penaltyRate,
      calculated_penalty: penaltyAmount
    };
  }

  async deleteOrCancelBill(billId) {
    const bill = await prisma.bills.findUnique({
      where: { bill_id: billId },
      select: { status: true, deleted_at: true },
    });

    if (!bill) throw new Error("Bill not found");
    if (bill.deleted_at) throw new Error("Bill already deleted");

    if (bill.status === "draft") {
      // Soft delete draft
      return prisma.bills.update({ where: { bill_id: billId }, data: { deleted_at: getVietnamDay() } });
    } else if (["issued", "overdue"].includes(bill.status)) {
      // Soft cancel issued
      return prisma.bills.update({
        where: { bill_id: billId },
        data: { status: "cancelled", updated_at: getVietnamDay(), deleted_at: getVietnamDay() },
      });
    } else {
      throw new Error(`Cannot delete/cancel bill with status: ${bill.status}`);
    }
  }

  async restoreBill(billId) {
    const bill = await prisma.bills.findUnique({
      where: { bill_id: billId },
      select: { deleted_at: true },
    });
    if (!bill) throw new Error("Bill not found");
    if (!bill.deleted_at) throw new Error("Bill is not deleted");

    return prisma.bills.update({
      where: { bill_id: billId },
      data: { deleted_at: null },
    });
  }

  async _checkBillOverlap(roomId, startDate, endDate, excludeBillId = null, billType = null) {
    // Relax requirement: 'other' bills can overlap freely.
    // Multiple repair bills or ad-hoc fees in the same month are allowed.
    if (billType === 'other') return;

    const contracts = await prisma.contracts.findMany({ where: { room_id: roomId }, select: { contract_id: true } });
    const contractIds = contracts.map(c => c.contract_id);
    if (contractIds.length === 0) return;

    const whereClause = {
      contract_id: { in: contractIds },
      status: { in: ["issued", "overdue", "paid", "partially_paid"] },
      bill_id: excludeBillId ? { not: excludeBillId } : undefined,
      AND: [{ billing_period_start: { lte: endDate } }, { billing_period_end: { gte: startDate } }],
    };
    if (billType) whereClause.bill_type = billType;

    const overlappingBill = await prisma.bills.findFirst({ where: whereClause, select: { bill_number: true, bill_type: true } });

    // THIS IS WHAT TRIGGERS THE SKIP IN AUTO-BILLING
    if (overlappingBill) {
      const error = new Error(`Khoảng thời gian trùng với hóa đơn: ${overlappingBill.bill_number}`);
      error.statusCode = 409; // Conflict
      throw error;
    }
  }

  /**
     * CRON TASK: Runs daily at 17:00
     * Scans for bills due in 1 or 2 days and sends push reminders.
     */
  async scanAndSendReminders() {
    console.log(`[BillReminder] Starting scan at ${getVietnamDay().toISOString()}...`);

    const today = getVietnamDay();

    // Define the window: Tomorrow (1 day out) and Day After (2 days out)
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const dayAfter = new Date(today);
    dayAfter.setDate(today.getDate() + 2);
    dayAfter.setHours(23, 59, 59, 999);

    // Find UNPAID (issued) bills due within this specific window
    const billsDueSoon = await prisma.bills.findMany({
      where: {
        status: 'issued', // Only remind for unpaid bills
        deleted_at: null,
        due_date: {
          gte: tomorrow,  // >= Tomorrow 00:00
          lte: dayAfter   // <= Day After 23:59
        }
      },
      include: {
        tenant: {
          select: { user: { select: { user_id: true, full_name: true } } } // Need user_id for notification
        },
        contract: {
          select: {
            room_current: { select: { room_number: true } },
            room_history: { select: { room_number: true } }
          }
        }
      }
    });

    console.log(`[BillReminder] Found ${billsDueSoon.length} bills due soon.`);

    let sentCount = 0;

    for (const bill of billsDueSoon) {
      try {
        // Calculate days left
        const dueDate = new Date(bill.due_date);
        const diffTime = Math.abs(dueDate - today);
        const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        // Format Money (Helper from NotificationService logic)
        const amountStr = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(bill.total_amount));
        const roomNum = bill.contract?.room_current?.room_number || bill.contract?.room_history?.room_number || "?";

        // Craft Message
        const title = `📅 Nhắc nhở: Hóa đơn sắp hết hạn (${daysLeft} ngày)`;
        const body = `Chào ${bill.tenant?.user.full_name}, hóa đơn phòng ${roomNum} trị giá ${amountStr} sẽ hết hạn vào ngày ${dueDate.toLocaleDateString('vi-VN')}. Vui lòng thanh toán sớm để tránh phí phạt.`;

        // Send Notification
        await NotificationService.createNotification(
          null, // Sender = System
          bill.tenant_user_id,
          title,
          body,
          {
            type: 'bill_due_soon',
            bill_id: String(bill.bill_id),
            days_left: String(daysLeft)
          }
        );

        sentCount++;
      } catch (err) {
        console.error(`[BillReminder] Failed to send for Bill #${bill.bill_id}:`, err.message);
      }
    }

    return { found: billsDueSoon.length, sent: sentCount };
  }
}

module.exports = new BillService();
