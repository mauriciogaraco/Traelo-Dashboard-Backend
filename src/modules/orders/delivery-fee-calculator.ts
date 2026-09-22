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

// Recargo por volumen: +100 CUP si la tarifa base es la default (250, ningún negocio del
// pedido tiene una tarifa propia mayor) y el subtotal de productos (CUP, antes de delivery y
// servicio) supera los 10,000 — un pedido grande con tarifa "genérica" paga un poco más.
const VOLUME_SURCHARGE = new Prisma.Decimal(100);
const VOLUME_SURCHARGE_BASE_RATE = new Prisma.Decimal(250);
const VOLUME_SURCHARGE_MIN_SUBTOTAL = new Prisma.Decimal(10000);

export function computeAppDeliveryFee(
  businessDeliveryFeeBases: Prisma.Decimal[],
  orderDate: Date,
  productsSubtotal: Prisma.Decimal,
): Prisma.Decimal {
  if (businessDeliveryFeeBases.length === 0) {
    throw new Error('computeAppDeliveryFee requiere al menos un negocio');
  }

  const baseRate = businessDeliveryFeeBases.reduce((max, rate) =>
    rate.greaterThan(max) ? rate : max,
  );
  const extraBusinesses = businessDeliveryFeeBases.length - 1;
  const isNight = getBusinessHour(orderDate) >= NIGHT_SURCHARGE_START_HOUR;
  const isHighVolume =
    baseRate.equals(VOLUME_SURCHARGE_BASE_RATE) && productsSubtotal.greaterThan(VOLUME_SURCHARGE_MIN_SUBTOTAL);

  let fee = baseRate.plus(EXTRA_BUSINESS_SURCHARGE.times(extraBusinesses));
  if (isNight) {
    fee = fee.plus(NIGHT_SURCHARGE);
  }
  if (isHighVolume) {
    fee = fee.plus(VOLUME_SURCHARGE);
  }
  return fee;
}
