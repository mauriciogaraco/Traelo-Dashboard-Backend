import { Readable } from 'node:stream';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../../config/env';
import { BadRequestError } from '../errors';

let configured = false;

function ensureConfigured(): void {
  if (configured) {
    return;
  }
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
}

export interface UploadedImage {
  url: string;
  publicId: string;
}

// Sube un archivo ya validado (ver middlewares/imageUpload.ts: tipo y tamaño) a Cloudinary,
// dentro de `folder` (ej. "traelo/businesses/<id>"). Nunca guarda el binario en Postgres —
// solo la URL resultante se persiste (Business.logoUrl / Product.imageUrl).
export async function uploadImage(buffer: Buffer, folder: string): Promise<UploadedImage> {
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    throw new BadRequestError(
      'La subida de imágenes no está configurada en el servidor (faltan credenciales de Cloudinary)',
      'IMAGE_UPLOAD_NOT_CONFIGURED',
    );
  }
  ensureConfigured();

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error('Cloudinary no devolvió resultado'));
          return;
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );
    Readable.from(buffer).pipe(uploadStream);
  });
}
