import { logger } from '../logger';

const EXPO_PUSH_API = 'https://exp.host/--/api/v2/push/send';
const MAX_ATTEMPTS = 3; // intento inicial + 2 reintentos, mismo criterio que sendTelegramMessage
const RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Notificación operacional al mensajero (app móvil): el evento que la origina (pedido asignado,
// editado, recordatorio) YA pasó en Postgres antes de llamar esto — nunca es la fuente de
// verdad, y si falla (red, token inválido, servicio de Expo caído) se loguea y se sigue, nunca
// se lanza, para no afectar al caller (mismo principio que sendTelegramMessage). No requiere
// API key: el servicio de Expo Push acepta requests sin autenticar por diseño.
export async function sendExpoPushNotification(
  expoPushToken: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(EXPO_PUSH_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify({
          to: expoPushToken,
          title,
          body,
          data: data ?? {},
          sound: 'default',
        }),
        signal: controller.signal,
      });

      if (response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { data?: { status?: string; message?: string } }
          | null;
        // Expo responde 200 incluso si el token es inválido/no registrado — el error real va
        // en el body (`data.status === 'error'`). No se reintenta: reintentar un token muerto
        // no lo revive, igual criterio que un error de negocio en runMutation (app cliente).
        if (payload?.data?.status === 'error') {
          logger.warn({ expoPushToken, payload }, 'Expo push: el servicio rechazó la notificación');
        }
        return;
      }

      const responseBody = await response.text().catch(() => '');
      logger.warn(
        { status: response.status, body: responseBody, attempt },
        'Expo push: respuesta no OK',
      );
    } catch (error) {
      logger.warn({ err: error, attempt }, 'Expo push: falló el request');
    } finally {
      clearTimeout(timeoutId);
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  logger.error('Expo push: se agotaron los reintentos, la notificación no se envió');
}
