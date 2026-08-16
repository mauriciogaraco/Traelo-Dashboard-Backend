import { prisma, decimalToNumber } from '../shared/prisma';
import type { Prisma } from '../generated/prisma/client';
import type { UpdateSystemConfigInput } from './system-config.dto';

const SINGLETON_ID = 'singleton';

export interface SystemConfigDTO {
  defaultDelivererCommissionPercentage: number;
  updatedAt: Date;
}

function toDTO(config: {
  defaultDelivererCommissionPercentage: Prisma.Decimal;
  updatedAt: Date;
}): SystemConfigDTO {
  return {
    defaultDelivererCommissionPercentage: decimalToNumber(
      config.defaultDelivererCommissionPercentage,
    ),
    updatedAt: config.updatedAt,
  };
}

export async function getSystemConfig(): Promise<SystemConfigDTO> {
  const config = await prisma.systemConfig.upsert({
    where: { id: SINGLETON_ID },
    update: {},
    create: { id: SINGLETON_ID, defaultDelivererCommissionPercentage: 60 },
  });

  return toDTO(config);
}

export async function updateSystemConfig(input: UpdateSystemConfigInput): Promise<SystemConfigDTO> {
  const config = await prisma.systemConfig.upsert({
    where: { id: SINGLETON_ID },
    update: { defaultDelivererCommissionPercentage: input.defaultDelivererCommissionPercentage },
    create: {
      id: SINGLETON_ID,
      defaultDelivererCommissionPercentage: input.defaultDelivererCommissionPercentage,
    },
  });

  return toDTO(config);
}
