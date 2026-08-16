import bcrypt from 'bcrypt';
import { UnauthorizedError, BadRequestError, ConflictError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import * as usersRepository from '../users/users.repository';
import * as usersService from '../users/users.service';
import * as authRepository from './auth.repository';
import * as tokenService from './token.service';
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from './auth.dto';
import type { UserDTO } from '../users/users.service';

const PASSWORD_SALT_ROUNDS = 12;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hora

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface RequestContext {
  userAgent?: string;
  ipAddress?: string;
}

async function issueTokens(
  user: { id: string; role: UserDTO['role'] },
  ctx: RequestContext,
): Promise<AuthTokens> {
  const accessToken = tokenService.signAccessToken({
    sub: user.id,
    role: user.role,
  });

  const refreshToken = tokenService.generateRefreshToken();
  await authRepository.createRefreshToken({
    userId: user.id,
    tokenHash: tokenService.hashToken(refreshToken),
    expiresAt: tokenService.refreshTokenExpiresAt(),
    userAgent: ctx.userAgent,
    ipAddress: ctx.ipAddress,
  });

  return { accessToken, refreshToken };
}

export async function register(
  input: RegisterInput,
  ctx: RequestContext,
): Promise<AuthTokens & { user: UserDTO }> {
  const user = await usersService.createUser(input);
  const tokens = await issueTokens(user, ctx);
  return { ...tokens, user };
}

export async function login(
  input: LoginInput,
  ctx: RequestContext,
): Promise<AuthTokens & { user: UserDTO }> {
  const user = await usersRepository.findByEmail(input.email);
  if (!user || !user.active) {
    throw new UnauthorizedError('Credenciales inválidas');
  }

  const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
  if (!passwordMatches) {
    throw new UnauthorizedError('Credenciales inválidas');
  }

  const tokens = await issueTokens(user, ctx);
  return { ...tokens, user: await usersService.getUserById(user.id) };
}

export async function refresh(refreshToken: string, ctx: RequestContext): Promise<AuthTokens> {
  const tokenHash = tokenService.hashToken(refreshToken);
  const stored = await authRepository.findRefreshTokenByHash(tokenHash);

  if (!stored || stored.revokedAt || stored.expiresAt < new Date() || !stored.user.active) {
    throw new UnauthorizedError('Refresh token inválido o expirado');
  }

  const tokens = await issueTokens(stored.user, ctx);
  await authRepository.revokeRefreshToken(stored.id, tokenService.hashToken(tokens.refreshToken));
  return tokens;
}

export async function logout(refreshToken: string): Promise<void> {
  const tokenHash = tokenService.hashToken(refreshToken);
  const stored = await authRepository.findRefreshTokenByHash(tokenHash);
  if (stored && !stored.revokedAt) {
    await authRepository.revokeRefreshToken(stored.id);
  }
}

export async function forgotPassword(input: ForgotPasswordInput): Promise<void> {
  const user = await usersRepository.findByEmail(input.email);

  // Respuesta genérica siempre, para no filtrar si el correo existe.
  if (!user || !user.active) {
    return;
  }

  const rawToken = tokenService.generateOpaqueToken();
  await authRepository.createPasswordResetToken({
    userId: user.id,
    tokenHash: tokenService.hashToken(rawToken),
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
  });

  // TODO: integrar envío real (email/SMS) cuando exista ese canal; por ahora se registra en log para uso interno/QA.
  logger.info({ userId: user.id, rawToken }, 'Password reset token generado');
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const tokenHash = tokenService.hashToken(input.token);
  const stored = await authRepository.findValidPasswordResetToken(tokenHash);

  if (!stored) {
    throw new BadRequestError('Token de recuperación inválido o expirado');
  }

  const passwordHash = await bcrypt.hash(input.newPassword, PASSWORD_SALT_ROUNDS);
  await usersRepository.update(stored.userId, { passwordHash });
  await authRepository.markPasswordResetTokenUsed(stored.id);
  await authRepository.revokeAllUserRefreshTokens(stored.userId);
}

export async function changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
  const user = await usersRepository.findById(userId);
  if (!user) {
    throw new UnauthorizedError();
  }

  const passwordMatches = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!passwordMatches) {
    throw new ConflictError('La contraseña actual no es correcta');
  }

  const passwordHash = await bcrypt.hash(input.newPassword, PASSWORD_SALT_ROUNDS);
  await usersRepository.update(userId, { passwordHash });
  await authRepository.revokeAllUserRefreshTokens(userId);
}
