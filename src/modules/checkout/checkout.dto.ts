import { z } from 'zod';
import { isValidPhone, normalizePhone } from '../../shared/phone';
import { appOrderBusinessSchema } from '../customers/customer-orders.dto';

export type AppOrderBusinessInput = z.infer<typeof appOrderBusinessSchema>;

// Checkout unificado. NO exige cuenta: sin Authorization es un pedido de invitado; con un
// Bearer de cliente válido el pedido se vincula a esa cuenta. La identidad sale SIEMPRE del
// token — este body no acepta customerId (si llega, se ignora) — y tampoco
// unitPrice/deliveryFee/platformFeeOverride: todo eso lo resuelve el servidor.
//
// Qué campos hacen falta depende de quién llama, y eso lo decide el service:
//  - invitado: customerName + customerPhone + address (addressId no aplica: no tiene direcciones);
//  - cliente autenticado: addressId o address; nombre/teléfono opcionales (por defecto, los de
//    su cuenta).
// customerPhone se conserva tal cual lo escribió la persona (snapshot del pedido), pero debe
// tener forma de teléfono.
export const checkoutOrderSchema = z
  .object({
    customerName: z.string().trim().min(2).max(150).optional(),
    customerPhone: z
      .string()
      .min(6)
      .max(30)
      .refine((value) => isValidPhone(normalizePhone(value)), { message: 'Teléfono inválido' })
      .optional(),
    addressId: z.cuid('id de dirección inválido').optional(),
    address: z.string().trim().min(3).max(300).optional(),
    addressReference: z.string().max(200).optional(),
    clientRequestId: z.string().min(8).max(100).optional(),
    businesses: z.array(appOrderBusinessSchema).min(1),
  })
  .refine((data) => data.addressId !== undefined || data.address !== undefined, {
    message: 'Debe indicar addressId (una dirección guardada) o address (una nueva)',
    path: ['address'],
  });

export type CheckoutOrderInput = z.infer<typeof checkoutOrderSchema>;
