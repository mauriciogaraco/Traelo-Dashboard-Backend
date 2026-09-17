import { describe, expect, it } from 'vitest';
import { timeStringToDate, timeToString } from './time-of-day';

describe('timeStringToDate / timeToString', () => {
  it('hace round-trip sin perder la hora', () => {
    for (const value of ['00:00', '09:05', '13:30', '19:00', '23:59']) {
      expect(timeToString(timeStringToDate(value))).toBe(value);
    }
  });

  it('ancla siempre a 1970-01-01 en UTC, sin importar el TZ del proceso', () => {
    const date = timeStringToDate('14:45');
    expect(date.getUTCFullYear()).toBe(1970);
    expect(date.getUTCMonth()).toBe(0);
    expect(date.getUTCDate()).toBe(1);
    expect(date.getUTCHours()).toBe(14);
    expect(date.getUTCMinutes()).toBe(45);
  });

  it('rellena con cero a la izquierda en timeToString', () => {
    expect(timeToString(new Date(Date.UTC(1970, 0, 1, 5, 3)))).toBe('05:03');
  });
});
