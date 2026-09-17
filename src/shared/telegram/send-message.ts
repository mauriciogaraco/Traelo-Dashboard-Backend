import { env } from '../../config/env';
import { logger } from '../logger';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const MAX_ATTEMPTS = 3; // intento inicial + 2 reintentos
const RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Notificación operacional (Fase 14): el pedido YA existe en Postgres antes de que esto se
// llame — nunca es la fuente de verdad, y si falla (red, rate limit, bot mal configurado) se
// loguea y se sigue, nunca se lanza, para no afectar al caller (no hay rollback del pedido
// solo porque Telegram falló). Reintenta un par de veces con backoff simple; si no está
// configurada (TELEGRAM_BOT_TOKEN/CHAT_ID ausentes), no hace nada.
export async function sendTelegramMessage(text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return;
  }

  const url = `${TELEGRAM_API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text,
          parse_mode: 'HTML',
        }),
        signal: controller.signal,
      });

      if (response.ok) {
        return;
      }

      const body = await response.text().catch(() => '');
      logger.warn(
        { status: response.status, body, attempt },
        'Telegram sendMessage: respuesta no OK',
      );
    } catch (error) {
      logger.warn({ err: error, attempt }, 'Telegram sendMessage: falló el request');
    } finally {
      clearTimeout(timeoutId);
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  logger.error('Telegram sendMessage: se agotaron los reintentos, la notificación no se envió');
}
