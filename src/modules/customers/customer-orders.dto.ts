import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http';

// Exportados (no solo usados acá): checkout.dto.ts los reutiliza para el flujo de invitado,
// que comparte exactamente la misma forma de "negocios + items" que este endpoint.
export const appOrderItemSchema = z.object({
  productId: z.cuid('id de producto inválido'),
  quantity: z.coerce.number().int().positive().default(1),
  // Precio que la app tenía cacheado al armar el carrito. Solo se usa para DETECTAR que
  // cambió (Fase 11: respuesta CART_CHANGED) — nunca para calcular el cargo real, que
  // siempre sale de getEffectiveProductPrice en el servidor.
  expectedPrice: z.coerce.number().min(0).optional(),
});

export const appOrderBusinessSchema = z.object({
  businessId: z.cuid('id de negocio inválido'),
  items: z.array(appOrderItemSchema).min(1),
});

// A propósito, este DTO NO acepta unitPrice, deliveryFee ni platformFeeOverride: todo eso se
// resuelve en el servidor (customer-orders.service.ts) para que un cliente de la app nunca
// pueda fijar su propio precio, costo de envío o "Servicio Tráelo". Tampoco acepta
// productName libre (a diferencia del flujo manual del dashboard): cada línea debe ser un
// producto real del catálogo.
export const createAppOrderSchema = z
  .object({
    addressId: z.cuid('id de dirección inválido').optional(),
    address: z.string().min(3).max(300).optional(),
    addressReference: z.string().max(200).optional(),
    clientRequestId: z.string().min(8).max(100).optional(),
    businesses: z.array(appOrderBusinessSchema).min(1),
  })
  .refine((data) => data.addressId !== undefined || data.address !== undefined, {
    message: 'Debe indicar addressId (una dirección guardada) o address (una nueva)',
    path: ['address'],
  });

export type CreateAppOrderInput = z.infer<typeof createAppOrderSchema>;

export const listCustomerOrdersQuerySchema = paginationQuerySchema;

export type ListCustomerOrdersQuery = z.infer<typeof listCustomerOrdersQuerySchema>;

export const customerOrderParamsSchema = z.object({
  id: z.cuid('id de cliente inválido'),
  orderId: z.cuid('id de pedido inválido'),
});

export type CustomerOrderParams = z.infer<typeof customerOrderParamsSchema>;
