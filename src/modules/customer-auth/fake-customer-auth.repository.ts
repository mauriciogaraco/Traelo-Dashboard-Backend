// Doble en memoria de customer-auth.repository, SOLO para tests (se inyecta con vi.mock). Imita
// la semántica de las consultas reales (unicidad, updateMany condicionado, transacciones) para
// poder probar los flujos completos de autenticación sin base de datos.
export interface FakeCustomer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  passwordHash: string | null;
  phoneVerified: boolean;
  emailVerified: boolean;
  active: boolean;
  lastOrderAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeRefreshToken {
  id: string;
  customerId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByTokenHash: string | null;
}

export interface FakeResetToken {
  id: string;
  customerId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export function createFakeRepository() {
  let seq = 0;
  const nextId = () => `cfake${String(++seq).padStart(10, '0')}`; // con forma de cuid

  const state = {
    customers: new Map<string, FakeCustomer>(),
    refreshTokens: new Map<string, FakeRefreshToken>(), // por id
    resetTokens: new Map<string, FakeResetToken>(),
    orderCounts: new Map<string, number>(),
    // Lo que "colgaba" de un cliente (direcciones/dispositivos/favoritos): solo un contador.
    dependents: new Map<string, number>(),
  };

  const byPhone = (phone: string) =>
    [...state.customers.values()].find((customer) => customer.phone === phone) ?? null;

  const api = {
    state,

    seedCustomer(data: Partial<FakeCustomer> & { phone: string }): FakeCustomer {
      const now = new Date();
      const customer: FakeCustomer = {
        id: nextId(),
        name: 'Cliente',
        email: null,
        passwordHash: null,
        phoneVerified: false,
        emailVerified: false,
        active: true,
        lastOrderAt: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      state.customers.set(customer.id, customer);
      return customer;
    },

    async findCustomerByPhone(phone: string) {
      return byPhone(phone);
    },

    async findCustomerById(id: string) {
      return state.customers.get(id) ?? null;
    },

    async countOrdersOfCustomer(customerId: string) {
      return state.orderCounts.get(customerId) ?? 0;
    },

    async createCustomerWithPassword(data: {
      name: string;
      phone: string;
      email?: string;
      passwordHash: string;
    }) {
      if (byPhone(data.phone)) {
        throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      }
      return api.seedCustomer({
        name: data.name,
        phone: data.phone,
        email: data.email ?? null,
        passwordHash: data.passwordHash,
      });
    },

    async claimLegacyCustomer(
      customerId: string,
      data: { name: string; email?: string; passwordHash: string },
    ) {
      const customer = state.customers.get(customerId);
      if (!customer || customer.passwordHash !== null) {
        return null;
      }
      customer.name = data.name;
      customer.email = data.email ?? null;
      customer.passwordHash = data.passwordHash;
      state.dependents.set(customerId, 0);
      return customer;
    },

    async createRefreshToken(data: { customerId: string; tokenHash: string; expiresAt: Date }) {
      const token: FakeRefreshToken = {
        id: nextId(),
        customerId: data.customerId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        revokedAt: null,
        replacedByTokenHash: null,
      };
      state.refreshTokens.set(token.id, token);
      return token;
    },

    async findRefreshTokenByHash(tokenHash: string) {
      const token = [...state.refreshTokens.values()].find((t) => t.tokenHash === tokenHash);
      if (!token) {
        return null;
      }
      return { ...token, customer: state.customers.get(token.customerId) as FakeCustomer };
    },

    async shortenRefreshToken(id: string, graceUntil: Date, replacedByTokenHash: string) {
      const token = state.refreshTokens.get(id);
      if (token) {
        token.replacedByTokenHash = replacedByTokenHash;
        token.expiresAt = token.expiresAt < graceUntil ? token.expiresAt : graceUntil;
      }
    },

    async revokeRefreshTokenByHash(tokenHash: string) {
      let count = 0;
      for (const token of state.refreshTokens.values()) {
        if (token.tokenHash === tokenHash && !token.revokedAt) {
          token.revokedAt = new Date();
          count++;
        }
      }
      return { count };
    },

    async revokeAllCustomerRefreshTokens(customerId: string) {
      for (const token of state.refreshTokens.values()) {
        if (token.customerId === customerId && !token.revokedAt) {
          token.revokedAt = new Date();
        }
      }
    },

    async deleteExpiredRefreshTokens(customerId: string, now: Date) {
      for (const [id, token] of state.refreshTokens) {
        if (token.customerId === customerId && token.expiresAt < now) {
          state.refreshTokens.delete(id);
        }
      }
    },

    async createPasswordResetToken(data: {
      customerId: string;
      tokenHash: string;
      expiresAt: Date;
    }) {
      for (const token of state.resetTokens.values()) {
        if (token.customerId === data.customerId && !token.usedAt) {
          token.usedAt = new Date();
        }
      }
      const token: FakeResetToken = { id: nextId(), usedAt: null, ...data };
      state.resetTokens.set(token.id, token);
      return token;
    },

    async findValidPasswordResetToken(tokenHash: string, now: Date) {
      const token = [...state.resetTokens.values()].find(
        (t) => t.tokenHash === tokenHash && !t.usedAt && t.expiresAt > now,
      );
      return token
        ? { ...token, customer: state.customers.get(token.customerId) as FakeCustomer }
        : null;
    },

    async consumeResetTokenAndSetPassword(
      resetTokenId: string,
      customerId: string,
      passwordHash: string,
    ) {
      const token = state.resetTokens.get(resetTokenId);
      if (!token || token.usedAt) {
        return false;
      }
      token.usedAt = new Date();
      (state.customers.get(customerId) as FakeCustomer).passwordHash = passwordHash;
      await api.revokeAllCustomerRefreshTokens(customerId);
      return true;
    },
  };

  return api;
}

export type FakeRepository = ReturnType<typeof createFakeRepository>;

// Repositorio "activo" de cada test: se reemplaza en beforeEach por uno limpio.
export const fakeHolder: { current: FakeRepository } = { current: createFakeRepository() };

const REPOSITORY_FUNCTIONS = [
  'findCustomerByPhone',
  'findCustomerById',
  'countOrdersOfCustomer',
  'createCustomerWithPassword',
  'claimLegacyCustomer',
  'createRefreshToken',
  'findRefreshTokenByHash',
  'shortenRefreshToken',
  'revokeRefreshTokenByHash',
  'revokeAllCustomerRefreshTokens',
  'deleteExpiredRefreshTokens',
  'createPasswordResetToken',
  'findValidPasswordResetToken',
  'consumeResetTokenAndSetPassword',
] as const;

// Módulo con la misma forma que customer-auth.repository, delegando siempre al doble activo.
// Uso: vi.mock('./customer-auth.repository', async () =>
//        (await import('./fake-customer-auth.repository')).delegatingRepositoryModule());
export function delegatingRepositoryModule(): Record<string, (...args: never[]) => unknown> {
  return Object.fromEntries(
    REPOSITORY_FUNCTIONS.map((name) => [
      name,
      (...args: unknown[]) => (fakeHolder.current[name] as (...a: unknown[]) => unknown)(...args),
    ]),
  );
}
