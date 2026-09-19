import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { logger } from './shared/logger';
import { errorHandler } from './middlewares/errorHandler';
import { env } from './config/env';
import { authRouter } from './modules/auth/auth.routes';
import { customerAuthRouter } from './modules/customer-auth/customer-auth.routes';
import { usersRouter } from './modules/users/users.routes';
import { businessesRouter } from './modules/businesses/businesses.routes';
import { categoriesRouter } from './modules/categories/categories.routes';
import { catalogRouter } from './modules/catalog/catalog.routes';
import { customersRouter } from './modules/customers/customers.routes';
import { checkoutRouter } from './modules/checkout/checkout.routes';
import { guestOrdersRouter } from './modules/guest-orders/guest-orders.routes';
import { deliverersRouter } from './modules/deliverers/deliverers.routes';
import { ordersRouter } from './modules/orders/orders.routes';
import { settlementsRouter } from './modules/settlements/settlements.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { analyticsRouter } from './modules/analytics/analytics.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { businessPortalRouter } from './modules/business-portal/business-portal.routes';
import { systemConfigRouter } from './config/system-config.routes';

export function createApp(): Express {
  const app = express();

  // Tras el proxy de Render, req.ip sería la IP del proxy y todo el mundo compartiría el mismo
  // cupo de rate limit. Solo en producción: en local no hay proxy y confiar en X-Forwarded-For
  // dejaría a cualquiera falsear su IP.
  if (env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(pinoHttp({ logger }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Antes que /auth (staff): ambos cuelgan de /api/v1/auth pero son sistemas de identidad distintos.
  app.use('/api/v1/auth/customer', customerAuthRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/businesses', businessesRouter);
  app.use('/api/v1/categories', categoriesRouter);
  app.use('/api/v1/catalog', catalogRouter);
  app.use('/api/v1/customers', customersRouter);
  app.use('/api/v1/checkout', checkoutRouter);
  app.use('/api/v1/guest/orders', guestOrdersRouter);
  app.use('/api/v1/deliverers', deliverersRouter);
  app.use('/api/v1/orders', ordersRouter);
  app.use('/api/v1/settlements', settlementsRouter);
  app.use('/api/v1/reports', reportsRouter);
  app.use('/api/v1/analytics', analyticsRouter);
  app.use('/api/v1/dashboard', dashboardRouter);
  app.use('/api/v1/my-business', businessPortalRouter);
  app.use('/api/v1/config', systemConfigRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Recurso no encontrado' });
  });

  app.use(errorHandler);

  return app;
}
