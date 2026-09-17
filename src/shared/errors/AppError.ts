export class AppError extends Error {
  readonly statusCode: number;
  // Código de dominio machine-readable (ej. "PRODUCT_NOT_FOUND"), para que un cliente pueda
  // diferenciar errores programáticamente en vez de parsear `message` (en español, frágil).
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, statusCode: number, code: string, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

// `code` es opcional en cada subclase y tiene un default genérico — los ~80 call sites
// existentes (`throw new NotFoundError('Negocio no encontrado')`, etc.) siguen funcionando
// sin cambios, con el código genérico de su clase. Los call sites nuevos que necesiten un
// código específico (ej. "PRODUCT_NOT_FOUND" en vez de "NOT_FOUND") lo pasan explícito.
export class BadRequestError extends AppError {
  constructor(message = 'Solicitud inválida', code = 'BAD_REQUEST', details?: unknown) {
    super(message, 400, code, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'No autenticado', code = 'UNAUTHORIZED') {
    super(message, 401, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'No autorizado', code = 'FORBIDDEN') {
    super(message, 403, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Recurso no encontrado', code = 'NOT_FOUND') {
    super(message, 404, code);
  }
}

export class ConflictError extends AppError {
  constructor(
    message = 'Conflicto con el estado actual del recurso',
    code = 'CONFLICT',
    details?: unknown,
  ) {
    super(message, 409, code, details);
  }
}

// Fase 11 del checklist de la app: si algo del carrito cambió entre que el cliente lo armó y
// confirmó (precio, disponibilidad, negocio cerrado), se reporta como un único error
// estructurado con el detalle de cada cambio, en vez de un mensaje genérico del primer ítem
// que falló. `changes` queda sin tipar acá a propósito (shared/errors no debe conocer la
// forma exacta del dominio de checkout) — quien la lanza la tipa.
export class CartChangedError extends AppError {
  constructor(changes: unknown[]) {
    super(
      'Algunos productos cambiaron de precio o disponibilidad. Revisa tu pedido antes de confirmar.',
      409,
      'CART_CHANGED',
      { changes },
    );
  }
}
