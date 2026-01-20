// prisma/seed.js
// Run command: npx prisma db seed

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Hash for "password" (bcrypt hash for the word 'password')
const PASSWORD_HASH = '$2a$10$vsGUFR7YnTrgdAwM4nR2TuRimOXIX5wimc20tYLtPm.23CZ7dvjQy';

async function main() {
  console.log('🌱 Starting Ultimate Seed (v2.0)...');

  // --- 1. CLEANUP (Uncomment to wipe DB) ---
  // await prisma.bill_payment_details.deleteMany();
  // await prisma.bill_payments.deleteMany();
  // await prisma.bill_service_charges.deleteMany();
  // await prisma.bills.deleteMany();
  // await prisma.utility_readings.deleteMany();
  // await prisma.vehicle_registrations.deleteMany();
  // await prisma.vehicles.deleteMany();
  // await prisma.maintenance_requests.deleteMany();
  // await prisma.regulations.deleteMany();
  // await prisma.contract_addendums.deleteMany();
  // await prisma.contracts.deleteMany();
  // await prisma.room_tenants.deleteMany();
  // await prisma.rooms.deleteMany();
  // await prisma.building_managers.deleteMany();
  // await prisma.buildings.deleteMany();
  // await prisma.tenants.deleteMany();
  // await prisma.users.deleteMany();
  // console.log('🧹 Cleaned old data');

  // --- 2. USERS ---
  const owner = await prisma.users.upsert({
    where: { email: 'owner@sami.test' },
    update: {},
    create: { email: 'owner@sami.test', phone: '0900000001', password_hash: PASSWORD_HASH, full_name: 'Big Owner', role: 'OWNER' }
  });

  const manager = await prisma.users.upsert({
    where: { email: 'manager@sami.test' },
    update: {},
    create: { email: 'manager@sami.test', phone: '0900000002', password_hash: PASSWORD_HASH, full_name: 'Building Manager', role: 'MANAGER' }
  });

  const tenant1 = await prisma.users.upsert({
    where: { email: 'tenant1@sami.test' },
    update: {},
    create: { email: 'tenant1@sami.test', phone: '0900000003', password_hash: PASSWORD_HASH, full_name: 'Tenant A (Room 101)', role: 'TENANT' }
  });
  await prisma.tenants.upsert({ where: { user_id: tenant1.user_id }, update: {}, create: { user_id: tenant1.user_id, id_number: '001200000001' } });

  const tenant2 = await prisma.users.upsert({
    where: { email: 'tenant2@sami.test' },
    update: {},
    create: { email: 'tenant2@sami.test', phone: '0900000004', password_hash: PASSWORD_HASH, full_name: 'Tenant B (Room 201)', role: 'TENANT' }
  });
  await prisma.tenants.upsert({ where: { user_id: tenant2.user_id }, update: {}, create: { user_id: tenant2.user_id, id_number: '001200000002' } });

  console.log('✅ Users Created');

  // --- 3. BUILDINGS ---
  // Updated: Changed bill_due_day -> bill_closing_day
  const buildingA = await prisma.buildings.create({
    data: {
      name: 'SAMI Heights (Closing Day 25)',
      address: '101 Billing St',
      number_of_floors: 5,
      bill_closing_day: 25, // Cut-off date for Utilities
      electric_unit_price: 3500,
      water_unit_price: 25000,
      service_fee: 150000,
      is_active: true
    }
  });

  const buildingB = await prisma.buildings.create({
    data: {
      name: 'SAMI Tower (Closing Day 28)',
      address: '202 Late Fee Ave',
      number_of_floors: 10,
      bill_closing_day: 28,
      electric_unit_price: 4000,
      water_unit_price: 30000,
      service_fee: 200000,
      is_active: true
    }
  });

  // Assign Manager to Building A
  await prisma.building_managers.create({
    data: { user_id: manager.user_id, building_id: buildingA.building_id }
  });

  console.log('✅ Buildings Created');

  // --- 4. ROOMS ---
  const r101 = await prisma.rooms.create({
    data: { building_id: buildingA.building_id, room_number: '101', floor: 1, size: 30, status: 'occupied' }
  });

  const r102 = await prisma.rooms.create({
    data: { building_id: buildingA.building_id, room_number: '102', floor: 1, size: 30, status: 'available' }
  });

  const r201 = await prisma.rooms.create({
    data: { building_id: buildingB.building_id, room_number: '201', floor: 2, size: 50, status: 'occupied' }
  });

  console.log('✅ Rooms Created');

  // --- 5. CONTRACTS (Active) ---
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 2); // Started 2 months ago

  // Contract for Room 101 (With S3 Key for download test)
  const c1 = await prisma.contracts.create({
    data: {
      contract_number: 'CT-101',
      room_id: r101.room_id,
      tenant_user_id: tenant1.user_id,
      start_date: startDate,
      end_date: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
      duration_months: 12,
      rent_amount: 5000000, 
      deposit_amount: 5000000,
      status: 'active',
      // Fake S3 Key to test "Download Contract" bot feature
      s3_key: 'contracts/sample-contract.pdf',
      file_name: 'Hop_Dong_Thue_Nha_2025.pdf'
    }
  });
  await prisma.rooms.update({ where: { room_id: r101.room_id }, data: { current_contract_id: c1.contract_id } });
  await prisma.room_tenants.create({ data: { room_id: r101.room_id, tenant_user_id: tenant1.user_id, tenant_type: 'primary', moved_in_at: startDate, is_current: true }});

  // Contract for Room 201
  const c2 = await prisma.contracts.create({
    data: {
      contract_number: 'CT-201',
      room_id: r201.room_id,
      tenant_user_id: tenant2.user_id,
      start_date: startDate,
      end_date: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
      duration_months: 12,
      rent_amount: 8000000, 
      deposit_amount: 8000000,
      status: 'active'
    }
  });
  await prisma.rooms.update({ where: { room_id: r201.room_id }, data: { current_contract_id: c2.contract_id } });
  await prisma.room_tenants.create({ data: { room_id: r201.room_id, tenant_user_id: tenant2.user_id, tenant_type: 'primary', moved_in_at: startDate, is_current: true }});

  console.log('✅ Contracts Created');

  // --- 6. UTILITY HISTORY (Previous Month) ---
  // Create history so automation has a "Previous Index" to start from
  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  
  const billingMonth = lastMonth.getMonth() + 1; 
  const billingYear = lastMonth.getFullYear();

  await prisma.utility_readings.create({
    data: {
      room_id: r101.room_id,
      billing_month: billingMonth,
      billing_year: billingYear,
      recorded_date: lastMonth,
      prev_electric: 1000,
      curr_electric: 1200, 
      electric_price: 3500,
      prev_water: 50,
      curr_water: 60,      
      water_price: 25000,
      created_by: owner.user_id,
      // Default reset flags
      is_electric_reset: false,
      is_water_reset: false
    }
  });

  console.log('✅ Utility History Created');

  // --- 7. CREATE A PENDING BILL (For Payment Test) ---
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 5);

  await prisma.bills.create({
    data: {
      bill_number: 'B-RNT-TEST-001',
      contract_id: c1.contract_id,
      tenant_user_id: tenant1.user_id,
      bill_type: 'monthly_rent',
      billing_period_start: new Date(),
      billing_period_end: new Date(),
      due_date: dueDate,
      total_amount: 5000000,
      status: 'issued', // Issued = Unpaid (Ready for Payment Link)
      description: 'Tiền thuê nhà tháng này',
      created_by: manager.user_id
    }
  });

  console.log('✅ Test Bill Created (B-RNT-TEST-001)');

  // --- 8. REGULATIONS (For Bot Context) ---
  await prisma.regulations.create({
    data: {
      title: 'General Rules',
      content: 'No loud noise after 10PM.',
      status: 'published',
      target: 'all',
      created_by: owner.user_id,
      version: 1
    }
  });

  console.log('✅ Regulations Created');
  console.log('🚀 Seed Finished! Ready for testing.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
