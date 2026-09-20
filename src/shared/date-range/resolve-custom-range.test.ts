import { describe, expect, it } from 'vitest';
import { resolveDateRange } from './index';

// El dashboard manda el mediodía UTC del día elegido (YYYY-MM-DDT12:00:00Z). Tiene que resolverse
// al día calendario de La Habana, sin correrse al día anterior ni al siguiente.
describe('resolveDateRange · custom (un día elegido en el calendario)', () => {
  const noon = (day: string) => new Date(`${day}T12:00:00.000Z`);

  it('un solo día en septiembre (horario de verano, UTC-4): del 00:00 al 23:59:59.999 de La Habana', () => {
    const { from, to } = resolveDateRange({ range: 'custom', from: noon('2026-09-20'), to: noon('2026-09-20') });
    expect(from.toISOString()).toBe('2026-09-20T04:00:00.000Z');
    expect(to.toISOString()).toBe('2026-09-21T03:59:59.999Z');
  });

  it('un solo día en enero (UTC-5)', () => {
    const { from, to } = resolveDateRange({ range: 'custom', from: noon('2026-01-15'), to: noon('2026-01-15') });
    expect(from.toISOString()).toBe('2026-01-15T05:00:00.000Z');
    expect(to.toISOString()).toBe('2026-01-16T04:59:59.999Z');
  });

  it('un rango de varios días cubre desde el inicio del primero hasta el final del último', () => {
    const { from, to } = resolveDateRange({ range: 'custom', from: noon('2026-09-18'), to: noon('2026-09-20') });
    expect(from.toISOString()).toBe('2026-09-18T04:00:00.000Z');
    expect(to.toISOString()).toBe('2026-09-21T03:59:59.999Z');
  });

  it('exige from y to, y rechaza un from posterior a to', () => {
    expect(() => resolveDateRange({ range: 'custom', from: noon('2026-09-20') })).toThrow(/requeridos/);
    expect(() =>
      resolveDateRange({ range: 'custom', from: noon('2026-09-21'), to: noon('2026-09-20') }),
    ).toThrow(/posterior/);
  });
});
