import { describe, expect, it } from 'vitest';
import {
  AppError,
  BadRequestError,
  CartChangedError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from './AppError';

describe('AppError subclasses — código por default', () => {
  it('NotFoundError usa NOT_FOUND por default', () => {
    const error = new NotFoundError('Producto no encontrado');
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Producto no encontrado');
  });

  it('BadRequestError, ConflictError, UnauthorizedError, ForbiddenError tienen su código genérico', () => {
    expect(new BadRequestError().code).toBe('BAD_REQUEST');
    expect(new ConflictError().code).toBe('CONFLICT');
    expect(new UnauthorizedError().code).toBe('UNAUTHORIZED');
    expect(new ForbiddenError().code).toBe('FORBIDDEN');
  });
});

describe('AppError subclasses — código explícito (call sites nuevos)', () => {
  it('acepta un código específico sin romper la firma existente (message-only)', () => {
    const error = new NotFoundError('Producto no encontrado', 'PRODUCT_NOT_FOUND');
    expect(error.code).toBe('PRODUCT_NOT_FOUND');
    expect(error.statusCode).toBe(404);
  });

  it('BadRequestError conserva `details` como tercer argumento', () => {
    const error = new BadRequestError('Cantidad inválida', 'INVALID_QUANTITY', { min: 1 });
    expect(error.code).toBe('INVALID_QUANTITY');
    expect(error.details).toEqual({ min: 1 });
  });
});

describe('CartChangedError', () => {
  it('siempre usa code CART_CHANGED, status 409, y guarda los changes en details', () => {
    const changes = [
      { productId: 'p1', reason: 'PRICE_CHANGED', oldPrice: 250, currentPrice: 275 },
    ];
    const error = new CartChangedError(changes);

    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe('CART_CHANGED');
    expect(error.details).toEqual({ changes });
  });
});
