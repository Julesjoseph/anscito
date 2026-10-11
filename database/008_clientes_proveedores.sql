-- ANSCITO 008: clientes y proveedores (terceros)
-- Todo se ejecuta como una sola operación: si algo falla, no se crea nada.
BEGIN;

-- Tipos de documento: lista configurable. El patrón valida el número ya
-- normalizado (sin guiones, espacios ni puntos, en mayúsculas).
-- No se valida el dígito verificador: solo formato y largo.
CREATE TABLE tipos_documento (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo      varchar(20)  NOT NULL UNIQUE,
  nombre      varchar(50)  NOT NULL,
  patron      varchar(100) NOT NULL,
  ayuda       varchar(150) NOT NULL,
  orden       integer      NOT NULL DEFAULT 0,
  is_active   boolean      NOT NULL DEFAULT true,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);

INSERT INTO tipos_documento (codigo, nombre, patron, ayuda, orden) VALUES
  ('rnc',       'RNC',       '^[0-9]{9}$',      'RNC: 9 dígitos',                          1),
  ('cedula',    'Cédula',    '^[0-9]{11}$',     'Cédula: 11 dígitos',                      2),
  ('pasaporte', 'Pasaporte', '^[A-Z0-9]{5,20}$', 'Pasaporte: 5 a 20 letras o números',     3),
  ('otro',      'Otro',      '^[A-Z0-9]{3,30}$', 'Otro documento: 3 a 30 letras o números', 4);

-- Clientes y proveedores en una sola tabla, pero como listas separadas:
-- cada registro es cliente O proveedor ("rol").
CREATE TABLE terceros (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rol                varchar(10)  NOT NULL,
  tipo_documento_id  uuid REFERENCES tipos_documento(id),
  numero_documento   varchar(30),
  nombre             varchar(150) NOT NULL,
  nombre_comercial   varchar(150),
  es_contribuyente   boolean      NOT NULL DEFAULT false,
  direccion          varchar(300),
  telefono           varchar(30),
  whatsapp           varchar(30),
  correo             varchar(150),
  notas              text,
  -- Solo clientes: puede comprar a crédito (sin montos por ahora).
  puede_credito      boolean      NOT NULL DEFAULT false,
  -- Sobre todo proveedores: persona de contacto y días de plazo para pagarle.
  persona_contacto   varchar(150),
  dias_credito       integer,
  -- "Consumidor final": viene creado y no se edita ni se desactiva.
  es_protegido       boolean      NOT NULL DEFAULT false,
  is_active          boolean      NOT NULL DEFAULT true,
  created_by         uuid REFERENCES usuarios(id),
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT terceros_rol CHECK (rol IN ('cliente', 'proveedor')),
  CONSTRAINT terceros_documento_completo
    CHECK ((tipo_documento_id IS NULL) = (numero_documento IS NULL)),
  CONSTRAINT terceros_contribuyente_con_documento
    CHECK (NOT es_contribuyente OR numero_documento IS NOT NULL),
  CONSTRAINT terceros_credito_solo_clientes
    CHECK (rol = 'cliente' OR NOT puede_credito),
  CONSTRAINT terceros_dias_solo_proveedores
    CHECK (rol = 'proveedor' OR dias_credito IS NULL),
  CONSTRAINT terceros_dias_rango
    CHECK (dias_credito IS NULL OR dias_credito BETWEEN 0 AND 365)
);

-- El mismo documento no se repite dentro de la misma lista.
CREATE UNIQUE INDEX terceros_documento_uq
  ON terceros (rol, tipo_documento_id, numero_documento)
  WHERE numero_documento IS NOT NULL;
CREATE INDEX terceros_rol_nombre_idx ON terceros (rol, lower(nombre));

-- Cliente para ventas sin identificar al comprador.
INSERT INTO terceros (rol, nombre, es_protegido, notas) VALUES
  ('cliente', 'Consumidor final', true,
   'Cliente del sistema para ventas sin identificar al comprador. No se edita ni se desactiva.');

-- Permisos.
INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('clientes.ver',           'clientes',    'ver',           'Ver clientes'),
  ('clientes.crear',         'clientes',    'crear',         'Crear clientes'),
  ('clientes.editar',        'clientes',    'editar',        'Editar clientes'),
  ('clientes.desactivar',    'clientes',    'desactivar',    'Activar o desactivar clientes'),
  ('proveedores.ver',        'proveedores', 'ver',           'Ver proveedores'),
  ('proveedores.crear',      'proveedores', 'crear',         'Crear proveedores'),
  ('proveedores.editar',     'proveedores', 'editar',        'Editar proveedores'),
  ('proveedores.desactivar', 'proveedores', 'desactivar',    'Activar o desactivar proveedores'),
  ('terceros.ver_documento', 'terceros',    'ver_documento', 'Ver completo el RNC, cédula o pasaporte de clientes y proveedores');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.modulo IN ('clientes', 'proveedores', 'terceros')
WHERE r.codigo = 'administrador';

COMMIT;
