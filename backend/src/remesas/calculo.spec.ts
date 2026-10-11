import { calcularEnvio, esEntero, numeroEnvio, telefonoHaiti } from './calculo';

const tarifa = {
  tasa: '2.050000',
  comision_pct: '10.00',
  comision_agente_pct: '50.00',
};

describe('calcularEnvio (pesos y gourdes enteros)', () => {
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

  it('redondea al entero, la mitad hacia arriba', () => {
    // 875 x 10% = 87.5 -> 88; la mitad 44. 1838 x 2.05 = 3767.9 -> 3768.
    const r = calcularEnvio('875.00', tarifa, false);
    expect(r.comision).toBe('88.00');
    expect(r.comision_agente).toBe('44.00');
    expect(r.total_pagar).toBe('963.00');
    expect(calcularEnvio('1838.00', tarifa, false).monto_recibir).toBe(
      '3768.00',
    );
    // 1464 x 2.05 = 3001.2 -> 3001; 146.4 -> 146; mitad 73.
    const e = calcularEnvio('1464.00', tarifa, false);
    expect([
      e.monto_recibir,
      e.comision,
      e.total_pagar,
      e.comision_agente,
    ]).toEqual(['3001.00', '146.00', '1610.00', '73.00']);
    // Comisión impar: 145 x 50% = 72.5 -> 73 para el agente, 72 para SCITO.
    const i = calcularEnvio('1450.00', tarifa, false);
    expect([i.comision, i.comision_agente, i.comision_scito]).toEqual([
      '145.00',
      '73.00',
      '72.00',
    ]);
  });

  it('esEntero', () => {
    expect(esEntero('1000.00')).toBe(true);
    expect(esEntero('1000.50')).toBe(false);
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
