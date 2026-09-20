import { prisma } from '../../shared/prisma';

export function findByDelivererId(delivererId: string) {
  return prisma.delivererLocation.findUnique({ where: { delivererId } });
}

// Una sola fila por mensajero (unique en delivererId): cada posición pisa la anterior.
export function upsert(
  delivererId: string,
  data: { latitude: number; longitude: number; accuracy: number | null; updatedAt: Date },
) {
  return prisma.delivererLocation.upsert({
    where: { delivererId },
    create: { delivererId, ...data },
    update: data,
  });
}

export async function deleteByDelivererId(delivererId: string): Promise<void> {
  await prisma.delivererLocation.deleteMany({ where: { delivererId } });
}

// "Entrega activa" = pedido ASSIGNED a este mensajero (único estado real entre asignado y
// entregado: no existen "recogiendo"/"en camino" en el backend).
export function countActiveDeliveries(delivererId: string) {
  return prisma.order.count({ where: { delivererId, status: 'ASSIGNED' } });
}
