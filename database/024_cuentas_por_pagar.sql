-- ANSCITO 024: Cuentas por Pagar.
-- Un pago a un proveedor (comprobante PP-000001) puede cubrir una o varias
-- facturas de compra, completas o en parte: cada parte queda en compra_pagos
-- (como el pago de contado) con su movimiento "Pago de compra" en la caja o
-- la cuenta. Un pago se puede anular (el dinero vuelve). Gastos fijos:
-- recordatorios mensuales (alquiler, luz, internet…) que avisan antes del día.
BEGIN;

INSERT INTO contadores (clave, valor) VALUES ('cxp_pagos', 0);

CREATE TABLE cxp_pagos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero            bigint        NOT NULL UNIQUE,      -- PP-000001
  proveedor_id      uuid          NOT NULL REFERENCES terceros(id),
  total             numeric(14,2) NOT NULL,
  forma             varchar(8)    NOT NULL,             -- efectivo (caja) | banco (cuenta)
  referencia        varchar(60),
  fecha             date          NOT NULL,
  estado            varchar(10)   NOT NULL DEFAULT 'activo',
  anulado_por       uuid REFERENCES usuarios(id),
  anulado_en        timestamptz,
  motivo_anulacion  varchar(500),
  usuario_id        uuid          NOT NULL REFERENCES usuarios(id),
  created_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT cxp_pago_total CHECK (total > 0),
  CONSTRAINT cxp_pago_forma CHECK (forma IN ('efectivo', 'banco')),
  CONSTRAINT cxp_pago_estado CHECK (estado IN ('activo', 'anulado')),
  CONSTRAINT cxp_pago_anulado CHECK ((estado = 'anulado') =
    (anulado_por IS NOT NULL AND anulado_en IS NOT NULL AND motivo_anulacion IS NOT NULL))
);
CREATE INDEX cxp_pagos_proveedor_idx ON cxp_pagos (proveedor_id, fecha);

-- Solo se anula; un pago anulado no vuelve a quedar activo.
CREATE FUNCTION cxp_pago_solo_anular() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'No se borra: se anula';
  END IF;
  IF OLD.estado = 'anulado' OR NEW.estado <> 'anulado'
     OR (to_jsonb(NEW) - ARRAY['estado', 'anulado_por', 'anulado_en', 'motivo_anulacion'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['estado', 'anulado_por', 'anulado_en', 'motivo_anulacion']) THEN
    RAISE EXCEPTION 'Un pago a proveedor solo se puede anular';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER cxp_pagos_solo_anular BEFORE UPDATE OR DELETE ON cxp_pagos
  FOR EACH ROW EXECUTE FUNCTION cxp_pago_solo_anular();

-- Cada parte del pago, en la factura a la que va (el pago de contado queda sin pago_id).
ALTER TABLE compra_pagos ADD COLUMN pago_id uuid REFERENCES cxp_pagos(id);
CREATE INDEX compra_pagos_pago_idx ON compra_pagos (pago_id);

-- Gastos fijos: recordatorios mensuales.
CREATE TABLE gastos_fijos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        varchar(100)  NOT NULL,              -- "Alquiler del local", "Luz"…
  proveedor_id  uuid          NOT NULL REFERENCES terceros(id),
  tipo_gasto    varchar(2)    NOT NULL REFERENCES tipos_gasto(codigo),
  dia_mes       int           NOT NULL,              -- día en que vence cada mes
  monto         numeric(14,2),                       -- si siempre es igual (sin ITBIS)
  itbis         numeric(14,2),
  notas         varchar(300),
  is_active     boolean       NOT NULL DEFAULT true,
  created_by    uuid          NOT NULL REFERENCES usuarios(id),
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES usuarios(id),
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT gastos_fijos_dia CHECK (dia_mes BETWEEN 1 AND 31),
  CONSTRAINT gastos_fijos_monto CHECK (monto IS NULL OR monto > 0),
  CONSTRAINT gastos_fijos_itbis CHECK (itbis IS NULL OR (itbis >= 0 AND monto IS NOT NULL))
);

-- La factura registrada desde un gasto fijo sabe de cuál viene (así el aviso se apaga ese mes).
ALTER TABLE compras ADD COLUMN gasto_fijo_id uuid REFERENCES gastos_fijos(id);

INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('cxp.dias_alerta', '7', 'Cuántos días antes del vencimiento avisa Cuentas por Pagar (facturas y gastos fijos)');

INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('cxp.ver',          'cxp', 'ver',          'Ver Cuentas por Pagar, alertas y estado de cuenta de proveedores'),
  ('cxp.pagar',        'cxp', 'pagar',        'Pagar facturas de proveedores (completas o en parte)'),
  ('cxp.anular_pago',  'cxp', 'anular_pago',  'Anular un pago a proveedor (el dinero vuelve)'),
  ('cxp.gastos_fijos', 'cxp', 'gastos_fijos', 'Crear y cambiar los gastos fijos y los días de aviso');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.modulo = 'cxp'
WHERE r.codigo = 'administrador';

COMMIT;
