-- Foto de perfil del mensajero (solo la URL). Migración ADITIVA: una columna nullable; ninguna fila cambia.

-- AlterTable
ALTER TABLE "deliverers" ADD COLUMN     "photoUrl" TEXT;

