import {
  getBusinessDateOnly,
  getBusinessDayOfWeek,
  getBusinessTimeOfDay,
} from '../../shared/date-range';
import * as businessesRepository from './businesses.repository';
import * as businessHoursRepository from './business-hours.repository';
import * as closuresRepository from './business-closures.repository';

export type BusinessOpenReason =
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'NOT_ACCEPTING_ORDERS'
  | 'EXCEPTIONAL_CLOSURE'
  | 'CLOSED_TODAY'
  | 'OUTSIDE_HOURS'
  | 'NO_SCHEDULE_CONFIGURED';

export type BusinessOpenResult = { open: true } | { open: false; reason: BusinessOpenReason };

// Única fuente de verdad de "¿este negocio puede recibir pedidos ahora mismo?". Combina
// active + acceptingOrders + horario semanal + cierres excepcionales, todo en hora de La
// Habana. Cualquier lugar que necesite esta respuesta (catálogo, checkout, dashboard,
// futuras notificaciones) debe llamar a esta función en vez de reimplementar la lógica.
export async function isBusinessOpen(
  businessId: string,
  dateTime: Date,
): Promise<BusinessOpenResult> {
  const business = await businessesRepository.findById(businessId);
  if (!business) {
    return { open: false, reason: 'NOT_FOUND' };
  }
  if (!business.active) {
    return { open: false, reason: 'INACTIVE' };
  }
  if (!business.acceptingOrders) {
    return { open: false, reason: 'NOT_ACCEPTING_ORDERS' };
  }

  const closureDate = getBusinessDateOnly(dateTime);
  const closure = await closuresRepository.findByBusinessAndDate(businessId, closureDate);
  if (closure) {
    return { open: false, reason: 'EXCEPTIONAL_CLOSURE' };
  }

  const dayOfWeek = getBusinessDayOfWeek(dateTime);
  const hours = await businessHoursRepository.findForDay(businessId, dayOfWeek);
  if (!hours) {
    return { open: false, reason: 'NO_SCHEDULE_CONFIGURED' };
  }
  if (hours.closed) {
    return { open: false, reason: 'CLOSED_TODAY' };
  }

  const currentTime = getBusinessTimeOfDay(dateTime).getTime();
  if (currentTime < hours.openTime.getTime() || currentTime >= hours.closeTime.getTime()) {
    return { open: false, reason: 'OUTSIDE_HOURS' };
  }

  return { open: true };
}
