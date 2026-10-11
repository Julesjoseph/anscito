import { margenTotal, porcentaje, rentabilidad, restar } from './rentabilidad';

describe('rentabilidad', () => {
  it('calcula ganancia, margen y ganancia sobre costo (ejemplo del agua)', () => {
    expect(rentabilidad('30.00', '50.00')).toEqual({
      ganancia: '20.00',
      margen: '40.0',
      sobreCosto: '66.7',
    });
  });

  it('pérdida: precio menor que el costo', () => {
    expect(rentabilidad('50.00', '40.00')).toEqual({
      ganancia: '-10.00',
      margen: '-25.0',
      sobreCosto: '-20.0',
    });
  });

  it('sin precio o sin costo no inventa porcentajes', () => {
    expect(rentabilidad('0.00', '50.00').sobreCosto).toBeNull();
    expect(rentabilidad('30.00', '0.00').margen).toBeNull();
  });
});

describe('porcentaje', () => {
  it('redondea a 1 decimal, la mitad se aleja del cero', () => {
    expect(porcentaje(1n, 3n)).toBe('33.3');
    expect(porcentaje(2n, 3n)).toBe('66.7');
    expect(porcentaje(1n, 8n)).toBe('12.5');
    expect(porcentaje(-1n, 3n)).toBe('-33.3');
    expect(porcentaje(0n, 5n)).toBe('0.0');
  });
});

describe('restar / margenTotal', () => {
  it('opera con montos positivos y negativos', () => {
    expect(restar('500.00', '300.00')).toBe('200.00');
    expect(restar('300.00', '500.00')).toBe('-200.00');
    expect(restar('-5.00', '-7.50')).toBe('2.50');
    expect(margenTotal('200.00', '500.00')).toBe('40.0');
  });
});
