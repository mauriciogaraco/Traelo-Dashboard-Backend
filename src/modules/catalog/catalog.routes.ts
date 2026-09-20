import { Router } from 'express';
import { apiKeyAuth } from '../../middlewares/apiKeyAuth';
import { publicRateLimit } from '../../middlewares/publicRateLimit';
import { validate } from '../../middlewares/validate';
import * as catalogController from './catalog.controller';
import { sendOk } from '../../shared/http';
import { getCatalogStats } from './catalog-stats.service';
import {
  catalogBusinessIdParamSchema,
  listCatalogBusinessesQuerySchema,
  listCatalogChangesQuerySchema,
  listCatalogProductsQuerySchema,
} from './catalog.dto';

// Rutas públicas (sin JWT de staff): las consume la app móvil/web de clientes, protegidas
// solo por API key + rate limit (ver decisión en el checklist: auth real de Customer, con
// OTP por teléfono, queda para otra tarea).
export const catalogRouter = Router();

catalogRouter.use(publicRateLimit, apiKeyAuth);

catalogRouter.get('/bootstrap', catalogController.getBootstrap);

catalogRouter.get('/version', catalogController.getVersion);

catalogRouter.get(
  '/changes',
  validate({ query: listCatalogChangesQuerySchema }),
  catalogController.getChanges,
);

catalogRouter.get('/categories', catalogController.listCategories);

// Popularidad (pedidos/unidades recientes) y calificación de negocios, para ordenar la búsqueda.
catalogRouter.get('/stats', async (_req, res) => {
  sendOk(res, await getCatalogStats());
});

catalogRouter.get(
  '/businesses',
  validate({ query: listCatalogBusinessesQuerySchema }),
  catalogController.listBusinesses,
);

catalogRouter.get(
  '/businesses/:businessId/products',
  validate({ params: catalogBusinessIdParamSchema, query: listCatalogProductsQuerySchema }),
  catalogController.listProducts,
);
