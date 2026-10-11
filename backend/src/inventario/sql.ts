// Piezas de SQL compartidas por productos y movimientos de inventario, para
// que la existencia se calcule siempre de la misma forma.

// Tasa vigente hoy del impuesto "i".
export const SQL_TASA_VIGENTE = `(SELECT t.tasa FROM impuesto_tasas t
   WHERE t.impuesto_id = i.id
     AND t.vigente_desde <= current_date
     AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= current_date)
   ORDER BY t.vigente_desde DESC LIMIT 1)`;

// Tipos que suman y que restan. EXISTENCIA = inicial + entradas − salidas.
export const TIPOS_ENTRADA = `('entrada', 'ajuste_entrada')`;
export const TIPOS_SALIDA = `('salida', 'ajuste_salida')`;

// Signo de cada movimiento "m".
export const SQL_SIGNO = `CASE
  WHEN m.tipo = 'inicial' OR m.tipo IN ${TIPOS_ENTRADA} THEN 1
  WHEN m.tipo IN ${TIPOS_SALIDA} THEN -1
  ELSE 0 END`;

// Existencia actual de un producto ($1 = id del producto).
export const SQL_EXISTENCIA = `SELECT COALESCE(sum(m.cantidad * ${SQL_SIGNO}), 0)::numeric(14,3)
  AS existencia
  FROM movimientos_inventario m WHERE m.producto_id = $1`;

// Columnas de la hoja de inventario para el producto "p".
export const SQL_TOTALES_PRODUCTO = `CROSS JOIN LATERAL (
    SELECT COALESCE(sum(m.cantidad) FILTER (WHERE m.tipo = 'inicial'), 0)::numeric(14,3)
             AS existencia_inicial,
           COALESCE(sum(m.cantidad) FILTER (WHERE m.tipo IN ${TIPOS_ENTRADA}), 0)::numeric(14,3)
             AS entradas,
           COALESCE(sum(m.cantidad) FILTER (WHERE m.tipo IN ${TIPOS_SALIDA}), 0)::numeric(14,3)
             AS salidas,
           COALESCE(sum(m.cantidad * ${SQL_SIGNO}), 0)::numeric(14,3) AS existencia
    FROM movimientos_inventario m WHERE m.producto_id = p.id) mv`;
