-- ANSCITO 041: nómina (primera parte, sin TSS ni ISR).
-- Decisiones del dueño:
-- * Cada empleado tiene su frecuencia de pago (semanal, quincenal o
--   mensual) y un sueldo MENSUAL; el sistema lo divide según la frecuencia.
-- * Todavía ningún empleado está en la TSS: no hay descuentos de ley. La
--   columna en_tss queda lista para activarlos después.
-- * Se paga en efectivo (caja abierta) o por transferencia (cuenta en pesos).
-- * Adelantos y préstamos: al darlos se fija la cuota que se descuenta en
--   cada pago; se puede cambiar en cada nómina.
-- * Comisiones, bonos, horas extra (35 % y 100 % de recargo), regalía
--   pascual y vacaciones.
-- Los valores de ley (recargos, días, divisores) van en nomina_parametros con
-- fecha de vigencia: el contador debe validarlos antes de usar el sistema real.
-- Nada se borra: los borradores se descartan y lo pagado se anula con motivo.
BEGIN;

-- ---------- Permisos ----------
INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('nomina.ver',        'nomina', 'ver',        'Ver empleados, nóminas y adelantos'),
  ('nomina.empleados',  'nomina', 'empleados',  'Crear, editar y desactivar empleados'),
  ('nomina.preparar',   'nomina', 'preparar',   'Preparar nóminas: anotar horas extra, comisiones, bonos y descuentos'),
  ('nomina.pagar',      'nomina', 'pagar',      'Pagar y anular nóminas'),
  ('nomina.adelantos',  'nomina', 'adelantos',  'Dar y anular adelantos y préstamos a empleados'),
  ('nomina.parametros', 'nomina', 'parametros', 'Cambiar los valores de ley de la nómina (recargos, días, divisores)');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.codigo IN ('nomina.ver', 'nomina.empleados', 'nomina.preparar',
                                'nomina.pagar', 'nomina.adelantos', 'nomina.parametros')
WHERE r.codigo = 'administrador';

INSERT INTO contadores (clave, valor) VALUES
  ('empleados', 0), ('nominas', 0), ('adelantos', 0)
ON CONFLICT (clave) DO NOTHING;

-- ---------- Empleados ----------
CREATE TABLE empleados (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  numero          bigint        NOT NULL UNIQUE,              -- EMP-0001
  nombre          varchar(120)  NOT NULL,
  documento       varchar(30),                                -- cédula o pasaporte
  telefono        varchar(30),
  direccion       varchar(300),
  cargo           varchar(80),
  fecha_ingreso   date          NOT NULL,
  frecuencia      varchar(10)   NOT NULL,                     -- semanal | quincenal | mensual
  sueldo_mensual  numeric(14,2) NOT NULL,
  forma_pago      varchar(10)   NOT NULL DEFAULT 'efectivo',  -- efectivo | banco
  cuenta_empleado varchar(120),                               -- banco y número del empleado (para transferirle)
  en_tss          boolean       NOT NULL DEFAULT false,       -- todavía sin uso (decisión del dueño)
  notas           varchar(500),
  is_active       boolean       NOT NULL DEFAULT true,
  fecha_salida    date,
  created_by      uuid          NOT NULL REFERENCES usuarios(id),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT empleados_frecuencia CHECK (frecuencia IN ('semanal', 'quincenal', 'mensual')),
  CONSTRAINT empleados_sueldo CHECK (sueldo_mensual > 0),
  CONSTRAINT empleados_forma CHECK (forma_pago IN ('efectivo', 'banco')),
  CONSTRAINT empleados_salida CHECK (fecha_salida IS NULL OR fecha_salida >= fecha_ingreso)
);
CREATE UNIQUE INDEX empleados_documento_unico ON empleados (documento) WHERE documento IS NOT NULL;

-- ---------- Valores de ley (con fecha de vigencia) ----------
CREATE TABLE nomina_parametros (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  clave          varchar(30)   NOT NULL,
  valor          numeric(10,4) NOT NULL,
  vigente_desde  date          NOT NULL,
  motivo         varchar(300)  NOT NULL,
  created_by     uuid REFERENCES usuarios(id),
  created_at     timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT nomina_parametros_clave CHECK (clave IN (
    'dias_mes',            -- divisor del salario diario (sueldo mensual ÷ 23.83)
    'horas_dia',           -- horas de la jornada (valor de la hora = diario ÷ 8)
    'semanas_mes',         -- para pagar por semana (mensual ÷ 4.3333)
    'recargo_extra',       -- % de recargo de las horas extra (de 44 a 68 por semana)
    'recargo_extra_alto',  -- % de recargo pasadas las 68 horas por semana
    'vacaciones_dias',     -- días de vacaciones pagadas (1 a 5 años de servicio)
    'vacaciones_dias_5'    -- días de vacaciones con 5 años o más
  )),
  CONSTRAINT nomina_parametros_valor CHECK (valor > 0),
  CONSTRAINT nomina_parametros_unico UNIQUE (clave, vigente_desde)
);
INSERT INTO nomina_parametros (clave, valor, vigente_desde, motivo)
SELECT p.clave, p.valor, DATE '2000-01-01',
       'Valor inicial (Código de Trabajo); el contador debe validarlo'
FROM (VALUES
  ('dias_mes', 23.83), ('horas_dia', 8), ('semanas_mes', 4.3333),
  ('recargo_extra', 35), ('recargo_extra_alto', 100),
  ('vacaciones_dias', 14), ('vacaciones_dias_5', 18)
) AS p(clave, valor);

-- ---------- Nóminas ----------
-- regular: sueldo del período (+ extras, comisiones, bonos − descuentos).
-- regalia: salario de Navidad. vacaciones: días de vacaciones pagados.
CREATE TABLE nominas (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  numero            bigint        NOT NULL UNIQUE,              -- NOM-000001
  tipo              varchar(12)   NOT NULL,
  frecuencia        varchar(10),                                -- solo en las regulares
  desde             date          NOT NULL,
  hasta             date          NOT NULL,
  estado            varchar(10)   NOT NULL DEFAULT 'borrador',  -- borrador | pagada | anulada | descartada
  total             numeric(14,2) NOT NULL DEFAULT 0,           -- suma de los netos
  notas             varchar(500),
  fecha_pago        date,
  pagada_por        uuid REFERENCES usuarios(id),
  pagada_en         timestamptz,
  anulada_por       uuid REFERENCES usuarios(id),
  anulada_en        timestamptz,
  motivo_anulacion  varchar(500),
  created_by        uuid          NOT NULL REFERENCES usuarios(id),
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT nominas_tipo CHECK (tipo IN ('regular', 'regalia', 'vacaciones')),
  CONSTRAINT nominas_frecuencia CHECK (
    (tipo = 'regular' AND frecuencia IN ('semanal', 'quincenal', 'mensual'))
    OR (tipo <> 'regular' AND frecuencia IS NULL)),
  CONSTRAINT nominas_periodo CHECK (desde <= hasta),
  CONSTRAINT nominas_estado CHECK (estado IN ('borrador', 'pagada', 'anulada', 'descartada')),
  CONSTRAINT nominas_total CHECK (total >= 0),
  CONSTRAINT nominas_pagada CHECK ((estado IN ('pagada', 'anulada')) =
    (fecha_pago IS NOT NULL AND pagada_por IS NOT NULL AND pagada_en IS NOT NULL)),
  CONSTRAINT nominas_anulada CHECK ((estado IN ('anulada', 'descartada')) =
    (anulada_por IS NOT NULL AND anulada_en IS NOT NULL AND motivo_anulacion IS NOT NULL))
);
CREATE INDEX nominas_periodo_idx ON nominas (desde, hasta);

CREATE TABLE nomina_lineas (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  nomina_id         uuid          NOT NULL REFERENCES nominas(id),
  empleado_id       uuid          NOT NULL REFERENCES empleados(id),
  sueldo_mensual    numeric(14,2) NOT NULL,           -- el del empleado al preparar
  forma_pago        varchar(10)   NOT NULL,           -- efectivo | banco
  dias              numeric(6,2),                     -- vacaciones: días pagados
  sueldo            numeric(14,2) NOT NULL,           -- sueldo del período, regalía o vacaciones
  horas_extra       numeric(7,2)  NOT NULL DEFAULT 0, -- con el recargo normal (35 %)
  horas_extra_alto  numeric(7,2)  NOT NULL DEFAULT 0, -- con el recargo alto (100 %)
  monto_extra       numeric(14,2) NOT NULL DEFAULT 0,
  comisiones        numeric(14,2) NOT NULL DEFAULT 0,
  bonos             numeric(14,2) NOT NULL DEFAULT 0,
  adelantos         numeric(14,2) NOT NULL DEFAULT 0, -- descuento de adelantos y préstamos
  otros_descuentos  numeric(14,2) NOT NULL DEFAULT 0,
  motivo_descuento  varchar(200),
  neto              numeric(14,2) NOT NULL,
  notas             varchar(300),
  updated_by        uuid          NOT NULL REFERENCES usuarios(id),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT nomina_lineas_unica UNIQUE (nomina_id, empleado_id),
  CONSTRAINT nomina_lineas_forma CHECK (forma_pago IN ('efectivo', 'banco')),
  CONSTRAINT nomina_lineas_positivos CHECK (sueldo >= 0 AND horas_extra >= 0 AND horas_extra_alto >= 0
    AND monto_extra >= 0 AND comisiones >= 0 AND bonos >= 0 AND adelantos >= 0 AND otros_descuentos >= 0),
  CONSTRAINT nomina_lineas_neto CHECK (
    neto = sueldo + monto_extra + comisiones + bonos - adelantos - otros_descuentos AND neto >= 0),
  CONSTRAINT nomina_lineas_motivo CHECK (otros_descuentos = 0 OR motivo_descuento IS NOT NULL)
);
CREATE INDEX nomina_lineas_empleado_idx ON nomina_lineas (empleado_id);

-- ---------- Adelantos y préstamos ----------
CREATE TABLE empleado_adelantos (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  numero            bigint        NOT NULL UNIQUE,              -- ADL-000001
  empleado_id       uuid          NOT NULL REFERENCES empleados(id),
  fecha             date          NOT NULL,
  monto             numeric(14,2) NOT NULL,
  cuota             numeric(14,2) NOT NULL,                     -- descuento sugerido en cada pago
  forma             varchar(10)   NOT NULL,                     -- efectivo | banco
  motivo            varchar(300)  NOT NULL,
  estado            varchar(10)   NOT NULL DEFAULT 'activo',    -- activo | anulado
  anulado_por       uuid REFERENCES usuarios(id),
  anulado_en        timestamptz,
  motivo_anulacion  varchar(500),
  created_by        uuid          NOT NULL REFERENCES usuarios(id),
  created_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT adelantos_montos CHECK (monto > 0 AND cuota > 0 AND cuota <= monto),
  CONSTRAINT adelantos_forma CHECK (forma IN ('efectivo', 'banco')),
  CONSTRAINT adelantos_estado CHECK (estado IN ('activo', 'anulado')),
  CONSTRAINT adelantos_anulado CHECK ((estado = 'anulado') =
    (anulado_por IS NOT NULL AND anulado_en IS NOT NULL AND motivo_anulacion IS NOT NULL))
);
CREATE INDEX adelantos_empleado_idx ON empleado_adelantos (empleado_id);

-- Cuánto de cada adelanto se descontó en cada pago (se guarda al pagar la
-- nómina; si la nómina se anula, deja de contar).
CREATE TABLE adelanto_descuentos (
  adelanto_id      uuid          NOT NULL REFERENCES empleado_adelantos(id),
  nomina_linea_id  uuid          NOT NULL REFERENCES nomina_lineas(id),
  monto            numeric(14,2) NOT NULL CHECK (monto > 0),
  created_at       timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (adelanto_id, nomina_linea_id)
);

-- Lo pagado no se toca: una nómina pagada solo pasa a anulada, y sus líneas
-- solo cambian en borrador. Nada se borra.
CREATE FUNCTION nominas_proteger() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las nóminas no se borran: se descartan o se anulan';
  END IF;
  IF OLD.estado IN ('anulada', 'descartada') THEN
    RAISE EXCEPTION 'Una nómina anulada o descartada no se cambia';
  END IF;
  IF OLD.estado = 'pagada' AND NEW.estado <> 'anulada' THEN
    RAISE EXCEPTION 'Una nómina pagada solo se puede anular';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER nominas_proteger BEFORE UPDATE OR DELETE ON nominas
  FOR EACH ROW EXECUTE FUNCTION nominas_proteger();

CREATE FUNCTION nomina_lineas_proteger() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF (SELECT estado FROM nominas WHERE id = OLD.nomina_id) <> 'borrador' THEN
      RAISE EXCEPTION 'La nómina ya no está en borrador';
    END IF;
    RETURN OLD;
  END IF;
  IF (SELECT estado FROM nominas WHERE id = NEW.nomina_id) <> 'borrador' THEN
    RAISE EXCEPTION 'La nómina ya no está en borrador';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER nomina_lineas_proteger BEFORE INSERT OR UPDATE OR DELETE ON nomina_lineas
  FOR EACH ROW EXECUTE FUNCTION nomina_lineas_proteger();

CREATE FUNCTION adelantos_proteger() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los adelantos no se borran: se anulan';
  END IF;
  IF OLD.estado = 'anulado' THEN
    RAISE EXCEPTION 'Un adelanto anulado no se cambia';
  END IF;
  IF (NEW.empleado_id, NEW.fecha, NEW.monto, NEW.forma, NEW.motivo, NEW.numero)
     IS DISTINCT FROM (OLD.empleado_id, OLD.fecha, OLD.monto, OLD.forma, OLD.motivo, OLD.numero) THEN
    RAISE EXCEPTION 'De un adelanto solo cambia la cuota o se anula';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER adelantos_proteger BEFORE UPDATE OR DELETE ON empleado_adelantos
  FOR EACH ROW EXECUTE FUNCTION adelantos_proteger();

CREATE FUNCTION adelanto_descuentos_proteger() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Los descuentos de adelantos no se cambian ni se borran';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER adelanto_descuentos_proteger BEFORE UPDATE OR DELETE ON adelanto_descuentos
  FOR EACH ROW EXECUTE FUNCTION adelanto_descuentos_proteger();

-- ---------- Caja y bancos ----------
-- Caja: "nomina" = pago a empleados (nómina o adelanto, resta);
-- "nomina_reverso" = se anuló y el dinero vuelve (suma).
-- Bancos: "nomina" (resta); si se anula, el "reverso" de siempre.
ALTER TABLE caja_movimientos ADD COLUMN nomina_id uuid REFERENCES nominas(id);
ALTER TABLE caja_movimientos ADD COLUMN adelanto_id uuid REFERENCES empleado_adelantos(id);
ALTER TABLE caja_movimientos DROP CONSTRAINT caja_mov_tipo;
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_mov_tipo CHECK (tipo IN (
  'venta', 'devolucion', 'gasto', 'retiro', 'ingreso', 'deposito', 'desde_cuenta',
  'san_cuota', 'san_mano', 'compra', 'compra_reverso', 'abono_credito', 'abono_anulado',
  'cambio', 'cambio_reverso',
  'nomina',          -- pago a empleados: nómina o adelanto (resta)
  'nomina_reverso'   -- se anuló ese pago y el dinero vuelve (suma)
));
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_mov_nomina CHECK (
  (tipo IN ('nomina', 'nomina_reverso')) = ((nomina_id IS NOT NULL) <> (adelanto_id IS NOT NULL))
  AND (tipo IN ('nomina', 'nomina_reverso') OR (nomina_id IS NULL AND adelanto_id IS NULL)));

ALTER TABLE cuenta_movimientos ADD COLUMN nomina_id uuid REFERENCES nominas(id);
ALTER TABLE cuenta_movimientos ADD COLUMN adelanto_id uuid REFERENCES empleado_adelantos(id);
ALTER TABLE cuenta_movimientos DROP CONSTRAINT cuenta_mov_tipo;
ALTER TABLE cuenta_movimientos ADD CONSTRAINT cuenta_mov_tipo CHECK (tipo IN (
  'saldo_inicial', 'venta', 'devolucion', 'transferencia_entrada', 'transferencia_salida',
  'pago', 'cargo', 'interes', 'ingreso', 'reverso', 'remesa', 'san_cuota', 'san_mano', 'compra',
  'abono_credito',
  'nomina'           -- pago a empleados: nómina o adelanto (resta)
));
ALTER TABLE cuenta_movimientos DROP CONSTRAINT cuenta_mov_signo;
ALTER TABLE cuenta_movimientos ADD CONSTRAINT cuenta_mov_signo CHECK (
  (tipo IN ('saldo_inicial', 'venta', 'transferencia_entrada', 'interes', 'ingreso', 'san_cuota', 'abono_credito') AND signo = 1) OR
  (tipo IN ('devolucion', 'transferencia_salida', 'pago', 'cargo', 'remesa', 'san_mano', 'compra', 'nomina') AND signo = -1) OR
  (tipo = 'reverso' AND signo IN (1, -1)));
ALTER TABLE cuenta_movimientos ADD CONSTRAINT cuenta_mov_nomina CHECK (
  (tipo <> 'nomina' OR ((nomina_id IS NOT NULL) <> (adelanto_id IS NOT NULL)))
  AND ((nomina_id IS NULL AND adelanto_id IS NULL) OR tipo IN ('nomina', 'reverso')));

-- ---------- Contabilidad ----------
-- Cuentas nuevas (si no existen ya): adelantos a empleados y vacaciones.
INSERT INTO cuentas_contables (codigo, nombre, tipo, naturaleza, padre_id, nivel, acepta_movimientos, notas)
SELECT n.codigo, n.nombre, n.tipo, n.naturaleza, p.id, p.nivel + 1, true, 'Creada por la migración 041 (nómina)'
FROM (VALUES
  ('110204', 'Adelantos y préstamos a empleados', 'activo', 'deudora', '1102'),
  ('610106', 'Vacaciones', 'gasto', 'deudora', '6101')
) AS n(codigo, nombre, tipo, naturaleza, padre)
JOIN cuentas_contables p ON p.codigo = n.padre
WHERE NOT EXISTS (SELECT 1 FROM cuentas_contables x WHERE x.codigo = n.codigo);

-- Reglas: a qué cuenta va cada parte de la nómina (se pueden cambiar en
-- Contabilidad → Reglas). Pendiente de validar con el contador.
INSERT INTO contabilidad_reglas (clave, nombre, descripcion, orden, cuenta_id)
SELECT r.clave, r.nombre, r.descripcion, r.orden, c.id
FROM (VALUES
  ('sueldos',             'Sueldos y salarios',       'Nómina: sueldo del período y horas extra (los otros descuentos lo rebajan)', 70, '610101'),
  ('bonificaciones',      'Comisiones y bonos de empleados', 'Nómina: comisiones y bonos de los empleados',              71, '610105'),
  ('regalia',             'Regalía pascual',          'Nómina de regalía (salario de Navidad)',                                  72, '610104'),
  ('vacaciones',          'Vacaciones',               'Nómina de vacaciones',                                                    73, '610106'),
  ('adelantos_empleados', 'Adelantos a empleados',    'Adelantos y préstamos a empleados (lo que deben; se rebaja al descontarlos)', 74, '110204')
) AS r(clave, nombre, descripcion, orden, codigo)
JOIN cuentas_contables c ON c.codigo = r.codigo
ON CONFLICT (clave) DO NOTHING;

COMMIT;
