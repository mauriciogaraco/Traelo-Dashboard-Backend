import { createHmac } from 'node:crypto';
import { env } from '../../config/env';
import { generateOpaqueToken, hashToken } from '../auth/token.service';

// Header con el que un invitado (sin cuenta) prueba que el pedido es suyo.
export const GUEST_TOKEN_HEADER = 'x-guest-token';

// Token de acceso a un pedido de invitado. Solo se guarda su hash (Order.guestAccessTokenHash)
// y se entrega al dispositivo en la respuesta de /checkout.
//
// Con clientRequestId el token es DERIVADO (HMAC con un secreto del servidor): un reintento
// idempotente del mismo checkout (la respuesta original se perdió por mala conexión) obtiene el
// MISMO token, en vez de un pedido que nadie puede volver a seguir. Sigue siendo imposible de
// adivinar sin el secreto, y para pedirlo de nuevo hay que conocer el clientRequestId, que solo
// vive en el dispositivo que hizo el pedido. Sin clientRequestId es aleatorio.
export function createGuestAccessToken(clientRequestId?: string): string {
  if (!clientRequestId) {
    return generateOpaqueToken();
  }
  return createHmac('sha256', env.JWT_REFRESH_SECRET)
    .update(`guest-order-access:${clientRequestId}`)
    .digest('hex');
}

export function hashGuestAccessToken(token: string): string {
  return hashToken(token);
}
