-- ANSCITO 033: asientos automáticos de Bancos, SOL CASH y SCITO TRANSFER
-- (parte 2b de Contabilidad).
-- * Ingresos de banco: igual que en Caja, quien lo registra dice qué fue
--   (aporte del dueño, préstamo recibido u "otro"). "Otro" queda en
--   pendientes para que el contador escoja la cuenta. Los movimientos
--   anteriores quedan sin clase.
-- * Clasificaciones: cuando una operación no se puede contabilizar sola
--   ("otro", saldo inicial tardío, dinero que no llegó al banco…), el
--   contador escoge la cuenta desde la pantalla de pendientes. Se guarda aquí
--   (solo se agregan filas; vale la última).
-- * Comisión de los agentes autorizados: gasto el día que se les paga
--   (decisión del dueño). Se aclara la descripción de las reglas.
-- Todo sugerido: pendiente de validar por el contador.
BEGIN;

-- ---------- Clase de los ingresos de banco ----------
ALTER TABLE cuenta_movimientos ADD COLUMN clase varchar(12);
ALTER TABLE cuenta_movimientos ADD CONSTRAINT cuenta_mov_clase CHECK (clase IS NULL
  OR (tipo = 'ingreso' AND clase IN ('aporte', 'prestamo', 'otro')));

-- ---------- Clasificaciones del contador ----------
CREATE TABLE contabilidad_clasificaciones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origen_tabla  varchar(30)  NOT NULL,
  origen_id     varchar(40)  NOT NULL,
  cuenta_id     uuid         NOT NULL REFERENCES cuentas_contables(id),
  nota          varchar(300) NOT NULL,
  created_by    uuid         NOT NULL REFERENCES usuarios(id),
  created_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT contabilidad_clasif_nota CHECK (length(trim(nota)) >= 5)
);
CREATE INDEX contabilidad_clasif_origen_idx ON contabilidad_clasificaciones (origen_tabla, origen_id, created_at DESC);

-- Solo se agregan: una clasificación no se cambia ni se borra (se agrega otra).
CREATE FUNCTION contabilidad_clasif_inmutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Una clasificación contable no se puede modificar ni borrar; agregue otra';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER contabilidad_clasif_no_modificar BEFORE UPDATE OR DELETE ON contabilidad_clasificaciones
  FOR EACH ROW EXECUTE FUNCTION contabilidad_clasif_inmutable();

-- ---------- Descripción de las reglas ----------
WITH r AS (
  UPDATE contabilidad_reglas x SET descripcion = n.descripcion, updated_at = now()
  FROM (VALUES
    ('capital',             'Ingresos a la caja o al banco marcados como aporte del dueño'),
    ('prestamos_recibidos', 'Ingresos a la caja o al banco marcados como préstamo recibido'),
    ('comision_agentes',    'Comisión de los agentes autorizados: gasto el día que se les paga'),
    ('otras_cxp',           'Otras deudas por pagar'),
    ('agentes_envios',      'Lo que cobran los agentes de SCITO TRANSFER (envío + comisión) y deben entregar')
  ) AS n(clave, descripcion),
  LATERAL (SELECT descripcion AS anterior FROM contabilidad_reglas WHERE clave = n.clave) a
  WHERE x.clave = n.clave AND x.descripcion <> n.descripcion
  RETURNING x.clave, a.anterior, x.descripcion
)
INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo, motivo)
SELECT NULL, 'migracion.033', 'contabilidad_reglas', r.clave,
       jsonb_build_object('descripcion', r.anterior), jsonb_build_object('descripcion', r.descripcion),
       'Migración 033: comisión de agentes como gasto al pagarse (decisión del dueño)'
FROM r;

COMMIT;
