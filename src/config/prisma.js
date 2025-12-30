const { PrismaClient } = require('../../generated/prisma/client.ts');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ 
  connectionString: process.env.DATABASE_URL 
});

const prisma = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

module.exports = prisma;
