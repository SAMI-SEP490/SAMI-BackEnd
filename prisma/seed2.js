const { PrismaClient, Role } = require('@prisma/client');

const prisma = new PrismaClient();

// =================================================================
// 1. ĐẶT MẬT KHẨU ĐÃ BĂM (HASHED) CỦA BẠN TẠI ĐÂY
// =================================================================
// All users will share this password.
// Replace 'YOUR_HASHED_PASSWORD_HERE' with your actual password hash.
const USER_PASSWORD = '$2a$10$vsGUFR7YnTrgdAwM4nR2TuRimOXIX5wimc20tYLtPm.23CZ7dvjQy';
// =================================================================

async function main() {
    console.log('🌱 Bắt đầu chạy seed...');

    if (USER_PASSWORD === 'YOUR_HASHED_PASSWORD_HERE') {
        console.warn(
            '!! CẢNH BÁO: Mật khẩu mặc định chưa được đặt. Vui lòng chỉnh sửa tệp prisma/seed.js và đặt biến USER_PASSWORD.',
        );
    }

    // --- 1. Tạo Tòa nhà ---
    let building = await prisma.buildings.findFirst({
        where: { name: 'SAMI Apartment (Hai Duong)' },
    });

    if (!building) {
        building = await prisma.buildings.create({
            data: {
                name: 'SAMI Apartment (Hai Duong)',
                address: '123 Đường Thanh Niên, TP. Hải Dương',
                is_active: true,
                number_of_floors: 10,
            },
        });
        console.log(`Đã tạo tòa nhà mới: ${building.name}`);
    } else {
        console.log(`Đã tìm thấy tòa nhà: ${building.name}`);
    }

    // --- 2. Tạo Phòng (6 phòng) ---
    const room101 = await prisma.rooms.upsert({
        where: { building_id_room_number: { building_id: building.building_id, room_number: '101' } },
        update: { status: 'occupied' },
        create: {
            building_id: building.building_id,
            room_number: '101',
            floor: 1,
            size: '30m2',
            status: 'occupied',
        },
    });

    const room102 = await prisma.rooms.upsert({
        where: { building_id_room_number: { building_id: building.building_id, room_number: '102' } },
        update: { status: 'occupied' },
        create: {
            building_id: building.building_id,
            room_number: '102',
            floor: 1,
            size: '28m2',
            status: 'occupied',
        },
    });

    const room201 = await prisma.rooms.upsert({
        where: { building_id_room_number: { building_id: building.building_id, room_number: '201' } },
        update: { status: 'occupied' },
        create: {
            building_id: building.building_id,
            room_number: '201',
            floor: 2,
            size: '30m2',
            status: 'occupied',
        },
    });

    const room202 = await prisma.rooms.upsert({
        where: { building_id_room_number: { building_id: building.building_id, room_number: '202' } },
        update: { status: 'occupied' },
        create: {
            building_id: building.building_id,
            room_number: '202',
            floor: 2,
            size: '28m2',
            status: 'occupied',
        },
    });

    // --- PHÒNG MỚI (TRỐNG) ---
    const room301 = await prisma.rooms.upsert({
        where: { building_id_room_number: { building_id: building.building_id, room_number: '301' } },
        update: { status: 'available' },
        create: {
            building_id: building.building_id,
            room_number: '301',
            floor: 3,
            size: '25m2',
            status: 'available',
        },
    });

    const room302 = await prisma.rooms.upsert({
        where: { building_id_room_number: { building_id: building.building_id, room_number: '302' } },
        update: { status: 'available' },
        create: {
            building_id: building.building_id,
            room_number: '302',
            floor: 3,
            size: '25m2',
            status: 'available',
        },
    });
    console.log('Đã tạo/tìm thấy 6 phòng (4 đã thuê, 2 còn trống).');

    // --- 3. Tạo Chủ Tòa Nhà (Owner) ---
    const ownerUser = await prisma.users.upsert({
        where: { phone: '0900000001' },
        update: {},
        create: {
            phone: '0900000001',
            email: 'owner@sami.com',
            password_hash: USER_PASSWORD,
            full_name: 'Chủ Toà Nhà',
            role: Role.OWNER,
            gender: 'Male',
            birthday: new Date('1970-01-01'),
            is_verified: true,
        },
    });
    const ownerRecord = await prisma.building_owner.upsert({
        where: { user_id: ownerUser.user_id },
        update: {},
        create: {
            user_id: ownerUser.user_id,
            notes: 'Chủ sở hữu toà nhà SAMI',
        },
    });
    console.log(`Đã tạo/tìm thấy chủ sở hữu: ${ownerUser.full_name}`);

    // --- 4. Tạo Quản Lý (Managers) (2) ---
    const managerUserA = await prisma.users.upsert({
        where: { phone: '0900000002' },
        update: {},
        create: {
            phone: '0900000002',
            email: 'manager.a@sami.com',
            password_hash: USER_PASSWORD,
            full_name: 'Nguyễn Văn A', // <-- ĐÃ THAY ĐỔI
            role: Role.MANAGER,
            gender: 'Male',
            birthday: new Date('1985-05-15'),
            is_verified: true,
        },
    });
    const managerRecordA = await prisma.building_managers.upsert({
        where: { user_id: managerUserA.user_id },
        update: {},
        create: {
            user_id: managerUserA.user_id,
            building_id: building.building_id,
            assigned_from: new Date('2025-01-01'),
        },
    });
    console.log(`Đã tạo/tìm thấy quản lý: ${managerUserA.full_name}`);

    const managerUserB = await prisma.users.upsert({
        where: { phone: '0900000003' },
        update: {},
        create: {
            phone: '0900000003',
            email: 'manager.b@sami.com',
            password_hash: USER_PASSWORD,
            full_name: 'Trần Thị B', // <-- ĐÃ THAY ĐỔI
            role: Role.MANAGER,
            gender: 'Female',
            birthday: new Date('1990-11-20'),
            is_verified: true,
        },
    });
    const managerRecordB = await prisma.building_managers.upsert({
        where: { user_id: managerUserB.user_id },
        update: {},
        create: {
            user_id: managerUserB.user_id,
            building_id: building.building_id,
            assigned_from: new Date('2025-01-01'),
        },
    });
    console.log(`Đã tạo/tìm thấy quản lý: ${managerUserB.full_name}`);

    // --- 5. Tạo Người Thuê (Tenants) (4) ---

    // Tenant 1: (Age 18-25)
    const tenantUserA = await prisma.users.upsert({
        where: { phone: '0910000001' },
        update: {},
        create: {
            phone: '0910000001',
            email: 'an.nguyen@tenant.com',
            password_hash: USER_PASSWORD,
            full_name: 'Nguyễn Văn An',
            role: Role.TENANT,
            gender: 'Male',
            birthday: new Date('2000-03-10'),
            is_verified: true,
        },
    });
    const tenantRecordA = await prisma.tenants.upsert({
        where: { user_id: tenantUserA.user_id },
        update: {},
        create: {
            user_id: tenantUserA.user_id,
            id_number: '001123456001',
            tenant_since: new Date('2025-02-01'),
            room_id: room101.room_id,
            emergency_contact_phone: '0911111111',
        },
    });
    let contractA = await prisma.contracts.findFirst({
        where: { tenant_user_id: tenantUserA.user_id },
    });
    if (!contractA) {
        contractA = await prisma.contracts.create({
            data: {
                tenant_user_id: tenantUserA.user_id,
                room_id: room101.room_id,
                start_date: new Date('2025-02-01'),
                end_date: new Date('2026-01-31'),
                rent_amount: 5000000,
                status: 'active',
            },
        });
    }
    console.log(`Đã tạo/tìm thấy người thuê: ${tenantUserA.full_name} trong phòng ${room101.room_number}`);

    // Tenant 2: (Age 26-35)
    const tenantUserB = await prisma.users.upsert({
        where: { phone: '0910000002' },
        update: {},
        create: {
            phone: '0910000002',
            email: 'binh.tran@tenant.com',
            password_hash: USER_PASSWORD,
            full_name: 'Trần Thị Bình',
            role: Role.TENANT,
            gender: 'Female',
            birthday: new Date('1995-07-20'),
            is_verified: true,
        },
    });
    const tenantRecordB = await prisma.tenants.upsert({
        where: { user_id: tenantUserB.user_id },
        update: {},
        create: {
            user_id: tenantUserB.user_id,
            id_number: '001123456002',
            tenant_since: new Date('2025-03-01'),
            room_id: room102.room_id,
            emergency_contact_phone: '0922222222',
        },
    });
    let contractB = await prisma.contracts.findFirst({
        where: { tenant_user_id: tenantUserB.user_id },
    });
    if (!contractB) {
        contractB = await prisma.contracts.create({
            data: {
                tenant_user_id: tenantUserB.user_id,
                room_id: room102.room_id,
                start_date: new Date('2025-03-01'),
                end_date: new Date('2026-02-28'),
                rent_amount: 4500000,
                status: 'active',
            },
        });
    }
    console.log(`Đã tạo/tìm thấy người thuê: ${tenantUserB.full_name} trong phòng ${room102.room_number}`);

    // Tenant 3: (Age 36-50)
    const tenantUserC = await prisma.users.upsert({
        where: { phone: '0910000003' },
        update: {},
        create: {
            phone: '0910000003',
            email: 'cuong.le@tenant.com',
            password_hash: USER_PASSWORD,
            full_name: 'Lê Văn Cường',
            role: Role.TENANT,
            gender: 'Male',
            birthday: new Date('1988-12-01'),
            is_verified: true,
        },
    });
    const tenantRecordC = await prisma.tenants.upsert({
        where: { user_id: tenantUserC.user_id },
        update: {},
        create: {
            user_id: tenantUserC.user_id,
            id_number: '001123456003',
            tenant_since: new Date('2025-04-01'),
            room_id: room201.room_id,
            emergency_contact_phone: '0933333333',
        },
    });
    let contractC = await prisma.contracts.findFirst({
        where: { tenant_user_id: tenantUserC.user_id },
    });
    if (!contractC) {
        contractC = await prisma.contracts.create({
            data: {
                tenant_user_id: tenantUserC.user_id,
                room_id: room201.room_id,
                start_date: new Date('2025-04-01'),
                end_date: new Date('2026-03-31'),
                rent_amount: 5000000,
                status: 'active',
            },
        });
    }
    console.log(`Đã tạo/tìm thấy người thuê: ${tenantUserC.full_name} trong phòng ${room201.room_number}`);

    // Tenant 4: (Age Over 50)
    const tenantUserD = await prisma.users.upsert({
        where: { phone: '0910000004' },
        update: {},
        create: {
            phone: '0910000004',
            email: 'dung.pham@tenant.com',
            password_hash: USER_PASSWORD,
            full_name: 'Phạm Thị Dung',
            role: Role.TENANT,
            gender: 'Female',
            birthday: new Date('1972-06-05'),
            is_verified: true,
        },
    });
    const tenantRecordD = await prisma.tenants.upsert({
        where: { user_id: tenantUserD.user_id },
        update: {},
        create: {
            user_id: tenantUserD.user_id,
            id_number: '001123456004',
            tenant_since: new Date('2025-05-01'),
            room_id: room202.room_id,
            emergency_contact_phone: '0944444444',
        },
    });
    let contractD = await prisma.contracts.findFirst({
        where: { tenant_user_id: tenantUserD.user_id },
    });
    if (!contractD) {
        contractD = await prisma.contracts.create({
            data: {
                tenant_user_id: tenantUserD.user_id,
                room_id: room202.room_id,
                start_date: new Date('2025-05-01'),
                end_date: new Date('2026-04-30'),
                rent_amount: 4500000,
                status: 'active',
            },
        });
    }
    console.log(`Đã tạo/tìm thấy người thuê: ${tenantUserD.full_name} trong phòng ${room202.room_number}`);

    console.log('✅ Seed đã hoàn thành thành công.');
}

main()
    .catch((e) => {
        console.error('Lỗi khi chạy seed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
