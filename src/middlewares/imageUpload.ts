import multer from 'multer';
import { BadRequestError } from '../shared/errors';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// Memoria, no disco: el archivo nunca se escribe en el filesystem del servidor (efímero en
// Render) — se sube directo a Cloudinary desde el buffer. Un solo campo por request, la
// imagen no es tan grande como para justificar streaming a disco antes de subirla.
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, callback) => {
    if (!file.mimetype.startsWith('image/')) {
      callback(new BadRequestError('El archivo debe ser una imagen', 'INVALID_FILE_TYPE'));
      return;
    }
    callback(null, true);
  },
});
