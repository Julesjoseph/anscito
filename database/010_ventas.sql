-- ANSCITO 010: ventas
-- Todo se ejecuta como una sola operación: si algo falla, no se crea nada.
-- Las ventas guardan una COPIA de precio, costo, impuesto y tasa del día
-- (docs/notas-ventas.md): el catálogo nunca es la fuente del historial.
-- Todavía no hay caja, asientos contables, cuentas por cobrar ni e-CF.
BEGIN;

-- Valores configurables del sistema (sin escribirlos en el código).
CREATE TABLE configuracion (
  clave        varchar(60)  PRIMARY KEY,
  valor        text         NOT NULL,
  descripcion  varchar(200) NOT NULL,
  updated_by   uuid REFERENCES usuarios(id),
  updated_at   timestamptz  NOT NULL DEFAULT now()
);

INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('ventas.descuento_maximo_pct', '10.00',
   'Descuento máximo permitido por línea de venta, en porcentaje'),
  ('empresa.zona_horaria', 'America/Santo_Domingo',
   'Zona horaria para decidir qué es "el mismo día" (anulaciones, reportes)');

-- Contadores para numerar documentos sin huecos (se toman dentro de la
-- misma transacción que crea el documento).
CREATE TABLE contadores (
  clave  varchar(30) PRIMARY KEY,
  valor  bigint      NOT NULL DEFAULT 0 CHECK (valor >= 0)
);
INSERT INTO contadores (clave, valor) VALUES ('ventas', 0);

-- Formas de pago: lista configurable.
CREATE TABLE formas_pago (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo               varchar(30)  NOT NULL UNIQUE,
  nombre               varchar(60)  NOT NULL,
  calcula_devuelta     boolean      NOT NULL DEFAULT false,
  requiere_referencia  boolean      NOT NULL DEFAULT false,
  orden                integer      NOT NULL DEFAULT 0,
  is_active            boolean      NOT NULL DEFAULT true,
  created_at           timestamptz  NOT NULL DEFAULT now()
);
INSERT INTO formas_pago (codigo, nombre, calcula_devuelta, requiere_referencia, orden) VALUES
  ('efectivo',      'Efectivo',      true,  false, 1),
  ('transferencia', 'Transferencia', false, true,  2);

-- Ventas.
CREATE TABLE ventas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero              bigint        NOT NULL UNIQUE,
  fecha               timestamptz   NOT NULL DEFAULT now(),
  sucursal_id         uuid          NOT NULL REFERENCES sucursales(id),
  cliente_id          uuid          NOT NULL REFERENCES terceros(id),
  usuario_id          uuid          NOT NULL REFERENCES usuarios(id),
  estado              varchar(15)   NOT NULL DEFAULT 'completada',
  subtotal            numeric(14,2) NOT NULL,  -- precio × cantidad, antes de descuentos
  descuento           numeric(14,2) NOT NULL DEFAULT 0,
  motivo_descuento    text,
  base_imponible      numeric(14,2) NOT NULL,
  itbis               numeric(14,2) NOT NULL,
  total               numeric(14,2) NOT NULL,
  -- NCF o e-CF emitido por el sistema fiscal actual del dueño (referencia).
  comprobante_fiscal  varchar(30),
  notas               text,
  anulada_por         uuid REFERENCES usuarios(id),
  anulada_en          timestamptz,
  motivo_anulacion    text,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT ventas_estado CHECK (estado IN ('completada', 'anulada')),
  CONSTRAINT ventas_montos_no_negativos
    CHECK (subtotal >= 0 AND descuento >= 0 AND base_imponible >= 0
           AND itbis >= 0 AND total >= 0),
  CONSTRAINT ventas_cuadre CHECK (total = base_imponible + itbis),
  CONSTRAINT ventas_descuento_con_motivo
    CHECK (descuento = 0 OR motivo_descuento IS NOT NULL),
  CONSTRAINT ventas_anulacion_completa CHECK (
    (estado = 'anulada') = (anulada_en IS NOT NULL AND anulada_por IS NOT NULL
                            AND motivo_anulacion IS NOT NULL))
);
CREATE INDEX ventas_fecha_idx ON ventas (fecha DESC);
CREATE INDEX ventas_cliente_idx ON ventas (cliente_id);

-- Líneas: todo copiado del catálogo al momento de vender.
CREATE TABLE venta_lineas (
  id                    bigserial PRIMARY KEY,
  venta_id              uuid          NOT NULL REFERENCES ventas(id),
  tipo                  varchar(10)   NOT NULL,
  producto_id           uuid REFERENCES productos(id),
  servicio_id           uuid REFERENCES servicios(id),
  codigo                varchar(30)   NOT NULL,
  descripcion           varchar(150)  NOT NULL,
  unidad                varchar(50)   NOT NULL,
  cantidad              numeric(14,3) NOT NULL,
  precio_unitario       numeric(14,2) NOT NULL,
  precio_incluye_itbis  boolean       NOT NULL,
  impuesto_id           uuid          NOT NULL REFERENCES impuestos(id),
  impuesto              varchar(100)  NOT NULL,
  tasa                  numeric(5,2)  NOT NULL,
  bruto                 numeric(14,2) NOT NULL,  -- precio × cantidad
  descuento             numeric(14,2) NOT NULL DEFAULT 0,
  base                  numeric(14,2) NOT NULL,
  itbis                 numeric(14,2) NOT NULL,
  total                 numeric(14,2) NOT NULL,
  costo_unitario        numeric(14,2),           -- costo promedio del día (productos)
  CONSTRAINT venta_lineas_tipo CHECK (
    (tipo = 'producto' AND producto_id IS NOT NULL AND servicio_id IS NULL) OR
    (tipo = 'servicio' AND servicio_id IS NOT NULL AND producto_id IS NULL)),
  CONSTRAINT venta_lineas_cantidad CHECK (cantidad > 0),
  CONSTRAINT venta_lineas_montos CHECK (
    precio_unitario >= 0 AND bruto >= 0 AND descuento >= 0 AND descuento <= bruto
    AND base >= 0 AND itbis >= 0 AND total = base + itbis)
);
CREATE INDEX venta_lineas_venta_idx ON venta_lineas (venta_id);

-- Pagos (hoy uno por venta; la tabla ya permite pago mixto en el futuro).
CREATE TABLE venta_pagos (
  id             bigserial PRIMARY KEY,
  venta_id       uuid          NOT NULL REFERENCES ventas(id),
  forma_pago_id  uuid          NOT NULL REFERENCES formas_pago(id),
  monto          numeric(14,2) NOT NULL CHECK (monto > 0),
  recibido       numeric(14,2),
  devuelta       numeric(14,2),
  referencia     varchar(60),
  CONSTRAINT venta_pagos_devuelta CHECK (
    (recibido IS NULL AND devuelta IS NULL) OR
    (recibido >= monto AND devuelta = recibido - monto))
);
CREATE INDEX venta_pagos_venta_idx ON venta_pagos (venta_id);

-- Inventario: las ventas descuentan y las anulaciones devuelven.
ALTER TABLE movimientos_inventario DROP CONSTRAINT movimientos_tipo;
ALTER TABLE movimientos_inventario
  ADD CONSTRAINT movimientos_tipo CHECK (tipo IN (
    'inicial', 'entrada', 'salida', 'ajuste_entrada', 'ajuste_salida',
    'venta',            -- sale por una venta
    'anulacion_venta'   -- vuelve porque la venta se anuló
  )),
  ADD COLUMN venta_id uuid REFERENCES ventas(id),
  ADD CONSTRAINT movimientos_venta_con_id
    CHECK (tipo NOT IN ('venta', 'anulacion_venta') OR venta_id IS NOT NULL);

-- Permisos.
INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('ventas.ver',               'ventas', 'ver',               'Ver ventas'),
  ('ventas.crear',             'ventas', 'crear',             'Registrar ventas'),
  ('ventas.descontar',         'ventas', 'descontar',         'Dar descuentos (hasta el máximo configurado)'),
  ('ventas.comprobante',       'ventas', 'comprobante',       'Anotar el comprobante fiscal (NCF/e-CF) de una venta'),
  ('ventas.anular',            'ventas', 'anular',            'Anular ventas del mismo día'),
  ('ventas.anular_anteriores', 'ventas', 'anular_anteriores', 'Anular ventas de días anteriores');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.modulo = 'ventas'
WHERE r.codigo = 'administrador';

COMMIT;
