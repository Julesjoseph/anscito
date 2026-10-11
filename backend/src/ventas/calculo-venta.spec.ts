import {
  bruto,
  calcularLinea,
  descuentoPermitido,
  mayorOIgual,
  restar,
  sumar,
} from './calculo-venta';

describe('bruto', () => {
  it('precio × cantidad redondeado al centavo', () => {
    expect(bruto('50.00', '3.000')).toBe('150.00');
    expect(bruto('450.00', '2.500')).toBe('1125.00');
    expect(bruto('33.33', '0.333')).toBe('11.10'); // 11.09889 -> 11.10
    expect(bruto('0.05', '0.100')).toBe('0.01'); // 0.005 -> 0.01
  });
});

describe('descuentoPermitido (máximo 10%)', () => {
  it('acepta hasta el 10% exacto y rechaza más', () => {
    expect(descuentoPermitido('150.00', '15.00', '10.00')).toBe(true);
    expect(descuentoPermitido('150.00', '15.01', '10.00')).toBe(false);
    expect(descuentoPermitido('150.00', '0.00', '10.00')).toBe(true);
    expect(descuentoPermitido('99.99', '10.00', '10.00')).toBe(false);
  });
});

describe('calcularLinea', () => {
  it('agua: 3 a RD$50 sin ITBIS incluido, 18%', () => {
    expect(calcularLinea('50.00', '3.000', '0.00', '18.00', false)).toEqual({
      bruto: '150.00',
      descuento: '0.00',
      base: '150.00',
      itbis: '27.00',
      total: '177.00',
    });
  });

  it('el ITBIS se calcula después del descuento', () => {
    expect(calcularLinea('50.00', '3.000', '15.00', '18.00', false)).toEqual({
      bruto: '150.00',
      descuento: '15.00',
      base: '135.00',
      itbis: '24.30',
      total: '159.30',
    });
  });

  it('precio con ITBIS incluido', () => {
    expect(calcularLinea('59.00', '2.000', '0.00', '18.00', true)).toEqual({
      bruto: '118.00',
      descuento: '0.00',
      base: '100.00',
      itbis: '18.00',
      total: '118.00',
    });
  });

  it('servicio exento', () => {
    expect(calcularLinea('5.00', '10.000', '0.00', '0.00', false).total).toBe(
      '50.00',
    );
  });

  it('no permite descuento mayor que la línea', () => {
    expect(() =>
      calcularLinea('10.00', '1.000', '10.01', '18.00', false),
    ).toThrow();
  });
});

describe('sumar / restar / mayorOIgual', () => {
  it('opera sin decimales flotantes', () => {
    expect(sumar(['0.10', '0.20', '0.30'])).toBe('0.60');
    expect(restar('200.00', '177.00')).toBe('23.00');
    expect(mayorOIgual('177.00', '177.00')).toBe(true);
    expect(mayorOIgual('176.99', '177.00')).toBe(false);
  });
});
