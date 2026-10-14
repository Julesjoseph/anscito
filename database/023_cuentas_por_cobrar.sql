-- ANSCITO 023: Cuentas por Cobrar (ventas a crédito).
-- Crédito solo a clientes autorizados, con límite y plazo. Una venta puede
-- llevar un inicial y el resto a crédito. Abonos con recibo (AC-000001) que
-- se aplican a lo más viejo (primero el recargo). Recargo por cada mes
-- completo de atraso sobre el capital pendiente, sin interés sobre interés:
-- se calcula desde el historial (no se guarda) con la tasa vigente en cada
-- fecha; el administrador puede perdonarlo. Con facturas vencidas solo el
-- administrador autoriza una venta a crédito (en el momento o por adelantado).
BEGIN;

-- Forma de pago "Crédito": la parte de la venta que queda debiendo.
INSERT INTO formas_pago (codigo, nombre, calcula_devuelta, requiere_referencia, orden, usa_caja, usa_cuenta)
VALUES ('credito', 'Crédito', false, false, 99, false, false);

-- Clientes con crédito: límite y plazo normal (el administrador los pone).
CREATE TABLE clientes_credito (
  tercero_id   uuid PRIMARY KEY REFERENCES terceros(id),
  limite       numeric(14,2) NOT NULL,
  plazo_dias   int           NOT NULL,
  is_active    boolean       NOT NULL DEFAULT true,
  notas        varchar(300),
  created_by   uuid          NOT NULL REFERENCES usuarios(id),
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES usuarios(id),
  updated_at   timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT clientes_credito_limite CHECK (limite > 0),
  CONSTRAINT clientes_credito_plazo CHECK (plazo_dias BETWEEN 1 AND 365)
);

-- Porcentaje de recargo por mes completo de atraso, con fecha de vigencia.
CREATE TABLE cxc_tasas_recargo (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  porcentaje     numeric(5,2) NOT NULL,
  vigente_desde  date         NOT NULL UNIQUE,
  created_by     uuid REFERENCES usuarios(id),
  created_at     timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT cxc_tasas_porcentaje CHECK (porcentaje >= 0 AND porcentaje <= 100)
);
INSERT INTO cxc_tasas_recargo (porcentaje, vigente_desde) VALUES (5.00, DATE '2000-01-01');

-- Autorizaciones del administrador para vender a crédito con facturas vencidas.
CREATE TABLE cxc_autorizaciones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id      uuid          NOT NULL REFERENCES terceros(id),
  tipo            varchar(10)   NOT NULL,           -- previa (por adelantado) | en_venta
  motivo          varchar(300)  NOT NULL,
  valida_hasta    date          NOT NULL,           -- la previa vale solo ese día
  autorizado_por  uuid          NOT NULL REFERENCES usuarios(id),
  usada_venta_id  uuid UNIQUE REFERENCES ventas(id),
  usada_en        timestamptz,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT cxc_aut_tipo CHECK (tipo IN ('previa', 'en_venta')),
  CONSTRAINT cxc_aut_usada CHECK ((usada_venta_id IS NULL) = (usada_en IS NULL)),
  CONSTRAINT cxc_aut_en_venta CHECK (tipo <> 'en_venta' OR usada_venta_id IS NOT NULL)
);
CREATE INDEX cxc_aut_cliente_idx ON cxc_autorizaciones (cliente_id, valida_hasta);

-- Una cuenta por cobrar por cada venta a crédito (la parte que quedó debiendo).
CREATE TABLE cuentas_cobrar (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venta_id          uuid          NOT NULL UNIQUE REFERENCES ventas(id),
  cliente_id        uuid          NOT NULL REFERENCES terceros(id),
  monto             numeric(14,2) NOT NULL,
  fecha             date          NOT NULL,
  plazo_dias        int           NOT NULL,
  vencimiento       date          NOT NULL,
  autorizacion_id   uuid REFERENCES cxc_autorizaciones(id),
  estado            varchar(10)   NOT NULL DEFAULT 'activa',
  anulada_en        timestamptz,
  created_by        uuid          NOT NULL REFERENCES usuarios(id),
  created_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT cxc_monto CHECK (monto > 0),
  CONSTRAINT cxc_plazo CHECK (plazo_dias BETWEEN 1 AND 365),
  CONSTRAINT cxc_vencimiento CHECK (vencimiento = fecha + plazo_dias),
  CONSTRAINT cxc_estado CHECK (estado IN ('activa', 'anulada')),
  CONSTRAINT cxc_anulada CHECK ((estado = 'anulada') = (anulada_en IS NOT NULL))
);
CREATE INDEX cxc_cliente_idx ON cuentas_cobrar (cliente_id, vencimiento);

-- Abonos (recibos AC-000001): dinero que entra por caja o por cuenta.
INSERT INTO contadores (clave, valor) VALUES ('cxc_abonos', 0);
CREATE TABLE cxc_abonos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero            bigint        NOT NULL UNIQUE,
  cliente_id        uuid          NOT NULL REFERENCES terceros(id),
  total             numeric(14,2) NOT NULL,
  forma             varchar(15)   NOT NULL,           -- efectivo | transferencia
  referencia        varchar(60),
  fecha             date          NOT NULL,
  estado            varchar(10)   NOT NULL DEFAULT 'activo',
  anulado_por       uuid REFERENCES usuarios(id),
  anulado_en        timestamptz,
  motivo_anulacion  varchar(500),
  usuario_id        uuid          NOT NULL REFERENCES usuarios(id),
  created_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT cxc_abono_total CHECK (total > 0),
  CONSTRAINT cxc_abono_forma CHECK (forma IN ('efectivo', 'transferencia')),
  CONSTRAINT cxc_abono_estado CHECK (estado IN ('activo', 'anulado')),
  CONSTRAINT cxc_abono_anulado CHECK ((estado = 'anulado') =
    (anulado_por IS NOT NULL AND anulado_en IS NOT NULL AND motivo_anulacion IS NOT NULL))
);
CREATE INDEX cxc_abonos_cliente_idx ON cxc_abonos (cliente_id, fecha);

-- A qué factura y a qué parte (recargo o capital) se aplicó cada abono.
CREATE TABLE cxc_aplicaciones (
  id         bigserial PRIMARY KEY,
  abono_id   uuid          NOT NULL REFERENCES cxc_abonos(id),
  cuenta_id  uuid          NOT NULL REFERENCES cuentas_cobrar(id),
  recargo    numeric(14,2) NOT NULL DEFAULT 0,
  capital    numeric(14,2) NOT NULL DEFAULT 0,
  CONSTRAINT cxc_aplicacion_montos CHECK (recargo >= 0 AND capital >= 0 AND recargo + capital > 0)
);
CREATE INDEX cxc_aplicaciones_cuenta_idx ON cxc_aplicaciones (cuenta_id);
CREATE INDEX cxc_aplicaciones_abono_idx ON cxc_aplicaciones (abono_id);

-- Recargos perdonados por el administrador.
CREATE TABLE cxc_perdones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id    uuid          NOT NULL REFERENCES cuentas_cobrar(id),
  monto        numeric(14,2) NOT NULL,
  motivo       varchar(300)  NOT NULL,
  usuario_id   uuid          NOT NULL REFERENCES usuarios(id),
  created_at   timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT cxc_perdon_monto CHECK (monto > 0)
);

-- Lo registrado no se cambia ni se borra (abonos y cuentas solo se anulan).
CREATE FUNCTION cxc_inmutables() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Este registro de Cuentas por Cobrar no se cambia ni se borra';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER cxc_aplicaciones_no_modificar BEFORE UPDATE OR DELETE ON cxc_aplicaciones
  FOR EACH ROW EXECUTE FUNCTION cxc_inmutables();
CREATE TRIGGER cxc_perdones_no_modificar BEFORE UPDATE OR DELETE ON cxc_perdones
  FOR EACH ROW EXECUTE FUNCTION cxc_inmutables();
CREATE TRIGGER cxc_tasas_no_modificar BEFORE UPDATE OR DELETE ON cxc_tasas_recargo
  FOR EACH ROW EXECUTE FUNCTION cxc_inmutables();

CREATE FUNCTION cxc_solo_anular() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'No se borra: se anula';
  END IF;
  IF OLD.estado IN ('anulada', 'anulado') OR OLD.estado = NEW.estado
     OR (to_jsonb(NEW) - ARRAY['estado', 'anulada_en', 'anulado_por', 'anulado_en', 'motivo_anulacion'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['estado', 'anulada_en', 'anulado_por', 'anulado_en', 'motivo_anulacion']) THEN
    RAISE EXCEPTION 'Solo se puede anular';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER cuentas_cobrar_solo_anular BEFORE UPDATE OR DELETE ON cuentas_cobrar
  FOR EACH ROW EXECUTE FUNCTION cxc_solo_anular();
CREATE TRIGGER cxc_abonos_solo_anular BEFORE UPDATE OR DELETE ON cxc_abonos
  FOR EACH ROW EXECUTE FUNCTION cxc_solo_anular();

-- Caja: abono en efectivo (suma) y su anulación (resta).
ALTER TABLE caja_movimientos ADD COLUMN cxc_abono_id uuid REFERENCES cxc_abonos(id);
ALTER TABLE caja_movimientos DROP CONSTRAINT caja_mov_tipo;
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_mov_tipo CHECK (tipo IN (
  'venta', 'devolucion', 'gasto', 'retiro', 'ingreso', 'deposito', 'desde_cuenta',
  'san_cuota', 'san_mano', 'compra', 'compra_reverso',
  'abono_credito',          -- abono de un cliente a su crédito (suma)
  'abono_anulado'           -- se anuló el abono y el dinero se devuelve (resta)
));
ALTER TABLE caja_movimientos DROP CONSTRAINT caja_mov_motivo;
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_mov_motivo CHECK (
  tipo IN ('venta', 'devolucion', 'deposito', 'desde_cuenta', 'san_cuota', 'san_mano', 'compra',
           'abono_credito')
  OR motivo IS NOT NULL);
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_mov_cxc CHECK (
  (tipo IN ('abono_credito', 'abono_anulado')) = (cxc_abono_id IS NOT NULL));

-- Cuentas: abono por transferencia (suma); si se anula, el "reverso" de siempre.
ALTER TABLE cuenta_movimientos ADD COLUMN cxc_abono_id uuid REFERENCES cxc_abonos(id);
ALTER TABLE cuenta_movimientos DROP CONSTRAINT cuenta_mov_tipo;
ALTER TABLE cuenta_movimientos ADD CONSTRAINT cuenta_mov_tipo CHECK (tipo IN (
  'saldo_inicial', 'venta', 'devolucion', 'transferencia_entrada', 'transferencia_salida',
  'pago', 'cargo', 'interes', 'ingreso', 'reverso', 'remesa', 'san_cuota', 'san_mano', 'compra',
  'abono_credito'           -- abono de un cliente a su crédito (suma)
));
ALTER TABLE cuenta_movimientos DROP CONSTRAINT cuenta_mov_signo;
ALTER TABLE cuenta_movimientos ADD CONSTRAINT cuenta_mov_signo CHECK (
  (tipo IN ('saldo_inicial', 'venta', 'transferencia_entrada', 'interes', 'ingreso', 'san_cuota', 'abono_credito') AND signo = 1) OR
  (tipo IN ('devolucion', 'transferencia_salida', 'pago', 'cargo', 'remesa', 'san_mano', 'compra') AND signo = -1) OR
  (tipo = 'reverso' AND signo IN (1, -1)));
ALTER TABLE cuenta_movimientos DROP CONSTRAINT cuenta_mov_motivo;
ALTER TABLE cuenta_movimientos ADD CONSTRAINT cuenta_mov_motivo CHECK (
  tipo IN ('venta', 'devolucion', 'transferencia_entrada', 'transferencia_salida', 'remesa',
           'san_cuota', 'san_mano', 'compra', 'abono_credito')
  OR motivo IS NOT NULL);
ALTER TABLE cuenta_movimientos ADD CONSTRAINT cuenta_mov_cxc CHECK (
  (tipo <> 'abono_credito' OR cxc_abono_id IS NOT NULL) AND
  (cxc_abono_id IS NULL OR tipo IN ('abono_credito', 'reverso')));

INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('cxc.ver',           'cxc', 'ver',           'Ver Cuentas por Cobrar, estados de cuenta y antigüedad de saldos'),
  ('cxc.gestionar',     'cxc', 'gestionar',     'Dar crédito a clientes (límite y plazo) y cambiar el % de recargo'),
  ('cxc.vender',        'cxc', 'vender',        'Vender a crédito (dentro del límite y sin facturas vencidas)'),
  ('cxc.autorizar',     'cxc', 'autorizar',     'Autorizar ventas a crédito a clientes con facturas vencidas'),
  ('cxc.abonar',        'cxc', 'abonar',        'Recibir abonos y dar recibo'),
  ('cxc.perdonar',      'cxc', 'perdonar',      'Perdonar recargos por atraso'),
  ('cxc.anular_abono',  'cxc', 'anular_abono',  'Anular un abono (el dinero se devuelve)');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.modulo = 'cxc'
WHERE r.codigo = 'administrador';

COMMIT;
