import { describe, expect, it } from 'vitest';
import { isValidPhone, normalizePhone } from './phone';

describe('normalizePhone', () => {
  it('quita espacios, guiones y paréntesis', () => {
    expect(normalizePhone(' 5 555-1234 ')).toBe('55551234');
    expect(normalizePhone('(53) 5 555 1234')).toBe('5355551234');
  });

  it('conserva el "+" inicial y solo ese', () => {
    expect(normalizePhone('+53 5 555 1234')).toBe('+5355551234');
    expect(normalizePhone('53+5')).toBe('535');
  });

  it('dos formas de escribir el mismo número dan la misma cuenta', () => {
    expect(normalizePhone('+53 5555 1234')).toBe(normalizePhone('+5355551234'));
  });
});

describe('isValidPhone', () => {
  it.each(['55551234', '+5355551234', '123456'])('acepta %s', (phone) => {
    expect(isValidPhone(phone)).toBe(true);
  });

  it.each(['', '12345', '1234567890123456', 'abc', '+', '+12'])('rechaza "%s"', (phone) => {
    expect(isValidPhone(phone)).toBe(false);
  });
});
