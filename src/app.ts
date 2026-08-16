import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { logger } from './shared/logger';
import { errorHandler } from './middlewares/errorHandler';
import { authRouter } from './modules/auth/auth.routes';
import { usersRouter } from './modules/users/users.routes';
import { businessesRouter } from './modules/businesses/businesses.routes';
import { deliverersRouter } from './modules/deliverers/deliverers.routes';
import { ordersRouter } from './modules/orders/orders.routes';
import { settlementsRouter } from './modules/settlements/settlements.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { systemConfigRouter } from './config/system-config.routes';

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(pinoHttp({ logger }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/businesses', businessesRouter);
  app.use('/api/v1/deliverers', deliverersRouter);
  app.use('/api/v1/orders', ordersRouter);
  app.use('/api/v1/settlements', settlementsRouter);
  app.use('/api/v1/reports', reportsRouter);
  app.use('/api/v1/dashboard', dashboardRouter);
  app.use('/api/v1/config', systemConfigRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Recurso no encontrado' });
  });

  app.use(errorHandler);

  return app;
}
