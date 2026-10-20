import {
  diasVacaciones,
  montoDias,
  montoExtra,
  regalia,
  sueldoPeriodo,
  valorHora,
} from './calculo';
import type { Parametros } from './calculo';

const P: Parametros = {
  dias_mes: '23.83',
  horas_dia: '8',
  semanas_mes: '4.3333',
  recargo_extra: '35',
  recargo_extra_alto: '100',
  vacaciones_dias: '14',
  vacaciones_dias_5: '18',
};

describe('cálculos de nómina', () => {
  it('sueldo del período según la frecuencia', () => {
    expect(sueldoPeriodo('20000', 'mensual', P)).toBe('20000.00');
    expect(sueldoPeriodo('20000', 'quincenal', P)).toBe('10000.00');
    expect(sueldoPeriodo('20000.01', 'quincenal', P)).toBe('10000.01');
    // 20 000 ÷ 4.3333 = 4615.4201…
    expect(sueldoPeriodo('20000', 'semanal', P)).toBe('4615.42');
  });

  it('valor de la hora: mensual ÷ 23.83 ÷ 8', () => {
    // 20 000 ÷ 23.83 ÷ 8 = 104.9098…
    expect(valorHora('20000', P)).toBe('104.91');
  });

  it('horas extra con 35 % y 100 % de recargo, redondeo al final', () => {
    // 10 h × 104.9098 × 1.35 = 1416.28
    expect(montoExtra('20000', '10', '0', P)).toBe('1416.28');
    // 2 h × 104.9098 × 2 = 419.64
    expect(montoExtra('20000', '0', '2', P)).toBe('419.64');
    expect(montoExtra('20000', '10', '2', P)).toBe('1835.92');
    expect(montoExtra('20000', '0', '0', P)).toBe('0.00');
    expect(montoExtra('20000', '1.5', '0', P)).toBe('212.44');
  });

  it('vacaciones: días según los años y su monto', () => {
    expect(diasVacaciones('2024-03-10', '2026-10-20', P)).toBe('14.00');
    expect(diasVacaciones('2021-10-20', '2026-10-20', P)).toBe('18.00');
    expect(diasVacaciones('2021-10-21', '2026-10-20', P)).toBe('14.00');
    // 20 000 ÷ 23.83 × 14 = 11749.895…
    expect(montoDias('20000', '14', P)).toBe('11749.90');
  });

  it('regalía: un año completo = un sueldo; parte del año = proporcional', () => {
    expect(regalia('20000', '2020-01-15', 2026, '2026-12-31')).toBe('20000.00');
    // Entró el 1 de julio de 2026: 184 de 365 días
    expect(regalia('20000', '2026-07-01', 2026, '2026-12-31')).toBe('10082.19');
    expect(regalia('20000', '2027-01-05', 2026, '2026-12-31')).toBe('0.00');
    // Se calcula al 30 de noviembre (sale antes de diciembre): 334 días
    expect(regalia('20000', '2020-01-15', 2026, '2026-11-30')).toBe('18301.37');
  });
});
