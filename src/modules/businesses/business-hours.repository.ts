import { prisma } from '../../shared/prisma';

interface BusinessHoursData {
  openTime: Date;
  closeTime: Date;
  closed: boolean;
}

export function findManyForBusiness(businessId: string) {
  return prisma.businessHours.findMany({ where: { businessId }, orderBy: { dayOfWeek: 'asc' } });
}

export function findForDay(businessId: string, dayOfWeek: number) {
  return prisma.businessHours.findUnique({
    where: { businessId_dayOfWeek: { businessId, dayOfWeek } },
  });
}

export function upsert(businessId: string, dayOfWeek: number, data: BusinessHoursData) {
  return prisma.businessHours.upsert({
    where: { businessId_dayOfWeek: { businessId, dayOfWeek } },
    update: data,
    create: { businessId, dayOfWeek, ...data },
  });
}

export function deleteForDay(businessId: string, dayOfWeek: number) {
  return prisma.businessHours.deleteMany({ where: { businessId, dayOfWeek } });
}
