import { fechaDelMes, numeroPago } from './estado';

describe('fechaDelMes (día de vencimiento de un gasto fijo)', () => {
  it('usa el día pedido si el mes lo tiene', () => {
    expect(fechaDelMes('2026-10-14', 15)).toBe('2026-10-15');
  });

  it('día 31 es el último día en meses más cortos', () => {
    expect(fechaDelMes('2026-04-03', 31)).toBe('2026-04-30');
    expect(fechaDelMes('2027-02-10', 31)).toBe('2027-02-28');
    expect(fechaDelMes('2028-02-10', 31)).toBe('2028-02-29'); // bisiesto
    expect(fechaDelMes('2027-02-10', 30)).toBe('2027-02-28');
  });

  it('pasa al mes siguiente, también de diciembre a enero', () => {
    expect(fechaDelMes('2026-10-14', 5, 1)).toBe('2026-11-05');
    expect(fechaDelMes('2026-12-28', 5, 1)).toBe('2027-01-05');
    expect(fechaDelMes('2026-01-31', 31, 1)).toBe('2026-02-28');
  });
});

describe('numeroPago', () => {
  it('formatea el comprobante PP', () => {
    expect(numeroPago(1)).toBe('PP-000001');
    expect(numeroPago('1234')).toBe('PP-001234');
  });
});
