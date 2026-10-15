import { numeroAsiento, totalesAsiento } from './asientos';

describe('asientos', () => {
  it('numera AS-000001', () => {
    expect(numeroAsiento(1)).toBe('AS-000001');
    expect(numeroAsiento('1234')).toBe('AS-001234');
  });

  it('suma débitos y créditos en centavos', () => {
    const t = totalesAsiento([
      { cuentaId: 'a', debito: '0.10', credito: '0.00' },
      { cuentaId: 'b', debito: '0.20', credito: '0.00' },
      { cuentaId: 'c', debito: '0.00', credito: '0.30' },
    ]);
    expect(t).toEqual({ debito: 30n, credito: 30n }); // 0.1 + 0.2 = 0.3 exacto
  });
});
