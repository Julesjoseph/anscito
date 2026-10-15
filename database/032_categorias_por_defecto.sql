-- ANSCITO 032: unidades de negocio de SCITO con sus categorías por defecto.
-- Lista aprobada por el dueño. Funciona en cualquier base: crea lo que falta,
-- no repite lo que ya existe y no borra nada.
-- * "Documentos" o "Legalización de documentos" (si existen) pasan a
--   llamarse "Documentos y trámites" (conservan sus servicios).
-- * Diseño gráfico e Imprenta se desactivan solo si no tienen servicios ni
--   productos activos.
-- * Cada servicio sin categoría recibe la categoría general de su unidad
--   (desde ahora la categoría es obligatoria en cada servicio).
-- Cada cambio deja su registro en la auditoría (usuario: la migración). Si
-- se vuelve a ejecutar, no cambia nada y no deja registros nuevos.
BEGIN;

-- 1) Renombrar "Documentos" → "Documentos y trámites".
WITH r AS (
  UPDATE unidades_negocio u SET nombre = 'Documentos y trámites', updated_at = now()
  FROM (SELECT id, nombre AS anterior FROM unidades_negocio
        WHERE lower(nombre) IN ('documentos', 'legalizacion de documentos', 'legalización de documentos')
        ORDER BY created_at LIMIT 1) a
  WHERE u.id = a.id
    AND NOT EXISTS (SELECT 1 FROM unidades_negocio WHERE lower(nombre) = lower('Documentos y trámites'))
  RETURNING u.id, a.anterior
)
INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo, motivo)
SELECT NULL, 'migracion.032', 'unidades_negocio', r.id::text,
       jsonb_build_object('nombre', r.anterior), jsonb_build_object('nombre', 'Documentos y trámites'),
       'Migración 032: categorías por defecto aprobadas por el dueño'
FROM r;

-- 2) Unidades que faltan.
WITH n AS (
  INSERT INTO unidades_negocio (codigo, nombre)
  SELECT u.codigo, u.nombre
  FROM (VALUES
    ('documentos_tramites', 'Documentos y trámites'),
    ('pago_servicios',      'Pago de servicios'),
    ('envios_haiti',        'Envíos a Haití'),
    ('sol_cash',            'SOL CASH'),
    ('moncash_natcash',     'MonCash / NatCash'),
    ('papeleria',           'Papelería'),
    ('cafeteria',           'Cafetería'),
    ('tecnologia',          'Tecnología'),
    ('otros',               'Otros')
  ) AS u(codigo, nombre)
  WHERE NOT EXISTS (SELECT 1 FROM unidades_negocio x WHERE lower(x.nombre) = lower(u.nombre))
    AND NOT EXISTS (SELECT 1 FROM unidades_negocio x WHERE x.codigo = u.codigo)
  RETURNING id, nombre
)
INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, valor_nuevo, motivo)
SELECT NULL, 'migracion.032', 'unidades_negocio', n.id::text, jsonb_build_object('nombre', n.nombre, 'creada', true),
       'Migración 032: categorías por defecto aprobadas por el dueño'
FROM n;

-- Las de la lista quedan activas.
WITH a AS (
  UPDATE unidades_negocio SET is_active = true, updated_at = now()
  WHERE lower(nombre) IN (lower('Documentos y trámites'), lower('Pago de servicios'), lower('Envíos a Haití'),
                          lower('SOL CASH'), lower('MonCash / NatCash'), lower('Papelería'), lower('Cafetería'),
                          lower('Tecnología'), lower('Otros'))
    AND NOT is_active
  RETURNING id, nombre
)
INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo, motivo)
SELECT NULL, 'migracion.032', 'unidades_negocio', a.id::text, jsonb_build_object('is_active', false),
       jsonb_build_object('is_active', true, 'nombre', a.nombre),
       'Migración 032: categorías por defecto aprobadas por el dueño'
FROM a;

-- 3) Categorías por defecto (prefijo solo en las que tendrán productos, y si está libre).
WITH n AS (
  INSERT INTO categorias (unidad_negocio_id, nombre, prefijo)
  SELECT un.id, c.nombre,
         CASE WHEN c.prefijo IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categorias p WHERE p.prefijo = c.prefijo)
              THEN c.prefijo END
  FROM (VALUES
    ('Documentos y trámites', 'Legalización de documentos', NULL),
    ('Documentos y trámites', 'Pasaportes y visas',         NULL),
    ('Documentos y trámites', 'Actas y certificados',       NULL),
    ('Documentos y trámites', 'Traducciones',               NULL),
    ('Documentos y trámites', 'Otros trámites',             NULL),
    ('Pago de servicios',     'Luz y agua',                 NULL),
    ('Pago de servicios',     'Teléfono e internet',        NULL),
    ('Pago de servicios',     'Otros pagos',                NULL),
    ('Envíos a Haití',        'Envíos de dinero',           NULL),
    ('SOL CASH',              'Comisiones de SOL CASH',     NULL),
    ('MonCash / NatCash',     'Recargas',                   NULL),
    ('MonCash / NatCash',     'Transferencias',             NULL),
    ('Papelería',             'Útiles escolares',           'UTI'),
    ('Papelería',             'Artículos de oficina',       'OFI'),
    ('Papelería',             'Copias e impresiones',       NULL),
    ('Cafetería',             'Bebidas',                    'BEB'),
    ('Cafetería',             'Comida y snacks',            'COM'),
    ('Tecnología',            'Accesorios',                 'ACC'),
    ('Tecnología',            'Celulares',                  'CEL'),
    ('Otros',                 'General',                    'GEN')
  ) AS c(unidad, nombre, prefijo)
  JOIN unidades_negocio un ON lower(un.nombre) = lower(c.unidad)
  WHERE NOT EXISTS (SELECT 1 FROM categorias x WHERE x.unidad_negocio_id = un.id AND lower(x.nombre) = lower(c.nombre))
  RETURNING id, unidad_negocio_id, nombre, prefijo
)
INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, valor_nuevo, motivo)
SELECT NULL, 'migracion.032', 'categorias', n.id::text,
       jsonb_build_object('nombre', n.nombre, 'unidad_negocio_id', n.unidad_negocio_id, 'prefijo', n.prefijo, 'creada', true),
       'Migración 032: categorías por defecto aprobadas por el dueño'
FROM n;

-- 4) Unidades viejas fuera de la lista: se desactivan si no se usan.
WITH d AS (
  UPDATE unidades_negocio un SET is_active = false, updated_at = now()
  WHERE lower(un.nombre) IN (lower('Diseño gráfico'), lower('Imprenta'))
    AND un.is_active
    AND NOT EXISTS (SELECT 1 FROM servicios s WHERE s.unidad_negocio_id = un.id AND s.is_active)
    AND NOT EXISTS (SELECT 1 FROM productos p JOIN categorias c ON c.id = p.categoria_id
                    WHERE c.unidad_negocio_id = un.id AND p.is_active)
  RETURNING un.id, un.nombre
)
INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo, motivo)
SELECT NULL, 'migracion.032', 'unidades_negocio', d.id::text, jsonb_build_object('is_active', true),
       jsonb_build_object('is_active', false, 'nombre', d.nombre),
       'Migración 032: unidad fuera de la lista aprobada por el dueño y sin servicios ni productos activos'
FROM d;

-- 5) Servicios sin categoría: la general de su unidad ("Otros trámites",
--    "Otros pagos" o "General"; si la unidad no tiene ninguna, se crea "General").
WITH n AS (
  INSERT INTO categorias (unidad_negocio_id, nombre)
  SELECT DISTINCT s.unidad_negocio_id, 'General'
  FROM servicios s
  WHERE s.categoria_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM categorias c
                    WHERE c.unidad_negocio_id = s.unidad_negocio_id
                      AND lower(c.nombre) IN ('otros trámites', 'otros pagos', 'general'))
  RETURNING id, unidad_negocio_id, nombre
)
INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, valor_nuevo, motivo)
SELECT NULL, 'migracion.032', 'categorias', n.id::text,
       jsonb_build_object('nombre', n.nombre, 'unidad_negocio_id', n.unidad_negocio_id, 'creada', true),
       'Migración 032: categoría general para servicios sin categoría'
FROM n;

WITH s AS (
  UPDATE servicios sv SET categoria_id = g.categoria_id, updated_at = now()
  FROM (
    SELECT x.id, (
      SELECT c.id FROM categorias c
      WHERE c.unidad_negocio_id = x.unidad_negocio_id
        AND lower(c.nombre) IN ('otros trámites', 'otros pagos', 'general')
      ORDER BY CASE lower(c.nombre) WHEN 'otros trámites' THEN 1 WHEN 'otros pagos' THEN 2 ELSE 3 END
      LIMIT 1) AS categoria_id
    FROM servicios x WHERE x.categoria_id IS NULL
  ) g
  WHERE sv.id = g.id
  RETURNING sv.id, sv.codigo, sv.categoria_id
)
INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo, motivo)
SELECT NULL, 'migracion.032', 'servicios', s.id::text, jsonb_build_object('categoria_id', NULL),
       jsonb_build_object('categoria_id', s.categoria_id, 'codigo', s.codigo),
       'Migración 032: la categoría ahora es obligatoria; se puso la general de su unidad'
FROM s;

COMMIT;
