import { describe, expect, it, vi } from 'vitest';
import { sendExpoPush } from './expo-push';

const callOf = (fn: ReturnType<typeof vi.fn>, index: number) =>
  fn.mock.calls[index] as unknown as [string, { body: string }];

const okResponse = (tickets: unknown[]) => ({ ok: true, json: async () => ({ data: tickets }) });

describe('sendExpoPush', () => {
  it('envía título, texto y data a cada token, con el formato de Expo', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse([{ status: 'ok' }, { status: 'ok' }]));

    await sendExpoPush(
      ['ExponentPushToken[a]', 'ExponentPushToken[b]'],
      {
        title: 'Puntos',
        body: 'Recibiste 5 puntos',
        data: { orderId: 'o1' },
      },
      fetchFn,
    );

    const [url, init] = callOf(fetchFn, 0);
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect(JSON.parse(init.body)).toEqual([
      {
        to: 'ExponentPushToken[a]',
        title: 'Puntos',
        body: 'Recibiste 5 puntos',
        data: { orderId: 'o1' },
        sound: 'default',
        channelId: 'default',
      },
      {
        to: 'ExponentPushToken[b]',
        title: 'Puntos',
        body: 'Recibiste 5 puntos',
        data: { orderId: 'o1' },
        sound: 'default',
        channelId: 'default',
      },
    ]);
  });

  it('devuelve solo los tokens que Expo marcó como DeviceNotRegistered', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        okResponse([
          { status: 'ok' },
          { status: 'error', details: { error: 'DeviceNotRegistered' } },
          { status: 'error', details: { error: 'MessageRateExceeded' } },
        ]),
      );

    const invalid = await sendExpoPush(['t1', 't2', 't3'], { title: 'x', body: 'y' }, fetchFn);

    expect(invalid).toEqual(['t2']);
  });

  it('parte los envíos en lotes de 100', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse([]));
    const tokens = Array.from({ length: 230 }, (_, i) => `t${i}`);

    await sendExpoPush(tokens, { title: 'x', body: 'y' }, fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(JSON.parse(callOf(fetchFn, 2)[1].body)).toHaveLength(30);
  });

  it('si Expo responde con error HTTP, lanza (el llamador de alto nivel lo captura)', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(sendExpoPush(['t1'], { title: 'x', body: 'y' }, fetchFn)).rejects.toThrow();
  });
});
