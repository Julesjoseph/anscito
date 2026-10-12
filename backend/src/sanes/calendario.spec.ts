import {
  calendario,
  cuotaDe,
  diasEntre,
  fechaValida,
  manoDe,
  moraDe,
  porcentaje,
} from './calendario';

describe('calendario de turnos', () => {
  it('semanal: cada 7 días', () => {
    expect(calendario('2026-10-12', 'semanal', 4)).toEqual([
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
      '2026-11-02',
    ]);
  });

  it('quincenal: días 15 y 30, febrero al último día', () => {
    expect(calendario('2026-01-15', 'quincenal', 6)).toEqual([
      '2026-01-15',
      '2026-01-30',
      '2026-02-15',
      '2026-02-28',
      '2026-03-15',
      '2026-03-30',
    ]);
    // Año bisiesto.
    expect(calendario('2028-02-10', 'quincenal', 3)).toEqual([
      '2028-02-15',
      '2028-02-29',
      '2028-03-15',
    ]);
  });

  it('quincenal: empieza en el primer 15 o 30 desde el inicio', () => {
    expect(calendario('2026-10-20', 'quincenal', 3)).toEqual([
      '2026-10-30',
      '2026-11-15',
      '2026-11-30',
    ]);
    expect(calendario('2026-10-31', 'quincenal', 2)).toEqual([
      '2026-11-15',
      '2026-11-30',
    ]);
    expect(calendario('2026-12-20', 'quincenal', 3)).toEqual([
      '2026-12-30',
      '2027-01-15',
      '2027-01-30',
    ]);
  });

  it('mensual: mismo día, o el último del mes si es más corto', () => {
    expect(calendario('2026-01-31', 'mensual', 4)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
    expect(calendario('2026-11-15', 'mensual', 3)).toEqual([
      '2026-11-15',
      '2026-12-15',
      '2027-01-15',
    ]);
  });
});

describe('dinero del SAN', () => {
  it('mano, medio número y comisión', () => {
    expect(manoDe('1000.00', 20, 'completo')).toBe('20000.00');
    expect(manoDe('1000.00', 20, 'medio')).toBe('10000.00');
    expect(cuotaDe('1000.00', 'medio')).toBe('500.00');
    expect(porcentaje('20000.00', '5.00')).toBe('1000.00');
    expect(porcentaje('333.33', '5.00')).toBe('16.67'); // 16.6665 -> 16.67
  });

  it('mora solo después de los días de gracia', () => {
    expect(moraDe('1000.00', '2026-10-15', '2026-10-18', 3, '10.00')).toEqual({
      dias: 3,
      mora: '0.00',
    });
    expect(moraDe('1000.00', '2026-10-15', '2026-10-19', 3, '10.00')).toEqual({
      dias: 4,
      mora: '100.00',
    });
    // Pagado por adelantado: sin atraso.
    expect(moraDe('500.00', '2026-11-15', '2026-10-12', 3, '10.00')).toEqual({
      dias: 0,
      mora: '0.00',
    });
  });

  it('fechas', () => {
    expect(diasEntre('2026-02-27', '2026-03-02')).toBe(3);
    expect(fechaValida('2026-02-29')).toBe(false);
    expect(fechaValida('2028-02-29')).toBe(true);
  });
});
