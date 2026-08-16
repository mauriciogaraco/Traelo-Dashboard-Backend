import { createApp } from './app';
import { env } from './config/env';
import { logger } from './shared/logger';
import { prisma } from './shared/prisma';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`Tráelo Operaciones backend escuchando en el puerto ${env.PORT} (${env.NODE_ENV})`);
});

async function shutdown(signal: string): Promise<void> {
  logger.info(`Recibida señal ${signal}, cerrando servidor...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
