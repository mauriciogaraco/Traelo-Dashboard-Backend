import { Prisma } from '../../generated/prisma/client';
import { getBusinessHour } from '../../shared/date-range';

// Regla de negocio (no configurable, a diferencia de deliveryFeeBase que sí vive en cada
// Business): +100 CUP por cada negocio adicional en un pedido multi-negocio, +100 CUP más
// si el pedido se hace desde las 7pm (hora de La Habana) en adelante. La tarifa base del
// pedido es la más alta entre los negocios involucrados (no se suman las bases, solo el
// recargo por negocio extra).
const EXTRA_BUSINESS_SURCHARGE = new Prisma.Decimal(100);
const NIGHT_SURCHARGE = new Prisma.Decimal(100);
const NIGHT_SURCHARGE_START_HOUR = 19;

export function computeAppDeliveryFee(
  businessDeliveryFeeBases: Prisma.Decimal[],
  orderDate: Date,
): Prisma.Decimal {
  if (businessDeliveryFeeBases.length === 0) {
    throw new Error('computeAppDeliveryFee requiere al menos un negocio');
  }

  const baseRate = businessDeliveryFeeBases.reduce((max, rate) =>
    rate.greaterThan(max) ? rate : max,
  );
  const extraBusinesses = businessDeliveryFeeBases.length - 1;
  const isNight = getBusinessHour(orderDate) >= NIGHT_SURCHARGE_START_HOUR;

  let fee = baseRate.plus(EXTRA_BUSINESS_SURCHARGE.times(extraBusinesses));
  if (isNight) {
    fee = fee.plus(NIGHT_SURCHARGE);
  }
  return fee;
}
