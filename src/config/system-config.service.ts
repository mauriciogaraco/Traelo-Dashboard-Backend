import { prisma, decimalToNumber } from '../shared/prisma';
import type { Prisma } from '../generated/prisma/client';
import type { UpdateSystemConfigInput } from './system-config.dto';

const SINGLETON_ID = 'singleton';

export interface SystemConfigDTO {
  defaultDelivererCommissionPercentage: number;
  rafflePromoText: string | null;
  raffleVideoUrl: string | null;
  updatedAt: Date;
}

function toDTO(config: {
  defaultDelivererCommissionPercentage: Prisma.Decimal;
  rafflePromoText: string | null;
  raffleVideoUrl: string | null;
  updatedAt: Date;
}): SystemConfigDTO {
  return {
    defaultDelivererCommissionPercentage: decimalToNumber(
      config.defaultDelivererCommissionPercentage,
    ),
    rafflePromoText: config.rafflePromoText,
    raffleVideoUrl: config.raffleVideoUrl,
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
    update: {
      defaultDelivererCommissionPercentage: input.defaultDelivererCommissionPercentage,
      rafflePromoText: input.rafflePromoText,
      raffleVideoUrl: input.raffleVideoUrl,
    },
    create: {
      id: SINGLETON_ID,
      defaultDelivererCommissionPercentage: input.defaultDelivererCommissionPercentage ?? 60,
      rafflePromoText: input.rafflePromoText,
      raffleVideoUrl: input.raffleVideoUrl,
    },
  });

  return toDTO(config);
}
