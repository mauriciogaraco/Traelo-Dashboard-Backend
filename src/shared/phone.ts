/**
 * El teléfono es el identificador de la cuenta del cliente. Se guarda en forma canónica
 * (sin espacios, guiones ni paréntesis; conserva un "+" inicial) para que "+53 5 555 1234"
 * y "+5355551234" sean la misma cuenta. Los snapshots de Order (customerPhone) NO se
 * normalizan: conservan exactamente lo que el cliente escribió.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits;
}

/** 6 a 15 dígitos (E.164 permite hasta 15), con "+" inicial opcional. */
export function isValidPhone(normalized: string): boolean {
  return /^\+?\d{6,15}$/.test(normalized);
}
