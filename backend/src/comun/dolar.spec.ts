import {
  aDolaresArriba,
  aPesos,
  cobroEnDolares,
  normalizarTasa,
} from './dolar';

describe('dólares', () => {
  it('normaliza la tasa a 4 decimales y rechaza la inválida', () => {
    expect(normalizarTasa('60.5')).toBe('60.5000');
    expect(normalizarTasa(' 58 ')).toBe('58.0000');
    expect(normalizarTasa('0')).toBeNull();
    expect(normalizarTasa('60.12345')).toBeNull();
    expect(normalizarTasa('abc')).toBeNull();
  });

  it('convierte US$ a RD$ al centavo', () => {
    expect(aPesos('20.00', '60.5000')).toBe('1210.00');
    expect(aPesos('5.20', '60.5000')).toBe('314.60');
    expect(aPesos('0.01', '60.1234')).toBe('0.60'); // 0.601234
    expect(aPesos('0.01', '60.5000')).toBe('0.61'); // 0.605 sube
  });

  it('cobra en US$ subiendo al centavo (a favor del negocio)', () => {
    expect(aDolaresArriba('1210.00', '60.5000')).toBe('20.00'); // exacto
    expect(aDolaresArriba('1500.00', '60.5000')).toBe('24.80'); // 24.7933…
    expect(aDolaresArriba('0.01', '60.5000')).toBe('0.01');
  });

  it('devuelta en US$ o en RD$', () => {
    expect(cobroEnDolares('1500.00', '60.5000', '30.00', 'USD')).toEqual({
      montoUsd: '24.80',
      recibidoUsd: '30.00',
      devueltaMoneda: 'USD',
      devueltaMonto: '5.20',
      entraUsd: '24.80',
      saleDop: '0.00',
    });
    expect(cobroEnDolares('1500.00', '60.5000', '30.00', 'DOP')).toEqual({
      montoUsd: '24.80',
      recibidoUsd: '30.00',
      devueltaMoneda: 'DOP',
      devueltaMonto: '314.60',
      entraUsd: '30.00',
      saleDop: '314.60',
    });
  });

  it('no alcanza lo que entregó', () => {
    expect(cobroEnDolares('1500.00', '60.5000', '24.79', 'USD')).toBeNull();
  });
});
