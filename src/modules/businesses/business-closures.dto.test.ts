import { describe, expect, it } from 'vitest';
import { createClosureSchema } from './business-closures.dto';

describe('createClosureSchema date', () => {
  it('ancla la fecha a mediodía UTC para que no se corra de día calendario', () => {
    const result = createClosureSchema.parse({ date: '2026-12-25' });
    // Si se ancla a medianoche UTC en vez de mediodía, en huso horario negativo (ej. La
    // Habana, UTC-5) esto caería en 2026-12-24 — exactamente el bug que este anclaje evita.
    expect(result.date.getUTCFullYear()).toBe(2026);
    expect(result.date.getUTCMonth()).toBe(11);
    expect(result.date.getUTCDate()).toBe(25);
  });

  it('rechaza fechas mal formadas', () => {
    for (const date of ['25-12-2026', '2026/12/25', '2026-12-25T00:00:00Z', 'no-date']) {
      const result = createClosureSchema.safeParse({ date });
      expect(result.success).toBe(false);
    }
  });

  it('reason es opcional', () => {
    const result = createClosureSchema.safeParse({ date: '2026-01-01' });
    expect(result.success).toBe(true);
  });
});
