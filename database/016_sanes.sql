-- ANSCITO 016: SAN (sociedad de ahorro por turnos) administrado por SCITO.
-- Cada período los participantes pagan su cuota; en cada turno un número
-- recibe la mano (cuota × números) menos la comisión de SCITO y menos lo que
-- ese participante deba. Las cuotas son dinero de los participantes; solo la
-- comisión y la mora son de SCITO. REQUIERE VALIDACIÓN LEGAL antes de usarse.
BEGIN;

INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('sanes.comision_pct', '5.00', 'Comisión de SCITO en cada mano del SAN (% de la mano), valor por defecto'),
  ('sanes.mora_pct', '10.00', 'Mora por cuota de SAN pagada tarde (% de la cuota), valor por defecto'),
  ('sanes.dias_gracia', '3', 'Días después del vencimiento antes de cobrar mora en el SAN, valor por defecto');

INSERT INTO contadores (clave, valor) VALUES ('sanes', 0), ('san_recibos', 0), ('san_entregas', 0);

CREATE TABLE sanes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero            bigint        NOT NULL UNIQUE,       -- SAN-0001
  nombre            varchar(80)   NOT NULL,
  frecuencia        varchar(10)   NOT NULL,
  cuota             numeric(14,2) NOT NULL,              -- por número completo
  cantidad_numeros  integer       NOT NULL,
  fecha_inicio      date          NOT NULL,
  comision_pct      numeric(5,2)  NOT NULL,
  mora_pct          numeric(5,2)  NOT NULL,
  dias_gracia       integer       NOT NULL,
  estado            varchar(12)   NOT NULL DEFAULT 'preparacion',
  notas             text,
  created_by        uuid REFERENCES usuarios(id),
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT sanes_frecuencia CHECK (frecuencia IN ('semanal', 'quincenal', 'mensual')),
  -- La mitad de la cuota (medio número) debe dar centavos exactos.
  CONSTRAINT sanes_cuota CHECK (cuota > 0 AND (cuota * 100) % 2 = 0),
  CONSTRAINT sanes_numeros CHECK (cantidad_numeros BETWEEN 2 AND 200),
  CONSTRAINT sanes_pct CHECK (comision_pct BETWEEN 0 AND 100 AND mora_pct BETWEEN 0 AND 100),
  CONSTRAINT sanes_gracia CHECK (dias_gracia BETWEEN 0 AND 60),
  CONSTRAINT sanes_estado CHECK (estado IN ('preparacion', 'activo', 'terminado', 'cancelado'))
);
CREATE UNIQUE INDEX sanes_nombre_uq ON sanes (lower(nombre));

-- Calendario: el turno N vence en "fecha" (cuota de todos) y ese día cobra el número N.
CREATE TABLE san_turnos (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  san_id  uuid    NOT NULL REFERENCES sanes(id),
  turno   integer NOT NULL,
  fecha   date    NOT NULL,
  CONSTRAINT san_turnos_turno CHECK (turno >= 1),
  UNIQUE (san_id, turno)
);

-- Quién tiene cada número (completo, o medio número compartido por dos).
CREATE TABLE san_participaciones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  san_id      uuid        NOT NULL REFERENCES sanes(id),
  numero      integer     NOT NULL,
  tercero_id  uuid        NOT NULL REFERENCES terceros(id),
  parte       varchar(8)  NOT NULL,
  created_by  uuid REFERENCES usuarios(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT san_part_parte CHECK (parte IN ('completo', 'medio')),
  CONSTRAINT san_part_numero CHECK (numero >= 1),
  UNIQUE (san_id, numero, tercero_id)
);
CREATE UNIQUE INDEX san_part_completo_uq ON san_participaciones (san_id, numero) WHERE parte = 'completo';
CREATE INDEX san_part_tercero_idx ON san_participaciones (tercero_id);

-- Recibo de un cobro en la oficina (uno o varios períodos de una vez).
CREATE TABLE san_recibos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero      bigint        NOT NULL UNIQUE,              -- R-000001
  san_id      uuid          NOT NULL REFERENCES sanes(id),
  tercero_id  uuid          NOT NULL REFERENCES terceros(id),
  cuotas      numeric(14,2) NOT NULL,                     -- dinero de los participantes
  mora        numeric(14,2) NOT NULL,                     -- ganancia de SCITO
  total       numeric(14,2) NOT NULL,
  forma       varchar(14)   NOT NULL,
  referencia  varchar(60),
  usuario_id  uuid          NOT NULL REFERENCES usuarios(id),
  created_at  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT san_recibos_montos CHECK (cuotas > 0 AND mora >= 0 AND total = cuotas + mora),
  CONSTRAINT san_recibos_forma CHECK (forma IN ('efectivo', 'transferencia'))
);

-- Entrega de la mano a un participante (en su turno).
CREATE TABLE san_entregas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero            bigint        NOT NULL UNIQUE,        -- M-000001
  san_id            uuid          NOT NULL REFERENCES sanes(id),
  turno             integer       NOT NULL,
  participacion_id  uuid          NOT NULL UNIQUE REFERENCES san_participaciones(id),
  bruto             numeric(14,2) NOT NULL,               -- su parte de la mano
  comision          numeric(14,2) NOT NULL,               -- para SCITO
  descuento         numeric(14,2) NOT NULL,               -- cuotas y moras que debía
  neto              numeric(14,2) NOT NULL,               -- lo que recibe
  forma             varchar(14)   NOT NULL,
  referencia        varchar(60),
  usuario_id        uuid          NOT NULL REFERENCES usuarios(id),
  created_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT san_entregas_montos CHECK (bruto > 0 AND comision >= 0 AND descuento >= 0
    AND neto >= 0 AND neto = bruto - comision - descuento),
  CONSTRAINT san_entregas_forma CHECK (forma IN ('efectivo', 'transferencia'))
);

-- Cada cuota pagada (un período de una participación). Se paga en un recibo
-- o se descuenta de la mano en una entrega.
CREATE TABLE san_pagos (
  id                bigserial PRIMARY KEY,
  participacion_id  uuid          NOT NULL REFERENCES san_participaciones(id),
  turno             integer       NOT NULL,
  cuota             numeric(14,2) NOT NULL,
  mora              numeric(14,2) NOT NULL,
  dias_atraso       integer       NOT NULL,
  recibo_id         uuid REFERENCES san_recibos(id),
  entrega_id        uuid REFERENCES san_entregas(id),
  created_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT san_pagos_montos CHECK (cuota > 0 AND mora >= 0 AND dias_atraso >= 0),
  CONSTRAINT san_pagos_origen CHECK ((recibo_id IS NULL) <> (entrega_id IS NULL)),
  UNIQUE (participacion_id, turno)
);

CREATE FUNCTION sanes_inmutables() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Los pagos y entregas del SAN no se pueden modificar ni borrar';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER san_recibos_no_modificar BEFORE UPDATE OR DELETE ON san_recibos
  FOR EACH ROW EXECUTE FUNCTION sanes_inmutables();
CREATE TRIGGER san_entregas_no_modificar BEFORE UPDATE OR DELETE ON san_entregas
  FOR EACH ROW EXECUTE FUNCTION sanes_inmutables();
CREATE TRIGGER san_pagos_no_modificar BEFORE UPDATE OR DELETE ON san_pagos
  FOR EACH ROW EXECUTE FUNCTION sanes_inmutables();

-- Caja: cuotas que entran (suma) y manos que salen (resta).
-- Se reemplazan dos reglas de caja para aceptar los tipos nuevos.
ALTER TABLE caja_movimientos ADD COLUMN san_recibo_id uuid REFERENCES san_recibos(id);
ALTER TABLE caja_movimientos ADD COLUMN san_entrega_id uuid REFERENCES san_entregas(id);
ALTER TABLE caja_movimientos DROP CONSTRAINT caja_mov_tipo;
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_mov_tipo CHECK (tipo IN (
  'venta', 'devolucion', 'gasto', 'retiro', 'ingreso', 'deposito', 'desde_cuenta',
  'san_cuota',  -- cuotas (y mora) de un SAN cobradas en efectivo (suma)
  'san_mano'    -- mano de un SAN entregada en efectivo (resta)
));
ALTER TABLE caja_movimientos DROP CONSTRAINT caja_mov_motivo;
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_mov_motivo CHECK (
  tipo IN ('venta', 'devolucion', 'deposito', 'desde_cuenta', 'san_cuota', 'san_mano')
  OR motivo IS NOT NULL);
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_mov_san CHECK (
  (tipo = 'san_cuota') = (san_recibo_id IS NOT NULL) AND
  (tipo = 'san_mano') = (san_entrega_id IS NOT NULL));

-- Bancos: cuotas recibidas por transferencia (por confirmar) y manos enviadas.
ALTER TABLE cuenta_movimientos ADD COLUMN san_recibo_id uuid REFERENCES san_recibos(id);
ALTER TABLE cuenta_movimientos ADD COLUMN san_entrega_id uuid REFERENCES san_entregas(id);
ALTER TABLE cuenta_movimientos DROP CONSTRAINT cuenta_mov_tipo;
ALTER TABLE cuenta_movimientos ADD CONSTRAINT cuenta_mov_tipo CHECK (tipo IN (
  'saldo_inicial', 'venta', 'devolucion', 'transferencia_entrada', 'transferencia_salida',
  'pago', 'cargo', 'interes', 'ingreso', 'reverso', 'remesa',
  'san_cuota',  -- cuotas de un SAN recibidas por transferencia (suma)
  'san_mano'    -- mano de un SAN enviada por transferencia (resta)
));
ALTER TABLE cuenta_movimientos DROP CONSTRAINT cuenta_mov_signo;
ALTER TABLE cuenta_movimientos ADD CONSTRAINT cuenta_mov_signo CHECK (
  (tipo IN ('saldo_inicial', 'venta', 'transferencia_entrada', 'interes', 'ingreso', 'san_cuota') AND signo = 1) OR
  (tipo IN ('devolucion', 'transferencia_salida', 'pago', 'cargo', 'remesa', 'san_mano') AND signo = -1) OR
  (tipo = 'reverso' AND signo IN (1, -1)));
ALTER TABLE cuenta_movimientos DROP CONSTRAINT cuenta_mov_motivo;
ALTER TABLE cuenta_movimientos ADD CONSTRAINT cuenta_mov_motivo CHECK (
  tipo IN ('venta', 'devolucion', 'transferencia_entrada', 'transferencia_salida', 'remesa',
           'san_cuota', 'san_mano')
  OR motivo IS NOT NULL);
ALTER TABLE cuenta_movimientos ADD CONSTRAINT cuenta_mov_san CHECK (
  (tipo = 'san_cuota') = (san_recibo_id IS NOT NULL) AND
  (tipo = 'san_mano') = (san_entrega_id IS NOT NULL));

-- Permisos.
INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('sanes.ver',       'sanes', 'ver',       'Ver los SAN, participantes, pagos y atrasados'),
  ('sanes.gestionar', 'sanes', 'gestionar', 'Crear y configurar SAN, asignar números y fechas'),
  ('sanes.cobrar',    'sanes', 'cobrar',    'Cobrar cuotas del SAN en la oficina'),
  ('sanes.entregar',  'sanes', 'entregar',  'Entregar la mano del SAN');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.modulo = 'sanes'
WHERE r.codigo = 'administrador';

COMMIT;
