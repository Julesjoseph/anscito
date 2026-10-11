-- ANSCITO 005: categorías universales (servicios y, más adelante, productos)
-- Dos niveles: unidad de negocio (Papelería, Cafetería…) -> categorías.
-- Todo se ejecuta como una sola operación: si algo falla, no se crea nada.
BEGIN;

-- Las unidades de negocio ya existen (004); ahora se administran desde la
-- pantalla, así que se registra quién crea cada una y no se repiten nombres.
ALTER TABLE unidades_negocio
  ADD COLUMN created_by uuid REFERENCES usuarios(id);

CREATE UNIQUE INDEX unidades_negocio_nombre_uq
  ON unidades_negocio (lower(nombre));

-- Categorías dentro de cada unidad de negocio. Se comparten entre servicios
-- y productos de inventario. No se borran: se desactivan.
CREATE TABLE categorias (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidad_negocio_id  uuid         NOT NULL REFERENCES unidades_negocio(id),
  nombre             varchar(100) NOT NULL,
  descripcion        text,
  is_active          boolean      NOT NULL DEFAULT true,
  created_by         uuid REFERENCES usuarios(id),
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  -- Permite que servicios (y productos) exijan que la categoría pertenezca
  -- a la misma unidad de negocio que eligieron.
  CONSTRAINT categorias_id_unidad_uq UNIQUE (id, unidad_negocio_id)
);

-- El mismo nombre no se repite dentro de una unidad de negocio.
CREATE UNIQUE INDEX categorias_nombre_uq
  ON categorias (unidad_negocio_id, lower(nombre));

-- Categoría del servicio: opcional, y siempre de su misma unidad de negocio.
ALTER TABLE servicios ADD COLUMN categoria_id uuid;
ALTER TABLE servicios
  ADD CONSTRAINT servicios_categoria_fk
  FOREIGN KEY (categoria_id, unidad_negocio_id)
  REFERENCES categorias (id, unidad_negocio_id);
CREATE INDEX servicios_categoria_idx ON servicios (categoria_id);

-- Permisos (módulo universal, no de servicios).
INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('categorias.ver',       'categorias', 'ver',
   'Ver unidades de negocio y categorías'),
  ('categorias.gestionar', 'categorias', 'gestionar',
   'Crear, modificar y desactivar unidades de negocio y categorías');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.modulo = 'categorias'
WHERE r.codigo = 'administrador';

COMMIT;
