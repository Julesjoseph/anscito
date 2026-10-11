-- ANSCITO 009: datos de la empresa y sucursales
-- Todo se ejecuta como una sola operación: si algo falla, no se crea nada.
BEGIN;

-- Datos de la empresa: una sola fila (id = 1). El nombre comercial y el
-- logo se muestran en el menú y en la pantalla de entrada.
CREATE TABLE empresa (
  id                smallint PRIMARY KEY DEFAULT 1,
  razon_social      varchar(150),
  nombre_comercial  varchar(100) NOT NULL,
  rnc               varchar(9),
  direccion         varchar(300),
  telefono          varchar(30),
  whatsapp          varchar(30),
  correo            varchar(150),
  sitio_web         varchar(200),
  logo              bytea,
  logo_tipo         varchar(20),
  updated_by        uuid REFERENCES usuarios(id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT empresa_una_sola_fila CHECK (id = 1),
  CONSTRAINT empresa_rnc_formato CHECK (rnc IS NULL OR rnc ~ '^[0-9]{9}$'),
  CONSTRAINT empresa_logo_tipo
    CHECK (logo_tipo IS NULL OR logo_tipo IN ('image/png', 'image/jpeg', 'image/webp')),
  CONSTRAINT empresa_logo_completo CHECK ((logo IS NULL) = (logo_tipo IS NULL)),
  -- Logo de hasta 512 KB.
  CONSTRAINT empresa_logo_tamano CHECK (logo IS NULL OR octet_length(logo) <= 524288)
);

INSERT INTO empresa (id, nombre_comercial) VALUES (1, 'SCITO ENTREPRISE');

-- Sucursales (tabla de 001): más datos y la marca de sucursal principal.
ALTER TABLE sucursales
  ADD COLUMN direccion    varchar(300),
  ADD COLUMN telefono     varchar(30),
  ADD COLUMN encargado    varchar(150),
  ADD COLUMN es_principal boolean NOT NULL DEFAULT false,
  ADD COLUMN created_by   uuid REFERENCES usuarios(id),
  ADD CONSTRAINT sucursales_codigo_formato CHECK (codigo ~ '^[A-Z0-9_-]{2,20}$');

UPDATE sucursales SET es_principal = true, updated_at = now()
WHERE codigo = 'PRINCIPAL';

-- Solo una sucursal principal, y no se repiten nombres.
CREATE UNIQUE INDEX sucursales_una_principal ON sucursales (es_principal)
  WHERE es_principal;
CREATE UNIQUE INDEX sucursales_nombre_uq ON sucursales (lower(nombre));

-- Los usuarios existentes quedan en la sucursal principal.
UPDATE usuarios SET sucursal_id = (SELECT id FROM sucursales WHERE es_principal),
                    updated_at = now()
WHERE sucursal_id IS NULL;

-- Permisos.
INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('empresa.ver',          'empresa',    'ver',       'Ver los datos de la empresa'),
  ('empresa.editar',       'empresa',    'editar',    'Cambiar los datos y el logo de la empresa'),
  ('sucursales.ver',       'sucursales', 'ver',       'Ver sucursales'),
  ('sucursales.gestionar', 'sucursales', 'gestionar', 'Crear, editar y desactivar sucursales');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.modulo IN ('empresa', 'sucursales')
WHERE r.codigo = 'administrador';

COMMIT;
