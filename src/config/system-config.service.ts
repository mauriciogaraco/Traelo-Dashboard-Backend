import { prisma, decimalToNumber } from '../shared/prisma';
import type { Prisma } from '../generated/prisma/client';
import type { UpdateSystemConfigInput } from './system-config.dto';

const SINGLETON_ID = 'singleton';

export interface SystemConfigDTO {
  defaultDelivererCommissionPercentage: number;
  rafflePromoText: string | null;
  raffleVideoUrl: string | null;
  /** Puntos V1: puntos = floor(Servicio Tráelo / pointsServiceDivisor). */
  pointsServiceDivisor: number;
  /** Bono por el primer pedido desde la app (0 = desactivado). */
  pointsFirstOrderBonus: number;
  /** Solo cuentan los pedidos completados desde esta fecha. */
  pointsEnabledFrom: Date;
  updatedAt: Date;
}

function toDTO(config: {
  defaultDelivererCommissionPercentage: Prisma.Decimal;
  rafflePromoText: string | null;
  raffleVideoUrl: string | null;
  pointsServiceDivisor: number;
  pointsFirstOrderBonus: number;
  pointsEnabledFrom: Date;
  updatedAt: Date;
}): SystemConfigDTO {
  return {
    defaultDelivererCommissionPercentage: decimalToNumber(
      config.defaultDelivererCommissionPercentage,
    ),
    rafflePromoText: config.rafflePromoText,
    raffleVideoUrl: config.raffleVideoUrl,
    pointsServiceDivisor: config.pointsServiceDivisor,
    pointsFirstOrderBonus: config.pointsFirstOrderBonus,
    pointsEnabledFrom: config.pointsEnabledFrom,
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
      pointsServiceDivisor: input.pointsServiceDivisor,
      pointsFirstOrderBonus: input.pointsFirstOrderBonus,
    },
    create: {
      id: SINGLETON_ID,
      defaultDelivererCommissionPercentage: input.defaultDelivererCommissionPercentage ?? 60,
      rafflePromoText: input.rafflePromoText,
      raffleVideoUrl: input.raffleVideoUrl,
      pointsServiceDivisor: input.pointsServiceDivisor ?? 10,
      pointsFirstOrderBonus: input.pointsFirstOrderBonus ?? 10,
    },
  });

  return toDTO(config);
}
