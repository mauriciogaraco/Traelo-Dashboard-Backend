import { Router, type Request, type Response } from 'express';
import { validate } from '../../middlewares/validate';
import { paginationQuerySchema, type PaginationQuery } from '../../shared/http';
import * as pointsService from './points.service';

// GET /customers/me/points — saldo y movimientos del cliente autenticado. Se monta bajo
// /customers/:id, donde assertOwnCustomerId ya garantiza que :id es el del token.
export const customerPointsRouter = Router({ mergeParams: true });

customerPointsRouter.get(
  '/',
  validate({ query: paginationQuerySchema }),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const { data, meta } = await pointsService.getCustomerPoints(
      id,
      req.query as unknown as PaginationQuery,
    );
    res.status(200).json({ data, meta });
  },
);
