import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http';
import { OrderStatus } from '../../generated/prisma/enums';

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

export const listOrdersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(OrderStatus).optional(),
  delivererId: z.cuid().optional(),
  businessId: z.cuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;
