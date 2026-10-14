// Piezas de SQL compartidas por Caja, Ventas y el Panel.

// Signo de cada movimiento de caja "m": ventas, ingresos, efectivo traído
// de una cuenta, cuotas de SOL CASH y compras anuladas (el dinero vuelve)
// suman; gastos, retiros, devoluciones, depósitos, manos de SOL CASH y pagos
// de compras restan. La devuelta en pesos de un pago en dólares ("cambio")
// resta; si esa venta se anula, esos pesos vuelven ("cambio_reverso", suma).
// Los dólares van aparte (caja_movimientos_usd, ver comun/dolar.ts).
export const SQL_SIGNO_CAJA = `CASE WHEN m.tipo IN ('venta', 'ingreso', 'desde_cuenta', 'san_cuota', 'compra_reverso', 'abono_credito', 'cambio_reverso') THEN 1 ELSE -1 END`;

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
    COALESCE(sum(monto) FILTER (WHERE tipo = 'deposito'), 0)::numeric(14,2) AS depositos,
    COALESCE(sum(monto) FILTER (WHERE tipo = 'desde_cuenta'), 0)::numeric(14,2) AS desde_cuentas,
    COALESCE(sum(monto) FILTER (WHERE tipo = 'san_cuota'), 0)::numeric(14,2) AS san_cuotas,
    COALESCE(sum(monto) FILTER (WHERE tipo = 'san_mano'), 0)::numeric(14,2) AS san_manos,
    COALESCE(sum(monto) FILTER (WHERE tipo = 'compra'), 0)::numeric(14,2) AS compras,
    COALESCE(sum(monto) FILTER (WHERE tipo = 'compra_reverso'), 0)::numeric(14,2) AS compras_devueltas,
    COALESCE(sum(monto) FILTER (WHERE tipo = 'abono_credito'), 0)::numeric(14,2) AS abonos_credito,
    COALESCE(sum(monto) FILTER (WHERE tipo = 'abono_anulado'), 0)::numeric(14,2) AS abonos_anulados,
    COALESCE(sum(monto) FILTER (WHERE tipo = 'cambio'), 0)::numeric(14,2) AS cambios,
    COALESCE(sum(monto) FILTER (WHERE tipo = 'cambio_reverso'), 0)::numeric(14,2) AS cambios_devueltos,
    count(*) FILTER (WHERE tipo = 'venta')::int AS cantidad_ventas
  FROM caja_movimientos WHERE sesion_id = $1`;

export function numeroSesion(n: number | string): string {
  return `S-${String(n).padStart(6, '0')}`;
}
