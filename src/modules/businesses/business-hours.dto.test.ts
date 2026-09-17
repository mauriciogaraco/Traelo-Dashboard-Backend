import { describe, expect, it } from 'vitest';
import { upsertBusinessHoursSchema } from './business-hours.dto';

describe('upsertBusinessHoursSchema', () => {
  it('acepta un horario válido', () => {
    const result = upsertBusinessHoursSchema.safeParse({ openTime: '09:00', closeTime: '22:00' });
    expect(result.success).toBe(true);
  });

  it('rechaza cuando openTime no es anterior a closeTime', () => {
    const result = upsertBusinessHoursSchema.safeParse({ openTime: '22:00', closeTime: '09:00' });
    expect(result.success).toBe(false);
  });

  it('rechaza cuando openTime es igual a closeTime', () => {
    const result = upsertBusinessHoursSchema.safeParse({ openTime: '09:00', closeTime: '09:00' });
    expect(result.success).toBe(false);
  });

  it('rechaza formatos de hora inválidos', () => {
    for (const openTime of ['9:00', '25:00', '09:60', '09-00', '']) {
      const result = upsertBusinessHoursSchema.safeParse({ openTime, closeTime: '22:00' });
      expect(result.success).toBe(false);
    }
  });

  it('closed=true sigue exigiendo openTime/closeTime (es un override, no reemplaza el horario)', () => {
    const missingTimes = upsertBusinessHoursSchema.safeParse({ closed: true });
    expect(missingTimes.success).toBe(false);

    const withTimes = upsertBusinessHoursSchema.safeParse({
      openTime: '09:00',
      closeTime: '22:00',
      closed: true,
    });
    expect(withTimes.success).toBe(true);
  });

  it('default de closed es false', () => {
    const result = upsertBusinessHoursSchema.parse({ openTime: '09:00', closeTime: '22:00' });
    expect(result.closed).toBe(false);
  });
});
