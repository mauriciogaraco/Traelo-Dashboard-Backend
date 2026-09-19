// Canal por el que se entrega al cliente el enlace/código de recuperación de contraseña.
//
// HOY NO HAY NINGUNO configurado: el backend no tiene SMS ni email (solo Telegram interno), y
// no se simula uno. Sin canal, forgot-password no genera ningún token y responde
// channelAvailable:false para que la app remita al cliente al soporte por WhatsApp.
//
// Cuando exista un proveedor real (SMS/WhatsApp Business/email), basta con implementar esta
// interfaz y registrarla con setRecoveryChannel() al arrancar; el resto del flujo (token con
// hash, expiración, un solo uso, respuestas genéricas, revocar sesiones) ya está hecho.
//
// Contrato: `send` recibe el token en claro SOLO para entregarlo al cliente; el llamador no lo
// registra en logs y la implementación tampoco debería.
export interface RecoveryRecipient {
  customerId: string;
  phone: string;
  email: string | null;
}

export interface RecoveryChannel {
  send(recipient: RecoveryRecipient, rawToken: string, expiresAt: Date): Promise<void>;
}

let configuredChannel: RecoveryChannel | null = null;

export function getRecoveryChannel(): RecoveryChannel | null {
  return configuredChannel;
}

export function setRecoveryChannel(channel: RecoveryChannel | null): void {
  configuredChannel = channel;
}
