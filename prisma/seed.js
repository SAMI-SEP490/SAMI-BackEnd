// prisma/seed.js
const { PrismaClient, Role } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Create Owner
  const owner = await prisma.users.upsert({
    where: { email: 'owner@sami.com' },
    update: {
      // If user exists, ensure these are correct
      role: 'OWNER', // Safe string fallback or use Role.OWNER
      is_verified: true,
    },
    create: {
      phone: '0900000001',
      email: 'owner@sami.com',
      // The hash provided (Pre-hashed password)
      password_hash: '$2a$10$vsGUFR7YnTrgdAwM4nR2TuRimOXIX5wimc20tYLtPm.23CZ7dvjQy',
      full_name: 'Chủ Toà Nhà',
      role: 'OWNER',
      gender: 'Male',
      birthday: new Date('1970-01-01'),
      is_verified: true,
      status: 'Active',
      avatar_url: 'https://placehold.co/400' 
    },
  });

  console.log('✅ Owner created:', owner.email);
  console.log('🏁 Seeding finished.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
