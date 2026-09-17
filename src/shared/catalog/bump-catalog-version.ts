import { prisma } from '../prisma';
import { CatalogChangeType, type CatalogEntityType } from '../../generated/prisma/enums';

// Incrementa el contador global de catálogo y deja una fila en CatalogChangeLog para que la
// app pueda pedir "GET changes since version X". Se ejecuta como una transacción propia,
// separada de la mutación de la entidad que la dispara (crear/actualizar un Business,
// Product, Category, etc.): no las forzamos a compartir una sola transacción porque el
// versionado de catálogo es una ayuda de sincronización, no un dato financiero — una
// ventana breve de inconsistencia entre "la entidad ya cambió" y "el contador ya subió" es
// aceptable (se autocorrige en el siguiente cambio) y evita acoplar cada repository a un
// cliente de transacción compartido.
export async function bumpCatalogVersion(
  entityType: CatalogEntityType,
  entityId: string,
  changeType: CatalogChangeType = CatalogChangeType.UPSERT,
): Promise<number> {
  const newVersion = await prisma.$transaction(async (tx) => {
    const state = await tx.catalogState.upsert({
      where: { id: 'singleton' },
      update: { version: { increment: 1 } },
      create: { id: 'singleton', version: 1 },
    });

    await tx.catalogChangeLog.create({
      data: { version: state.version, entityType, entityId, changeType },
    });

    return state.version;
  });

  return newVersion;
}
