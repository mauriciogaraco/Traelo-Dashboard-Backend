-- Etapas del reparto (recogiendo / en camino) mientras el pedido está ASSIGNED. Migración ADITIVA:
-- dos columnas nullable en orders; ninguna fila existente cambia y el estado del pedido no se toca.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "onTheWayAt" TIMESTAMP(3),
ADD COLUMN     "pickingUpAt" TIMESTAMP(3);

