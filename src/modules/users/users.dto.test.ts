import { describe, expect, it } from 'vitest';
import { createUserSchema } from './users.dto';

const base = { name: 'Ana Pérez', email: 'ana@example.com', password: '12345678' };
const businessId = 'cmta8ln470003g0uhv2vwxmmm';

describe('createUserSchema (dueño de negocio)', () => {
  it('un BUSINESS_OWNER requiere businessId', () => {
    const result = createUserSchema.safeParse({ ...base, role: 'BUSINESS_OWNER' });
    expect(result.success).toBe(false);
  });

  it('un BUSINESS_OWNER con businessId es válido', () => {
    const result = createUserSchema.safeParse({ ...base, role: 'BUSINESS_OWNER', businessId });
    expect(result.success).toBe(true);
  });

  it('los demás roles no pueden llevar businessId', () => {
    for (const role of ['OWNER', 'ADMIN', 'EMPLOYEE', 'DELIVERER']) {
      expect(createUserSchema.safeParse({ ...base, role, businessId }).success).toBe(false);
      expect(createUserSchema.safeParse({ ...base, role }).success).toBe(true);
    }
  });
});
