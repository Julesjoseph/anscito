-- ANSCITO 025: mes al que corresponde la factura de un gasto fijo.
-- Antes, la factura apagaba el aviso del mes de su fecha. Pero si el alquiler
-- vence el día 5 y la factura de noviembre se registra el 28 de octubre, el
-- aviso de noviembre no se apagaba. Ahora la factura dice de qué mes es, y no
-- se pueden registrar dos facturas activas del mismo gasto fijo para el mismo mes.
-- Las compras ya registradas no se tocan (el trigger compras_proteger no lo
-- permite): si no tienen mes, cuenta el mes de su fecha.
BEGIN;

ALTER TABLE compras ADD COLUMN gasto_fijo_mes date;

ALTER TABLE compras ADD CONSTRAINT compras_gasto_fijo_mes CHECK (
  gasto_fijo_mes IS NULL
  OR (gasto_fijo_id IS NOT NULL AND extract(day FROM gasto_fijo_mes) = 1)
);

CREATE UNIQUE INDEX compras_gasto_fijo_mes_unico ON compras (gasto_fijo_id, gasto_fijo_mes)
  WHERE estado = 'registrada';

COMMIT;
