import {
  agrupar,
  inicioEjercicio,
  montoSeccion,
  saldo,
  utilidad,
} from './libros';
import type { CuentaSaldo } from './libros';

const cuenta = (
  codigo: string,
  tipo: string,
  naturaleza: string,
  debitos: bigint,
  creditos: bigint,
  grupo = codigo.slice(0, 2),
): CuentaSaldo => ({
  id: codigo,
  codigo,
  nombre: `Cuenta ${codigo}`,
  tipo,
  naturaleza,
  grupo,
  debitos,
  creditos,
});

describe('libros y estados financieros', () => {
  it('inicio del año fiscal', () => {
    expect(inicioEjercicio('2026-10-16', '12-31')).toBe('2026-01-01');
    expect(inicioEjercicio('2026-12-31', '12-31')).toBe('2026-01-01');
    expect(inicioEjercicio('2026-01-01', '12-31')).toBe('2026-01-01');
    expect(inicioEjercicio('2026-10-16', '06-30')).toBe('2026-07-01');
    expect(inicioEjercicio('2026-03-15', '06-30')).toBe('2025-07-01');
    expect(inicioEjercicio('2026-06-30', '06-30')).toBe('2025-07-01');
    expect(inicioEjercicio('2026-04-01', '03-31')).toBe('2026-04-01');
  });

  it('saldo según la naturaleza y monto de la sección', () => {
    expect(
      saldo({ naturaleza: 'deudora', debitos: 1000n, creditos: 300n }),
    ).toBe(700n);
    expect(
      saldo({ naturaleza: 'acreedora', debitos: 300n, creditos: 1000n }),
    ).toBe(700n);
    // Retiros del dueño (capital con saldo deudor) restan en el capital.
    expect(montoSeccion({ tipo: 'capital', debitos: 500n, creditos: 0n })).toBe(
      -500n,
    );
  });

  it('agrupa por grupo de nivel 2 y omite saldos en cero', () => {
    const r = agrupar(
      [
        cuenta(
          '110101',
          'activo',
          'deudora',
          5000n,
          1000n,
          '11 Activo corriente',
        ),
        cuenta('110104', 'activo', 'deudora', 2000n, 0n, '11 Activo corriente'),
        cuenta('120101', 'activo', 'deudora', 0n, 0n, '12 Activo no corriente'),
        cuenta(
          '210101',
          'pasivo',
          'acreedora',
          0n,
          700n,
          '21 Pasivo corriente',
        ),
      ],
      ['activo'],
    );
    expect(r.total).toBe(6000n);
    expect(r.grupos).toHaveLength(1);
    expect(r.grupos[0].cuentas.map((c) => c.codigo)).toEqual([
      '110101',
      '110104',
    ]);
  });

  it('utilidad = ingresos − costos − gastos', () => {
    expect(
      utilidad([
        cuenta('410101', 'ingreso', 'acreedora', 0n, 10000n),
        cuenta('510101', 'costo', 'deudora', 4000n, 0n),
        cuenta('610201', 'gasto', 'deudora', 2500n, 500n),
        cuenta('110101', 'activo', 'deudora', 9999n, 0n),
      ]),
    ).toBe(4000n);
  });
});
