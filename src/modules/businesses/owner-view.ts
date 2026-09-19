import type { BusinessDTO } from './businesses.service';
import type { ProductDTO } from './products.service';

/**
 * Lo que ve un BUSINESS_OWNER de su propio negocio. Deliberadamente NO incluye comisión,
 * tarifa de envío base ni suscripción: son condiciones comerciales de Tráelo con el negocio y
 * nunca deben salir en una respuesta para ese rol (no basta con ocultarlas en el frontend).
 */
export interface OwnerBusinessDTO {
  id: string;
  name: string;
  phone: string;
  address: string;
  joinedAt: Date;
  active: boolean;
  acceptingOrders: boolean;
  logoUrl: string | null;
}

export function toOwnerBusinessDTO(business: BusinessDTO): OwnerBusinessDTO {
  return {
    id: business.id,
    name: business.name,
    phone: business.phone,
    address: business.address,
    joinedAt: business.joinedAt,
    active: business.active,
    acceptingOrders: business.acceptingOrders,
    logoUrl: business.logoUrl,
  };
}

/** Igual que ProductDTO pero sin la comisión por producto (ganancia de Tráelo). */
export function toOwnerProductDTO(product: ProductDTO): ProductDTO {
  return { ...product, commission: null };
}
