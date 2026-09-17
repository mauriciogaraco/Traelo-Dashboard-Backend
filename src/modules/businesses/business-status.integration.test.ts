// Tests de integración: corren contra la base de datos configurada en DATABASE_URL
// (la misma Postgres de desarrollo — el proyecto no tiene una DB de test separada).
// Cada test crea sus propios datos y el bloque afterAll los limpia.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../shared/prisma';
import { getBusinessDateOnly, getBusinessDayOfWeek } from '../../shared/date-range';
import * as businessesService from './businesses.service';
import { isBusinessOpen } from './business-status.service';

describe('isBusinessOpen (integración)', () => {
  let businessId: string;
  const now = new Date();
  const todayDayOfWeek = getBusinessDayOfWeek(now);

  beforeAll(async () => {
    const business = await businessesService.createBusiness({
      name: 'Business Status Test',
      phone: '+53 5555 3030',
      address: 'Calle Test',
      commissionType: 'PERCENTAGE',
      commissionPercentage: 10,
    });
    businessId = business.id;
  });

  afterAll(async () => {
    await prisma.businessHours.deleteMany({ where: { businessId } });
    await prisma.businessClosure.deleteMany({ where: { businessId } });
    await prisma.business.delete({ where: { id: businessId } });
  });

  it('cerrado si no tiene ningún horario configurado (NO_SCHEDULE_CONFIGURED)', async () => {
    const result = await isBusinessOpen(businessId, now);
    expect(result).toEqual({ open: false, reason: 'NO_SCHEDULE_CONFIGURED' });
  });

  it('abierto si hay horario para hoy que cubre la hora actual', async () => {
    await prisma.businessHours.create({
      data: {
        businessId,
        dayOfWeek: todayDayOfWeek,
        openTime: new Date(Date.UTC(1970, 0, 1, 0, 0)),
        closeTime: new Date(Date.UTC(1970, 0, 1, 23, 59)),
        closed: false,
      },
    });

    expect(await isBusinessOpen(businessId, now)).toEqual({ open: true });
  });

  it('cerrado si closed=true para el día de hoy (CLOSED_TODAY), aunque haya horario cargado', async () => {
    await prisma.businessHours.update({
      where: { businessId_dayOfWeek: { businessId, dayOfWeek: todayDayOfWeek } },
      data: { closed: true },
    });

    expect(await isBusinessOpen(businessId, now)).toEqual({ open: false, reason: 'CLOSED_TODAY' });

    await prisma.businessHours.update({
      where: { businessId_dayOfWeek: { businessId, dayOfWeek: todayDayOfWeek } },
      data: { closed: false },
    });
  });

  it('cerrado si hay un BusinessClosure para la fecha de hoy (EXCEPTIONAL_CLOSURE)', async () => {
    const closure = await prisma.businessClosure.create({
      data: { businessId, date: getBusinessDateOnly(now), reason: 'Mantenimiento' },
    });

    expect(await isBusinessOpen(businessId, now)).toEqual({
      open: false,
      reason: 'EXCEPTIONAL_CLOSURE',
    });

    await prisma.businessClosure.delete({ where: { id: closure.id } });
  });

  it('cerrado si acceptingOrders=false (NOT_ACCEPTING_ORDERS), sin importar el horario', async () => {
    await businessesService.setAcceptingOrders(businessId, { acceptingOrders: false });

    expect(await isBusinessOpen(businessId, now)).toEqual({
      open: false,
      reason: 'NOT_ACCEPTING_ORDERS',
    });

    await businessesService.setAcceptingOrders(businessId, { acceptingOrders: true });
  });

  it('devuelve NOT_FOUND para un negocio inexistente', async () => {
    expect(await isBusinessOpen('does-not-exist', now)).toEqual({
      open: false,
      reason: 'NOT_FOUND',
    });
  });
});
