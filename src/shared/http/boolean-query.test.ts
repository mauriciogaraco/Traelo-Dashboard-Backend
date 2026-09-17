import { describe, expect, it } from 'vitest';
import { booleanQueryParam } from './boolean-query';

describe('booleanQueryParam', () => {
  it('parsea "true" como true', () => {
    expect(booleanQueryParam.parse('true')).toBe(true);
  });

  it('parsea "false" como false (el bug que evita: Boolean("false") sería true)', () => {
    expect(booleanQueryParam.parse('false')).toBe(false);
  });

  it('rechaza cualquier otro string', () => {
    for (const value of ['1', '0', 'yes', 'no', '', 'True', 'FALSE']) {
      expect(() => booleanQueryParam.parse(value)).toThrow();
    }
  });
});
