-- ANSCITO 037: prefijo para todas las categorías (código automático).
-- Decisión del dueño: el código de productos y servicios se crea solo
-- (prefijo de la categoría + número de 4 cifras, ej. LEG-0001), así que
-- cada categoría necesita un prefijo.
-- * Las categorías por defecto sin prefijo reciben el aprobado por el dueño.
-- * Cualquier otra categoría sin prefijo recibe uno automático: las 3
--   primeras letras del nombre sin tildes, con un número si ya existe.
-- * Los servicios que ya existen conservan su código.
-- Cada prefijo deja su registro en la auditoría (accion 'migracion.037').
-- Si se vuelve a ejecutar, no cambia nada.
BEGIN;

-- 1) Prefijos aprobados (solo si la categoría no tiene y el prefijo está libre).
WITH s AS (
  UPDATE categorias ca SET prefijo = p.prefijo, updated_at = now()
  FROM (VALUES
    ('Documentos y trámites', 'Actas y certificados',       'ACT'),
    ('Documentos y trámites', 'Legalización de documentos', 'LEG'),
    ('Documentos y trámites', 'Otros trámites',             'TRA'),
    ('Documentos y trámites', 'Pasaportes y visas',         'PAS'),
    ('Documentos y trámites', 'Traducciones',               'TRD'),
    ('Envíos a Haití',        'Envíos de dinero',           'ENV'),
    ('MonCash / NatCash',     'Recargas',                   'REC'),
    ('MonCash / NatCash',     'Transferencias',             'TRF'),
    ('Pago de servicios',     'Luz y agua',                 'LUZ'),
    ('Pago de servicios',     'Otros pagos',                'PAG'),
    ('Pago de servicios',     'Teléfono e internet',        'TEL'),
    ('Papelería',             'Copias e impresiones',       'COP'),
    ('SOL CASH',              'Comisiones de SOL CASH',     'SOL')
  ) AS p(unidad, categoria, prefijo)
  JOIN unidades_negocio un ON lower(un.nombre) = lower(p.unidad)
  WHERE ca.unidad_negocio_id = un.id AND lower(ca.nombre) = lower(p.categoria)
    AND ca.prefijo IS NULL
    AND NOT EXISTS (SELECT 1 FROM categorias x WHERE x.prefijo = p.prefijo)
  RETURNING ca.id, ca.nombre, ca.prefijo
)
INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo, motivo)
SELECT NULL, 'migracion.037', 'categorias', s.id::text, jsonb_build_object('prefijo', NULL),
       jsonb_build_object('categoria', s.nombre, 'prefijo', s.prefijo),
       'Migración 037: prefijo para el código automático (aprobado por el dueño)'
FROM s;

-- 2) Las demás sin prefijo: automático y único.
DO $$
DECLARE
  r record;
  base text;
  candidato text;
  n int;
BEGIN
  FOR r IN SELECT id, nombre FROM categorias WHERE prefijo IS NULL ORDER BY created_at, id LOOP
    base := left(regexp_replace(upper(translate(r.nombre, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')), '[^A-Z]', '', 'g'), 3);
    IF length(base) < 2 THEN base := 'CAT'; END IF;
    candidato := base;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM categorias WHERE prefijo = candidato) LOOP
      n := n + 1;
      candidato := base || n::text;
    END LOOP;
    UPDATE categorias SET prefijo = candidato, updated_at = now() WHERE id = r.id;
    INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo, motivo)
    VALUES (NULL, 'migracion.037', 'categorias', r.id::text, jsonb_build_object('prefijo', NULL),
            jsonb_build_object('categoria', r.nombre, 'prefijo', candidato),
            'Migración 037: prefijo automático para el código de productos y servicios');
  END LOOP;
END $$;

COMMIT;
