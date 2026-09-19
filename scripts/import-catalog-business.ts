/**
 * Completa negocios YA EXISTENTES en la base con los datos del catálogo web (proyecto "Tráelo",
 * carpeta data/ + public/assets/): logo, horario, categorías y productos. Pasa por los mismos
 * servicios que usa el dashboard (validaciones, bumpCatalogVersion, subida a Cloudinary +
 * blurhash), así que lo importado queda visible en la app móvil.
 *
 * Uso (desde Traelo-Dashboard-backend):
 *   npx tsx scripts/import-catalog-business.ts --source "C:\Users\PC\Desktop\Tráelo" --all
 *   npx tsx scripts/import-catalog-business.ts --source "..." --business cronos,amore --apply
 *
 * Sin --apply es un simulacro: SOLO LEE (archivos locales y la base) y muestra qué haría, el
 * emparejamiento catálogo → negocio de la base y las diferencias. NO escribe ni sube imágenes.
 *
 * Reglas:
 *  - NO se crean negocios y NO se modifican nombre, teléfono, dirección, comisión ni tarifa base:
 *    las diferencias solo se informan.
 *  - Solo se completa lo que falta: logo (si no tiene), horario (por día, si no existe), categorías
 *    y productos. Los productos existentes (por externalId) no se sobrescriben salvo --update-existing.
 *  - Negocios con precios en USD y con scheduleExtra se informan y se saltan (ver --with-schedule-extra).
 *  - Idempotente: reejecutarlo no duplica nada. Reintenta errores transitorios del pooler/Cloudinary.
 *
 * Emparejamiento: por nombre normalizado (tildes, mayúsculas, puntuación). Solo los niveles EXACTO,
 * NORMALIZADO y NÚCLEO se aplican solos; los DUDOSO exigen --map con la confirmación explícita:
 *   --map emparejamiento.json   →   { "dlm": "<id del negocio en la base>", ... }
 */
import 'dotenv/config';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { prisma } from '../src/shared/prisma';
import { encodeBlurhash } from '../src/shared/blurhash';
import { timeToString } from '../src/shared/time';
import * as hoursService from '../src/modules/businesses/business-hours.service';
import { upsertBusinessHoursSchema } from '../src/modules/businesses/business-hours.dto';
import * as businessesService from '../src/modules/businesses/businesses.service';
import * as productsService from '../src/modules/businesses/products.service';
import * as categoriesService from '../src/modules/categories/categories.service';
import { packagingSchema, type PackagingOption } from '../src/modules/businesses/packaging';

interface CatalogSchedule {
  days: number[];
  open: string;
  close: string;
}

interface CatalogBusiness {
  id: string;
  name: string;
  description?: string;
  image?: string;
  color?: string;
  paymentNote?: string;
  businessCategories?: string[];
  deliveryFee?: number;
  businessCommission?: number;
  clientCommission?: number;
  schedule: CatalogSchedule;
  scheduleExtra?: CatalogSchedule;
  status?: string;
  currency?: string;
}

interface CatalogProduct {
  id: string;
  name: string;
  category: string;
  shortDescription?: string;
  longDescription?: string;
  photo?: string;
  image?: string;
  price: number;
  formato?: number;
  options?: string[] | string;
  addons?: unknown[];
  packaging?: { name: string; price: number; capacity?: number }[];
  featured?: boolean;
  stockStatus: string;
  currency?: string;
}

const { values: args } = parseArgs({
  options: {
    source: { type: 'string' },
    business: { type: 'string' },
    all: { type: 'boolean', default: false },
    map: { type: 'string' },
    apply: { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
    'update-existing': { type: 'boolean', default: false },
    'with-schedule-extra': { type: 'boolean', default: false },
    'skip-products': { type: 'boolean', default: false },
    'allow-product-logo': { type: 'boolean', default: false },
  },
});

if (!args.source || (!args.business && !args.all)) {
  console.error('Faltan argumentos: --source y (--business a,b,c o --all) son obligatorios.');
  process.exit(1);
}
const SOURCE = args.source;
const APPLY = args.apply === true;
const VERBOSE = args.verbose === true;
const UPDATE_EXISTING = args['update-existing'] === true;
const WITH_SCHEDULE_EXTRA = args['with-schedule-extra'] === true;
// Solo logo + horario: no lee productos, no crea categorías y no aplica la restricción de USD.
const SKIP_PRODUCTS = args['skip-products'] === true;
// Permite usar como logo una imagen que vive en assets/images/products/ (ej. La Marina).
const ALLOW_PRODUCT_LOGO = args['allow-product-logo'] === true;

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(SOURCE, relativePath), 'utf8')) as T;
}

// ── utilidades de texto ─────────────────────────────────────────────────────
function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STOP_WORDS = new Set(['bar', 'restaurante', 'restaurant', 'tienda', 'tiendas', 'de', 'del', 'la', 'el', 'los', 'las', 'y']);

function coreTokens(value: string): string[] {
  return normalizeName(value)
    .split(' ')
    .filter((token) => token && !STOP_WORDS.has(token));
}

function compact(value: string): string {
  return value.replace(/\s+/g, '');
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0] ?? 0;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j] ?? 0;
      prev[j] = Math.min(above + 1, (prev[j - 1] ?? 0) + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[b.length] ?? 0;
}

function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
}

// ── emparejamiento catálogo → base ──────────────────────────────────────────
type MatchTier = 'EXACTO' | 'NORMALIZADO' | 'NÚCLEO' | 'DUDOSO' | 'AMBIGUO' | 'SIN PAREJA';

interface DbBusiness {
  id: string;
  name: string;
  phone: string;
  address: string;
  active: boolean;
  acceptingOrders: boolean;
  commissionType: string;
  commissionPercentage: { toString(): string } | null;
  deliveryFeeBase: { toString(): string };
  logoUrl: string | null;
  _count: { products: number; businessHours: number };
}

interface Match {
  tier: MatchTier;
  dbBusiness: DbBusiness | null;
  candidates: DbBusiness[];
  viaMap: boolean;
}

function findMatch(catalogName: string, dbBusinesses: DbBusiness[]): Match {
  const pick = (predicate: (db: DbBusiness) => boolean, tier: MatchTier): Match | null => {
    const found = dbBusinesses.filter(predicate);
    if (found.length === 0) return null;
    if (found.length > 1) return { tier: 'AMBIGUO', dbBusiness: null, candidates: found, viaMap: false };
    return { tier, dbBusiness: found[0] ?? null, candidates: found, viaMap: false };
  };

  const exact = pick((db) => db.name === catalogName, 'EXACTO');
  if (exact) return exact;
  const normalizedTarget = compact(normalizeName(catalogName));
  const normalized = pick((db) => compact(normalizeName(db.name)) === normalizedTarget, 'NORMALIZADO');
  if (normalized) return normalized;
  const coreTarget = coreTokens(catalogName);
  const coreKey = compact(coreTarget.join(' '));
  const core = coreKey ? pick((db) => compact(coreTokens(db.name).join(' ')) === coreKey, 'NÚCLEO') : null;
  if (core) return core;

  const doubtful = dbBusinesses.filter((db) => {
    const other = coreTokens(db.name);
    if (other.length === 0 || coreTarget.length === 0) return false;
    const subset = (small: string[], big: string[]): boolean => small.every((token) => big.includes(token));
    return (
      subset(coreTarget, other) ||
      subset(other, coreTarget) ||
      similarity(coreKey, compact(other.join(' '))) >= 0.75
    );
  });
  return { tier: doubtful.length > 0 ? 'DUDOSO' : 'SIN PAREJA', dbBusiness: null, candidates: doubtful, viaMap: false };
}

function nearest(catalogName: string, dbBusinesses: DbBusiness[], limit = 3): DbBusiness[] {
  const target = compact(normalizeName(catalogName));
  return [...dbBusinesses]
    .sort((a, b) => similarity(target, compact(normalizeName(b.name))) - similarity(target, compact(normalizeName(a.name))))
    .slice(0, limit);
}

// ── reglas de mapeo ─────────────────────────────────────────────────────────
// En el catálogo web `price` es por UNIDAD y el cliente compra cajas de `formato` unidades
// (ver lib/cart.ts del sitio: quantity = nº de cajas). El backend solo tiene un precio por
// producto, así que se importa el precio de la CAJA para que el total coincida con el sitio.
function unitPriceForBackend(product: CatalogProduct): number {
  const pack = product.formato && product.formato > 1 ? product.formato : 1;
  return Math.round(product.price * pack * 100) / 100;
}

// Algunos productos traen `options` como string suelto ("S") en vez de array.
function optionsOf(product: CatalogProduct): string[] {
  if (Array.isArray(product.options)) return product.options;
  return product.options ? [product.options] : [];
}

function buildDescription(product: CatalogProduct): string | undefined {
  const parts: string[] = [];
  const base = (product.longDescription || product.shortDescription || '').trim();
  if (base) parts.push(base);
  if (product.formato && product.formato > 1 && !base.includes(String(product.formato))) {
    parts.push(`Caja de ${product.formato} unidades.`);
  }
  const options = optionsOf(product);
  if (options.length) {
    parts.push(`Opciones: ${options.join(', ')}.`);
  }
  return parts.length ? parts.join(' ') : undefined;
}

// La base es remota (pooler de Supabase) y Cloudinary a veces corta la conexión (ECONNRESET,
// P2028...). Es seguro reintentar porque cada paso es idempotente.
function isTransient(error: unknown): boolean {
  const e = error as { code?: string; http_code?: number; message?: string; error?: { code?: string; http_code?: number; message?: string } };
  const code = e.code ?? e.error?.code;
  const http = e.http_code ?? e.error?.http_code;
  const message = `${e.message ?? ''} ${e.error?.message ?? ''}`;
  return (
    ['P2028', 'P1001', 'P1017', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN'].includes(code ?? '') ||
    (http !== undefined && (http >= 500 || http === 429 || http === 499)) ||
    /ECONNRESET|ETIMEDOUT|socket hang up|timeout|Connection terminated|Connection (?:closed|refused)/i.test(message)
  );
}

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isTransient(error) || attempt >= attempts) throw error;
      console.warn(`  ↻ ${label}: error transitorio, reintento ${attempt}/${attempts - 1}…`);
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
}

// stockStatus del catálogo: disponible | pocas | agotado. "pocas" sigue siendo comprable pero avisa
// que queda poco, que es exactamente Product.lowStock.
function availabilityFor(p: CatalogProduct): { available: boolean; lowStock: boolean } {
  return { available: p.stockStatus !== 'agotado', lowStock: p.stockStatus === 'pocas' };
}

// Empaque del catálogo → Product.packaging. undefined = sin empaque (o inválido: se avisa en el análisis).
function packagingFor(p: CatalogProduct): PackagingOption[] | undefined {
  if (!p.packaging?.length) return undefined;
  const parsed = packagingSchema.safeParse(p.packaging);
  return parsed.success ? parsed.data : undefined;
}

function imagePath(publicUrl: string | undefined): string | null {
  if (!publicUrl) return null;
  const path = join(SOURCE, 'public', publicUrl);
  return existsSync(path) ? path : null;
}

// ── análisis del catálogo (sin tocar nada) ──────────────────────────────────
interface ProductPlan {
  p: CatalogProduct;
  file: string | null;
  imageIssue: 'sin foto' | 'archivo inexistente' | 'sin blurhash' | 'archivo >9.5MB' | null;
  price: number;
  description: string | undefined;
}

interface HoursPlan {
  day: number;
  openTime: string;
  closeTime: string;
  closed: boolean;
}

interface Analysis {
  business: CatalogBusiness;
  products: CatalogProduct[];
  plan: ProductPlan[];
  logoFile: string | null;
  hours: HoursPlan[];
  skipReason: string | null;
  warnings: string[];
  unmapped: Record<string, number>;
}

async function analyze(business: CatalogBusiness): Promise<Analysis> {
  const products = SKIP_PRODUCTS ? [] : readJson<CatalogProduct[]>(`data/${business.id}.json`);
  const warnings: string[] = [];
  let skipReason: string | null = null;

  const usdProducts = products.filter((p) => p.currency === 'USD');
  if (!SKIP_PRODUCTS && (business.currency === 'USD' || usdProducts.length > 0)) {
    skipReason = `USD: negocio ${business.currency ?? 'CUP'}, ${usdProducts.length}/${products.length} productos en USD. Requiere decisión de modelado.`;
  }

  const days = new Map<number, HoursPlan>();
  for (let day = 0; day <= 6; day++) {
    days.set(day, {
      day,
      openTime: business.schedule.open,
      closeTime: business.schedule.close,
      closed: !business.schedule.days.includes(day),
    });
  }
  if (business.scheduleExtra) {
    const extra = business.scheduleExtra;
    const note = `scheduleExtra (${extra.days.join(',')}: ${extra.open}–${extra.close}). Cabe en el modelo (un turno por día) pero no se aplica sin confirmación (--with-schedule-extra).`;
    if (WITH_SCHEDULE_EXTRA) {
      for (const day of extra.days) {
        days.set(day, { day, openTime: extra.open, closeTime: extra.close, closed: false });
      }
      warnings.push(`scheduleExtra aplicado: ${extra.days.join(',')} ${extra.open}–${extra.close}.`);
    } else {
      warnings.push(`HORARIO NO SE IMPORTA: ${note}`);
    }
  }
  let logoFile = imagePath(business.image);
  if (logoFile && business.image?.includes('/products/') && !ALLOW_PRODUCT_LOGO) {
    warnings.push(`LOGO NO SE IMPORTA: el "logo" del catálogo (${business.image}) es una foto de producto, no un logo.`);
    logoFile = null;
  } else if (logoFile && statSync(logoFile).size > 9.5 * 1024 * 1024) {
    warnings.push(`LOGO NO SE IMPORTA: ${business.image} pesa más de 9.5MB.`);
    logoFile = null;
  }

  const plan: ProductPlan[] = [];
  for (const p of products) {
    const file = imagePath(p.photo);
    let imageIssue: ProductPlan['imageIssue'] = null;
    if (!p.photo) imageIssue = 'sin foto';
    else if (!file) imageIssue = 'archivo inexistente';
    else if (statSync(file).size > 9.5 * 1024 * 1024) imageIssue = 'archivo >9.5MB';
    else if (!(await encodeBlurhash(readFileSync(file)))) imageIssue = 'sin blurhash';
    plan.push({ p, file, imageIssue, price: unitPriceForBackend(p), description: buildDescription(p) });

    if (typeof p.options === 'string') warnings.push(`${p.id}: options es un string ("${p.options}") en vez de array; se trata como una sola opción.`);
    if (p.packaging?.length && !packagingFor(p)) warnings.push(`${p.id}: packaging inválido, no se importa el empaque.`);
    if (p.name.length > 150) warnings.push(`${p.id}: nombre >150 caracteres.`);
    if (p.category.length > 80) warnings.push(`${p.id}: categoría >80 caracteres.`);
    const description = buildDescription(p);
    if (description && description.length > 2000) warnings.push(`${p.id}: descripción >2000 caracteres (se recorta).`);
    if (!(p.price > 0)) warnings.push(`${p.id} "${p.name}": precio ${p.price} (se importaría con precio 0).`);
    if (!['disponible', 'pocas', 'agotado'].includes(p.stockStatus)) {
      warnings.push(`${p.id}: stockStatus desconocido "${p.stockStatus}".`);
    }
  }

  const count = (test: (p: CatalogProduct) => boolean): number => products.filter(test).length;
  const unmapped: Record<string, number> = {
    'producto.addons': count((p) => (p.addons?.length ?? 0) > 0),
    'producto.featured': count((p) => p.featured === true),
    'producto.image (emoji)': count((p) => Boolean(p.image)),
    'negocio.description': business.description ? 1 : 0,
    'negocio.paymentNote': business.paymentNote ? 1 : 0,
    'negocio.businessCategories': business.businessCategories?.length ? 1 : 0,
    'negocio.color': business.color ? 1 : 0,
  };

  return {
    business,
    products,
    plan,
    logoFile,
    hours: [...days.values()],
    skipReason,
    warnings,
    unmapped,
  };
}

// ── diferencias entre la base y el catálogo (solo se informan) ──────────────
function differences(a: Analysis, db: DbBusiness, hoursRows: { dayOfWeek: number; openTime: Date; closeTime: Date; closed: boolean }[]): string[] {
  const out: string[] = [];
  const b = a.business;
  if (db.name !== b.name) out.push(`nombre: base "${db.name}" ≠ catálogo "${b.name}"`);
  const fee = b.deliveryFee ?? 250;
  if (Number(db.deliveryFeeBase.toString()) !== fee) out.push(`tarifa base: base ${db.deliveryFeeBase} ≠ catálogo ${fee}`);
  const businessPct = b.businessCommission ?? 0;
  const clientPct = b.clientCommission ?? 0;
  const dbPct = db.commissionPercentage === null ? null : Number(db.commissionPercentage.toString());
  if (db.commissionType !== 'PERCENTAGE' || dbPct !== businessPct + clientPct) {
    out.push(
      `comisión: base ${db.commissionType} ${dbPct ?? '—'}% ≠ catálogo (negocio ${businessPct}% + servicio cliente ${clientPct}% = ${businessPct + clientPct}%)`,
    );
  }
  if (!db.active) out.push('el negocio está INACTIVO en la base');
  if (b.status === 'cerrado' && db.acceptingOrders) out.push('catálogo dice cerrado y la base acepta pedidos → se pondrá acceptingOrders=false');
  if (b.status !== 'cerrado' && !db.acceptingOrders) out.push('la base tiene acceptingOrders=false y el catálogo lo tiene abierto (no se toca)');
  for (const row of hoursRows) {
    const extra = b.scheduleExtra;
    const wanted =
      extra && extra.days.includes(row.dayOfWeek)
        ? { day: row.dayOfWeek, openTime: extra.open, closeTime: extra.close, closed: false }
        : a.hours.find((h) => h.day === row.dayOfWeek);
    if (!wanted) continue;
    const open = timeToString(row.openTime);
    const close = timeToString(row.closeTime);
    if (open !== wanted.openTime || close !== wanted.closeTime || row.closed !== wanted.closed) {
      out.push(`horario día ${row.dayOfWeek}: base ${open}–${close}${row.closed ? ' cerrado' : ''} ≠ catálogo ${wanted.openTime}–${wanted.closeTime}${wanted.closed ? ' cerrado' : ''} (no se toca)`);
    }
  }
  return out;
}

// ── resumen ─────────────────────────────────────────────────────────────────
interface Summary {
  id: string;
  dbName: string;
  tier: string;
  status: string;
  products: number;
  created: number;
  updated: number;
  unchanged: number;
  skippedDup: number;
  imagesUploaded: number;
  noImage: number;
  agotados: number;
  logo: string;
  hours: string;
  diffs: number;
  warnings: number;
  failures: string[];
}

async function main(): Promise<void> {
  const catalog = readJson<CatalogBusiness[]>('data/businesses.json');
  const requested = args.all ? catalog.map((b) => b.id) : (args.business ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = requested.filter((id) => !catalog.some((b) => b.id === id));
  if (unknown.length) throw new Error(`No existe(n) en data/businesses.json: ${unknown.join(', ')}`);
  const selected = catalog.filter((b) => requested.includes(b.id));

  const manualMap: Record<string, string> = args.map ? (JSON.parse(readFileSync(args.map, 'utf8')) as Record<string, string>) : {};

  console.log(`\n##### ${APPLY ? 'APLICAR' : 'SIMULACRO (solo lectura)'} · ${selected.length} negocio(s) #####`);

  const dbBusinesses: DbBusiness[] = await withRetry('leer negocios', () =>
    prisma.business.findMany({
      select: {
        id: true, name: true, phone: true, address: true, active: true, acceptingOrders: true,
        commissionType: true, commissionPercentage: true, deliveryFeeBase: true, logoUrl: true,
        _count: { select: { products: true, businessHours: true } },
      },
      orderBy: { name: 'asc' },
    }),
  );
  console.log(`Negocios en la base: ${dbBusinesses.length}`);

  // 1. Emparejamiento
  const matches = new Map<string, Match>();
  for (const b of selected) {
    const mappedId = manualMap[b.id];
    if (mappedId) {
      const db = dbBusinesses.find((d) => d.id === mappedId);
      if (!db) throw new Error(`--map: el id "${mappedId}" (${b.id}) no existe en la base`);
      matches.set(b.id, { tier: 'EXACTO', dbBusiness: db, candidates: [db], viaMap: true });
    } else {
      matches.set(b.id, findMatch(b.name, dbBusinesses));
    }
  }
  const claimed = new Map<string, string[]>();
  for (const [catalogId, m] of matches) {
    if (m.dbBusiness) claimed.set(m.dbBusiness.id, [...(claimed.get(m.dbBusiness.id) ?? []), catalogId]);
  }

  console.log('\n=== EMPAREJAMIENTO catálogo → base ===');
  for (const b of selected) {
    const m = matches.get(b.id)!;
    const label = m.viaMap ? 'MAP' : m.tier;
    const target = m.dbBusiness ? `"${m.dbBusiness.name}" (${m.dbBusiness.id})` : '—';
    const conflict = m.dbBusiness && (claimed.get(m.dbBusiness.id)?.length ?? 0) > 1 ? '  ⚠ CONFLICTO: lo reclaman varios' : '';
    console.log(`${b.id.padEnd(19)} "${b.name}"  →  [${label}] ${target}${conflict}`);
    if (!m.dbBusiness) {
      const options = m.candidates.length ? m.candidates : nearest(b.name, dbBusinesses);
      console.log(`${' '.repeat(20)}candidatos: ${options.map((c) => `"${c.name}" (${c.id})`).join(' | ') || '—'}`);
    }
  }
  const matchedDbIds = new Set([...matches.values()].flatMap((m) => (m.dbBusiness ? [m.dbBusiness.id] : [])));
  if (args.all) {
    const leftovers = dbBusinesses.filter((d) => !matchedDbIds.has(d.id));
    console.log(`\nNegocios de la base SIN pareja en el catálogo (${leftovers.length}):`);
    for (const d of leftovers) console.log(`  "${d.name}" (${d.id}) activo=${d.active} productos=${d._count.products}`);
  }

  // 2. Análisis por negocio
  const allCategories = await withRetry('leer categorías', () => prisma.category.findMany({ select: { id: true, name: true, slug: true } }));
  const categoryBySlug = new Map(allCategories.map((c) => [c.slug, c]));
  const summaries: Summary[] = [];
  const unmappedTotals = new Map<string, { businesses: number; items: number }>();
  const skippedForDecision: string[] = [];
  const newCategoryNames = new Set<string>();

  for (const b of selected) {
    const m = matches.get(b.id)!;
    const analysis = await analyze(b);
    const db = m.dbBusiness;
    for (const [field, n] of Object.entries(analysis.unmapped)) {
      if (n === 0) continue;
      const current = unmappedTotals.get(field) ?? { businesses: 0, items: 0 };
      unmappedTotals.set(field, { businesses: current.businesses + 1, items: current.items + n });
    }

    const summary: Summary = {
      id: b.id, dbName: db?.name ?? '—', tier: m.viaMap ? 'MAP' : m.tier, status: '', products: analysis.products.length,
      created: 0, updated: 0, unchanged: 0, skippedDup: 0, imagesUploaded: 0,
      noImage: analysis.plan.filter((x) => x.imageIssue).length,
      agotados: analysis.products.filter((p) => p.stockStatus === 'agotado').length,
      logo: analysis.logoFile ? 'ok' : 'SIN ARCHIVO', hours: '', diffs: 0, warnings: analysis.warnings.length, failures: [],
    };
    summaries.push(summary);

    console.log(`\n=== ${b.name} [${b.id}] ===`);
    const categoryNames = [...new Set(analysis.products.map((p) => p.category))];
    const newHere = categoryNames.filter((name) => !categoryBySlug.has(slugify(name)));
    newHere.forEach((name) => newCategoryNames.add(slugify(name)));
    console.log(`Productos: ${analysis.products.length} (agotados ${summary.agotados}, con foto ${analysis.plan.filter((x) => !x.imageIssue).length}, sin imagen ${summary.noImage}) · categorías: ${categoryNames.length} (nuevas: ${newHere.length ? newHere.join(', ') : 'ninguna'})`);
    const imageProblems = analysis.plan.filter((x) => x.imageIssue && x.imageIssue !== 'sin foto');
    for (const x of imageProblems) console.log(`  IMG ${x.p.id} "${x.p.name}": ${x.imageIssue} (${x.p.photo ?? ''})`);
    const boxes = analysis.plan.filter((x) => x.p.formato && x.p.formato > 1);
    if (boxes.length) console.log(`  Precio de caja (price × formato): ${boxes.length} productos, ej. ${boxes[0]!.p.id} ${boxes[0]!.p.price}×${boxes[0]!.p.formato}=${boxes[0]!.price}`);
    if (VERBOSE) {
      for (const x of analysis.plan) {
        console.log(`  ${x.p.id.padEnd(18)} ${x.p.name.slice(0, 34).padEnd(34)} ${String(x.price).padStart(8)} CUP ${x.p.stockStatus.padEnd(10)} ${x.imageIssue ?? 'img'}`);
      }
    }
    for (const w of analysis.warnings) console.log(`  ⚠ ${w}`);

    if (analysis.skipReason) {
      summary.status = 'SALTADO (USD)';
      skippedForDecision.push(`${b.id}: ${analysis.skipReason}`);
      console.log(`  ⛔ ${analysis.skipReason}`);
      continue;
    }
    if (!db) {
      summary.status = `SIN PAREJA (${m.tier})`;
      console.log('  ⛔ sin negocio emparejado en la base: se salta hasta confirmar el emparejamiento.');
      continue;
    }
    if ((claimed.get(db.id)?.length ?? 0) > 1) {
      summary.status = 'CONFLICTO';
      console.log('  ⛔ varios negocios del catálogo reclaman este negocio de la base: se salta.');
      continue;
    }
    if (!m.viaMap && m.tier === 'DUDOSO') {
      summary.status = 'DUDOSO';
      continue;
    }

    // Estado actual en la base (solo lectura)
    const [hoursRows, dbProducts] = await Promise.all([
      withRetry('leer horarios', () => prisma.businessHours.findMany({ where: { businessId: db.id } })),
      withRetry('leer productos', () =>
        prisma.product.findMany({ where: { businessId: db.id }, select: { id: true, externalId: true, name: true, imageUrl: true, available: true, lowStock: true, packaging: true } }),
      ),
    ]);
    const diffs = differences(analysis, db, hoursRows);
    summary.diffs = diffs.length;
    console.log(`Base: "${db.name}" ${db.id} · ${db._count.products} productos, ${db._count.businessHours} días de horario, logo ${db.logoUrl ? 'sí' : 'no'}`);
    for (const d of diffs) console.log(`  ≠ ${d}`);

    const byExternal = new Map(dbProducts.filter((x) => x.externalId).map((x) => [x.externalId as string, x]));
    const foreignNames = new Map(dbProducts.filter((x) => !x.externalId || !analysis.products.some((p) => p.id === x.externalId)).map((x) => [normalizeName(x.name), x]));
    const duplicates = analysis.plan.filter((x) => !byExternal.has(x.p.id) && foreignNames.has(normalizeName(x.p.name)));
    const toCreate = analysis.plan.filter((x) => !byExternal.has(x.p.id) && !foreignNames.has(normalizeName(x.p.name)));
    const packagingToFill = analysis.plan.filter((x) => byExternal.has(x.p.id) && packagingFor(x.p) && !byExternal.get(x.p.id)!.packaging).length;
    console.log(`Plan: crear ${toCreate.length} productos · ya existen por externalId ${byExternal.size} (${UPDATE_EXISTING ? 'se actualizan' : 'no se sobrescriben'}) · empaque por completar en existentes ${packagingToFill} · posibles duplicados manuales ${duplicates.length}`);
    const staleAvailability = analysis.plan.filter((x) => {
      const row = byExternal.get(x.p.id);
      const wanted = availabilityFor(x.p);
      return row && (row.available !== wanted.available || row.lowStock !== wanted.lowStock);
    });
    if (staleAvailability.length) {
      console.log(`  ≠ disponibilidad distinta al catálogo en ${staleAvailability.length} producto(s): ${staleAvailability.map((x) => x.p.id).join(', ')} (no se toca)`);
    }
    for (const x of duplicates) console.log(`  ⚠ ${x.p.id} "${x.p.name}" ya existe en la base sin externalId (${foreignNames.get(normalizeName(x.p.name))!.id}): se omite`);
    const missingDays = analysis.hours.filter((h) => !hoursRows.some((r) => r.dayOfWeek === h.day));
    const hoursSkipped = Boolean(b.scheduleExtra) && !WITH_SCHEDULE_EXTRA;
    summary.hours = hoursSkipped ? 'pendiente (scheduleExtra)' : `${missingDays.length} día(s) por crear`;

    if (!APPLY) {
      summary.status = 'simulado';
      summary.created = toCreate.length;
      summary.skippedDup = duplicates.length;
      continue;
    }

    // ── escritura ──────────────────────────────────────────────────────────
    const businessId = db.id;
    try {
      if (b.status === 'cerrado' && db.acceptingOrders) {
        await withRetry('acceptingOrders', () => businessesService.setAcceptingOrders(businessId, { acceptingOrders: false }));
        console.log('acceptingOrders=false (catálogo: cerrado).');
      }
      if (analysis.logoFile && !db.logoUrl) {
        const logoFile = analysis.logoFile;
        await withRetry('logo', () => businessesService.setBusinessLogo(businessId, readFileSync(logoFile)));
        summary.logo = 'subido';
        console.log('Logo subido.');
      } else if (db.logoUrl) {
        summary.logo = 'ya tenía';
      }

      if (!hoursSkipped) {
        for (const h of missingDays) {
          const input = upsertBusinessHoursSchema.parse({ openTime: h.openTime, closeTime: h.closeTime, closed: h.closed });
          await withRetry(`horario día ${h.day}`, () => hoursService.upsertBusinessHours(businessId, h.day, input));
        }
        console.log(`Horario: ${missingDays.length} día(s) creados, ${7 - missingDays.length} ya existían.`);
      }

      const categoryIdByName = new Map<string, string>();
      for (const name of categoryNames) {
        const slug = slugify(name);
        let category = categoryBySlug.get(slug);
        if (!category) {
          const created = await withRetry('crear categoría', () =>
            categoriesService.createCategory({ name, slug, sortOrder: categoryBySlug.size }),
          );
          category = { id: created.id, name: created.name, slug };
          categoryBySlug.set(slug, category);
          console.log(`Categoría creada: ${name}`);
        }
        categoryIdByName.set(name, category.id);
      }

      for (const { p, file, price, description } of analysis.plan) {
        try {
          const fields = {
            name: p.name,
            description: description?.slice(0, 2000),
            category: p.category,
            categoryId: categoryIdByName.get(p.category),
            price,
            packaging: packagingFor(p),
          };
          const existing = byExternal.get(p.id);
          if (!existing && duplicates.some((x) => x.p.id === p.id)) {
            summary.skippedDup++;
            continue;
          }
          let productId: string;
          let hadImage = Boolean(existing?.imageUrl);
          if (existing) {
            productId = existing.id;
            if (UPDATE_EXISTING) {
              await withRetry('actualizar', () => productsService.updateProduct(businessId, productId, fields));
              await withRetry('disponibilidad', () =>
                productsService.setProductAvailability(businessId, productId, availabilityFor(p)),
              );
              summary.updated++;
            } else if (fields.packaging && !existing.packaging) {
              // Solo completa lo que falta: el empaque se rellena si el producto aún no lo tiene.
              await withRetry('empaque', () =>
                productsService.updateProduct(businessId, productId, { packaging: fields.packaging }),
              );
              summary.updated++;
            } else {
              summary.unchanged++;
            }
          } else {
            // Si un intento previo llegó a la base pero se cortó la respuesta, la fila ya existe:
            // se busca por externalId antes de crear para que el reintento sea idempotente.
            const product = await withRetry('crear', async () => {
              const already = await prisma.product.findFirst({ where: { businessId, externalId: p.id }, select: { id: true } });
              return already ?? productsService.createProduct(businessId, { ...fields, externalId: p.id });
            });
            productId = product.id;
            hadImage = false;
            summary.created++;
            // Un producto nuevo ya nace available=true/lowStock=false: solo se escribe si difiere.
            if (p.stockStatus !== 'disponible') {
              await withRetry('disponibilidad', () =>
                productsService.setProductAvailability(businessId, productId, availabilityFor(p)),
              );
            }
          }
          if (file && !hadImage) {
            await withRetry('imagen', () => productsService.setProductImage(businessId, productId, readFileSync(file)));
            summary.imagesUploaded++;
          }
        } catch (error) {
          summary.failures.push(`${p.id}: ${(error as Error).message.split('\n')[0]}`);
          console.error(`  ✗ ${p.id} ${p.name}: ${(error as Error).message.split('\n')[0]}`);
        }
      }
      summary.status = summary.failures.length ? `PARCIAL (${summary.failures.length} fallos)` : 'OK';
      console.log(`Listo: ${summary.created} creados, ${summary.updated} actualizados, ${summary.unchanged} sin tocar, ${summary.imagesUploaded} imágenes subidas, ${summary.skippedDup} omitidos por duplicado.`);
    } catch (error) {
      summary.status = 'ERROR';
      summary.failures.push((error as Error).message.split('\n')[0] ?? 'error');
      console.error(`  ✗ ERROR en ${b.id}: ${(error as Error).message.split('\n')[0]}`);
    }
  }

  // 3. Resumen final
  console.log('\n\n=== RESUMEN POR NEGOCIO ===');
  console.table(
    summaries.map((s) => ({
      catalogo: s.id, base: s.dbName.slice(0, 28), match: s.tier, estado: s.status, prod: s.products,
      crear: s.created, actual: s.updated, sinTocar: s.unchanged, dup: s.skippedDup, imgSubidas: s.imagesUploaded,
      sinImg: s.noImage, agot: s.agotados, logo: s.logo, horario: s.hours, dif: s.diffs, avisos: s.warnings,
    })),
  );
  const sum = (key: 'products' | 'created' | 'noImage' | 'agotados'): number => summaries.reduce((t, s) => t + s[key], 0);
  console.log(`Totales: ${sum('products')} productos · a crear/creados ${sum('created')} · sin imagen ${sum('noImage')} · agotados ${sum('agotados')}`);
  if (newCategoryNames.size) console.log(`Categorías nuevas que se crearían (${newCategoryNames.size}): ${[...newCategoryNames].join(', ')}`);

  console.log('\nCampos del catálogo SIN destino en el backend (negocios que lo usan / elementos):');
  for (const [field, t] of unmappedTotals) console.log(`  ${field.padEnd(28)} ${t.businesses} negocios · ${t.items}`);
  if (skippedForDecision.length) {
    console.log('\nSaltados por decisión pendiente:');
    skippedForDecision.forEach((s) => console.log(`  ${s}`));
  }
  const failed = summaries.filter((s) => s.failures.length);
  if (failed.length) {
    console.log('\nFALLOS (reejecuta: es idempotente):');
    for (const s of failed) s.failures.forEach((f) => console.log(`  ${s.id} → ${f}`));
  }
  if (!APPLY) console.log('\nSimulacro terminado. No se escribió nada en la base ni en Cloudinary. Añade --apply para escribir.');
  await prisma.$disconnect();
  if (failed.length) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
