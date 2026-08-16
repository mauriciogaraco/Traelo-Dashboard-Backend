import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.systemConfig.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      defaultDelivererCommissionPercentage: 60,
    },
  });

  const ownerEmail = process.env.SEED_OWNER_EMAIL;
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;

  if (!ownerEmail || !ownerPassword) {
    throw new Error('SEED_OWNER_EMAIL y SEED_OWNER_PASSWORD son requeridos en .env para el seed.');
  }

  const passwordHash = await bcrypt.hash(ownerPassword, 12);

  await prisma.user.upsert({
    where: { email: ownerEmail },
    update: {},
    create: {
      name: 'Owner',
      email: ownerEmail,
      passwordHash,
      role: 'OWNER',
    },
  });

  console.log('Seed completado: SystemConfig y usuario OWNER listos.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
