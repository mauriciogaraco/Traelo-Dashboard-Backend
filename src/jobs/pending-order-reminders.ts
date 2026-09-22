import { logger } from '../shared/logger';
import { notifyDeliverer } from '../shared/push';
import * as ordersRepository from '../modules/orders/orders.repository';

// "Margen prudente" pedido explícitamente por el negocio (app móvil, mensajero): un mensajero
// con un pedido por aceptar/confirmar recibe como mucho un recordatorio cada
// PENDING_ORDER_REMINDER_INTERVAL_MS, nunca uno por cada corrida del job (Order.lastReminderPushAt
// es lo que hace cumplir esto). El primero tampoco sale de inmediato: se espera
// PENDING_ORDER_REMINDER_INITIAL_DELAY_MS desde que el pedido entró en ese estado, para no
// interrumpir a alguien que todavía está mirando la pantalla decidiendo.
export const PENDING_ORDER_REMINDER_INITIAL_DELAY_MS = 3 * 60_000; // 3 min
export const PENDING_ORDER_REMINDER_INTERVAL_MS = 10 * 60_000; // 10 min
// Cada cuánto corre el job: más seguido que el margen (para no atrasarse mucho en detectar que
// ya se puede volver a avisar), nunca tan seguido como para que el margen deje de sentirse.
const JOB_INTERVAL_MS = 2 * 60_000;

export async function checkPendingOrderReminders(now: Date = new Date()): Promise<void> {
  const reminderCutoff = new Date(now.getTime() - PENDING_ORDER_REMINDER_INTERVAL_MS);
  const initialDelayCutoff = new Date(now.getTime() - PENDING_ORDER_REMINDER_INITIAL_DELAY_MS);

  const candidates = await ordersRepository.findPendingReminderCandidates(reminderCutoff);

  for (const order of candidates) {
    if (!order.delivererId) continue; // el where ya lo garantiza, esto es solo para TS

    // "Por aceptar" cuenta desde que se asignó; "por confirmar" (ya aceptado, mismo status
    // ASSIGNED) cuenta desde que aceptó — es el momento real en que empezó a estar pendiente
    // de ESTA decisión puntual, no el momento en que se creó el pedido.
    const pendingSince = order.acceptedAt ?? order.assignedAt ?? order.orderDate;
    if (pendingSince > initialDelayCutoff) continue;

    const message = order.acceptedAt
      ? `Tienes el pedido #${order.orderNumber} por confirmar.`
      : `Tienes el pedido #${order.orderNumber} por aceptar.`;

    await notifyDeliverer(order.delivererId, 'Pedido pendiente', message, {
      orderId: order.id,
      type: 'ORDER_PENDING_REMINDER',
    });
    await ordersRepository.markReminderSent(order.id, now);
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startPendingOrderReminderJob(): void {
  if (intervalHandle) return; // idempotente, mismo criterio que LocationTrackingService (app móvil)
  intervalHandle = setInterval(() => {
    checkPendingOrderReminders().catch((error) => {
      logger.warn(
        { err: error },
        'checkPendingOrderReminders falló — se reintenta en la próxima corrida del job',
      );
    });
  }, JOB_INTERVAL_MS);
}

export function stopPendingOrderReminderJob(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
