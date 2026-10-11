import { calcularEnvio, numeroEnvio, telefonoHaiti } from './calculo';

const tarifa = {
  tasa: '2.050000',
  comision_pct: '10.00',
  comision_agente_pct: '50.00',
};

describe('calcularEnvio', () => {
  it('envío de un agente autorizado (ejemplo del Excel)', () => {
    expect(calcularEnvio('1000.00', tarifa, false)).toEqual({
      monto_enviado: '1000.00',
      tasa: '2.050000',
      monto_recibir: '2050.00',
      comision_pct: '10.00',
      comision: '100.00',
      total_pagar: '1100.00',
      comision_agente_pct: '50.00',
      comision_agente: '50.00',
      comision_scito: '50.00',
    });
  });

  it('el punto propio no reparte comisión', () => {
    const r = calcularEnvio('1000.00', tarifa, true);
    expect(r.comision_agente).toBe('0.00');
    expect(r.comision_agente_pct).toBe('0.00');
    expect(r.comision_scito).toBe('100.00');
  });

  it('redondea la mitad hacia arriba', () => {
    // 875 x 10% = 87.50; la mitad = 43.75. 1838 x 2.05 = 3767.90.
    const r = calcularEnvio('875.00', tarifa, false);
    expect(r.comision).toBe('87.50');
    expect(r.comision_agente).toBe('43.75');
    expect(calcularEnvio('1838.00', tarifa, false).monto_recibir).toBe(
      '3767.90',
    );
    // 0.05 x 10% = 0.005 -> 0.01; su mitad 0.005 -> 0.01.
    const p = calcularEnvio('0.05', tarifa, false);
    expect(p.comision).toBe('0.01');
    expect(p.comision_agente).toBe('0.01');
  });

  it('total = enviado + comisión con montos con centavos', () => {
    const r = calcularEnvio('919.99', tarifa, false);
    expect(r.comision).toBe('92.00');
    expect(r.total_pagar).toBe('1011.99');
    expect(r.monto_recibir).toBe('1885.98');
  });
});

describe('telefonoHaiti', () => {
  it('normaliza formatos y la letra O', () => {
    expect(telefonoHaiti('509-40-05-3815')).toBe('509-40-05-3815');
    expect(telefonoHaiti('5O9-35-54-2499')).toBe('509-35-54-2499');
    expect(telefonoHaiti('3738 2382')).toBe('509-37-38-2382');
    expect(telefonoHaiti('+509 3738-2382')).toBe('509-37-38-2382');
  });
  it('rechaza lo que no es de Haití', () => {
    expect(telefonoHaiti('829-312-8468')).toBeNull();
    expect(telefonoHaiti('123')).toBeNull();
  });
});

describe('numeroEnvio', () => {
  it('E-000001', () => {
    expect(numeroEnvio(1)).toBe('E-000001');
    expect(numeroEnvio('1234')).toBe('E-001234');
  });
});
