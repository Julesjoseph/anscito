import { finDeMes } from './cierre-mes';

describe('cierre de mes', () => {
  it('último día del mes', () => {
    expect(finDeMes(2026, 10)).toBe('2026-10-31');
    expect(finDeMes(2026, 9)).toBe('2026-09-30');
    expect(finDeMes(2026, 2)).toBe('2026-02-28');
    expect(finDeMes(2028, 2)).toBe('2028-02-29');
    expect(finDeMes(2026, 12)).toBe('2026-12-31');
  });
});
