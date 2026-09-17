import { describe, expect, it } from 'vitest';
import {
  getBusinessDateOnly,
  getBusinessDayOfWeek,
  getBusinessHour,
  getBusinessTimeOfDay,
} from './index';

describe('getBusinessTimeOfDay / getBusinessHour', () => {
  it('resuelve la hora:minuto de La Habana (UTC-5 en enero, sin horario de verano)', () => {
    const date = new Date('2026-01-15T14:30:00.000Z'); // 09:30 La Habana
    const timeOfDay = getBusinessTimeOfDay(date);
    expect(timeOfDay.getUTCHours()).toBe(9);
    expect(timeOfDay.getUTCMinutes()).toBe(30);
    expect(getBusinessHour(date)).toBe(9);
  });

  it('cruza medianoche correctamente (noche anterior en La Habana)', () => {
    const date = new Date('2026-01-16T02:00:00.000Z'); // 21:00 del 15 en La Habana
    expect(getBusinessHour(date)).toBe(21);
  });
});

describe('getBusinessDateOnly / getBusinessDayOfWeek', () => {
  it('no se corre de día calendario cerca de medianoche UTC', () => {
    // 2026-01-16T02:00:00Z es 2026-01-15 21:00 en La Habana — el día calendario debe seguir
    // siendo el 15, no el 16 (el bug que este helper evita).
    const date = new Date('2026-01-16T02:00:00.000Z');
    const dateOnly = getBusinessDateOnly(date);
    expect(dateOnly.getUTCFullYear()).toBe(2026);
    expect(dateOnly.getUTCMonth()).toBe(0);
    expect(dateOnly.getUTCDate()).toBe(15);
  });

  it('getBusinessDayOfWeek coincide con el día calendario de La Habana', () => {
    // 2026-01-15 es jueves → getDay() = 4.
    const date = new Date('2026-01-15T14:00:00.000Z'); // 09:00 La Habana, mismo día
    expect(getBusinessDayOfWeek(date)).toBe(4);
  });
});
