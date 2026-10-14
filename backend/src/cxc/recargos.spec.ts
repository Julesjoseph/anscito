import { diasEntre, recargosDe, sumarMeses, tasaEn } from './recargos';

const tasas = [{ desde: '2000-01-01', pct: '5.00' }];

describe('recargo por atraso', () => {
  it('suma meses respetando el fin de mes', () => {
    expect(sumarMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(sumarMeses('2026-10-15', 3)).toBe('2027-01-15');
    expect(diasEntre('2026-10-01', '2026-10-31')).toBe(30);
  });

  it('sin un mes completo de atraso no hay recargo', () => {
    expect(
      recargosDe(
        { monto: '1000.00', vencimiento: '2026-09-15' },
        [],
        tasas,
        '2026-10-14',
      ),
    ).toEqual([]);
  });

  it('5% por cada mes completo sobre el capital (sin interés sobre interés)', () => {
    const r = recargosDe(
      { monto: '1000.00', vencimiento: '2026-07-15' },
      [],
      tasas,
      '2026-10-14',
    );
    // 15/08 y 15/09 (el 15/10 todavía no llega): 50 + 50, no 50 + 52.50.
    expect(r.map((x) => [x.fecha, x.base, x.monto])).toEqual([
      ['2026-08-15', '1000.00', '50.00'],
      ['2026-09-15', '1000.00', '50.00'],
    ]);
  });

  it('los abonos al capital bajan la base de los meses siguientes', () => {
    const r = recargosDe(
      { monto: '1000.00', vencimiento: '2026-07-15' },
      [{ fecha: '2026-08-20', capital: '600.00' }],
      tasas,
      '2026-10-15',
    );
    expect(r.map((x) => x.monto)).toEqual(['50.00', '20.00', '20.00']);
  });

  it('si ya se pagó todo el capital, no hay más recargos', () => {
    const r = recargosDe(
      { monto: '1000.00', vencimiento: '2026-07-15' },
      [{ fecha: '2026-08-10', capital: '1000.00' }],
      tasas,
      '2026-12-31',
    );
    expect(r).toEqual([]);
  });

  it('usa el % vigente en la fecha de cada mes', () => {
    const t = [...tasas, { desde: '2026-09-01', pct: '6.00' }];
    expect(tasaEn(t, '2026-08-15')).toBe('5.00');
    const r = recargosDe(
      { monto: '1000.00', vencimiento: '2026-07-15' },
      [],
      t,
      '2026-09-30',
    );
    expect(r.map((x) => `${x.pct}:${x.monto}`)).toEqual([
      '5.00:50.00',
      '6.00:60.00',
    ]);
  });

  it('redondea a centavos (mitad hacia arriba)', () => {
    const r = recargosDe(
      { monto: '333.33', vencimiento: '2026-08-01' },
      [],
      tasas,
      '2026-09-01',
    );
    expect(r[0].monto).toBe('16.67');
  });
});
