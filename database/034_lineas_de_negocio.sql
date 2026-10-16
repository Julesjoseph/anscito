-- ANSCITO 034: ganancia por línea de negocio (unidad).
-- Decisión del dueño: los gastos comunes (alquiler, luz, sueldos…) NO se
-- reparten: van a "Gastos generales". Un gasto que es de una sola unidad
-- puede decir de cuál es (opcional) en Caja, Bancos y Compras.
-- * Gastos de caja, pagos de banco y compras: unidad opcional.
-- * SOL CASH y SCITO TRANSFER: sus comisiones, moras y comisiones de agentes
--   van a su unidad (configurable). Se busca por código y, si no, por nombre;
--   si no existe, queda vacía (va a generales hasta que se escoja).
BEGIN;

ALTER TABLE caja_movimientos ADD COLUMN unidad_negocio_id uuid REFERENCES unidades_negocio(id);
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_mov_unidad
  CHECK (unidad_negocio_id IS NULL OR tipo = 'gasto');

ALTER TABLE cuenta_movimientos ADD COLUMN unidad_negocio_id uuid REFERENCES unidades_negocio(id);
ALTER TABLE cuenta_movimientos ADD CONSTRAINT cuenta_mov_unidad
  CHECK (unidad_negocio_id IS NULL OR tipo = 'pago');

ALTER TABLE compras ADD COLUMN unidad_negocio_id uuid REFERENCES unidades_negocio(id);

INSERT INTO configuracion (clave, valor, descripcion)
VALUES
  ('lineas.unidad_sol_cash',
   COALESCE((SELECT id::text FROM unidades_negocio
             WHERE codigo = 'sol_cash' OR lower(nombre) = 'sol cash'
             ORDER BY (codigo = 'sol_cash') DESC, is_active DESC LIMIT 1), ''),
   'Línea de negocio de las comisiones y moras de SOL CASH'),
  ('lineas.unidad_envios',
   COALESCE((SELECT id::text FROM unidades_negocio
             WHERE codigo = 'envios_haiti' OR lower(nombre) IN ('envíos a haití', 'envios a haiti')
             ORDER BY (codigo = 'envios_haiti') DESC, is_active DESC LIMIT 1), ''),
   'Línea de negocio de las comisiones de SCITO TRANSFER y de sus agentes')
ON CONFLICT (clave) DO NOTHING;

COMMIT;
