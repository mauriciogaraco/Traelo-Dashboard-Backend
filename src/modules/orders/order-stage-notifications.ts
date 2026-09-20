import type { PushMessage } from '../../shared/push/expo-push';

export type DeliveryStage = 'PICKING_UP' | 'ON_THE_WAY';

/**
 * Texto del push que recibe el cliente cuando el reparto avanza de etapa. `data` permite a la app
 * abrir el pedido al tocar la notificación (type "order" + orderId).
 */
export function buildStageNotification(
  stage: DeliveryStage,
  order: { id: string; orderNumber: number },
): PushMessage {
  const data = { type: 'order', stage, orderId: order.id };
  if (stage === 'PICKING_UP') {
    return {
      title: 'Tu mensajero va por tu pedido',
      body: `Pedido #${order.orderNumber}: ya salió a recogerlo.`,
      data,
    };
  }
  return {
    title: '¡Tu pedido va en camino!',
    body: `Pedido #${order.orderNumber}: tu mensajero ya va hacia ti. Síguelo en el mapa.`,
    data,
  };
}
