import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http';
import { dateRangePreset } from '../../shared/date-range';
import { OrderSource, OrderStatus } from '../../generated/prisma/enums';

const orderItemInputSchema = z
  .object({
    productId: z.cuid().optional(),
    productName: z.string().min(1).max(150).optional(),
    quantity: z.coerce.number().int().positive().default(1),
    unitPrice: z.coerce.number().min(0),
  })
  .refine((item) => item.productId !== undefined || item.productName !== undefined, {
    message: 'Debe indicar productId o productName',
    path: ['productName'],
  });

const orderBusinessInputSchema = z.object({
  businessId: z.cuid(),
  items: z.array(orderItemInputSchema).min(1),
});

export const createOrderSchema = z.object({
  customerName: z.string().min(2).max(150),
  customerAddress: z.string().min(3).max(300),
  addressReference: z.string().max(200).optional(),
  customerPhone: z.string().min(6).max(30),
  deliveryFee: z.coerce.number().min(0),
  // Anula el Servicio Tráelo calculado automáticamente (p.ej. 0 cuando no se cobró en este
  // pedido puntual). Es un campo explícito y separado de `platformFee` (el de salida en el
  // DTO) — el cliente nunca puede spoofear el valor calculado, solo pedir una excepción
  // deliberada que el staff autorizado decide a mano.
  platformFeeOverride: z.coerce.number().min(0).optional(),
  // Cliente de la app/web vinculado a este pedido (opcional: la mayoría de los pedidos
  // siguen siendo manuales, sin Customer). source por defecto MANUAL en el service, no acá,
  // para no obligar a este DTO a decidir el default de cada caller.
  customerId: z.cuid('id de cliente inválido').optional(),
  source: z.enum(OrderSource).optional(),
  // Idempotencia (Fase 13): generado por el caller (la app), no por Prisma — por eso es un
  // string libre, no z.cuid(). Si la misma request llega dos veces, la segunda devuelve el
  // pedido ya creado en vez de duplicarlo. Opcional: el flujo manual del dashboard no lo usa.
  clientRequestId: z.string().min(8).max(100).optional(),
  // Número del "🎟️ Número del Sorteo" del vale pegado, cuando el pedido participa de una
  // promoción vigente. Opcional: no todos los pedidos ni todas las épocas tienen sorteo activo.
  raffleNumber: z.coerce.number().int().positive().optional(),
  businesses: z.array(orderBusinessInputSchema).min(1),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const updateOrderSchema = z.object({
  customerName: z.string().min(2).max(150).optional(),
  customerAddress: z.string().min(3).max(300).optional(),
  addressReference: z.string().max(200).optional(),
  customerPhone: z.string().min(6).max(30).optional(),
  deliveryFee: z.coerce.number().min(0).optional(),
  platformFeeOverride: z.coerce.number().min(0).optional(),
  raffleNumber: z.coerce.number().int().positive().nullable().optional(),
  // Reemplaza por completo los negocios/productos del pedido (agregar, quitar, cambiar
  // cantidad/precio/negocio). Si se omite, los productos existentes no se tocan.
  businesses: z.array(orderBusinessInputSchema).min(1).optional(),
});

export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;

export const assignOrderSchema = z.object({
  delivererId: z.cuid(),
});

export type AssignOrderInput = z.infer<typeof assignOrderSchema>;

export const updateOrderStatusSchema = z.object({
  status: z.enum(['COMPLETED', 'CANCELLED']),
});

export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

export const bulkCompleteOrdersSchema = z.object({
  ids: z.array(z.cuid()).min(1).max(100),
});

export type BulkCompleteOrdersInput = z.infer<typeof bulkCompleteOrdersSchema>;

export const listOrdersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(OrderStatus).optional(),
  delivererId: z.cuid().optional(),
  businessId: z.cuid().optional(),
  search: z.string().trim().min(1).optional(),
  // Atajo de rango (hoy/semana/mes/6 meses/año/custom), igual que dashboard/reports. Si se
  // omite junto con from/to, no se filtra por fecha ("todos").
  range: dateRangePreset.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

// Etapas del reparto mientras el pedido está ASSIGNED: el mensajero va a recoger el pedido (PICKING_UP)
// y luego ya lo lleva al cliente (ON_THE_WAY). El estado del pedido no cambia.
export const updateOrderStageSchema = z.object({
  stage: z.enum(['PICKING_UP', 'ON_THE_WAY']),
});

export type UpdateOrderStageInput = z.infer<typeof updateOrderStageSchema>;
