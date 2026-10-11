// Piezas de SQL compartidas por Caja, Ventas y el Panel.

// Signo de cada movimiento de caja "m": ventas e ingresos suman; gastos,
// retiros y devoluciones restan.
export const SQL_SIGNO_CAJA = `CASE WHEN m.tipo IN ('venta', 'ingreso') THEN 1 ELSE -1 END`;

// Lo que debería haber en la sesión $1: fondo inicial ± movimientos.
export const SQL_ESPERADO = `SELECT (s.fondo_inicial + COALESCE(
    (SELECT sum(m.monto * ${SQL_SIGNO_CAJA}) FROM caja_movimientos m
      WHERE m.sesion_id = s.id), 0))::numeric(14,2) AS esperado
  FROM caja_sesiones s WHERE s.id = $1`;

// Totales por tipo de la sesión $1.
export const SQL_TOTALES_SESION = `SELECT
    COALESCE(sum(monto) FILTER (WHERE tipo = 'venta'), 0)::numeric(14,2) AS ventas,
    COALESCE(sum(monto) FILTER (WHERE tipo = 'ingreso'), 0)::numeric(14,2) AS ingresos,
    COALESCE(sum(monto) FILTER (WHERE tipo = 'gasto'), 0)::numeric(14,2) AS gastos,
    COALESCE(sum(monto) FILTER (WHERE tipo = 'retiro'), 0)::numeric(14,2) AS retiros,
    COALESCE(sum(monto) FILTER (WHERE tipo = 'devolucion'), 0)::numeric(14,2) AS devoluciones,
    count(*) FILTER (WHERE tipo = 'venta')::int AS cantidad_ventas
  FROM caja_movimientos WHERE sesion_id = $1`;

export function numeroSesion(n: number | string): string {
  return `S-${String(n).padStart(6, '0')}`;
}
