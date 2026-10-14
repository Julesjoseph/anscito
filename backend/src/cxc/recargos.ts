import { centavos, porcentaje, texto2 } from '../sanes/calendario';

// Recargo por atraso de una cuenta por cobrar. Se calcula desde el historial
// (no se guarda): en cada mes completo después del vencimiento se cobra el %
// vigente ese día sobre el capital que todavía se debía ese día. Nunca sobre
// recargos anteriores (sin interés sobre interés).

export type Tasa = { desde: string; pct: string }; // vigente desde AAAA-MM-DD
export type PagoCapital = { fecha: string; capital: string };

export type Recargo = {
  mes: number;
  fecha: string;
  base: string; // capital pendiente ese día
  pct: string;
  monto: string;
};

function partes(f: string): [number, number, number] {
  const [a, m, d] = f.split('-').map(Number);
  return [a, m, d];
}

function ultimoDia(a: number, m: number): number {
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

// "2026-01-31" + 1 mes = "2026-02-28" (si el mes es más corto, su último día).
export function sumarMeses(fecha: string, n: number): string {
  const [a, m, d] = partes(fecha);
  const total = m - 1 + n;
  const aa = a + Math.floor(total / 12);
  const mm = (total % 12) + 1;
  const dd = Math.min(d, ultimoDia(aa, mm));
  return `${aa}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

// Días entre dos fechas (b − a).
export function diasEntre(a: string, b: string): number {
  const [a1, m1, d1] = partes(a);
  const [a2, m2, d2] = partes(b);
  return Math.round(
    (Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000,
  );
}

// El % vigente en una fecha: la última tasa cuyo "desde" es igual o anterior.
export function tasaEn(tasas: Tasa[], fecha: string): string {
  let pct = '0.00';
  let desde = '';
  for (const t of tasas) {
    if (t.desde <= fecha && t.desde >= desde) {
      pct = t.pct;
      desde = t.desde;
    }
  }
  return pct;
}

export function recargosDe(
  cuenta: { monto: string; vencimiento: string },
  pagos: PagoCapital[],
  tasas: Tasa[],
  hoy: string,
): Recargo[] {
  const res: Recargo[] = [];
  const monto = centavos(cuenta.monto);
  for (let n = 1; n <= 600; n++) {
    const fecha = sumarMeses(cuenta.vencimiento, n);
    if (fecha > hoy) break;
    const pagado = pagos
      .filter((p) => p.fecha <= fecha)
      .reduce((a, p) => a + centavos(p.capital), 0n);
    const base = monto - pagado;
    // Ya estaba saldada ese día: no hay más recargos.
    if (base <= 0n) break;
    const pct = tasaEn(tasas, fecha);
    res.push({
      mes: n,
      fecha,
      base: texto2(base),
      pct,
      monto: porcentaje(texto2(base), pct),
    });
  }
  return res;
}
