const { PrismaClient, Role } = require('../generated/prisma/client.ts');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ 
  connectionString: process.env.DATABASE_URL 
});

const prisma = new PrismaClient({ adapter });

async function main() {
  const USER_PASSWORD = '$2a$10$vsGUFR7YnTrgdAwM4nR2TuRimOXIX5wimc20tYLtPm.23CZ7dvjQy'

  console.log('Seeding owner user...')

  try {
    // Check if owner already exists
    const existingOwner = await prisma.users.findFirst({
      where: {
        OR: [
          { email: 'owner@sami.com' },
          { phone: '0900000001' }
        ],
        role: Role.OWNER
      }
    })

    if (existingOwner) {
      console.log('Owner user already exists, skipping...')
      return
    }

    // Create owner user
    const owner = await prisma.users.create({
      data: {
        phone: '0900000001',
        email: 'owner@sami.com',
        password_hash: USER_PASSWORD,
        full_name: 'Chủ Toà Nhà',
        role: Role.OWNER,
        gender: 'Male',
        birthday: new Date('1970-01-01'),
        is_verified: true,
        status: 'Active'
      }
    })

    console.log(`Created owner user with ID: ${owner.user_id}`)
    console.log('Owner email:', owner.email)
    console.log('Owner phone:', owner.phone)
    
  } catch (error) {
    console.error('Error seeding owner user:', error)
    throw error
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
