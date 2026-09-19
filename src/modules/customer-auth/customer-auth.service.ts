import bcrypt from 'bcrypt';
import { BadRequestError, ConflictError, UnauthorizedError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { generateOpaqueToken } from '../auth/token.service';
import { toCustomerDTO, type CustomerDTO } from '../customers/customers.service';
import * as repository from './customer-auth.repository';
import * as tokens from './customer-token.service';
import { getRecoveryChannel, type RecoveryChannel } from './recovery-channel';
import type {
  ForgotPasswordCustomerInput,
  LoginCustomerInput,
  RegisterCustomerInput,
  ResetPasswordCustomerInput,
} from './customer-auth.dto';

const PASSWORD_SALT_ROUNDS = 12;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000; // 30 minutos

export interface RequestContext {
  userAgent?: string;
  ipAddress?: string;
}

export interface CustomerSession {
  customer: CustomerDTO;
  accessToken: string;
  // Segundos de vida del access token: la app lo usa para refrescar antes de que venza.
  accessTokenExpiresIn: number;
  refreshToken: string;
}

export interface CustomerTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
}

const INVALID_CREDENTIALS_MESSAGE = 'Teléfono o contraseña incorrectos';

// Hash "de mentira" para que login con un teléfono inexistente (o sin contraseña) gaste el
// mismo bcrypt que uno real: si no, la diferencia de tiempo delataría qué teléfonos tienen
// cuenta. Se calcula una sola vez, la primera vez que hace falta.
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= bcrypt.hash('dummy-password-for-timing', PASSWORD_SALT_ROUNDS);
  return dummyHashPromise;
}

async function issueTokens(customerId: string, ctx: RequestContext): Promise<CustomerTokens> {
  const now = new Date();
  const refreshToken = tokens.generateRefreshToken();
  await repository.createRefreshToken({
    customerId,
    tokenHash: tokens.hashToken(refreshToken),
    expiresAt: tokens.customerRefreshTokenExpiresAt(now),
    userAgent: ctx.userAgent?.slice(0, 300),
    ipAddress: ctx.ipAddress,
  });
  // Limpieza oportunista: no crece sin límite la tabla de un cliente que refresca durante meses.
  await repository.deleteExpiredRefreshTokens(customerId, now);

  return {
    accessToken: tokens.signCustomerAccessToken(customerId),
    accessTokenExpiresIn: tokens.accessTokenLifetimeSeconds(),
    refreshToken,
  };
}

export async function register(
  input: RegisterCustomerInput,
  ctx: RequestContext,
): Promise<CustomerSession> {
  const alreadyRegistered = () =>
    new ConflictError('Ya existe una cuenta con ese teléfono', 'PHONE_ALREADY_REGISTERED');

  const passwordHash = await bcrypt.hash(input.password, PASSWORD_SALT_ROUNDS);
  const existing = await repository.findCustomerByPhone(input.phone);

  let customer;
  if (existing) {
    // Con contraseña: es una cuenta real. Sin contraseña: solo se reclama si nunca hizo un
    // pedido (un registro heredado vacío). Uno con historial NO se puede reclamar: no hay
    // forma de probar que el nuevo registro es la misma persona, y heredaría sus pedidos.
    // Ambos casos responden igual para no revelar si el número tiene historial.
    if (existing.passwordHash || !existing.active) {
      throw alreadyRegistered();
    }
    if ((await repository.countOrdersOfCustomer(existing.id)) > 0) {
      throw alreadyRegistered();
    }
    customer = await repository.claimLegacyCustomer(existing.id, {
      name: input.name,
      email: input.email,
      passwordHash,
    });
    if (!customer) {
      throw alreadyRegistered();
    }
  } else {
    try {
      customer = await repository.createCustomerWithPassword({
        name: input.name,
        phone: input.phone,
        email: input.email,
        passwordHash,
      });
    } catch (error) {
      // Dos registros simultáneos con el mismo teléfono: el unique de la BD decide.
      if ((error as { code?: string }).code === 'P2002') {
        throw alreadyRegistered();
      }
      throw error;
    }
  }

  return { customer: toCustomerDTO(customer), ...(await issueTokens(customer.id, ctx)) };
}

export async function login(
  input: LoginCustomerInput,
  ctx: RequestContext,
): Promise<CustomerSession> {
  const customer = await repository.findCustomerByPhone(input.phone);

  // Siempre se hace exactamente un bcrypt.compare, exista o no la cuenta.
  const hashToCompare = customer?.passwordHash ?? (await getDummyHash());
  const passwordMatches = await bcrypt.compare(input.password, hashToCompare);

  if (!customer || !customer.passwordHash || !customer.active || !passwordMatches) {
    throw new UnauthorizedError(INVALID_CREDENTIALS_MESSAGE, 'INVALID_CREDENTIALS');
  }

  return { customer: toCustomerDTO(customer), ...(await issueTokens(customer.id, ctx)) };
}

// Refresh con rotación y ventana de gracia: el token presentado deja de servir a los
// REFRESH_ROTATION_GRACE_MS (no se revoca de inmediato) y se entrega uno nuevo con la
// vigencia completa (sesión deslizante).
export async function refresh(refreshToken: string, ctx: RequestContext): Promise<CustomerTokens> {
  const now = new Date();
  const stored = await repository.findRefreshTokenByHash(tokens.hashToken(refreshToken));

  if (
    !stored ||
    stored.revokedAt ||
    stored.expiresAt <= now ||
    !stored.customer.active ||
    !stored.customer.passwordHash
  ) {
    throw new UnauthorizedError(
      'Sesión expirada. Inicia sesión de nuevo.',
      'INVALID_REFRESH_TOKEN',
    );
  }

  const newTokens = await issueTokens(stored.customerId, ctx);
  await repository.shortenRefreshToken(
    stored.id,
    new Date(now.getTime() + tokens.REFRESH_ROTATION_GRACE_MS),
    tokens.hashToken(newTokens.refreshToken),
  );
  return newTokens;
}

// Revoca únicamente el token presentado (cierra esta sesión, no las de otros dispositivos).
// Idempotente: un token desconocido o ya revocado no es un error.
export async function logout(refreshToken: string): Promise<void> {
  await repository.revokeRefreshTokenByHash(tokens.hashToken(refreshToken));
}

export interface ForgotPasswordResult {
  // Dato GLOBAL del servidor (¿hay algún canal de entrega configurado?), idéntico para
  // cualquier teléfono: no revela si la cuenta existe.
  channelAvailable: boolean;
  message: string;
}

// Núcleo del envío, separado para poder correrlo en segundo plano (mismo tiempo de respuesta
// exista o no la cuenta) y para probarlo directamente.
export async function processRecovery(
  channel: RecoveryChannel,
  phone: string,
  now = new Date(),
): Promise<void> {
  const customer = await repository.findCustomerByPhone(phone);
  if (!customer || !customer.active || !customer.passwordHash) {
    return;
  }

  const rawToken = generateOpaqueToken();
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);
  await repository.createPasswordResetToken({
    customerId: customer.id,
    tokenHash: tokens.hashToken(rawToken),
    expiresAt,
  });

  // El token en claro solo viaja al canal de entrega; jamás se loguea.
  await channel.send(
    { customerId: customer.id, phone: customer.phone, email: customer.email },
    rawToken,
    expiresAt,
  );
}

export async function forgotPassword(
  input: ForgotPasswordCustomerInput,
): Promise<ForgotPasswordResult> {
  const channel = getRecoveryChannel();

  // Sin canal no se genera ningún token: no habría cómo entregarlo, y un token que nadie
  // recibe solo sería un secreto huérfano en la BD.
  if (!channel) {
    return {
      channelAvailable: false,
      message:
        'Por ahora no podemos enviarte un código de recuperación automáticamente. Contáctanos por WhatsApp y te ayudamos.',
    };
  }

  processRecovery(channel, input.phone).catch((error: unknown) => {
    logger.error({ err: error }, 'Falló el envío de recuperación de contraseña de cliente');
  });

  return {
    channelAvailable: true,
    message: 'Si existe una cuenta con ese teléfono, recibirás las instrucciones en breve.',
  };
}

export async function resetPassword(input: ResetPasswordCustomerInput): Promise<void> {
  const invalid = () =>
    new BadRequestError('El código de recuperación es inválido o expiró', 'INVALID_RESET_TOKEN');

  const stored = await repository.findValidPasswordResetToken(
    tokens.hashToken(input.token),
    new Date(),
  );
  if (!stored || !stored.customer.active) {
    throw invalid();
  }

  const passwordHash = await bcrypt.hash(input.newPassword, PASSWORD_SALT_ROUNDS);
  const done = await repository.consumeResetTokenAndSetPassword(
    stored.id,
    stored.customerId,
    passwordHash,
  );
  if (!done) {
    throw invalid();
  }
}
