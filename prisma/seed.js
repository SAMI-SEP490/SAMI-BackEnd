const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
    // --- USERS (idempotent: tìm theo phone trước, nếu không có thì tạo) ---
    let admin = await prisma.users.findUnique({ where: { phone: '0900000001' } });
    if (!admin) {
        admin = await prisma.users.create({
            data: {
                phone: '0900000001',
                email: 'admin@example.com',
                password_hash: 'pass_hash_admin',
                full_name: 'Admin User',
            },
        });
    }

    let alice = await prisma.users.findUnique({ where: { phone: '0900000002' } });
    if (!alice) {
        alice = await prisma.users.create({
            data: {
                phone: '0900000002',
                email: 'alice@example.com',
                password_hash: 'pass_hash_alice',
                full_name: 'Alice Tenant',
            },
        });
    }

    let bob = await prisma.users.findUnique({ where: { phone: '0900000003' } });
    if (!bob) {
        bob = await prisma.users.create({
            data: {
                phone: '0900000003',
                email: 'bob@example.com',
                password_hash: 'pass_hash_bob',
                full_name: 'Bob Manager',
            },
        });
    }

    // --- TENANT (connect tới user đã có) ---
    // tenants.user_id is PK and relation to users; check by id_number unique
    let tenantAlice = await prisma.tenants.findFirst({ where: { id_number: 'TNT-0001' } });
    if (!tenantAlice) {
        await prisma.tenants.create({
            data: {
                tenant_since: new Date('2024-01-01'),
                id_number: 'TNT-0001',
                emergency_contact_phone: '0987654321',
                note: 'Tenant sample',
                users: { connect: { user_id: alice.user_id } },
            },
        });
    }

    // --- BUILDING ---
    let building = await prisma.buildings.findFirst({ where: { name: 'Sunrise Tower' } });
    if (!building) {
        building = await prisma.buildings.create({
            data: {
                name: 'Sunrise Tower',
                address: '123 Example St, District 1',
                is_active: true,
            },
        });
    }

    // building owner (connect to existing user)
    const existingOwner = await prisma.building_owner.findUnique({ where: { user_id: admin.user_id } });
    if (!existingOwner) {
        await prisma.building_owner.create({
            data: {
                notes: 'Owner of Sunrise Tower',
                users: { connect: { user_id: admin.user_id } },
            },
        });
    }

    // building manager (user_id + building_id is not unique but we avoid duplicate by findFirst)
    const bm = await prisma.building_managers.findFirst({
        where: { user_id: bob.user_id, building_id: building.building_id },
    });
    if (!bm) {
        await prisma.building_managers.create({
            data: {
                assigned_from: new Date('2024-01-01'),
                note: 'Primary building manager',
                users: { connect: { user_id: bob.user_id } },
                buildings: { connect: { building_id: building.building_id } },
            },
        });
    }

    // --- ROOMS ---
    let room101 = await prisma.rooms.findFirst({
        where: { building_id: building.building_id, room_number: '101' },
    });
    if (!room101) {
        room101 = await prisma.rooms.create({
            data: {
                room_number: '101',
                floor: 1,
                size: '30m2',
                description: 'Corner room with balcony',
                buildings: { connect: { building_id: building.building_id } },
            },
        });
    }

    let room102 = await prisma.rooms.findFirst({
        where: { building_id: building.building_id, room_number: '102' },
    });
    if (!room102) {
        room102 = await prisma.rooms.create({
            data: {
                room_number: '102',
                floor: 1,
                size: '28m2',
                buildings: { connect: { building_id: building.building_id } },
            },
        });
    }

    // --- CONTRACT ---
    const existingContract = await prisma.contracts.findFirst({
        where: { room_id: room101.room_id, tenant_user_id: alice.user_id },
    });
    if (!existingContract) {
        await prisma.contracts.create({
            data: {
                start_date: new Date('2025-01-01'),
                end_date: new Date('2025-12-31'),
                rent_amount: '500.00',
                deposit_amount: '500.00',
                status: 'active',
                note: '12-month lease',
                rooms: { connect: { room_id: room101.room_id } },
                tenants: { connect: { user_id: alice.user_id } },
            },
        });
    }

    // --- FLOOR PLAN ---
    const fpExists = await prisma.floor_plans.findFirst({
        where: { building_id: building.building_id, floor_number: 1, version: 1 },
    });
    if (!fpExists) {
        await prisma.floor_plans.create({
            data: {
                name: 'First Floor Plan',
                floor_number: 1,
                version: 1,
                layout: { rooms: ['101', '102'] },
                is_published: true,
                created_at: new Date(),
                buildings: { connect: { building_id: building.building_id } },
                users: { connect: { user_id: admin.user_id } },
            },
        });
    }

    // --- REGULATION ---
    const regExists = await prisma.regulations.findFirst({
        where: { title: 'Quiet Hours Policy', building_id: building.building_id },
    });
    if (!regExists) {
        await prisma.regulations.create({
            data: {
                title: 'Quiet Hours Policy',
                content: 'No loud noise after 22:00',
                effective_date: new Date('2024-01-01'),
                version: 1,
                status: 'published',
                created_at: new Date(),
                buildings: { connect: { building_id: building.building_id } },
                users: { connect: { user_id: admin.user_id } },
            },
        });
    }

    // --- BILL (issued) ---
    let bill = await prisma.bills.findUnique({ where: { bill_number: 'BILL-2025-0001' } });
    if (!bill) {
        bill = await prisma.bills.create({
            data: {
                bill_number: 'BILL-2025-0001',
                billing_period_start: new Date('2025-09-01'),
                billing_period_end: new Date('2025-09-30'),
                due_date: new Date('2025-10-05'),
                total_amount: '550.00',
                paid_amount: '0.00',
                status: 'issued',
                description: 'September rent + utilities',
                is_recurring: true,
                created_at: new Date(),
                tenants: { connect: { user_id: alice.user_id } },
                users: { connect: { user_id: bob.user_id } },
            },
        });
    }

    // --- PAYMENT ---
    // payment reference may be unique-ish; we check by reference
    let payment = await prisma.bill_payments.findFirst({ where: { reference: 'TXN-20251013-0001' } });
    if (!payment) {
        payment = await prisma.bill_payments.create({
            data: {
                amount: '550.00',
                payment_date: new Date(),
                method: 'bank_transfer',
                status: 'completed',
                reference: 'TXN-20251013-0001',
                note: 'Paid full amount via bank transfer',
                users: { connect: { user_id: alice.user_id } },
            },
        });

        // connect payment to bill if not already connected
        await prisma.bills.update({
            where: { bill_id: bill.bill_id },
            data: {
                bill_payments: { connect: { payment_id: payment.payment_id } },
                paid_amount: payment.amount,
                status: 'paid',
            },
        });
    }

    // --- VEHICLE ---
    let vehicle = await prisma.vehicles.findFirst({
        where: { tenants: { user_id: alice.user_id }, note: 'Toyota example' },
    });
    if (!vehicle) {
        vehicle = await prisma.vehicles.create({
            data: {
                type: 'car',
                status: 'approved',
                registered_at: new Date(),
                note: 'Toyota example',
                tenants: { connect: { user_id: alice.user_id } },
            },
        });
    }

    // --- VEHICLE SLOT REGISTRATION ---
    const vsrExists = await prisma.vehicle_slot_registration.findFirst({
        where: { vehicle_id: vehicle.vehicle_id, requested_by: alice.user_id },
    });
    if (!vsrExists) {
        await prisma.vehicle_slot_registration.create({
            data: {
                requested_at: new Date(),
                status: 'approved',
                approved_at: new Date(),
                start_date: new Date('2025-10-01'),
                end_date: new Date('2026-10-01'),
                note: 'Assigned slot 5',
                vehicles: { connect: { vehicle_id: vehicle.vehicle_id } },
                tenants: { connect: { user_id: alice.user_id } },
                users: { connect: { user_id: bob.user_id } },
            },
        });
    }

    // --- MAINTENANCE REQUEST ---
    const mrExists = await prisma.maintenance_requests.findFirst({
        where: { tenant_user_id: alice.user_id, title: 'Leaky faucet' },
    });
    if (!mrExists) {
        await prisma.maintenance_requests.create({
            data: {
                title: 'Leaky faucet',
                description: 'Tap leaking in the bathroom',
                category: 'plumbing',
                priority: 'normal',
                status: 'pending',
                created_at: new Date(),
                note: 'Please fix soon',
                tenants: { connect: { user_id: alice.user_id } },
                rooms: { connect: { room_id: room101.room_id } },
                users: { connect: { user_id: bob.user_id } },
            },
        });
    }

    // --- GUEST REGISTRATION (example) ---
    const grExists = await prisma.guest_registrations.findFirst({
        where: { host_user_id: alice.user_id, guest_name: 'John Visitor' },
    });
    if (!grExists) {
        await prisma.guest_registrations.create({
            data: {
                guest_name: 'John Visitor',
                id_number: 'CIT-1234',
                contact: '0911222333',
                guest_count: 1,
                arrival_date: new Date('2025-10-20'),
                departure_date: new Date('2025-10-22'),
                status: 'pending',
                created_at: new Date(),
                submitted_at: new Date(),
                tenants: { connect: { user_id: alice.user_id } },
                rooms: { connect: { room_id: room101.room_id } },
            },
        });
    }

    console.log('✅ Seed finished (idempotent)');
}

main()
    .catch((e) => {
        console.error('Seed error', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
