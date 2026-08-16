import { prisma } from '../../shared/prisma';

export function createRefreshToken(data: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
}) {
  return prisma.refreshToken.create({ data });
}

export function findRefreshTokenByHash(tokenHash: string) {
  return prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
}

export function revokeRefreshToken(id: string, replacedByTokenHash?: string) {
  return prisma.refreshToken.update({
    where: { id },
    data: { revokedAt: new Date(), replacedByTokenHash },
  });
}

export function revokeAllUserRefreshTokens(userId: string) {
  return prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function createPasswordResetToken(data: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  return prisma.passwordResetToken.create({ data });
}

export function findValidPasswordResetToken(tokenHash: string) {
  return prisma.passwordResetToken.findFirst({
    where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
  });
}

export function markPasswordResetTokenUsed(id: string) {
  return prisma.passwordResetToken.update({ where: { id }, data: { usedAt: new Date() } });
}
