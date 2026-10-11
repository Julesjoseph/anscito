import { calcularItbis, normalizarMonto } from './calculo-itbis';

describe('normalizarMonto', () => {
  it('acepta montos válidos y los deja con 2 decimales', () => {
    expect(normalizarMonto('100')).toBe('100.00');
    expect(normalizarMonto('100.5')).toBe('100.50');
    expect(normalizarMonto(' 0.05 ')).toBe('0.05');
    expect(normalizarMonto(25)).toBe('25.00');
    expect(normalizarMonto('0')).toBe('0.00');
    expect(normalizarMonto('999999999999.99')).toBe('999999999999.99');
  });

  it('rechaza negativos, texto, más de 2 decimales y montos enormes', () => {
    expect(normalizarMonto('-1')).toBeNull();
    expect(normalizarMonto(-1)).toBeNull();
    expect(normalizarMonto('abc')).toBeNull();
    expect(normalizarMonto('1.234')).toBeNull();
    expect(normalizarMonto('1,50')).toBeNull();
    expect(normalizarMonto('')).toBeNull();
    expect(normalizarMonto(null)).toBeNull();
    expect(normalizarMonto('1000000000000')).toBeNull();
    expect(normalizarMonto('1e3')).toBeNull();
  });
});

describe('calcularItbis', () => {
  it('suma el ITBIS cuando el precio no lo incluye', () => {
    expect(calcularItbis('100.00', '18.00', false)).toEqual({
      base: '100.00',
      itbis: '18.00',
      total: '118.00',
    });
  });

  it('separa el ITBIS cuando el precio ya lo incluye', () => {
    expect(calcularItbis('118.00', '18.00', true)).toEqual({
      base: '100.00',
      itbis: '18.00',
      total: '118.00',
    });
    // 100 / 1.18 = 84.745… -> 84.75; ITBIS = 100 - 84.75
    expect(calcularItbis('100.00', '18.00', true)).toEqual({
      base: '84.75',
      itbis: '15.25',
      total: '100.00',
    });
  });

  it('redondea la mitad hacia arriba', () => {
    // 0.25 * 18% = 0.045 -> 0.05
    expect(calcularItbis('0.25', '18.00', false).itbis).toBe('0.05');
    // 0.02 * 18% = 0.0036 -> 0.00
    expect(calcularItbis('0.02', '18.00', false).itbis).toBe('0.00');
  });

  it('con tasa 0 (Exento) no agrega nada', () => {
    expect(calcularItbis('250.00', '0.00', false)).toEqual({
      base: '250.00',
      itbis: '0.00',
      total: '250.00',
    });
    expect(calcularItbis('250.00', '0.00', true)).toEqual({
      base: '250.00',
      itbis: '0.00',
      total: '250.00',
    });
  });

  it('precio cero da todo cero', () => {
    expect(calcularItbis('0.00', '18.00', false)).toEqual({
      base: '0.00',
      itbis: '0.00',
      total: '0.00',
    });
  });

  it('montos grandes sin perder centavos', () => {
    expect(calcularItbis('999999999999.99', '18.00', false)).toEqual({
      base: '999999999999.99',
      itbis: '180000000000.00',
      total: '1179999999999.99',
    });
  });

  it('base + ITBIS siempre es igual al total', () => {
    for (const precio of ['0.01', '1.00', '33.33', '99.99', '1234.56']) {
      for (const incluye of [true, false]) {
        const d = calcularItbis(precio, '18.00', incluye);
        const suma = (Number(d.base) * 100 + Number(d.itbis) * 100) / 100;
        expect(suma.toFixed(2)).toBe(d.total);
      }
    }
  });
});
