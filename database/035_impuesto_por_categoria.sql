-- ANSCITO 035: impuesto sugerido por categoría.
-- Al crear un producto o servicio, el impuesto (ITBIS o Exento) se llena solo
-- según su categoría; se puede cambiar como excepción. El ITBIS se sigue
-- calculando en el servidor con la tasa vigente.
-- Propuesta aprobada por el dueño como punto de partida; el contador debe
-- confirmarla. Las dudosas quedan sin sugerencia (se escoge a mano).
-- Cada sugerencia deja su registro en la auditoría (accion 'migracion.035').
-- Funciona en cualquier base: si una categoría no existe, no hace nada.
BEGIN;

ALTER TABLE categorias ADD COLUMN impuesto_id uuid REFERENCES impuestos(id);

WITH s AS (
  UPDATE categorias ca SET impuesto_id = i.id, updated_at = now()
  FROM (VALUES
    ('Cafetería',             'Bebidas',                    'itbis'),
    ('Cafetería',             'Comida y snacks',            'itbis'),
    ('Documentos y trámites', 'Legalización de documentos', 'itbis'),
    ('Documentos y trámites', 'Traducciones',               'itbis'),
    ('Documentos y trámites', 'Otros trámites',             'itbis'),
    ('Papelería',             'Artículos de oficina',       'itbis'),
    ('Papelería',             'Copias e impresiones',       'itbis'),
    ('Tecnología',            'Accesorios',                 'itbis'),
    ('Tecnología',            'Celulares',                  'itbis'),
    ('Otros',                 'General',                    'itbis'),
    ('Envíos a Haití',        'Envíos de dinero',           'exento'),
    ('MonCash / NatCash',     'Recargas',                   'exento'),
    ('MonCash / NatCash',     'Transferencias',             'exento'),
    ('SOL CASH',              'Comisiones de SOL CASH',     'exento')
  ) AS p(unidad, categoria, impuesto)
  JOIN unidades_negocio un ON lower(un.nombre) = lower(p.unidad)
  JOIN impuestos i ON i.codigo = p.impuesto
  WHERE ca.unidad_negocio_id = un.id AND lower(ca.nombre) = lower(p.categoria)
    AND ca.impuesto_id IS NULL
  RETURNING ca.id, ca.nombre, i.codigo
)
INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo, motivo)
SELECT NULL, 'migracion.035', 'categorias', s.id::text, jsonb_build_object('impuesto', NULL),
       jsonb_build_object('categoria', s.nombre, 'impuesto', s.codigo),
       'Migración 035: impuesto sugerido por categoría (propuesta aprobada por el dueño, a validar con el contador)'
FROM s;

COMMIT;
