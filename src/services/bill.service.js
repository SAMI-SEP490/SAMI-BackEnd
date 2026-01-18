// src/services/bill.service.js
// Updated: 2026-01-18
// Features: Auto-Billing, Bulk Billing, Draft Workflow (Strict Types), (Rent/Utility), Rent Cap, Overdue Extension, New Schema Support

const prisma = require('../config/prisma');
const crypto = require('crypto');
const NotificationService = require('./notification.service');

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
    const today = new Date();
    const currentDayOfMonth = today.getDate();

    // PAYMENT DEADLINE LOGIC:
    // Created Today -> Due in 10 Days (Configurable)
    const paymentDeadline = new Date(today);
    paymentDeadline.setDate(today.getDate() + 10);

    console.log(`[AutoBill] --- Starting Scan for Day ${currentDayOfMonth} ---`);

    // A. RENT BILLS (Based on Contract Start Day)
    // Only fetch ACTIVE contracts
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
      if (this._shouldCreateRentBill(contract, today)) {
        try {
          // Attempt to create bill
          await this.createRentBill({
            contract_id: contract.contract_id,
            tenant_user_id: contract.tenant_user_id,
            amount: contract.rent_amount,
            periodStart: today,
            dueDate: paymentDeadline,
            cycleMonths: contract.payment_cycle_months
          });
          
          console.log(`[AutoBill] ✅ Created Rent Bill for Contract ${contract.contract_number}`);
          rentCount++;

        } catch (error) {
          // [LOGGING] Check if it's our specific "Overlap" error
          if (error.statusCode === 409) {
            console.log(`[AutoBill] ⏭️ SKIPPED Rent for Contract ${contract.contract_number}: Manual bill already exists for this period.`);
            rentSkipped++;
          } else {
            // Real error, log it but don't stop the loop
            console.error(`[AutoBill] ❌ ERROR creating Rent for Contract ${contract.contract_number}:`, error.message);
          }
        }
      }
    }

    // --- B. UTILITY BILLS ---
    const buildingsDue = await prisma.buildings.findMany({
      where: {
        is_active: true,
        bill_due_day: currentDayOfMonth
      }
    });

    let utilityCount = 0;
    for (const building of buildingsDue) {
      const result = await this._processUtilityBillsForBuilding(building, paymentDeadline);
      utilityCount += result.created;
    }

    console.log(`[AutoBill] --- Scan Complete ---`);
    return { 
        rent_created: rentCount, 
        rent_skipped: rentSkipped,
        utility_created: utilityCount 
    };
  }

  /**
   * Helper: Logic to check if Rent should be generated TODAY
   */
  _shouldCreateRentBill(contract, today) {
    const start = new Date(contract.start_date);

    // 1. Day Match: Contract starts on 5th, Today is 5th?
    if (start.getDate() !== today.getDate()) return false;

    // 2. Cycle Match: Handle quarterly/yearly payment cycles
    const monthsPassed =
      (today.getFullYear() - start.getFullYear()) * 12 +
      (today.getMonth() - start.getMonth());

    const cycle = contract.payment_cycle_months || 1;

    // Example: Started Jan 1st. Cycle = 3 months.
    // Jan 1st (0 months) -> True
    // Feb 1st (1 month) -> False
    // Apr 1st (3 months) -> True
    return monthsPassed >= 0 && monthsPassed % cycle === 0;
  }

  /**
   * Helper: Process Utilities
   */
  async _processUtilityBillsForBuilding(building, dueDate) {
    // Billing for PREVIOUS month
    const today = new Date();
    let billingMonth = today.getMonth(); // 0-11 (Jan is 0)
    let billingYear = today.getFullYear();

    // If today is Jan, billing month is Dec of previous year
    if (billingMonth === 0) {
      billingMonth = 12;
      billingYear -= 1;
    }
    // billingMonth is now 1-12 format for DB

    const rooms = await prisma.rooms.findMany({
      where: {
        building_id: building.building_id,
        current_contract_id: { not: null }
      },
      include: { current_contract: true }
    });

    let created = 0;

    for (const room of rooms) {
      // Find reading for last month
      const reading = await prisma.utility_readings.findUnique({
        where: {
          room_id_billing_month_billing_year: {
            room_id: room.room_id,
            billing_month: billingMonth,
            billing_year: billingYear
          }
        }
      });

      // Logic: Only process if reading exists AND hasn't been linked to a bill yet
      if (reading && !reading.bill_id) {
        try {
            await this.createUtilityBill(room, building, reading, dueDate);
            console.log(`[AutoBill] ✅ Created Utility Bill for Room ${room.room_number}`);
            created++;
        } catch (error) {
            if (error.statusCode === 409) {
                console.log(`[AutoBill] ⏭️ SKIPPED Utility for Room ${room.room_number}: Bill exists.`);
            } else {
                console.error(`[AutoBill] ❌ ERROR Utility for Room ${room.room_number}:`, error.message);
            }
        }
      } else if (reading && reading.bill_id) {
          // Already billed (Reading is linked)
          // console.log(`[AutoBill] Info: Room ${room.room_number} reading already billed.`);
      }
    }
    return { created };
  }

  // ==========================================
  // 2. CREATION LOGIC (Used by Cron & Manual)
  // ==========================================

  // Used by Cron
  async createRentBill({ contract_id, tenant_user_id, amount, periodStart, dueDate, cycleMonths = 1 }) {
    const contract = await prisma.contracts.findUnique({ where: { contract_id }, select: { rent_amount: true, room_id: true } });

    // Rent Cap Check
    if (Number(amount) > Number(contract.rent_amount)) throw new Error(`Bill amount exceeds contract rent`);

    // Validation 2: Date Check [NEW]
    if (new Date(periodStart) < new Date(contract.start_date)) {
      throw new Error(`Cannot create bill before contract start date (${contract.start_date.toISOString().split('T')[0]})`);
    }

    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + cycleMonths);

    // [IMPORTANT] Overlap Check
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
        due_date: dueDate, // Now passed in (Today + 10 days)
        total_amount: amount,
        status: 'issued',
        description: `Tiền thuê phòng ${cycleMonths} tháng (Từ ${periodStart.toLocaleDateString('vi-VN')})`,
        service_charges: {
          create: [{
            service_type: 'Tiền thuê phòng',
            quantity: 1,
            unit_price: amount,
            amount: amount,
            description: `Chu kỳ ${cycleMonths} tháng`
          }]
        }
      }
    });
  }

  async createUtilityBill(room, building, reading, due_date, created_by) {
    // 1. Determine the standard "Month" boundaries
    const monthStart = new Date(reading.billing_year, reading.billing_month - 1, 1);
    const monthEnd = new Date(reading.billing_year, reading.billing_month, 0);

    // 2. Fetch Contract Start Date (Handle if not populated)
    let contractStart = null;
    if (room.current_contract && room.current_contract.start_date) {
      contractStart = new Date(room.current_contract.start_date);
    } else if (room.current_contract_id) {
      // Fallback: Fetch if only ID provided
      const c = await prisma.contracts.findUnique({
        where: { contract_id: room.current_contract_id },
        select: { start_date: true }
      });
      if (c) contractStart = new Date(c.start_date);
    }

    // 3. [FIX] Dynamic Start Date Logic
    // If Contract starts AFTER the 1st of this billing month, use Contract Start.
    // Example: Bill Jan (1-31). Contract starts Jan 18. -> Period: Jan 18 - Jan 31.
    let periodStart = monthStart;

    if (contractStart && contractStart > monthStart && contractStart <= monthEnd) {
      periodStart = contractStart;
      console.log(`[BillLogic] Adjusted Utility Start for Room ${room.room_number}: ${monthStart.toISOString().split('T')[0]} -> ${periodStart.toISOString().split('T')[0]}`);
    }

    // 4. Calculate Costs
    const electricUsed = reading.curr_electric - reading.prev_electric;
    const waterUsed = reading.curr_water - reading.prev_water;
    const electricCost = electricUsed * Number(reading.electric_price);
    const waterCost = waterUsed * Number(reading.water_price);
    const serviceFee = Number(building.service_fee || 0);
    const totalAmount = electricCost + waterCost + serviceFee;

    // 5. Overlap Check
    // Now safe because periodStart is guaranteed >= contractStart (if within month)
    await this._checkBillOverlap(room.room_id, periodStart, monthEnd, null, 'utilities');

    const billNumber = generateBillNumber(reading.billing_year, reading.billing_month, 'utilities');

    // 6. Create
    return prisma.$transaction(async (tx) => {
      const newBill = await tx.bills.create({
        data: {
          bill_number: billNumber,
          contract_id: room.current_contract_id,
          tenant_user_id: room.current_contract.tenant_user_id,
          bill_type: 'utilities',
          billing_period_start: periodStart, // <--- Used the adjusted date
          billing_period_end: monthEnd,
          due_date: due_date,
          total_amount: totalAmount,
          status: 'issued',
          description: `Điện nước tháng ${reading.billing_month}/${reading.billing_year}`,
          created_by: created_by || null,
          service_charges: {
            create: [
              { service_type: 'Điện', quantity: electricUsed, unit_price: reading.electric_price, amount: electricCost, description: `${reading.prev_electric} - ${reading.curr_electric}` },
              { service_type: 'Nước', quantity: waterUsed, unit_price: reading.water_price, amount: waterCost, description: `${reading.prev_water} - ${reading.curr_water}` },
              { service_type: 'Dịch vụ chung', quantity: 1, unit_price: serviceFee, amount: serviceFee, description: 'Vệ sinh, thang máy, rác' }
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
   * Only allows 'other' or 'utilities' (manual override)
   */
  async createDraftBill(data, createdById) {
    if (!['other', 'utilities'].includes(data.bill_type)) {
        throw new Error("Manual creation is only allowed for 'other' or 'utilities' bills.");
    }

    // Validation: Check date vs Contract
    const contract = await prisma.contracts.findUnique({ where: { contract_id: data.contract_id } });
    if (!contract) throw new Error("Contract not found");

    if (new Date(data.billing_period_start) < new Date(contract.start_date)) {
      throw new Error("Billing period cannot start before the contract start date.");
    }

    const billNumber = generateBillNumber(
      new Date().getFullYear(),
      new Date().getMonth() + 1,
      data.bill_type
    );

    return prisma.bills.create({
      data: {
        ...data,
        bill_number: billNumber,
        status: 'draft',
        created_by: createdById,
        billing_period_start: new Date(data.billing_period_start),
        billing_period_end: new Date(data.billing_period_end),
        due_date: new Date(data.due_date),
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
        include: { contract: true } // Need contract info for room
    });

    if (!originalDraft || originalDraft.status !== "draft") {
      const error = new Error("Only draft bills can be updated here.");
      error.statusCode = 403;
      throw error;
    }

    // --- CASE A: PUBLISHING UTILITY BILL ---
    // If it's a utility bill being issued, we must use createUtilityBill logic
    // to properly link the reading and ensure data consistency.
    if (data.status === "issued" && originalDraft.bill_type === 'utilities') {
        return this._publishUtilityBillFromDraft(originalDraft, data);
    }

    // --- CASE B: STANDARD UPDATE/PUBLISH (Other) ---
    const { service_charges, ...mainData } = data;
    let updateData = { ...mainData, updated_at: new Date() };

    // Handle Publishing (Draft -> Issued)
    if (data.status === "issued") {
      const finalData = { ...originalDraft, ...data };
      const periodStart = new Date(finalData.billing_period_start);
      const periodEnd = new Date(finalData.billing_period_end);

      await this._checkBillOverlap(
          // Need to fetch room_id from contract if it's missing in bill
          (await this._getRoomIdFromContract(originalDraft.contract_id)),
          periodStart, 
          periodEnd, 
          billId, 
          originalDraft.bill_type
      );

      // Regenerate number to match Issued format/time
      updateData.bill_number = generateBillNumber(
        periodStart.getFullYear(),
        periodStart.getMonth() + 1,
        originalDraft.bill_type
      );
    }

    // Format Dates
    if (data.billing_period_start) updateData.billing_period_start = new Date(data.billing_period_start);
    if (data.billing_period_end) updateData.billing_period_end = new Date(data.billing_period_end);
    if (data.due_date) updateData.due_date = new Date(data.due_date);

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

          await this.createUtilityBill(room, building, reading, new Date(due_date), createdByUserId);

          results.success++;
          results.details.push({ room: room.room_number, status: 'created' });

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

      const periodStart = new Date(); // Use current time as reference
      const periodEnd = new Date();

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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = await prisma.bills.updateMany({
      where: {
        status: 'issued',
        due_date: { lt: today },
        deleted_at: null
      },
      data: {
        status: 'overdue',
        updated_at: new Date()
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
        updated_at: new Date()
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
        bill_type: true
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
            room_current: { select: { room_id: true, room_number: true } },
            room_history: { select: { room_id: true, room_number: true } }
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

  async deleteOrCancelBill(billId) {
    const bill = await prisma.bills.findUnique({
      where: { bill_id: billId },
      select: { status: true, deleted_at: true },
    });

    if (!bill) throw new Error("Bill not found");
    if (bill.deleted_at) throw new Error("Bill already deleted");

    if (bill.status === "draft") {
      // Soft delete draft
      return prisma.bills.update({ where: { bill_id: billId }, data: { deleted_at: new Date() } });
    } else if (["issued", "overdue"].includes(bill.status)) {
      // Soft cancel issued
      return prisma.bills.update({
        where: { bill_id: billId },
        data: { status: "cancelled", updated_at: new Date(), deleted_at: new Date() },
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
    console.log(`[BillReminder] Starting scan at ${new Date().toISOString()}...`);

    const today = new Date();

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
