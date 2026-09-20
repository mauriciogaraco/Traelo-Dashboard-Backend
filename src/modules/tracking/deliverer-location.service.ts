import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import * as deliverersRepository from '../deliverers/deliverers.repository';
import * as locationRepository from './deliverer-location.repository';
import type { UpdateDelivererLocationInput } from './deliverer-location.dto';

export interface DelivererLocationDTO {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  updatedAt: Date;
}

// Guarda la última posición del mensajero autenticado (identificado por el token, nunca por el
// body). Solo se almacena mientras tenga una entrega activa: si no la tiene, se descarta lo
// recibido y se borra cualquier posición vieja — la app de mensajero decide cuándo dejar de enviar.
export async function updateMyLocation(
  userId: string,
  input: UpdateDelivererLocationInput,
  now: Date = new Date(),
): Promise<DelivererLocationDTO> {
  const deliverer = await deliverersRepository.findByUserId(userId);
  if (!deliverer) {
    throw new NotFoundError('Perfil de mensajero no encontrado');
  }
  if (!deliverer.user.active) {
    throw new ForbiddenError('El mensajero no está activo');
  }

  const activeDeliveries = await locationRepository.countActiveDeliveries(deliverer.id);
  if (activeDeliveries === 0) {
    await locationRepository.deleteByDelivererId(deliverer.id);
    throw new ConflictError(
      'No tienes entregas activas: no se guarda tu ubicación',
      'NO_ACTIVE_DELIVERY',
    );
  }

  const saved = await locationRepository.upsert(deliverer.id, {
    latitude: input.latitude,
    longitude: input.longitude,
    accuracy: input.accuracy ?? null,
    updatedAt: now,
  });
  return {
    latitude: saved.latitude,
    longitude: saved.longitude,
    accuracy: saved.accuracy,
    updatedAt: saved.updatedAt,
  };
}

// Se llama cuando un pedido termina (entregado/cancelado): si el mensajero ya no tiene entregas
// activas, su última posición se borra. Es limpieza de privacidad — nunca debe romper el cambio
// de estado del pedido, por eso traga (y registra) cualquier error.
export async function releaseLocationIfIdleSafely(delivererId: string | null): Promise<void> {
  if (!delivererId) return;
  try {
    if ((await locationRepository.countActiveDeliveries(delivererId)) === 0) {
      await locationRepository.deleteByDelivererId(delivererId);
    }
  } catch (error) {
    logger.error({ err: error, delivererId }, 'No se pudo limpiar la ubicación del mensajero');
  }
}
