-- ANSCITO 021: Compras (facturas de proveedor).
-- Cada factura guarda proveedor, NCF, tipo de gasto (606), bienes, servicios,
-- ITBIS, retenciones y vencimiento. Los productos entran solos al inventario.
-- Contado: se paga en el momento desde la caja o una cuenta. Crédito: queda
-- pendiente para Cuentas por Pagar. Las reglas fiscales (retenciones, ITBIS)
-- deben validarse con el contador.
BEGIN;

-- Tipos de gasto del formato 606 de la DGII.
CREATE TABLE tipos_gasto (
  codigo     varchar(2)    PRIMARY KEY,
  nombre     varchar(120)  NOT NULL,
  orden      int           NOT NULL,
  is_active  boolean       NOT NULL DEFAULT true,
  CONSTRAINT tipos_gasto_codigo CHECK (codigo ~ '^[0-9]{2}$')
);
INSERT INTO tipos_gasto (codigo, nombre, orden) VALUES
  ('01', 'Gastos de personal', 1),
  ('02', 'Gastos por trabajos, suministros y servicios', 2),
  ('03', 'Arrendamientos', 3),
  ('04', 'Gastos de activos fijos', 4),
  ('05', 'Gastos de representación', 5),
  ('06', 'Otras deducciones admitidas', 6),
  ('07', 'Gastos financieros', 7),
  ('08', 'Gastos extraordinarios', 8),
  ('09', 'Compras y gastos que forman parte del costo de venta', 9),
  ('10', 'Adquisiciones de activos', 10),
  ('11', 'Gastos de seguros', 11);

INSERT INTO contadores (clave, valor) VALUES ('compras', 0);

CREATE TABLE compras (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero             bigint        NOT NULL UNIQUE,          -- CP-000001
  proveedor_id       uuid          NOT NULL REFERENCES terceros(id),
  sucursal_id        uuid          NOT NULL REFERENCES sucursales(id),
  ncf                varchar(13),                            -- B0100000001 o E310000000001
  fecha_comprobante  date          NOT NULL,
  tipo_gasto         varchar(2)    NOT NULL REFERENCES tipos_gasto(codigo),
  condicion          varchar(8)    NOT NULL,                 -- contado | credito
  vencimiento        date          NOT NULL,
  -- Montos sin ITBIS: bienes (productos y otras cosas) y servicios.
  monto_bienes       numeric(14,2) NOT NULL DEFAULT 0,
  monto_servicios    numeric(14,2) NOT NULL DEFAULT 0,
  itbis              numeric(14,2) NOT NULL DEFAULT 0,
  itbis_retenido     numeric(14,2) NOT NULL DEFAULT 0,
  isr_retenido       numeric(14,2) NOT NULL DEFAULT 0,
  total              numeric(14,2) NOT NULL,                 -- bienes + servicios + ITBIS
  a_pagar            numeric(14,2) NOT NULL,                 -- total - retenciones
  descripcion        varchar(300),
  notas              text,
  estado             varchar(10)   NOT NULL DEFAULT 'registrada',
  anulada_por        uuid REFERENCES usuarios(id),
  anulada_en         timestamptz,
  motivo_anulacion   text,
  created_by         uuid          NOT NULL REFERENCES usuarios(id),
  created_at         timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT compras_condicion CHECK (condicion IN ('contado', 'credito')),
  CONSTRAINT compras_estado CHECK (estado IN ('registrada', 'anulada')),
  CONSTRAINT compras_montos CHECK (monto_bienes >= 0 AND monto_servicios >= 0 AND itbis >= 0
    AND itbis_retenido >= 0 AND isr_retenido >= 0 AND itbis_retenido <= itbis),
  CONSTRAINT compras_total CHECK (total = monto_bienes + monto_servicios + itbis AND total > 0),
  CONSTRAINT compras_a_pagar CHECK (a_pagar = total - itbis_retenido - isr_retenido AND a_pagar >= 0),
  CONSTRAINT compras_ncf CHECK (ncf IS NULL OR ncf ~ '^(B[0-9]{10}|E[0-9]{12})$'),
  CONSTRAINT compras_vencimiento CHECK (vencimiento >= fecha_comprobante),
  CONSTRAINT compras_anulada CHECK ((estado = 'anulada') =
    (anulada_por IS NOT NULL AND anulada_en IS NOT NULL AND motivo_anulacion IS NOT NULL))
);
-- El mismo NCF de un proveedor no se registra dos veces.
CREATE UNIQUE INDEX compras_ncf_unico ON compras (proveedor_id, ncf)
  WHERE ncf IS NOT NULL AND estado <> 'anulada';
CREATE INDEX compras_fecha_idx ON compras (fecha_comprobante);
CREATE INDEX compras_proveedor_idx ON compras (proveedor_id, fecha_comprobante);

-- Productos de la factura (entran al inventario).
CREATE TABLE compra_lineas (
  id              bigserial PRIMARY KEY,
  compra_id       uuid          NOT NULL REFERENCES compras(id),
  producto_id     uuid          NOT NULL REFERENCES productos(id),
  cantidad        numeric(14,3) NOT NULL,
  costo_unitario  numeric(14,2) NOT NULL,     -- sin ITBIS
  subtotal        numeric(14,2) NOT NULL,
  CONSTRAINT compra_lineas_montos CHECK (cantidad > 0 AND costo_unitario >= 0 AND subtotal >= 0)
);
CREATE INDEX compra_lineas_compra_idx ON compra_lineas (compra_id);

-- Pagos de una factura (contado ahora; abonos de crédito en Cuentas por Pagar).
CREATE TABLE compra_pagos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id   uuid          NOT NULL REFERENCES compras(id),
  monto       numeric(14,2) NOT NULL,
  forma       varchar(8)    NOT NULL,          -- efectivo (caja) | banco (cuenta)
  fecha       date          NOT NULL,
  referencia  varchar(60),
  usuario_id  uuid          NOT NULL REFERENCES usuarios(id),
  created_at  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT compra_pagos_monto CHECK (monto > 0),
  CONSTRAINT compra_pagos_forma CHECK (forma IN ('efectivo', 'banco'))
);
CREATE INDEX compra_pagos_compra_idx ON compra_pagos (compra_id);

-- Líneas y pagos no se cambian ni se borran. La factura solo pasa a anulada.
CREATE FUNCTION compras_inmutables() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Este registro de compra no se cambia ni se borra';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER compra_lineas_no_modificar BEFORE UPDATE OR DELETE ON compra_lineas
  FOR EACH ROW EXECUTE FUNCTION compras_inmutables();
CREATE TRIGGER compra_pagos_no_modificar BEFORE UPDATE OR DELETE ON compra_pagos
  FOR EACH ROW EXECUTE FUNCTION compras_inmutables();

CREATE FUNCTION compras_proteger() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las compras no se borran: se anulan';
  END IF;
  IF OLD.estado <> 'registrada' OR NEW.estado <> 'anulada'
     OR (to_jsonb(NEW) - ARRAY['estado', 'anulada_por', 'anulada_en', 'motivo_anulacion'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['estado', 'anulada_por', 'anulada_en', 'motivo_anulacion']) THEN
    RAISE EXCEPTION 'Una compra registrada solo se puede anular';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER compras_proteger BEFORE UPDATE OR DELETE ON compras
  FOR EACH ROW EXECUTE FUNCTION compras_proteger();

-- Inventario: la entrada sabe de qué compra viene.
ALTER TABLE movimientos_inventario ADD COLUMN compra_id uuid REFERENCES compras(id);

-- Caja: pago de una compra (resta) y su devolución si se anula (suma).
ALTER TABLE caja_movimientos ADD COLUMN compra_pago_id uuid REFERENCES compra_pagos(id);
ALTER TABLE caja_movimientos DROP CONSTRAINT caja_mov_tipo;
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_mov_tipo CHECK (tipo IN (
  'venta', 'devolucion', 'gasto', 'retiro', 'ingreso', 'deposito', 'desde_cuenta',
  'san_cuota', 'san_mano',
  'compra',          -- pago de una factura de proveedor (resta)
  'compra_reverso'   -- se anuló la compra y el dinero vuelve (suma)
));
ALTER TABLE caja_movimientos DROP CONSTRAINT caja_mov_motivo;
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_mov_motivo CHECK (
  tipo IN ('venta', 'devolucion', 'deposito', 'desde_cuenta', 'san_cuota', 'san_mano', 'compra')
  OR motivo IS NOT NULL);
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_mov_compra CHECK (
  (tipo IN ('compra', 'compra_reverso')) = (compra_pago_id IS NOT NULL));

-- Cuentas: pago de una compra (resta); si se anula, se usa el "reverso" de siempre.
ALTER TABLE cuenta_movimientos ADD COLUMN compra_pago_id uuid REFERENCES compra_pagos(id);
ALTER TABLE cuenta_movimientos DROP CONSTRAINT cuenta_mov_tipo;
ALTER TABLE cuenta_movimientos ADD CONSTRAINT cuenta_mov_tipo CHECK (tipo IN (
  'saldo_inicial', 'venta', 'devolucion', 'transferencia_entrada', 'transferencia_salida',
  'pago', 'cargo', 'interes', 'ingreso', 'reverso', 'remesa', 'san_cuota', 'san_mano',
  'compra'           -- pago de una factura de proveedor (resta)
));
ALTER TABLE cuenta_movimientos DROP CONSTRAINT cuenta_mov_signo;
ALTER TABLE cuenta_movimientos ADD CONSTRAINT cuenta_mov_signo CHECK (
  (tipo IN ('saldo_inicial', 'venta', 'transferencia_entrada', 'interes', 'ingreso', 'san_cuota') AND signo = 1) OR
  (tipo IN ('devolucion', 'transferencia_salida', 'pago', 'cargo', 'remesa', 'san_mano', 'compra') AND signo = -1) OR
  (tipo = 'reverso' AND signo IN (1, -1)));
ALTER TABLE cuenta_movimientos DROP CONSTRAINT cuenta_mov_motivo;
ALTER TABLE cuenta_movimientos ADD CONSTRAINT cuenta_mov_motivo CHECK (
  tipo IN ('venta', 'devolucion', 'transferencia_entrada', 'transferencia_salida', 'remesa',
           'san_cuota', 'san_mano', 'compra')
  OR motivo IS NOT NULL);
ALTER TABLE cuenta_movimientos ADD CONSTRAINT cuenta_mov_compra CHECK (
  (tipo <> 'compra' OR compra_pago_id IS NOT NULL) AND
  (compra_pago_id IS NULL OR tipo IN ('compra', 'reverso')));

INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('compras.ver',       'compras', 'ver',       'Ver las compras (facturas de proveedor)'),
  ('compras.registrar', 'compras', 'registrar', 'Registrar facturas de proveedor'),
  ('compras.anular',    'compras', 'anular',    'Anular facturas de proveedor');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.modulo = 'compras'
WHERE r.codigo = 'administrador';

COMMIT;
