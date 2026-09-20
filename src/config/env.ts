import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es requerido'),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET debe tener al menos 16 caracteres'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET debe tener al menos 16 caracteres'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  // Sesión persistente del cliente de la app (deslizante: cada refresh la renueva). Más larga
  // que la del staff a propósito: a un cliente no se le pide login para volver a comprar.
  CUSTOMER_REFRESH_EXPIRES_IN: z.string().default('180d'),
  // Opcional a propósito: sin ella, las rutas públicas de catálogo/app (Fase 2) responden
  // 403 en vez de tumbar el arranque del servidor — así este deploy no rompe producción
  // mientras el valor no esté configurado en Render.
  MOBILE_APP_API_KEY: z.string().min(16).optional(),
  // Opcionales, mismo criterio: sin configurar, sendTelegramMessage simplemente no envía
  // nada (no tumba el arranque ni el pedido).
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_CHAT_ID: z.string().min(1).optional(),
  // Imágenes de productos/negocios (Cloudinary). Opcionales por ahora — todavía no hay
  // código que los use, solo quedan disponibles en `env` para cuando se implemente el upload.
  CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
  CLOUDINARY_API_KEY: z.string().min(1).optional(),
  CLOUDINARY_API_SECRET: z.string().min(1).optional(),
  // Motor de rutas (compatible con la API de OSRM) para dibujar el recorrido del mensajero. Por
  // defecto el servidor PÚBLICO de demostración de OSRM: sirve para probar, NO para producción
  // (sin garantías, uso limitado y le llegan las posiciones del mensajero). Para producción,
  // apuntar a un OSRM propio con el mapa de Cuba.
  ROUTING_BASE_URL: z.string().url().default('https://router.project-osrm.org'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variables de entorno inválidas:', z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
