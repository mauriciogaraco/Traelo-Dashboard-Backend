import rateLimit from 'express-rate-limit';

// Único middleware de rate limiting del proyecto: protege las rutas públicas de catálogo
// (sin JWT de staff detrás) de scraping/abuso básico. 60 req/min por IP es generoso para
// una app navegando el catálogo, mucho para un scraper naive.
export const publicRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
