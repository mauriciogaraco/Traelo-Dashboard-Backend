import { getSystemConfig } from '../../config/system-config.service';
import { BadRequestError, NotFoundError } from '../../shared/errors';
import * as productsRepository from '../businesses/products.repository';
import * as productOffersRepository from '../businesses/product-offers.repository';
import { resolveEffectivePrice } from '../businesses/effective-price';
import * as repository from './rewards.repository';
import type { RewardWithProduct } from './rewards.repository';
import {
  planRedemption,
  rewardListStatus,
  RedemptionError,
  type CartLineFacts,
  type RedemptionPlan,
  type RewardListStatus,
} from './rewards.rules';

export interface RedemptionRequest {
  rewardId: string;
  /** Solo para detectar que la app tenía un saldo viejo; nunca se usa para calcular. */
  expectedBalance?: number;
}

export interface RewardDTO {
  id: string;
  name: string;
  description: string | null;
  pointsCost: number;
  imageUrl: string | null;
  productId: string;
  productName: string;
  businessId: string;
  businessName: string;
  /** Precio vigente del producto (con oferta si la hay): es lo que se ahorra el cliente. */
  moneyValue: number | null;
  /** AVAILABLE | INSUFFICIENT_POINTS | LOGIN_REQUIRED: lo decide el servidor, la app solo lo muestra. */
  status: RewardListStatus;
  missingPoints: number;
}

export interface RewardsListDTO {
  /** null = invitado (sin cuenta no hay puntos). */
  balance: number | null;
  rewards: RewardDTO[];
}

async function currentPrice(product: RewardWithProduct['product'], now: Date): Promise<number | null> {
  const offer = await productOffersRepository.findActiveForProduct(product.id, now);
  return resolveEffectivePrice(product.price, offer)?.price ?? null;
}

async function toRewardDTO(reward: RewardWithProduct, balance: number | null, now: Date): Promise<RewardDTO> {
  const { status, missingPoints } = rewardListStatus(reward.pointsCost, balance);
  return {
    id: reward.id,
    name: reward.name,
    description: reward.description,
    pointsCost: reward.pointsCost,
    imageUrl: reward.imageUrl ?? reward.product.imageUrl,
    productId: reward.product.id,
    productName: reward.product.name,
    businessId: reward.product.business.id,
    businessName: reward.product.business.name,
    moneyValue: await currentPrice(reward.product, now),
    status,
    missingPoints,
  };
}

/** Recompensas visibles para la app (activas y con su producto disponible), con el estado según el saldo. */
export async function listRewards(customerId: string | undefined, now: Date = new Date()): Promise<RewardsListDTO> {
  const [rewards, balance] = await Promise.all([
    repository.listActiveRewards(),
    customerId ? repository.findCustomerBalance(customerId) : Promise.resolve(null),
  ]);
  return {
    balance,
    rewards: await Promise.all(rewards.map((reward) => toRewardDTO(reward, balance, now))),
  };
}

/**
 * Valida el canje contra el estado REAL (recompensa, producto, saldo) y devuelve el plan. No
 * escribe nada: lo usan tanto la cotización como la creación del pedido (que además vuelve a
 * comprobar el saldo de forma atómica al descontar).
 */
export async function resolveRedemptionPlan(params: {
  customerId: string | undefined;
  request: RedemptionRequest;
  lines: CartLineFacts[];
}): Promise<RedemptionPlan> {
  if (!params.customerId) {
    throw new RedemptionError(
      'REDEMPTION_REQUIRES_LOGIN',
      'Inicia sesión para usar tus puntos',
    );
  }
  const reward = await repository.findRewardById(params.request.rewardId);
  if (!reward) {
    throw new RedemptionError('REWARD_NOT_FOUND', 'Recompensa no encontrada');
  }
  const balance = await repository.findCustomerBalance(params.customerId);
  if (balance === null) {
    throw new NotFoundError('Cliente no encontrado');
  }
  return planRedemption({
    reward: {
      id: reward.id,
      name: reward.name,
      pointsCost: reward.pointsCost,
      active: reward.active,
      productId: reward.productId,
      productAvailable:
        reward.product.active && reward.product.available && reward.product.business.active,
    },
    lines: params.lines,
    balance,
    expectedBalance: params.request.expectedBalance,
  });
}

export async function getPointsDivisor(): Promise<number> {
  return (await getSystemConfig()).pointsServiceDivisor;
}

// ── Administración (staff OWNER/ADMIN) ─────────────────────────────────────────

export async function adminListRewards(): Promise<RewardDTO[]> {
  const now = new Date();
  const rewards = await repository.listAllRewards();
  return Promise.all(
    rewards.map(async (reward) => ({
      ...(await toRewardDTO(reward, null, now)),
      active: reward.active,
    })),
  );
}

async function assertProductExists(productId: string): Promise<void> {
  const product = await productsRepository.findById(productId);
  if (!product) {
    throw new BadRequestError('Producto no encontrado', 'PRODUCT_NOT_FOUND');
  }
}

export async function createReward(input: {
  name: string;
  description?: string | null;
  pointsCost: number;
  productId: string;
  imageUrl?: string | null;
  active?: boolean;
}) {
  await assertProductExists(input.productId);
  const reward = await repository.createReward({
    name: input.name,
    description: input.description ?? null,
    pointsCost: input.pointsCost,
    productId: input.productId,
    imageUrl: input.imageUrl ?? null,
    active: input.active ?? true,
  });
  return { ...(await toRewardDTO(reward, null, new Date())), active: reward.active };
}

export async function updateReward(
  id: string,
  input: {
    name?: string;
    description?: string | null;
    pointsCost?: number;
    productId?: string;
    imageUrl?: string | null;
    active?: boolean;
  },
) {
  if (!(await repository.findRewardById(id))) {
    throw new NotFoundError('Recompensa no encontrada', 'REWARD_NOT_FOUND');
  }
  if (input.productId) {
    await assertProductExists(input.productId);
  }
  // Cambiar pointsCost NO altera los canjes ya hechos: cada RewardRedemption guarda su snapshot.
  const reward = await repository.updateReward(id, input);
  return { ...(await toRewardDTO(reward, null, new Date())), active: reward.active };
}
