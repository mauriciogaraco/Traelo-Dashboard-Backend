import { prisma } from '../prisma';
import { logger } from '../logger';
import { sendExpoPushNotification } from './send-push';

// Punto único de "avisale esto a este mensajero" para todo el backend (asignación, edición de
// vale, recordatorios) — busca el token acá en vez de pedirle a cada caller que lo resuelva, y
// no hace nada (ni loguea como error) si el mensajero nunca dio permiso de notificaciones
// (expoPushToken null): es un estado válido y esperado, no una falla.
export async function notifyDeliverer(
  delivererId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const deliverer = await prisma.deliverer.findUnique({
    where: { id: delivererId },
    select: { expoPushToken: true },
  });

  if (!deliverer?.expoPushToken) return;

  try {
    await sendExpoPushNotification(deliverer.expoPushToken, title, body, data);
  } catch (error) {
    // sendExpoPushNotification ya no debería lanzar (mismo criterio que sendTelegramMessage),
    // pero se cubre igual: una notificación nunca puede tumbar el flujo que la disparó.
    logger.warn({ err: error, delivererId }, 'notifyDeliverer: falló inesperadamente');
  }
}
