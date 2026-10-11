-- ANSCITO 013: bancos y billeteras (cuentas en RD$, US$ y HTG, movimientos,
-- confirmación contra el estado de cuenta y transferencias entre cuentas y caja)
-- Todo se ejecuta como una sola operación: si algo falla, no se crea nada.
BEGIN;

-- Monedas. Lista configurable; la moneda principal es el peso dominicano.
CREATE TABLE monedas (
  codigo     varchar(3)   PRIMARY KEY,
  nombre     varchar(40)  NOT NULL,
  simbolo    varchar(5)   NOT NULL,
  orden      integer      NOT NULL DEFAULT 0,
  is_active  boolean      NOT NULL DEFAULT true,
  CONSTRAINT monedas_codigo_formato CHECK (codigo ~ '^[A-Z]{3}$')
);
INSERT INTO monedas (codigo, nombre, simbolo, orden) VALUES
  ('DOP', 'Peso dominicano',      'RD$', 1),
  ('USD', 'Dólar estadounidense', 'US$', 2),
  ('HTG', 'Gourde haitiano',      'HTG', 3);

-- Cuentas del negocio: bancarias y billeteras (MonCash, NatCash).
-- Solo se guardan los últimos 4 dígitos del número de cuenta.
CREATE TABLE cuentas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo              varchar(20)  NOT NULL UNIQUE,
  tipo                varchar(10)  NOT NULL,
  entidad             varchar(60)  NOT NULL,   -- banco o servicio (Banco Popular, MonCash)
  nombre              varchar(60)  NOT NULL,   -- cómo se le llama (Popular corriente)
  tipo_cuenta         varchar(10),             -- corriente / ahorro (solo bancos)
  moneda              varchar(3)   NOT NULL REFERENCES monedas(codigo),
  ultimos_digitos     varchar(4),
  recibe_ventas       boolean      NOT NULL DEFAULT false,
  cuenta_contable_id  uuid,                    -- previsto para Contabilidad
  is_active           boolean      NOT NULL DEFAULT true,
  created_by          uuid REFERENCES usuarios(id),
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT cuentas_codigo_formato CHECK (codigo ~ '^[A-Z0-9_-]{2,20}$'),
  CONSTRAINT cuentas_tipo CHECK (tipo IN ('banco', 'billetera')),
  CONSTRAINT cuentas_tipo_cuenta CHECK (
    (tipo = 'banco' AND tipo_cuenta IN ('corriente', 'ahorro')) OR
    (tipo = 'billetera' AND tipo_cuenta IS NULL)),
  CONSTRAINT cuentas_digitos CHECK (ultimos_digitos IS NULL OR ultimos_digitos ~ '^[0-9]{4}$'),
  -- Las ventas se cobran solo en pesos.
  CONSTRAINT cuentas_ventas_en_pesos CHECK (NOT recibe_ventas OR moneda = 'DOP')
);
CREATE UNIQUE INDEX cuentas_nombre_uq ON cuentas (lower(nombre));

-- Transferencias de dinero propio: banco ↔ banco, caja → banco (depósito),
-- banco → caja, banco o caja → MonCash/NatCash. Si cambian de moneda,
-- se guarda cuánto salió, cuánto entró y quién hizo el cambio.
CREATE TABLE transferencias (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero              bigint        NOT NULL UNIQUE,
  origen_cuenta_id    uuid REFERENCES cuentas(id),
  origen_sesion_id    uuid REFERENCES caja_sesiones(id),
  destino_cuenta_id   uuid REFERENCES cuentas(id),
  destino_sesion_id   uuid REFERENCES caja_sesiones(id),
  monto_sale          numeric(14,2) NOT NULL,   -- en la moneda del origen
  monto_entra         numeric(14,2) NOT NULL,   -- en la moneda del destino
  monto_dop           numeric(14,2) NOT NULL,   -- valor en RD$
  cambiado_por        varchar(12),              -- solo si cambia de moneda
  referencia          varchar(60),
  motivo              text,
  usuario_id          uuid          NOT NULL REFERENCES usuarios(id),
  created_at          timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT transf_un_origen CHECK ((origen_cuenta_id IS NULL) <> (origen_sesion_id IS NULL)),
  CONSTRAINT transf_un_destino CHECK ((destino_cuenta_id IS NULL) <> (destino_sesion_id IS NULL)),
  CONSTRAINT transf_distinta CHECK (origen_cuenta_id IS DISTINCT FROM destino_cuenta_id
    OR origen_cuenta_id IS NULL),
  CONSTRAINT transf_no_caja_a_caja CHECK (origen_sesion_id IS NULL OR destino_sesion_id IS NULL),
  CONSTRAINT transf_montos CHECK (monto_sale > 0 AND monto_entra > 0 AND monto_dop > 0),
  CONSTRAINT transf_cambiado_por CHECK (
    cambiado_por IS NULL OR cambiado_por IN ('casa_cambio', 'agente', 'banco', 'otro'))
);
INSERT INTO contadores (clave, valor) VALUES ('transferencias', 0);

-- Movimientos de cada cuenta, en la moneda de la cuenta. Solo se agregan;
-- un error se corrige con un reverso. "tasa" = RD$ por 1 unidad (1 en pesos).
CREATE TABLE cuenta_movimientos (
  id                  bigserial PRIMARY KEY,
  cuenta_id           uuid          NOT NULL REFERENCES cuentas(id),
  tipo                varchar(24)   NOT NULL,
  signo               smallint      NOT NULL,
  monto               numeric(14,2) NOT NULL,
  tasa                numeric(18,8) NOT NULL,
  monto_dop           numeric(14,2) NOT NULL,
  fecha               date          NOT NULL,   -- fecha del banco
  por_confirmar       boolean       NOT NULL DEFAULT false,
  venta_id            uuid REFERENCES ventas(id),
  transferencia_id    uuid REFERENCES transferencias(id),
  categoria_gasto_id  uuid REFERENCES categorias_gasto(id),
  beneficiario        varchar(120),
  comprobante         varchar(30),
  referencia          varchar(60),
  motivo              text,
  reverso_de          bigint UNIQUE REFERENCES cuenta_movimientos(id),
  usuario_id          uuid          NOT NULL REFERENCES usuarios(id),
  created_at          timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT cuenta_mov_tipo CHECK (tipo IN (
    'saldo_inicial',          -- suma
    'venta',                  -- cobro por transferencia (suma)
    'devolucion',             -- venta anulada (resta)
    'transferencia_entrada',  -- suma
    'transferencia_salida',   -- resta
    'pago',                   -- gasto o pago desde la cuenta (resta)
    'cargo',                  -- comisión, impuesto 0.15%, mantenimiento (resta)
    'interes',                -- suma
    'ingreso',                -- otro dinero que entra (suma)
    'reverso'                 -- deshace otro movimiento (signo contrario)
  )),
  CONSTRAINT cuenta_mov_signo CHECK (
    (tipo IN ('saldo_inicial', 'venta', 'transferencia_entrada', 'interes', 'ingreso') AND signo = 1) OR
    (tipo IN ('devolucion', 'transferencia_salida', 'pago', 'cargo') AND signo = -1) OR
    (tipo = 'reverso' AND signo IN (1, -1))),
  CONSTRAINT cuenta_mov_montos CHECK (monto > 0 AND tasa > 0 AND monto_dop > 0),
  CONSTRAINT cuenta_mov_venta CHECK ((tipo IN ('venta', 'devolucion')) = (venta_id IS NOT NULL)),
  CONSTRAINT cuenta_mov_transf CHECK (
    (tipo IN ('transferencia_entrada', 'transferencia_salida')) = (transferencia_id IS NOT NULL)),
  CONSTRAINT cuenta_mov_pago CHECK ((tipo = 'pago') = (categoria_gasto_id IS NOT NULL)),
  CONSTRAINT cuenta_mov_reverso CHECK ((tipo = 'reverso') = (reverso_de IS NOT NULL)),
  CONSTRAINT cuenta_mov_motivo CHECK (
    tipo IN ('venta', 'devolucion', 'transferencia_entrada', 'transferencia_salida')
    OR motivo IS NOT NULL)
);
CREATE INDEX cuenta_mov_cuenta_idx ON cuenta_movimientos (cuenta_id, fecha, id);
CREATE INDEX cuenta_mov_venta_idx ON cuenta_movimientos (venta_id);
CREATE INDEX cuenta_mov_transf_idx ON cuenta_movimientos (transferencia_id);
-- Un solo saldo inicial por cuenta.
CREATE UNIQUE INDEX cuenta_mov_un_saldo_inicial ON cuenta_movimientos (cuenta_id)
  WHERE tipo = 'saldo_inicial';

-- Confirmación contra el estado de cuenta del banco (una por movimiento).
CREATE TABLE cuenta_confirmaciones (
  id             bigserial PRIMARY KEY,
  movimiento_id  bigint       NOT NULL UNIQUE REFERENCES cuenta_movimientos(id),
  resultado      varchar(10)  NOT NULL,
  fecha_banco    date,
  motivo         text,
  usuario_id     uuid         NOT NULL REFERENCES usuarios(id),
  created_at     timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT cuenta_conf_resultado CHECK (resultado IN ('confirmado', 'no_llego')),
  CONSTRAINT cuenta_conf_motivo CHECK (resultado = 'confirmado' OR motivo IS NOT NULL)
);

CREATE FUNCTION bancos_inmutables() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Los movimientos de bancos no se pueden modificar ni borrar';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transferencias_no_modificar
  BEFORE UPDATE OR DELETE ON transferencias
  FOR EACH ROW EXECUTE FUNCTION bancos_inmutables();
CREATE TRIGGER cuenta_movimientos_no_modificar
  BEFORE UPDATE OR DELETE ON cuenta_movimientos
  FOR EACH ROW EXECUTE FUNCTION bancos_inmutables();
CREATE TRIGGER cuenta_confirmaciones_no_modificar
  BEFORE UPDATE OR DELETE ON cuenta_confirmaciones
  FOR EACH ROW EXECUTE FUNCTION bancos_inmutables();

-- Caja: depósitos al banco (resta) y efectivo traído del banco (suma).
-- Se reemplazan dos reglas de 012 para aceptar los tipos nuevos (no se
-- modifica ningún movimiento existente).
ALTER TABLE caja_movimientos ADD COLUMN transferencia_id uuid REFERENCES transferencias(id);
ALTER TABLE caja_movimientos DROP CONSTRAINT caja_mov_tipo;
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_mov_tipo CHECK (tipo IN (
  'venta', 'devolucion', 'gasto', 'retiro', 'ingreso',
  'deposito',      -- efectivo llevado a una cuenta (resta)
  'desde_cuenta'   -- efectivo traído de una cuenta (suma)
));
ALTER TABLE caja_movimientos DROP CONSTRAINT caja_mov_motivo;
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_mov_motivo CHECK (
  tipo IN ('venta', 'devolucion', 'deposito', 'desde_cuenta') OR motivo IS NOT NULL);
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_mov_transf CHECK (
  (tipo IN ('deposito', 'desde_cuenta')) = (transferencia_id IS NOT NULL));

-- Ventas por transferencia: a qué cuenta llegó el dinero.
ALTER TABLE formas_pago ADD COLUMN usa_cuenta boolean NOT NULL DEFAULT false;
UPDATE formas_pago SET usa_cuenta = true WHERE codigo = 'transferencia';
ALTER TABLE venta_pagos ADD COLUMN cuenta_id uuid REFERENCES cuentas(id);

-- Categorías para pagos desde el banco (la lista sigue siendo configurable).
INSERT INTO categorias_gasto (codigo, nombre, orden) VALUES
  ('alquiler',          'Alquiler',                      7),
  ('servicios_basicos', 'Luz, agua, teléfono e internet', 8),
  ('compra_mercancia',  'Compra de mercancía',           9),
  ('comision_cambio',   'Comisión de cambio de moneda',  10);

-- Permisos.
INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('bancos.ver',         'bancos', 'ver',         'Ver cuentas, saldos y movimientos'),
  ('bancos.movimientos', 'bancos', 'movimientos', 'Registrar pagos, cargos, intereses e ingresos'),
  ('bancos.transferir',  'bancos', 'transferir',  'Transferir entre cuentas y caja (depósitos, recargas)'),
  ('bancos.confirmar',   'bancos', 'confirmar',   'Confirmar movimientos contra el estado de cuenta'),
  ('bancos.gestionar',   'bancos', 'gestionar',   'Crear y editar cuentas, saldo inicial y reversos');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.modulo = 'bancos'
WHERE r.codigo = 'administrador';

COMMIT;
