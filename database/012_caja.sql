-- ANSCITO 012: caja (cajas fijas, sesiones, movimientos y cierre con arqueo)
-- Todo se ejecuta como una sola operación: si algo falla, no se crea nada.
BEGIN;

-- Cajas fijas por sucursal ("Caja 1", "Caja 2"…). Lista configurable.
CREATE TABLE cajas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id  uuid         NOT NULL REFERENCES sucursales(id),
  codigo       varchar(20)  NOT NULL UNIQUE,
  nombre       varchar(60)  NOT NULL,
  is_active    boolean      NOT NULL DEFAULT true,
  created_by   uuid REFERENCES usuarios(id),
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT cajas_codigo_formato CHECK (codigo ~ '^[A-Z0-9_-]{2,20}$')
);
CREATE UNIQUE INDEX cajas_nombre_uq ON cajas (sucursal_id, lower(nombre));

INSERT INTO cajas (sucursal_id, codigo, nombre)
SELECT id, 'CAJA-1', 'Caja 1' FROM sucursales WHERE es_principal;

-- Categorías de gasto: lista configurable. Previsto: cuenta contable.
CREATE TABLE categorias_gasto (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo              varchar(30)  NOT NULL UNIQUE,
  nombre              varchar(60)  NOT NULL,
  orden               integer      NOT NULL DEFAULT 0,
  cuenta_contable_id  uuid,
  is_active           boolean      NOT NULL DEFAULT true,
  created_at          timestamptz  NOT NULL DEFAULT now()
);
INSERT INTO categorias_gasto (codigo, nombre, orden) VALUES
  ('compras_menores', 'Compras menores', 1),
  ('transporte',      'Transporte',      2),
  ('alimentacion',    'Alimentación',    3),
  ('limpieza',        'Limpieza',        4),
  ('mantenimiento',   'Mantenimiento',   5),
  ('otros',           'Otros',           6);

-- Qué formas de pago mueven efectivo de la caja.
ALTER TABLE formas_pago ADD COLUMN usa_caja boolean NOT NULL DEFAULT false;
UPDATE formas_pago SET usa_caja = true WHERE codigo = 'efectivo';

-- Denominaciones para el conteo del cierre (billetes y monedas de RD$).
INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('caja.denominaciones', '2000,1000,500,200,100,50,25,10,5,1',
   'Billetes y monedas (RD$) para contar la caja al cerrarla');

INSERT INTO contadores (clave, valor) VALUES ('caja_sesiones', 0);

-- Sesiones: se abren con un fondo y se cierran contando. No se reabren.
CREATE TABLE caja_sesiones (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero             bigint        NOT NULL UNIQUE,
  caja_id            uuid          NOT NULL REFERENCES cajas(id),
  estado             varchar(10)   NOT NULL DEFAULT 'abierta',
  fondo_inicial      numeric(14,2) NOT NULL,
  abierta_por        uuid          NOT NULL REFERENCES usuarios(id),
  abierta_en         timestamptz   NOT NULL DEFAULT now(),
  cerrada_por        uuid REFERENCES usuarios(id),
  cerrada_en         timestamptz,
  esperado           numeric(14,2),  -- lo que el sistema calcula al cerrar
  contado            numeric(14,2),  -- lo que el cajero contó
  diferencia         numeric(14,2),  -- contado − esperado (+ sobra, − falta)
  conteo             jsonb,          -- cantidad por billete/moneda
  motivo_diferencia  text,
  notas              text,
  CONSTRAINT caja_sesiones_estado CHECK (estado IN ('abierta', 'cerrada')),
  CONSTRAINT caja_sesiones_fondo CHECK (fondo_inicial >= 0),
  CONSTRAINT caja_sesiones_cierre_completo CHECK (
    (estado = 'cerrada') = (cerrada_en IS NOT NULL AND cerrada_por IS NOT NULL
      AND esperado IS NOT NULL AND contado IS NOT NULL AND diferencia IS NOT NULL)),
  CONSTRAINT caja_sesiones_diferencia CHECK (diferencia IS NULL OR diferencia = contado - esperado),
  CONSTRAINT caja_sesiones_contado CHECK (contado IS NULL OR contado >= 0),
  CONSTRAINT caja_sesiones_motivo CHECK (
    diferencia IS NULL OR diferencia = 0 OR motivo_diferencia IS NOT NULL)
);
-- Una sola sesión abierta por caja.
CREATE UNIQUE INDEX caja_sesiones_una_abierta ON caja_sesiones (caja_id)
  WHERE estado = 'abierta';
CREATE INDEX caja_sesiones_caja_idx ON caja_sesiones (caja_id, abierta_en DESC);

-- Movimientos de dinero: solo se agregan, nunca se modifican ni borran.
CREATE TABLE caja_movimientos (
  id                  bigserial PRIMARY KEY,
  sesion_id           uuid          NOT NULL REFERENCES caja_sesiones(id),
  tipo                varchar(12)   NOT NULL,
  monto               numeric(14,2) NOT NULL,
  venta_id            uuid REFERENCES ventas(id),
  categoria_gasto_id  uuid REFERENCES categorias_gasto(id),
  comprobante         varchar(30),
  motivo              text,
  usuario_id          uuid          NOT NULL REFERENCES usuarios(id),
  created_at          timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT caja_mov_tipo CHECK (tipo IN (
    'venta',       -- cobro en efectivo (suma)
    'devolucion',  -- efectivo devuelto por una venta anulada (resta)
    'gasto',       -- resta
    'retiro',      -- resta
    'ingreso'      -- suma
  )),
  CONSTRAINT caja_mov_monto CHECK (monto > 0),
  CONSTRAINT caja_mov_venta CHECK ((tipo IN ('venta', 'devolucion')) = (venta_id IS NOT NULL)),
  CONSTRAINT caja_mov_gasto CHECK ((tipo = 'gasto') = (categoria_gasto_id IS NOT NULL)),
  CONSTRAINT caja_mov_motivo CHECK (tipo IN ('venta', 'devolucion') OR motivo IS NOT NULL)
);
CREATE INDEX caja_mov_sesion_idx ON caja_movimientos (sesion_id, created_at);
CREATE INDEX caja_mov_venta_idx ON caja_movimientos (venta_id);

CREATE FUNCTION caja_movimientos_inmutables() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Los movimientos de caja no se pueden modificar ni borrar';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER caja_movimientos_no_modificar
  BEFORE UPDATE OR DELETE ON caja_movimientos
  FOR EACH ROW EXECUTE FUNCTION caja_movimientos_inmutables();

-- Permisos.
INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('caja.ver',         'caja', 'ver',         'Ver cajas, sesiones y movimientos'),
  ('caja.abrir',       'caja', 'abrir',       'Abrir una sesión de caja'),
  ('caja.cerrar',      'caja', 'cerrar',      'Cerrar y cuadrar una sesión de caja'),
  ('caja.movimientos', 'caja', 'movimientos', 'Registrar gastos, retiros e ingresos de caja'),
  ('caja.gestionar',   'caja', 'gestionar',   'Crear y editar cajas y categorías de gasto');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.modulo = 'caja'
WHERE r.codigo = 'administrador';

COMMIT;
