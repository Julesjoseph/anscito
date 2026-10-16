// Estados financieros a partir de los saldos de las cuentas (funciones
// puras, sin base de datos). Montos en centavos; los saldos se muestran
// según la naturaleza de la cuenta (positivo = saldo normal).

export const CIERRES = ['12-31', '03-31', '06-30', '09-30'] as const;

// Inicio del año fiscal que contiene la fecha (AAAA-MM-DD), con el cierre
// MM-DD: el día siguiente al último cierre anterior a la fecha.
export function inicioEjercicio(fecha: string, cierre: string): string {
  const anio = Number(fecha.slice(0, 4));
  const cierreEsteAnio = `${anio}-${cierre}`;
  const anterior =
    fecha <= cierreEsteAnio ? `${anio - 1}-${cierre}` : cierreEsteAnio;
  const d = new Date(`${anterior}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export type CuentaSaldo = {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  naturaleza: string;
  grupo: string; // "11 Activo corriente" (cuenta de nivel 2 a la que pertenece)
  debitos: bigint;
  creditos: bigint;
};

// Saldo según la naturaleza (deudora: débitos − créditos).
export function saldo(
  c: Pick<CuentaSaldo, 'naturaleza' | 'debitos' | 'creditos'>,
): bigint {
  const d = c.debitos - c.creditos;
  return c.naturaleza === 'deudora' ? d : -d;
}

// Monto de una cuenta para su sección: activos, costos y gastos suman con
// saldo deudor; pasivos, capital e ingresos con saldo acreedor (así una
// cuenta "al revés", como retiros del dueño, resta).
export function montoSeccion(
  c: Pick<CuentaSaldo, 'tipo' | 'debitos' | 'creditos'>,
): bigint {
  const d = c.debitos - c.creditos;
  return ['activo', 'costo', 'gasto'].includes(c.tipo) ? d : -d;
}

export type Grupo = {
  grupo: string;
  cuentas: { codigo: string; nombre: string; monto: bigint }[];
  total: bigint;
};

// Agrupa las cuentas de unas secciones (tipos) por su grupo de nivel 2.
export function agrupar(
  cuentas: CuentaSaldo[],
  tipos: string[],
): { grupos: Grupo[]; total: bigint } {
  const m = new Map<string, Grupo>();
  for (const c of cuentas.filter((x) => tipos.includes(x.tipo))) {
    const monto = montoSeccion(c);
    if (monto === 0n) continue;
    const g = m.get(c.grupo) ?? { grupo: c.grupo, cuentas: [], total: 0n };
    g.cuentas.push({ codigo: c.codigo, nombre: c.nombre, monto });
    g.total += monto;
    m.set(c.grupo, g);
  }
  const grupos = [...m.values()].sort((a, b) =>
    a.grupo.localeCompare(b.grupo, 'es', { numeric: true }),
  );
  for (const g of grupos)
    g.cuentas.sort((a, b) =>
      a.codigo.localeCompare(b.codigo, 'es', { numeric: true }),
    );
  return { grupos, total: grupos.reduce((a, g) => a + g.total, 0n) };
}

// Utilidad (ingresos − costos − gastos) de un conjunto de saldos.
export function utilidad(cuentas: CuentaSaldo[]): bigint {
  return cuentas.reduce(
    (a, c) =>
      c.tipo === 'ingreso'
        ? a + montoSeccion(c)
        : c.tipo === 'costo' || c.tipo === 'gasto'
          ? a - montoSeccion(c)
          : a,
    0n,
  );
}
