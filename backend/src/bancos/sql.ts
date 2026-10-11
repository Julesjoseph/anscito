// Piezas de SQL compartidas por Bancos, Ventas, Caja y el Panel.

// Movimientos con su estado: "confirmado" (no necesitaba confirmación o ya se
// vio en el estado de cuenta), "por_confirmar" o "no_llego".
export const SQL_MOVS_CON_ESTADO = `(
  SELECT m.*, cf.resultado, cf.fecha_banco, cf.motivo AS motivo_confirmacion,
         cf.usuario_id AS confirmado_por, cf.created_at AS confirmado_en,
         CASE WHEN NOT m.por_confirmar THEN 'confirmado'
              ELSE COALESCE(cf.resultado, 'por_confirmar') END AS estado
  FROM cuenta_movimientos m
  LEFT JOIN cuenta_confirmaciones cf ON cf.movimiento_id = m.id
)`;

// Saldos por cuenta. Lo que "no llegó" no cuenta en ningún saldo.
// disponible = confirmado + por confirmar (lo que se espera tener).
export const SQL_SALDOS = `SELECT x.cuenta_id,
    COALESCE(sum(x.signo * x.monto) FILTER (WHERE x.estado = 'confirmado'), 0)::numeric(14,2) AS confirmado,
    COALESCE(sum(x.signo * x.monto) FILTER (WHERE x.estado = 'por_confirmar'), 0)::numeric(14,2) AS por_confirmar,
    COALESCE(sum(x.signo * x.monto) FILTER (WHERE x.estado <> 'no_llego'), 0)::numeric(14,2) AS disponible,
    COALESCE(sum(x.signo * x.monto_dop) FILTER (WHERE x.estado <> 'no_llego'), 0)::numeric(14,2) AS disponible_dop,
    count(*) FILTER (WHERE x.estado = 'por_confirmar')::int AS pendientes,
    count(*) FILTER (WHERE x.estado = 'no_llego')::int AS no_llegaron
  FROM ${SQL_MOVS_CON_ESTADO} x
  GROUP BY x.cuenta_id`;

// Lo disponible en la cuenta $1 (para no sacar más de lo que hay).
export const SQL_DISPONIBLE = `SELECT COALESCE(sum(x.signo * x.monto)
    FILTER (WHERE x.estado <> 'no_llego'), 0)::numeric(14,2) AS disponible
  FROM ${SQL_MOVS_CON_ESTADO} x WHERE x.cuenta_id = $1`;

// "No llegó" que todavía hay que atender: la cuenta sigue activa y, si es
// el cobro de una venta, la venta no se ha anulado. Usa los alias x
// (movimiento con estado), ct (cuenta) y v (venta).
export const SQL_NO_LLEGO_PENDIENTE = `x.estado = 'no_llego' AND ct.is_active
  AND (v.id IS NULL OR v.estado <> 'anulada')`;

export function numeroTransferencia(n: number | string): string {
  return `T-${String(n).padStart(6, '0')}`;
}
