import { logger } from '../shared/logger';
import { notifyDeliverer } from '../shared/push';
import * as ordersRepository from '../modules/orders/orders.repository';

// Recordatorio de "tenés un pedido por aceptar/confirmar" — UNA SOLA VEZ por pedido, nunca se
// repite (Order.lastReminderPushAt, una vez seteado, lo saca para siempre de los candidatos: ver
// ordersRepository.findPendingReminderCandidates). No sale de inmediato: se espera
// PENDING_ORDER_REMINDER_INITIAL_DELAY_MS desde que el pedido entró en ese estado, para no
// interrumpir a alguien que todavía está mirando la pantalla decidiendo. Esto es solo un aviso —
// a diferencia de declineOrder, nunca le quita el pedido a nadie (ver assignOrder: cuando lo
// asigna el staff, acceptedAt queda seteado de una, así que ni el mensajero puede declinarlo).
export const PENDING_ORDER_REMINDER_INITIAL_DELAY_MS = 3 * 60_000; // 3 min
// Cada cuánto corre el job: chico para no tardar mucho en detectar que un pedido ya cumplió el
// delay inicial, pero cada pedido solo recibe UN recordatorio en toda su vida.
const JOB_INTERVAL_MS = 2 * 60_000;

export async function checkPendingOrderReminders(now: Date = new Date()): Promise<void> {
  const initialDelayCutoff = new Date(now.getTime() - PENDING_ORDER_REMINDER_INITIAL_DELAY_MS);

  const candidates = await ordersRepository.findPendingReminderCandidates();

  for (const order of candidates) {
    if (!order.delivererId) continue; // el where ya lo garantiza, esto es solo para TS

    // "Por aceptar" cuenta desde que se asignó; "por confirmar" (ya aceptado, mismo status
    // ASSIGNED) cuenta desde que aceptó — es el momento real en que empezó a estar pendiente
    // de ESTA decisión puntual, no el momento en que se creó el pedido.
    const pendingSince = order.acceptedAt ?? order.assignedAt ?? order.orderDate;
    if (pendingSince > initialDelayCutoff) continue;

    const message = order.acceptedAt
      ? `Tienes el pedido #${order.orderNumber} (${order.customerName}) por confirmar.`
      : `Tienes el pedido #${order.orderNumber} (${order.customerName}) por aceptar.`;

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
