-- ANSCITO 006: inventario, parte 1 (productos y existencia inicial)
-- Todo se ejecuta como una sola operación: si algo falla, no se crea nada.
BEGIN;

-- Sucursal inicial. El inventario queda preparado para varias sucursales.
INSERT INTO sucursales (codigo, nombre)
SELECT 'PRINCIPAL', 'Principal'
WHERE NOT EXISTS (SELECT 1 FROM sucursales);

-- Unidades de medida (tabla de 004): ahora indican si aceptan decimales.
ALTER TABLE unidades_medida
  ADD COLUMN permite_decimales boolean NOT NULL DEFAULT false;

INSERT INTO unidades_medida (codigo, nombre, permite_decimales) VALUES
  ('libra',   'Libra',   true),
  ('caja',    'Caja',    false),
  ('paquete', 'Paquete', false),
  ('docena',  'Docena',  false),
  ('resma',   'Resma',   false),
  ('galon',   'Galón',   false);

-- Categorías universales (005): prefijo y contador para el código de los
-- productos. El prefijo solo hace falta en categorías con productos.
ALTER TABLE categorias
  ADD COLUMN prefijo varchar(5),
  ADD COLUMN ultimo_numero integer NOT NULL DEFAULT 0,
  -- Previsto: cuenta de inventario del plan de cuentas (aún no existe).
  ADD COLUMN cuenta_inventario_id uuid,
  ADD CONSTRAINT categorias_prefijo_formato
    CHECK (prefijo IS NULL OR prefijo ~ '^[A-Z0-9]{2,5}$'),
  ADD CONSTRAINT categorias_ultimo_numero_no_negativo
    CHECK (ultimo_numero >= 0);

CREATE UNIQUE INDEX categorias_prefijo_uq
  ON categorias (prefijo) WHERE prefijo IS NOT NULL;

-- Productos. El costo es el costo promedio vigente, SIN ITBIS.
-- La existencia no se guarda aquí: se calcula con los movimientos.
CREATE TABLE productos (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo                varchar(20)   NOT NULL UNIQUE,
  nombre                varchar(150)  NOT NULL,
  categoria_id          uuid          NOT NULL REFERENCES categorias(id),
  unidad_id             uuid          NOT NULL REFERENCES unidades_medida(id),
  costo                 numeric(14,2) NOT NULL DEFAULT 0,
  impuesto_id           uuid          NOT NULL REFERENCES impuestos(id),
  precio_venta          numeric(14,2),
  precio_incluye_itbis  boolean       NOT NULL DEFAULT false,
  stock_minimo          numeric(14,3),
  is_active             boolean       NOT NULL DEFAULT true,
  created_by            uuid REFERENCES usuarios(id),
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT productos_codigo_formato CHECK (codigo ~ '^[A-Z0-9]{2,5}-[0-9]{4,}$'),
  CONSTRAINT productos_costo_no_negativo CHECK (costo >= 0),
  CONSTRAINT productos_precio_no_negativo
    CHECK (precio_venta IS NULL OR precio_venta >= 0),
  CONSTRAINT productos_stock_minimo_no_negativo
    CHECK (stock_minimo IS NULL OR stock_minimo >= 0)
);

-- El mismo nombre no se repite dentro de una categoría.
CREATE UNIQUE INDEX productos_nombre_categoria_uq
  ON productos (categoria_id, lower(nombre));
CREATE INDEX productos_categoria_idx ON productos (categoria_id);

-- Movimientos de inventario: solo se agregan, nunca se modifican ni borran.
-- En esta parte solo existe el tipo 'inicial'; la parte 2 agrega entradas,
-- salidas y ajustes.
CREATE TABLE movimientos_inventario (
  id              bigserial PRIMARY KEY,
  producto_id     uuid          NOT NULL REFERENCES productos(id),
  sucursal_id     uuid          NOT NULL REFERENCES sucursales(id),
  tipo            varchar(20)   NOT NULL,
  cantidad        numeric(14,3) NOT NULL,
  costo_unitario  numeric(14,2) NOT NULL,
  referencia      varchar(100),
  motivo          text,
  usuario_id      uuid          NOT NULL REFERENCES usuarios(id),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT movimientos_tipo CHECK (tipo IN ('inicial')),
  CONSTRAINT movimientos_cantidad_positiva CHECK (cantidad > 0),
  CONSTRAINT movimientos_costo_no_negativo CHECK (costo_unitario >= 0)
);

CREATE INDEX movimientos_producto_idx
  ON movimientos_inventario (producto_id, sucursal_id, created_at);
-- Una sola existencia inicial por producto y sucursal.
CREATE UNIQUE INDEX movimientos_inicial_uq
  ON movimientos_inventario (producto_id, sucursal_id) WHERE tipo = 'inicial';

CREATE FUNCTION movimientos_inmutables() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Los movimientos de inventario no se pueden modificar ni borrar';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER movimientos_no_modificar
  BEFORE UPDATE OR DELETE ON movimientos_inventario
  FOR EACH ROW EXECUTE FUNCTION movimientos_inmutables();

-- Permisos del módulo.
INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('inventario.ver',        'inventario', 'ver',        'Ver productos y existencias'),
  ('inventario.crear',      'inventario', 'crear',      'Crear productos'),
  ('inventario.editar',     'inventario', 'editar',     'Editar productos, precios e impuestos'),
  ('inventario.desactivar', 'inventario', 'desactivar', 'Activar o desactivar productos'),
  ('inventario.ver_costos', 'inventario', 'ver_costos', 'Ver el costo de los productos');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.modulo = 'inventario'
WHERE r.codigo = 'administrador';

COMMIT;
