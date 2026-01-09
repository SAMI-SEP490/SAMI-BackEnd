// src/services/bill.service.js
// Updated: 2026-01-04
// Features: Auto-Billing (Rent/Utility), Rent Cap, Overdue Extension, New Schema Support

const prisma = require('../config/prisma');
const crypto = require('crypto');

// Helper: Generate unique bill number (e.g., B-RNT-202601-1234AB)
function generateBillNumber(year, month, type) {
  const timestampPart = Date.now().toString().slice(-4);
  const randomPart = crypto.randomBytes(2).toString('hex').toUpperCase();
  const typeCode = type === 'monthly_rent' ? 'RNT' : 'UTL';
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

    console.log(`[AutoBill] Running scan for Day ${currentDayOfMonth}...`);

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
    for (const contract of activeContracts) {
      // Check if TODAY is the contract's cycle day
      if (this._shouldCreateRentBill(contract, today)) {
        await this.createRentBill({
          contract_id: contract.contract_id,
          tenant_user_id: contract.tenant_user_id,
          amount: contract.rent_amount,
          // Period starts TODAY
          periodStart: today,
          // Deadline is 5 days from now
          dueDate: paymentDeadline,
          cycleMonths: contract.payment_cycle_months
        });
        rentCount++;
      }
    }

    // B. UTILITY BILLS (Based on Building.bill_due_day)
    // Find buildings where TODAY is the billing day
    const buildingsDue = await prisma.buildings.findMany({
      where: {
        is_active: true,
        bill_due_day: currentDayOfMonth
      }
    });

    let utilityCount = 0;
    for (const building of buildingsDue) {
      await this._processUtilityBillsForBuilding(building, paymentDeadline);
      utilityCount++;
    }

    return { rent_created: rentCount, utility_batches: utilityCount };
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
        current_contract_id: { not: null } // Only occupied rooms
      },
      include: { current_contract: true }
    });

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

      // If reading exists and NOT billed yet
      if (reading && !reading.bill_id) {
        await this.createUtilityBill(room, building, reading, dueDate);
      }
    }
  }

  // ==========================================
  // 2. CREATION LOGIC (Used by Cron & Manual)
  // ==========================================

  async createRentBill({ contract_id, tenant_user_id, amount, periodStart, dueDate, cycleMonths = 1 }) {
    // Task 3: Rent Cap Check
    const contract = await prisma.contracts.findUnique({ where: { contract_id }, select: { rent_amount: true, room_id: true } });
    if (Number(amount) > Number(contract.rent_amount)) throw new Error(`Bill amount exceeds contract rent`);

    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + cycleMonths);

    // Uses Contract ID for overlap check (Schema Update)
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
    // Calculate costs (Standard logic)
    const electricUsed = reading.curr_electric - reading.prev_electric;
    const waterUsed = reading.curr_water - reading.prev_water;

    const electricCost = electricUsed * Number(reading.electric_price);
    const waterCost = waterUsed * Number(reading.water_price);
    const serviceFee = Number(building.service_fee || 0);

    const totalAmount = electricCost + waterCost + serviceFee;

    // Period: 1st to End of Billing Month
    const periodStart = new Date(reading.billing_year, reading.billing_month - 1, 1);
    const periodEnd = new Date(reading.billing_year, reading.billing_month, 0);

    // Overlap Check (Specific to Utilities)
    // Prevent creating a second 'utilities' bill for this room & period
    await this._checkBillOverlap(room.room_id, periodStart, periodEnd, null, 'utilities');

    const billNumber = generateBillNumber(reading.billing_year, reading.billing_month, 'utilities');

    // Transaction: Create Bill AND Link Reading
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

  /**
   * Create a Draft Bill (Flexible, fewer validation rules)
   */
  async createDraftBill(data, createdById) {
    // Generate a temporary bill number or leave null? 
    // Best practice: Generate one so it's trackable, even as draft.
    const billNumber = generateBillNumber(
      new Date().getFullYear(),
      new Date().getMonth() + 1,
      data.bill_type || 'other'
    );

    return prisma.bills.create({
      data: {
        ...data,
        bill_number: billNumber,
        status: 'draft',
        created_by: createdById,
        // Ensure dates are objects if passed
        billing_period_start: new Date(data.billing_period_start),
        billing_period_end: new Date(data.billing_period_end),
        due_date: new Date(data.due_date),
        // If service charges are provided in the body, create them
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
   * Create and Immediately Issue a Bill (Strict Validation)
   */
  async createIssuedBill(data, createdById) {
    const {
      contract_id, room_id, tenant_user_id,
      total_amount, bill_type,
      billing_period_start, billing_period_end, due_date,
      service_charges
    } = data;

    // 1. Rent Cap Validation (Task 3)
    if (bill_type === 'monthly_rent') {
      const contract = await prisma.contracts.findUnique({
        where: { contract_id: contract_id }
      });
      if (!contract) throw new Error("Contract not found");

      // Only check if total_amount is strictly greater
      if (Number(total_amount) > Number(contract.rent_amount)) {
        throw new Error(`Rent bill amount (${total_amount}) cannot exceed contract rent (${contract.rent_amount})`);
      }
    }

    // 2. Overlap Check (Task 4)
    const periodStart = new Date(billing_period_start);
    const periodEnd = new Date(billing_period_end);
    await this._checkBillOverlap(data.room_id, periodStart, periodEnd, null, data.bill_type);

    // 3. Generate Bill Number
    const billNumber = generateBillNumber(
      periodStart.getFullYear(),
      periodStart.getMonth() + 1,
      bill_type || 'other'
    );

    // 4. Create Bill with Line Items (Transaction)
    // If no service_charges provided, create a default one from the total
    const chargesToCreate = service_charges && service_charges.length > 0
      ? service_charges
      : [{
        service_type: bill_type === 'monthly_rent' ? 'Tiền thuê phòng' : 'Chi phí khác',
        amount: total_amount,
        description: data.description || 'Chi phí theo yêu cầu'
      }];

    return prisma.bills.create({
      data: {
        bill_number: billNumber,
        contract_id,
        tenant_user_id,
        bill_type,
        billing_period_start: periodStart,
        billing_period_end: periodEnd,
        due_date: new Date(due_date),
        total_amount,
        status: 'issued', // Force status
        description: data.description,
        created_by: createdById,
        service_charges: {
          create: chargesToCreate.map(c => ({
            service_type: c.service_type,
            quantity: c.quantity || 1,
            unit_price: c.unit_price || c.amount,
            amount: c.amount,
            description: c.description
          }))
        }
      },
      include: { service_charges: true }
    });
  }

  // ==========================================
  // 3. OVERDUE & EXTENSION (Task 2)
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
  // 4. LISTING & GETTERS (Merged & Updated)
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
    return prisma.bills.findMany({
      where: {
        status: { notIn: ["draft", "cancelled"] },
        deleted_at: null,
        ...filters,
      },
      orderBy: { created_at: "desc" },
      include: {
        tenants: { select: { user: { select: { user_id: true, full_name: true } } } },
        creator: { select: { user_id: true, full_name: true } }, // Schema says 'creator' not 'users' for BillCreatedBy
      },
    });
  }

  async getDraftBills() {
    return prisma.bills.findMany({
      where: { status: "draft", deleted_at: null },
      orderBy: { created_at: "desc" },
      include: {
        tenants: { select: { user: { select: { user_id: true, full_name: true } } } },
        creator: { select: { user_id: true, full_name: true } },
      },
    });
  }

  async getDeletedBills() {
    return prisma.bills.findMany({
      where: { deleted_at: { not: null } },
      orderBy: { deleted_at: "desc" },
      include: {
        tenants: { select: { user: { select: { user_id: true, full_name: true } } } },
        creator: { select: { user_id: true, full_name: true } },
      },
    });
  }

  /**
   * Get Bill Details.
   * UPDATED: Includes 'utilityReadings' and 'service_charges'.
   */
  async getBillById(billId) {
    const bill = await prisma.bills.findUnique({
      where: { bill_id: billId },
      include: {
        tenants: {
          select: { user: { select: { user_id: true, full_name: true, phone: true } } },
        },
        creator: { select: { user_id: true, full_name: true } },
        service_charges: true, // [NEW]
        utilityReadings: true, // [NEW]
        payment_details: {
          include: { payment: true }
        }
      },
    });
    if (!bill) {
      const error = new Error("Bill not found");
      error.statusCode = 404;
      throw error;
    }
    return bill;
  }

  /**
   * Get rooms that haven't been billed for a specific period.
   * UPDATED: Uses 'current_contract' to find the actual active tenant.
   */
  async getUnbilledRooms(periodStartDate) {
    if (!periodStartDate || isNaN(new Date(periodStartDate).getTime())) {
      const error = new Error("Invalid billing period start date.");
      error.statusCode = 400;
      throw error;
    }

    return prisma.rooms.findMany({
      where: {
        is_active: true,
        current_contract_id: { not: null }, // Must have a contract
        bills: {
          none: {
            billing_period_start: new Date(periodStartDate),
            status: { not: "cancelled" },
          },
        },
      },
      select: {
        floor: true,
        // Use current_contract to get the correct tenant
        current_contract: {
          select: {
            tenant: {
              select: {
                user_id: true,
                user: { select: { full_name: true } }
              }
            }
          }
        }
      },
    });
  }

  // ==========================================
  // 5. UPDATE & UTILS
  // ==========================================

  async updateDraftBill(billId, data) {
    const originalDraft = await prisma.bills.findUnique({ where: { bill_id: billId } });

    if (!originalDraft || originalDraft.status !== "draft") {
      const error = new Error("Only draft bills can be updated here.");
      error.statusCode = 403;
      throw error;
    }

    const { service_charges, ...mainData } = data;
    let updateData = { ...mainData, updated_at: new Date() };

    // 1. Handle Publishing (Draft -> Issued)
    if (data.status === "issued") {
      const finalData = { ...originalDraft, ...data };
      const periodStart = new Date(finalData.billing_period_start);
      const periodEnd = new Date(finalData.billing_period_end);

      // Check overlap before making it official
      const billType = data.bill_type || originalDraft.bill_type; // Get from input or DB
      await this._checkBillOverlap(finalData.room_id, periodStart, periodEnd, billId, billType);

      updateData.bill_number = generateBillNumber(
        periodStart.getFullYear(),
        periodStart.getMonth() + 1,
        finalData.bill_type || 'other'
      );
    }

    // 2. Format Dates
    if (data.billing_period_start) updateData.billing_period_start = new Date(data.billing_period_start);
    if (data.billing_period_end) updateData.billing_period_end = new Date(data.billing_period_end);
    if (data.due_date) updateData.due_date = new Date(data.due_date);

    // 3. Transaction: Update Bill AND Replace Charges
    return prisma.$transaction(async (tx) => {
      // A. Update the main Bill info
      const updatedBill = await tx.bills.update({
        where: { bill_id: billId },
        data: updateData,
      });

      // B. If service charges are provided, REPLACE them
      // (Simpler than diffing: Delete all old -> Insert all new)
      if (service_charges && Array.isArray(service_charges)) {

        // Delete old charges
        await tx.bill_service_charges.deleteMany({
          where: { bill_id: billId }
        });

        // Insert new charges
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

  async updateIssuedBill(billId, data) {
    const bill = await prisma.bills.findUnique({
      where: { bill_id: billId },
      select: { status: true, room_id: true, billing_period_start: true, billing_period_end: true },
    });

    if (!bill) throw new Error("Bill not found");
    if (bill.status !== "issued") throw new Error(`Cannot edit bill with status: ${bill.status}`);

    // Check Overlap if dates change
    if (data.billing_period_start || data.billing_period_end) {
      const newStart = data.billing_period_start ? new Date(data.billing_period_start) : bill.billing_period_start;
      const newEnd = data.billing_period_end ? new Date(data.billing_period_end) : bill.billing_period_end;
      const billType = data.bill_type || originalDraft.bill_type; // Get from input or DB
      await this._checkBillOverlap(finalData.room_id, periodStart, periodEnd, billId, billType);
    }

    const updateData = { ...data, updated_at: new Date() };
    if (data.due_date) updateData.due_date = new Date(data.due_date);
    if (data.billing_period_start) updateData.billing_period_start = new Date(data.billing_period_start);
    if (data.billing_period_end) updateData.billing_period_end = new Date(data.billing_period_end);

    return prisma.bills.update({
      where: { bill_id: billId },
      data: updateData,
    });
  }

  async deleteOrCancelBill(billId) {
    const bill = await prisma.bills.findUnique({
      where: { bill_id: billId },
      select: { status: true, deleted_at: true },
    });

    if (!bill) throw new Error("Bill not found");
    if (bill.deleted_at) throw new Error("Bill already deleted");

    if (bill.status === "draft") {
      return prisma.bills.update({ where: { bill_id: billId }, data: { deleted_at: new Date() } });
    } else if (["issued", "overdue"].includes(bill.status)) {
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
    // Build the where clause
    // Ensure you fetch contracts first since bills don't have room_id
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
    if (overlappingBill) throw new Error(`Billing period overlaps with existing ${overlappingBill.bill_type} bill: ${overlappingBill.bill_number}`);
  }
}

module.exports = new BillService();
