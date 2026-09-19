import { logger } from '../logger';
import { prisma } from '../prisma';

// Push a clientes por Expo (el mismo mecanismo con el que la app registra sus dispositivos en
// /customers/me/devices). Como Telegram: NUNCA lanza — un push que falla no debe romper la
// operación que lo originó (completar un pedido, ajustar puntos...). Si el proveedor dice que un
// token ya no existe (DeviceNotRegistered), ese dispositivo se desactiva.

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100; // límite de Expo por request

export interface PushMessage {
  title: string;
  body: string;
  /** Viaja con la notificación (la app hoy no lo usa para navegar). */
  data?: Record<string, unknown>;
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

interface ExpoTicket {
  status?: 'ok' | 'error';
  details?: { error?: string };
}

/**
 * Envía un mensaje a varios tokens y devuelve los que Expo declaró inválidos
 * (DeviceNotRegistered). Separado de la base de datos para poder probarlo.
 */
export async function sendExpoPush(
  tokens: string[],
  message: PushMessage,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<string[]> {
  const invalid: string[] = [];

  for (let start = 0; start < tokens.length; start += BATCH_SIZE) {
    const batch = tokens.slice(start, start + BATCH_SIZE);
    const response = await fetchFn(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(
        batch.map((to) => ({
          to,
          title: message.title,
          body: message.body,
          data: message.data,
          sound: 'default',
          channelId: 'default',
        })),
      ),
    });
    if (!response.ok) {
      throw new Error('Expo push respondió con error');
    }

    // Los tickets vienen en el mismo orden que los mensajes enviados.
    const payload = (await response.json()) as { data?: ExpoTicket[] };
    (payload.data ?? []).forEach((ticket, index) => {
      const token = batch[index];
      if (token && ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        invalid.push(token);
      }
    });
  }

  return invalid;
}

export async function sendPushToCustomer(customerId: string, message: PushMessage): Promise<void> {
  try {
    const devices = await prisma.customerDevice.findMany({
      where: { customerId, active: true, pushToken: { not: null } },
      select: { pushToken: true },
    });
    const tokens = devices.map((device) => device.pushToken).filter((t): t is string => t !== null);
    if (tokens.length === 0) {
      return;
    }

    const invalid = await sendExpoPush(tokens, message);
    if (invalid.length > 0) {
      await prisma.customerDevice.updateMany({
        where: { pushToken: { in: invalid } },
        data: { active: false },
      });
    }
  } catch (error) {
    logger.warn({ err: error, customerId }, 'No se pudo enviar el push al cliente');
  }
}
