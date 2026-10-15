-- ANSCITO 029: base de la contabilidad.
-- * Catálogo de cuentas (plan de cuentas) jerárquico y editable. Se carga un
--   catálogo BASE SUGERIDO para una empresa de servicios en República
--   Dominicana: todas las cuentas quedan "pendientes de validar" hasta que el
--   contador las revise (puede cambiarlas, agregar o desactivar).
-- * Asientos (libro diario) en RD$ con partida doble: la suma de débitos es
--   igual a la de créditos (lo revisa la base de datos al final de cada
--   transacción). Un asiento no se edita ni se borra: se anula con un asiento
--   de reverso.
-- * Períodos (meses): un mes cerrado no acepta asientos.
-- * La contabilidad empieza en una fecha (contabilidad.fecha_inicio) con un
--   asiento de apertura; antes de esa fecha no se registran asientos.
BEGIN;

-- ---------- Catálogo de cuentas ----------
CREATE TABLE cuentas_contables (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo              varchar(20)  NOT NULL UNIQUE,     -- 1, 11, 1101, 110101…
  nombre              varchar(150) NOT NULL,
  tipo                varchar(10)  NOT NULL,            -- activo, pasivo, capital, ingreso, costo, gasto
  naturaleza          varchar(9)   NOT NULL,            -- deudora | acreedora
  padre_id            uuid REFERENCES cuentas_contables(id),
  nivel               int          NOT NULL,
  acepta_movimientos  boolean      NOT NULL DEFAULT false,  -- solo las de detalle llevan asientos
  validada            boolean      NOT NULL DEFAULT false,  -- la revisó el contador
  notas               varchar(500),
  is_active           boolean      NOT NULL DEFAULT true,
  created_by          uuid REFERENCES usuarios(id),
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES usuarios(id),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT cuentas_contables_codigo CHECK (codigo ~ '^[1-9][0-9]{0,19}$'),
  CONSTRAINT cuentas_contables_tipo CHECK (tipo IN ('activo', 'pasivo', 'capital', 'ingreso', 'costo', 'gasto')),
  CONSTRAINT cuentas_contables_naturaleza CHECK (naturaleza IN ('deudora', 'acreedora')),
  CONSTRAINT cuentas_contables_nivel CHECK (nivel BETWEEN 1 AND 10),
  CONSTRAINT cuentas_contables_raiz CHECK ((nivel = 1) = (padre_id IS NULL))
);
CREATE INDEX cuentas_contables_padre_idx ON cuentas_contables (padre_id);

-- Reglas del catálogo: no se borra; una cuenta con hijas no lleva movimientos
-- y una de detalle no tiene hijas; si ya tiene asientos, no se le cambia el
-- código, el tipo, la naturaleza, el padre ni si acepta movimientos.
CREATE FUNCTION cuentas_contables_reglas() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Una cuenta no se borra: se desactiva';
  END IF;
  IF NEW.padre_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM cuentas_contables WHERE id = NEW.padre_id AND acepta_movimientos) THEN
    RAISE EXCEPTION 'La cuenta padre acepta movimientos: no puede tener cuentas debajo';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.acepta_movimientos AND EXISTS (SELECT 1 FROM cuentas_contables WHERE padre_id = NEW.id) THEN
      RAISE EXCEPTION 'La cuenta % tiene cuentas debajo: no puede aceptar movimientos', NEW.codigo;
    END IF;
    IF (NEW.codigo, NEW.tipo, NEW.naturaleza, NEW.padre_id, NEW.acepta_movimientos)
         IS DISTINCT FROM (OLD.codigo, OLD.tipo, OLD.naturaleza, OLD.padre_id, OLD.acepta_movimientos)
       AND EXISTS (SELECT 1 FROM asiento_lineas WHERE cuenta_id = NEW.id) THEN
      RAISE EXCEPTION 'La cuenta % ya tiene asientos: no se le cambia el código, el tipo, la naturaleza, el padre ni si acepta movimientos', OLD.codigo;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------- Períodos ----------
CREATE TABLE periodos_contables (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anio         int         NOT NULL,
  mes          int         NOT NULL,
  estado       varchar(8)  NOT NULL DEFAULT 'abierto',
  cerrado_por  uuid REFERENCES usuarios(id),
  cerrado_en   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT periodos_mes CHECK (mes BETWEEN 1 AND 12 AND anio BETWEEN 2000 AND 2100),
  CONSTRAINT periodos_estado CHECK (estado IN ('abierto', 'cerrado')),
  CONSTRAINT periodos_cierre CHECK ((estado = 'cerrado') = (cerrado_por IS NOT NULL AND cerrado_en IS NOT NULL)),
  UNIQUE (anio, mes)
);

-- ---------- Asientos ----------
INSERT INTO contadores (clave, valor) VALUES ('asientos', 0);

CREATE TABLE asientos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero             bigint        NOT NULL UNIQUE,     -- AS-000001
  fecha              date          NOT NULL,
  concepto           varchar(300)  NOT NULL,
  origen             varchar(20)   NOT NULL DEFAULT 'manual',  -- manual, apertura, reverso, venta, compra…
  documento          varchar(40),                       -- V-000001, CP-000001…
  reverso_de         uuid REFERENCES asientos(id),      -- este asiento anula a otro
  estado             varchar(8)    NOT NULL DEFAULT 'activo',
  anulado_por        uuid REFERENCES usuarios(id),
  anulado_en         timestamptz,
  motivo_anulacion   varchar(500),
  created_by         uuid          NOT NULL REFERENCES usuarios(id),
  created_at         timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT asientos_estado CHECK (estado IN ('activo', 'anulado')),
  CONSTRAINT asientos_anulado CHECK ((estado = 'anulado') =
    (anulado_por IS NOT NULL AND anulado_en IS NOT NULL AND motivo_anulacion IS NOT NULL)),
  CONSTRAINT asientos_reverso CHECK ((origen = 'reverso') = (reverso_de IS NOT NULL))
);
CREATE INDEX asientos_fecha_idx ON asientos (fecha);
CREATE UNIQUE INDEX asientos_un_reverso ON asientos (reverso_de) WHERE reverso_de IS NOT NULL;
CREATE UNIQUE INDEX asientos_una_apertura ON asientos (origen) WHERE origen = 'apertura' AND estado = 'activo';

CREATE TABLE asiento_lineas (
  id                 bigserial PRIMARY KEY,
  asiento_id         uuid          NOT NULL REFERENCES asientos(id),
  cuenta_id          uuid          NOT NULL REFERENCES cuentas_contables(id),
  debito             numeric(14,2) NOT NULL DEFAULT 0,
  credito            numeric(14,2) NOT NULL DEFAULT 0,
  descripcion        varchar(300),
  tercero_id         uuid REFERENCES terceros(id),
  unidad_negocio_id  uuid REFERENCES unidades_negocio(id),   -- línea de negocio (ganancia por línea)
  CONSTRAINT asiento_lineas_montos CHECK (debito >= 0 AND credito >= 0 AND (debito > 0) <> (credito > 0))
);
CREATE INDEX asiento_lineas_asiento_idx ON asiento_lineas (asiento_id);
CREATE INDEX asiento_lineas_cuenta_idx ON asiento_lineas (cuenta_id);

-- (El trigger del catálogo se crea aquí porque mira asiento_lineas.)
CREATE TRIGGER cuentas_contables_reglas BEFORE INSERT OR UPDATE OR DELETE ON cuentas_contables
  FOR EACH ROW EXECUTE FUNCTION cuentas_contables_reglas();

-- La línea va a una cuenta de detalle activa.
CREATE FUNCTION asiento_linea_cuenta() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cuentas_contables WHERE id = NEW.cuenta_id AND acepta_movimientos AND is_active) THEN
    RAISE EXCEPTION 'La cuenta % no acepta movimientos o está desactivada',
      (SELECT codigo FROM cuentas_contables WHERE id = NEW.cuenta_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER asiento_lineas_cuenta BEFORE INSERT ON asiento_lineas
  FOR EACH ROW EXECUTE FUNCTION asiento_linea_cuenta();

-- Partida doble: al terminar la transacción, cada asiento tiene al menos dos
-- líneas y débitos = créditos.
CREATE FUNCTION asiento_cuadra() RETURNS trigger AS $$
DECLARE
  aid uuid;
  d numeric; c numeric; n int;
BEGIN
  IF TG_TABLE_NAME = 'asientos' THEN aid := NEW.id; ELSE aid := NEW.asiento_id; END IF;
  SELECT COALESCE(sum(debito), 0), COALESCE(sum(credito), 0), count(*) INTO d, c, n
  FROM asiento_lineas WHERE asiento_id = aid;
  IF n < 2 OR d <> c OR d = 0 THEN
    RAISE EXCEPTION 'El asiento no cuadra: débitos % y créditos % (% líneas)', d, c, n;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER asientos_cuadran AFTER INSERT ON asientos
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION asiento_cuadra();
CREATE CONSTRAINT TRIGGER asiento_lineas_cuadran AFTER INSERT ON asiento_lineas
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION asiento_cuadra();

-- Fecha: desde el inicio de la contabilidad y en un mes abierto.
CREATE FUNCTION asiento_fecha_valida() RETURNS trigger AS $$
DECLARE
  inicio text := (SELECT valor FROM configuracion WHERE clave = 'contabilidad.fecha_inicio');
BEGIN
  IF inicio IS NULL OR inicio = '' THEN
    RAISE EXCEPTION 'Primero indique la fecha de inicio de la contabilidad';
  END IF;
  IF NEW.fecha < inicio::date THEN
    RAISE EXCEPTION 'La contabilidad empieza el %: no se registran asientos antes', inicio;
  END IF;
  IF EXISTS (SELECT 1 FROM periodos_contables
             WHERE anio = extract(year FROM NEW.fecha) AND mes = extract(month FROM NEW.fecha)
               AND estado = 'cerrado') THEN
    RAISE EXCEPTION 'El mes % está cerrado: no acepta asientos', to_char(NEW.fecha, 'MM/YYYY');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER asientos_fecha BEFORE INSERT ON asientos
  FOR EACH ROW EXECUTE FUNCTION asiento_fecha_valida();

-- Un asiento solo se anula (una vez); las líneas no cambian nunca.
CREATE FUNCTION asiento_solo_anular() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un asiento no se borra: se anula con un asiento de reverso';
  END IF;
  IF OLD.estado = 'anulado' OR NEW.estado <> 'anulado'
     OR (to_jsonb(NEW) - ARRAY['estado', 'anulado_por', 'anulado_en', 'motivo_anulacion'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['estado', 'anulado_por', 'anulado_en', 'motivo_anulacion']) THEN
    RAISE EXCEPTION 'Un asiento solo se puede anular';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER asientos_solo_anular BEFORE UPDATE OR DELETE ON asientos
  FOR EACH ROW EXECUTE FUNCTION asiento_solo_anular();

CREATE FUNCTION asiento_lineas_inmutables() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Las líneas de un asiento no se cambian ni se borran';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER asiento_lineas_no_modificar BEFORE UPDATE OR DELETE ON asiento_lineas
  FOR EACH ROW EXECUTE FUNCTION asiento_lineas_inmutables();

-- ---------- Configuración y permisos ----------
INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('contabilidad.fecha_inicio', '',
   'Fecha desde la que se lleva la contabilidad en el sistema (con un asiento de apertura)');

INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('contabilidad.ver',      'contabilidad', 'ver',      'Ver el catálogo de cuentas, asientos, libros y estados financieros'),
  ('contabilidad.catalogo', 'contabilidad', 'catalogo', 'Crear, editar, validar y desactivar cuentas del catálogo'),
  ('contabilidad.asientos', 'contabilidad', 'asientos', 'Registrar asientos manuales y el de apertura'),
  ('contabilidad.anular',   'contabilidad', 'anular',   'Anular asientos (con un asiento de reverso)'),
  ('contabilidad.cerrar',   'contabilidad', 'cerrar',   'Cerrar meses y fijar la fecha de inicio de la contabilidad');

-- Administrador y contador: todo. Auditor: solo ver.
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.modulo = 'contabilidad'
WHERE r.codigo IN ('administrador', 'contador');
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.codigo = 'contabilidad.ver'
WHERE r.codigo = 'auditor';

-- ---------- Catálogo base sugerido (pendiente de validar por el contador) ----------
-- Cada fila: código, nombre, tipo, naturaleza. El padre y el nivel salen del
-- código (1 → 11 → 1101 → 110101); las de 6 cifras aceptan movimientos.
CREATE TEMP TABLE catalogo_base (codigo text, nombre text, tipo text, naturaleza text) ON COMMIT DROP;
INSERT INTO catalogo_base VALUES
  ('1', 'ACTIVOS', 'activo', 'deudora'),
  ('11', 'Activos corrientes', 'activo', 'deudora'),
  ('1101', 'Efectivo y equivalentes', 'activo', 'deudora'),
  ('110101', 'Caja general (RD$)', 'activo', 'deudora'),
  ('110102', 'Caja en dólares (US$)', 'activo', 'deudora'),
  ('110103', 'Caja chica', 'activo', 'deudora'),
  ('110104', 'Bancos: cuentas corrientes (RD$)', 'activo', 'deudora'),
  ('110105', 'Bancos: cuentas de ahorro (RD$)', 'activo', 'deudora'),
  ('110106', 'Bancos: cuentas en dólares (US$)', 'activo', 'deudora'),
  ('110107', 'Billeteras MonCash / NatCash (HTG)', 'activo', 'deudora'),
  ('110108', 'Efectivo en tránsito (cobros por confirmar)', 'activo', 'deudora'),
  ('1102', 'Cuentas por cobrar', 'activo', 'deudora'),
  ('110201', 'Clientes (ventas a crédito)', 'activo', 'deudora'),
  ('110202', 'Agentes de envíos por cobrar', 'activo', 'deudora'),
  ('110203', 'Otras cuentas por cobrar', 'activo', 'deudora'),
  ('1103', 'Inventarios', 'activo', 'deudora'),
  ('110301', 'Inventario de mercancías', 'activo', 'deudora'),
  ('1104', 'Impuestos a favor', 'activo', 'deudora'),
  ('110401', 'ITBIS pagado en compras (adelantado)', 'activo', 'deudora'),
  ('110402', 'ITBIS que nos retuvieron', 'activo', 'deudora'),
  ('110403', 'ISR que nos retuvieron', 'activo', 'deudora'),
  ('110404', 'Anticipos de ISR', 'activo', 'deudora'),
  ('1105', 'Gastos pagados por adelantado', 'activo', 'deudora'),
  ('110501', 'Gastos pagados por adelantado', 'activo', 'deudora'),
  ('12', 'Activos no corrientes', 'activo', 'deudora'),
  ('1201', 'Propiedad, planta y equipo', 'activo', 'deudora'),
  ('120101', 'Mobiliario y equipo de oficina', 'activo', 'deudora'),
  ('120102', 'Equipos de cómputo', 'activo', 'deudora'),
  ('120103', 'Vehículos', 'activo', 'deudora'),
  ('120104', 'Mejoras en local alquilado', 'activo', 'deudora'),
  ('1202', 'Depreciación acumulada', 'activo', 'acreedora'),
  ('120201', 'Depreciación acumulada', 'activo', 'acreedora'),
  ('1203', 'Otros activos', 'activo', 'deudora'),
  ('120301', 'Depósitos en garantía', 'activo', 'deudora'),
  ('2', 'PASIVOS', 'pasivo', 'acreedora'),
  ('21', 'Pasivos corrientes', 'pasivo', 'acreedora'),
  ('2101', 'Cuentas por pagar', 'pasivo', 'acreedora'),
  ('210101', 'Proveedores', 'pasivo', 'acreedora'),
  ('210102', 'Otras cuentas por pagar', 'pasivo', 'acreedora'),
  ('2102', 'Dinero de terceros', 'pasivo', 'acreedora'),
  ('210201', 'SOL CASH: cuotas de participantes por entregar', 'pasivo', 'acreedora'),
  ('210202', 'Envíos a Haití por pagar a beneficiarios', 'pasivo', 'acreedora'),
  ('210203', 'Anticipos de clientes', 'pasivo', 'acreedora'),
  ('2103', 'Impuestos por pagar', 'pasivo', 'acreedora'),
  ('210301', 'ITBIS cobrado en ventas', 'pasivo', 'acreedora'),
  ('210302', 'ITBIS retenido a proveedores (por pagar)', 'pasivo', 'acreedora'),
  ('210303', 'ISR retenido a proveedores (por pagar)', 'pasivo', 'acreedora'),
  ('210304', 'ISR por pagar', 'pasivo', 'acreedora'),
  ('2104', 'Obligaciones laborales', 'pasivo', 'acreedora'),
  ('210401', 'Sueldos por pagar', 'pasivo', 'acreedora'),
  ('210402', 'TSS por pagar', 'pasivo', 'acreedora'),
  ('210403', 'INFOTEP por pagar', 'pasivo', 'acreedora'),
  ('210404', 'Regalía pascual por pagar', 'pasivo', 'acreedora'),
  ('2105', 'Préstamos a corto plazo', 'pasivo', 'acreedora'),
  ('210501', 'Préstamos bancarios a corto plazo', 'pasivo', 'acreedora'),
  ('22', 'Pasivos no corrientes', 'pasivo', 'acreedora'),
  ('2201', 'Préstamos a largo plazo', 'pasivo', 'acreedora'),
  ('220101', 'Préstamos bancarios a largo plazo', 'pasivo', 'acreedora'),
  ('3', 'CAPITAL', 'capital', 'acreedora'),
  ('31', 'Patrimonio', 'capital', 'acreedora'),
  ('3101', 'Capital', 'capital', 'acreedora'),
  ('310101', 'Capital aportado por el dueño', 'capital', 'acreedora'),
  ('310102', 'Retiros del dueño', 'capital', 'deudora'),
  ('3102', 'Resultados', 'capital', 'acreedora'),
  ('310201', 'Resultados acumulados', 'capital', 'acreedora'),
  ('310202', 'Resultado del ejercicio', 'capital', 'acreedora'),
  ('310203', 'Reserva legal', 'capital', 'acreedora'),
  ('4', 'INGRESOS', 'ingreso', 'acreedora'),
  ('41', 'Ingresos de operación', 'ingreso', 'acreedora'),
  ('4101', 'Ventas', 'ingreso', 'acreedora'),
  ('410101', 'Ventas de mercancías', 'ingreso', 'acreedora'),
  ('410102', 'Ventas de servicios (SCITO SERVICE)', 'ingreso', 'acreedora'),
  ('410103', 'Devoluciones y descuentos en ventas', 'ingreso', 'deudora'),
  ('4102', 'Comisiones ganadas', 'ingreso', 'acreedora'),
  ('410201', 'Comisiones por envíos (SCITO TRANSFER)', 'ingreso', 'acreedora'),
  ('410202', 'Comisiones de SOL CASH', 'ingreso', 'acreedora'),
  ('410203', 'Comisiones MonCash / NatCash', 'ingreso', 'acreedora'),
  ('42', 'Otros ingresos', 'ingreso', 'acreedora'),
  ('4201', 'Otros ingresos', 'ingreso', 'acreedora'),
  ('420101', 'Recargos por atraso (cuentas por cobrar)', 'ingreso', 'acreedora'),
  ('420102', 'Moras de SOL CASH', 'ingreso', 'acreedora'),
  ('420103', 'Intereses ganados', 'ingreso', 'acreedora'),
  ('420104', 'Diferencia cambiaria ganada', 'ingreso', 'acreedora'),
  ('420105', 'Otros ingresos', 'ingreso', 'acreedora'),
  ('5', 'COSTOS', 'costo', 'deudora'),
  ('51', 'Costo de ventas', 'costo', 'deudora'),
  ('5101', 'Costo de ventas', 'costo', 'deudora'),
  ('510101', 'Costo de mercancías vendidas', 'costo', 'deudora'),
  ('510102', 'Costo de servicios prestados', 'costo', 'deudora'),
  ('510103', 'Comisiones pagadas a agentes de envíos', 'costo', 'deudora'),
  ('6', 'GASTOS', 'gasto', 'deudora'),
  ('61', 'Gastos de operación', 'gasto', 'deudora'),
  ('6101', 'Gastos de personal', 'gasto', 'deudora'),
  ('610101', 'Sueldos y salarios', 'gasto', 'deudora'),
  ('610102', 'Aportes a la TSS (empleador)', 'gasto', 'deudora'),
  ('610103', 'INFOTEP', 'gasto', 'deudora'),
  ('610104', 'Regalía pascual', 'gasto', 'deudora'),
  ('610105', 'Bonificaciones', 'gasto', 'deudora'),
  ('6102', 'Gastos generales y administrativos', 'gasto', 'deudora'),
  ('610201', 'Alquiler', 'gasto', 'deudora'),
  ('610202', 'Energía eléctrica', 'gasto', 'deudora'),
  ('610203', 'Agua', 'gasto', 'deudora'),
  ('610204', 'Teléfono e internet', 'gasto', 'deudora'),
  ('610205', 'Transporte', 'gasto', 'deudora'),
  ('610206', 'Alimentación', 'gasto', 'deudora'),
  ('610207', 'Limpieza', 'gasto', 'deudora'),
  ('610208', 'Mantenimiento y reparaciones', 'gasto', 'deudora'),
  ('610209', 'Materiales de oficina y compras menores', 'gasto', 'deudora'),
  ('610210', 'Publicidad', 'gasto', 'deudora'),
  ('610211', 'Honorarios profesionales', 'gasto', 'deudora'),
  ('610212', 'Seguros', 'gasto', 'deudora'),
  ('610213', 'Depreciación', 'gasto', 'deudora'),
  ('610214', 'Otros gastos', 'gasto', 'deudora'),
  ('6103', 'Gastos financieros', 'gasto', 'deudora'),
  ('610301', 'Comisiones y cargos bancarios', 'gasto', 'deudora'),
  ('610302', 'Comisiones por cambio de moneda', 'gasto', 'deudora'),
  ('610303', 'Intereses pagados', 'gasto', 'deudora'),
  ('610304', 'Diferencia cambiaria perdida', 'gasto', 'deudora'),
  ('6104', 'Impuestos y tasas', 'gasto', 'deudora'),
  ('610401', 'ITBIS no deducible (llevado al gasto)', 'gasto', 'deudora'),
  ('610402', 'Otros impuestos y tasas', 'gasto', 'deudora');

-- Se insertan de lo general a lo particular (el padre ya existe).
INSERT INTO cuentas_contables (codigo, nombre, tipo, naturaleza, padre_id, nivel, acepta_movimientos, notas)
SELECT b.codigo, b.nombre, b.tipo, b.naturaleza, NULL,
       1, false, 'Catálogo base sugerido: pendiente de validar por el contador'
FROM catalogo_base b WHERE length(b.codigo) = 1;
INSERT INTO cuentas_contables (codigo, nombre, tipo, naturaleza, padre_id, nivel, acepta_movimientos, notas)
SELECT b.codigo, b.nombre, b.tipo, b.naturaleza, p.id, 2, false,
       'Catálogo base sugerido: pendiente de validar por el contador'
FROM catalogo_base b JOIN cuentas_contables p ON p.codigo = left(b.codigo, 1)
WHERE length(b.codigo) = 2;
INSERT INTO cuentas_contables (codigo, nombre, tipo, naturaleza, padre_id, nivel, acepta_movimientos, notas)
SELECT b.codigo, b.nombre, b.tipo, b.naturaleza, p.id, 3, false,
       'Catálogo base sugerido: pendiente de validar por el contador'
FROM catalogo_base b JOIN cuentas_contables p ON p.codigo = left(b.codigo, 2)
WHERE length(b.codigo) = 4;
INSERT INTO cuentas_contables (codigo, nombre, tipo, naturaleza, padre_id, nivel, acepta_movimientos, notas)
SELECT b.codigo, b.nombre, b.tipo, b.naturaleza, p.id, 4, true,
       'Catálogo base sugerido: pendiente de validar por el contador'
FROM catalogo_base b JOIN cuentas_contables p ON p.codigo = left(b.codigo, 4)
WHERE length(b.codigo) = 6;

COMMIT;
