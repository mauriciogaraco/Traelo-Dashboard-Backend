import type { Prisma } from '../../generated/prisma/client';

export function decimalToNumber(value: Prisma.Decimal): number;
export function decimalToNumber(value: Prisma.Decimal | null): number | null;
export function decimalToNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}
