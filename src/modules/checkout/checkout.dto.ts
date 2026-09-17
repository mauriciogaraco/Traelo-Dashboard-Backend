import { z } from 'zod';
import { appOrderBusinessSchema } from '../customers/customer-orders.dto';

export type AppOrderBusinessInput = z.infer<typeof appOrderBusinessSchema>;

// Checkout unificado (Fase 9 del checklist de la app): admite un cliente ya identificado
// (customerId) o un invitado sin cuenta previa (customerName+customerPhone+address directos).
// A propósito NO acepta unitPrice/deliveryFee/platformFeeOverride — igual que
// customer-orders.dto.ts, todo eso se resuelve en el servidor.
export const checkoutOrderSchema = z
  .object({
    customerId: z.cuid('id de cliente inválido').optional(),
    customerName: z.string().min(2).max(150).optional(),
    customerPhone: z.string().min(6).max(30).optional(),
    addressId: z.cuid('id de dirección inválido').optional(),
    address: z.string().min(3).max(300).optional(),
    addressReference: z.string().max(200).optional(),
    clientRequestId: z.string().min(8).max(100).optional(),
    businesses: z.array(appOrderBusinessSchema).min(1),
  })
  .refine(
    (data) =>
      data.customerId !== undefined ||
      (data.customerName !== undefined && data.customerPhone !== undefined),
    {
      message: 'Debe indicar customerId, o customerName y customerPhone para un pedido de invitado',
      path: ['customerId'],
    },
  )
  .refine((data) => data.addressId !== undefined || data.address !== undefined, {
    message: 'Debe indicar addressId (una dirección guardada) o address (una nueva)',
    path: ['address'],
  })
  .refine((data) => data.customerId !== undefined || data.addressId === undefined, {
    message:
      'addressId solo es válido junto con customerId — un invitado no tiene direcciones guardadas todavía',
    path: ['addressId'],
  });

export type CheckoutOrderInput = z.infer<typeof checkoutOrderSchema>;
