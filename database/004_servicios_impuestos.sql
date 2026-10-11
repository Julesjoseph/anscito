-- ANSCITO 004: catálogo de servicios e impuestos
-- Todo se ejecuta como una sola operación: si algo falla, no se crea nada.
BEGIN;

-- Impuestos (ITBIS, Exento…). La tasa no vive aquí sino en impuesto_tasas,
-- con fechas de vigencia: cuando la tasa cambie se agrega una fila nueva
-- y los servicios siguen apuntando al mismo impuesto.
CREATE TABLE impuestos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo      varchar(30)  NOT NULL UNIQUE,
  nombre      varchar(100) NOT NULL,
  is_active   boolean      NOT NULL DEFAULT true,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT impuestos_codigo_formato CHECK (codigo ~ '^[a-z0-9_]{2,30}$')
);

CREATE TABLE impuesto_tasas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  impuesto_id    uuid         NOT NULL REFERENCES impuestos(id),
  tasa           numeric(5,2) NOT NULL,
  vigente_desde  date         NOT NULL,
  vigente_hasta  date,
  created_by     uuid REFERENCES usuarios(id),
  created_at     timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT impuesto_tasas_rango CHECK (tasa >= 0 AND tasa <= 100),
  CONSTRAINT impuesto_tasas_fechas
    CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
  UNIQUE (impuesto_id, vigente_desde)
);

-- Listas configurables (se pueden ampliar sin cambiar el código).
CREATE TABLE unidades_negocio (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo      varchar(30)  NOT NULL UNIQUE,
  nombre      varchar(100) NOT NULL,
  is_active   boolean      NOT NULL DEFAULT true,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE unidades_medida (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo      varchar(30)  NOT NULL UNIQUE,
  nombre      varchar(50)  NOT NULL,
  is_active   boolean      NOT NULL DEFAULT true,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);

-- Catálogo de servicios. Es solo el precio de lista: una venta futura debe
-- copiar precio, costo y tasa vigentes al momento de vender.
CREATE TABLE servicios (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo               varchar(30)   NOT NULL,
  nombre               varchar(150)  NOT NULL,
  descripcion          text,
  unidad_negocio_id    uuid          NOT NULL REFERENCES unidades_negocio(id),
  -- Por ahora solo servicios propios; los pagos de terceros tendrán su módulo.
  tipo                 varchar(20)   NOT NULL DEFAULT 'propio',
  unidad_medida_id     uuid          NOT NULL REFERENCES unidades_medida(id),
  precio               numeric(14,2) NOT NULL,
  costo                numeric(14,2),
  -- "Exento" = no aplica ITBIS.
  impuesto_id          uuid          NOT NULL REFERENCES impuestos(id),
  precio_incluye_itbis boolean       NOT NULL DEFAULT false,
  -- Previsto: cuenta contable de ingreso. Se enlazará al plan de cuentas
  -- cuando exista; por ahora queda vacía y sin clave foránea.
  cuenta_ingreso_id    uuid,
  is_active            boolean       NOT NULL DEFAULT true,
  created_by           uuid REFERENCES usuarios(id),
  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT servicios_codigo_formato CHECK (codigo ~ '^[A-Z0-9._-]{2,30}$'),
  CONSTRAINT servicios_tipo CHECK (tipo IN ('propio')),
  CONSTRAINT servicios_precio_no_negativo CHECK (precio >= 0),
  CONSTRAINT servicios_costo_no_negativo CHECK (costo IS NULL OR costo >= 0)
);

CREATE UNIQUE INDEX servicios_codigo_uq ON servicios (codigo);
CREATE INDEX servicios_unidad_negocio_idx ON servicios (unidad_negocio_id);

-- Datos iniciales editables.
INSERT INTO unidades_negocio (codigo, nombre) VALUES
  ('papeleria',      'Papelería'),
  ('imprenta',       'Imprenta'),
  ('diseno_grafico', 'Diseño gráfico'),
  ('cafeteria',      'Cafetería'),
  ('tecnologia',     'Tecnología'),
  ('pago_servicios', 'Pago de servicios'),
  ('otros',          'Otros');

INSERT INTO unidades_medida (codigo, nombre) VALUES
  ('unidad', 'Unidad'),
  ('pagina', 'Página'),
  ('hora',   'Hora');

INSERT INTO impuestos (codigo, nombre) VALUES
  ('exento', 'Exento'),
  ('itbis',  'ITBIS');

-- VALOR INICIAL A CONFIRMAR POR EL CONTADOR: 18% es la tasa general de
-- ITBIS conocida al crear esta migración. Se corrige desde la pantalla de
-- impuestos agregando una nueva tasa con su fecha de vigencia.
INSERT INTO impuesto_tasas (impuesto_id, tasa, vigente_desde)
SELECT id, 0.00, DATE '2000-01-01' FROM impuestos WHERE codigo = 'exento';
INSERT INTO impuesto_tasas (impuesto_id, tasa, vigente_desde)
SELECT id, 18.00, DATE '2000-01-01' FROM impuestos WHERE codigo = 'itbis';

-- Permisos del módulo.
INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('servicios.ver',        'servicios', 'ver',        'Ver el catálogo de servicios'),
  ('servicios.crear',      'servicios', 'crear',      'Crear servicios'),
  ('servicios.editar',     'servicios', 'editar',     'Editar servicios, precios e impuestos'),
  ('servicios.desactivar', 'servicios', 'desactivar', 'Activar o desactivar servicios'),
  ('impuestos.ver',        'impuestos', 'ver',        'Ver impuestos y tasas'),
  ('impuestos.gestionar',  'impuestos', 'gestionar',  'Crear impuestos y cambiar tasas');

-- El Administrador recibe los permisos nuevos.
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.modulo IN ('servicios', 'impuestos')
WHERE r.codigo = 'administrador';

COMMIT;
