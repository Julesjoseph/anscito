import type { DatabaseService } from '../database/database.service';

// Dólares (migraciones 027 y 028): tasa del día (RD$ por 1 US$), conversión
// de precios y cobro en US$. Todo con enteros (centavos y tasa × 10,000),
// con las mismas reglas que la base de datos:
//   RD$ de un monto en US$ = round(usd × tasa, 2)            (al centavo)
//   US$ que paga el cliente = ceil(rd / tasa, 2)              (hacia arriba)
//   devuelta en US$ = recibido − cobrado; en RD$ = round(devuelta × tasa, 2)

type Consulta = Pick<DatabaseService, 'query'>;

const MONTO = /^\d{1,12}(\.\d{1,2})?$/;
const TASA = /^\d{1,3}(\.\d{1,4})?$/;

export function centavosDe(v: string): bigint {
  if (!MONTO.test(v)) throw new Error(`Monto inválido: ${v}`);
  const [e, d = ''] = v.split('.');
  return BigInt(e) * 100n + BigInt((d + '00').slice(0, 2));
}

export function textoDe(c: bigint): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
}

// Tasa como entero × 10,000 (60.5 → 605000).
export function tasaEntera(tasa: string): bigint {
  if (!TASA.test(tasa)) throw new Error(`Tasa inválida: ${tasa}`);
  const [e, d = ''] = tasa.split('.');
  return BigInt(e) * 10000n + BigInt((d + '0000').slice(0, 4));
}

// Texto normalizado de una tasa escrita por el usuario (null si no sirve).
export function normalizarTasa(v: unknown): string | null {
  const t =
    typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
  if (!TASA.test(t)) return null;
  const n = tasaEntera(t);
  if (n <= 0n) return null;
  return `${n / 10000n}.${String(n % 10000n).padStart(4, '0')}`;
}

// US$ → RD$ al centavo (la mitad sube).
export function aPesos(usd: string, tasa: string): string {
  const p = centavosDe(usd) * tasaEntera(tasa);
  return textoDe((p + 5000n) / 10000n);
}

// RD$ → US$ al centavo más cercano (solo para mostrar los montos de una
// factura cobrada en dólares; lo que se cobra va hacia arriba).
export function aDolares(rd: string, tasa: string): string {
  const t = tasaEntera(tasa);
  return textoDe((centavosDe(rd) * 10000n * 2n + t) / (2n * t));
}

// RD$ → US$ que paga el cliente, subido al centavo (a favor del negocio).
export function aDolaresArriba(rd: string, tasa: string): string {
  const t = tasaEntera(tasa);
  const n = centavosDe(rd) * 10000n;
  return textoDe((n + t - 1n) / t);
}

export type CobroUsd = {
  montoUsd: string; // lo que se cobra en US$
  recibidoUsd: string;
  devueltaMoneda: 'DOP' | 'USD';
  devueltaMonto: string; // en la moneda de la devuelta
  entraUsd: string; // US$ que quedan en la caja (recibido − devuelta en US$)
  saleDop: string; // RD$ que salen de la caja como devuelta
};

// Cobro en dólares de "rd" pesos: cuánto se cobra, la devuelta y lo que mueve la caja.
export function cobroEnDolares(
  rd: string,
  tasa: string,
  recibidoUsd: string,
  devueltaMoneda: 'DOP' | 'USD',
): CobroUsd | null {
  const montoUsd = aDolaresArriba(rd, tasa);
  const resto = centavosDe(recibidoUsd) - centavosDe(montoUsd);
  if (resto < 0n) return null;
  const devuelta = textoDe(resto);
  return {
    montoUsd,
    recibidoUsd,
    devueltaMoneda,
    devueltaMonto: devueltaMoneda === 'USD' ? devuelta : aPesos(devuelta, tasa),
    entraUsd: devueltaMoneda === 'USD' ? montoUsd : recibidoUsd,
    saleDop: devueltaMoneda === 'USD' ? '0.00' : aPesos(devuelta, tasa),
  };
}

// Tasa vigente (la última registrada hasta ahora). FOR SHARE: nadie la
// cambia mientras se usa; se lee una sola vez y se usa en toda la venta.
export async function tasaVigente(
  c: Consulta,
  bloquear = false,
): Promise<{ id: string; tasa: string; vigente_desde: string } | null> {
  const r = await c.query<{ id: string; tasa: string; vigente_desde: string }>(
    `SELECT id, tasa::text AS tasa, vigente_desde FROM tasas_dolar
     WHERE vigente_desde <= clock_timestamp() ORDER BY vigente_desde DESC LIMIT 1
     ${bloquear ? 'FOR SHARE' : ''}`,
  );
  if (r.rowCount === 0) return null;
  const x = r.rows[0];
  return { ...x, tasa: normalizarTasa(x.tasa) ?? x.tasa };
}

// Signo de los movimientos en dólares de la caja: entran ventas e ingresos.
export const SQL_SIGNO_CAJA_USD = `CASE WHEN m.tipo IN ('venta', 'ingreso') THEN 1 ELSE -1 END`;

// Dólares que debería haber en la sesión $1: fondo en US$ ± movimientos.
export const SQL_ESPERADO_USD = `SELECT (s.fondo_inicial_usd + COALESCE(
    (SELECT sum(m.monto * ${SQL_SIGNO_CAJA_USD}) FROM caja_movimientos_usd m
      WHERE m.sesion_id = s.id), 0))::numeric(14,2) AS esperado_usd
  FROM caja_sesiones s WHERE s.id = $1`;

// Totales en dólares por tipo de la sesión $1.
export const SQL_TOTALES_USD = `SELECT
    COALESCE(sum(monto) FILTER (WHERE tipo = 'venta'), 0)::numeric(14,2) AS ventas,
    COALESCE(sum(monto) FILTER (WHERE tipo = 'devolucion'), 0)::numeric(14,2) AS devoluciones,
    COALESCE(sum(monto) FILTER (WHERE tipo = 'ingreso'), 0)::numeric(14,2) AS ingresos,
    COALESCE(sum(monto) FILTER (WHERE tipo = 'retiro'), 0)::numeric(14,2) AS retiros,
    count(*) FILTER (WHERE tipo = 'venta')::int AS cantidad_ventas
  FROM caja_movimientos_usd WHERE sesion_id = $1`;
