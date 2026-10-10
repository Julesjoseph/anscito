-- ANSCITO 001: usuarios, roles y permisos
-- Todo se ejecuta como una sola operación: si algo falla, no se crea nada.
BEGIN;

CREATE TABLE sucursales (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo      varchar(20)  NOT NULL UNIQUE,
  nombre      varchar(100) NOT NULL,
  is_active   boolean      NOT NULL DEFAULT true,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE usuarios (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username              varchar(50)  NOT NULL UNIQUE,
  nombre                varchar(100) NOT NULL,
  apellido              varchar(100) NOT NULL,
  cedula                varchar(20),
  telefono              varchar(30),
  email                 varchar(150),
  password_hash         varchar(255) NOT NULL,
  sucursal_id           uuid REFERENCES sucursales(id),
  is_active             boolean      NOT NULL DEFAULT true,
  must_change_password  boolean      NOT NULL DEFAULT true,
  failed_attempts       integer      NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  last_login_at         timestamptz,
  created_by            uuid REFERENCES usuarios(id),
  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT usuarios_username_formato
    CHECK (username ~ '^[a-z0-9._-]{3,50}$')
);

-- La cédula y el correo no se repiten, pero pueden quedar vacíos.
CREATE UNIQUE INDEX usuarios_cedula_uq ON usuarios (cedula)
  WHERE cedula IS NOT NULL;
CREATE UNIQUE INDEX usuarios_email_uq ON usuarios (lower(email))
  WHERE email IS NOT NULL;

CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo      varchar(50)  NOT NULL UNIQUE,
  nombre      varchar(100) NOT NULL,
  descripcion text,
  is_system   boolean      NOT NULL DEFAULT false,
  is_active   boolean      NOT NULL DEFAULT true,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE permisos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo      varchar(100) NOT NULL UNIQUE,
  modulo      varchar(50)  NOT NULL,
  accion      varchar(50)  NOT NULL,
  descripcion text
);

CREATE TABLE rol_permisos (
  rol_id      uuid NOT NULL REFERENCES roles(id),
  permiso_id  uuid NOT NULL REFERENCES permisos(id),
  PRIMARY KEY (rol_id, permiso_id)
);

CREATE TABLE usuario_roles (
  usuario_id  uuid NOT NULL REFERENCES usuarios(id),
  rol_id      uuid NOT NULL REFERENCES roles(id),
  PRIMARY KEY (usuario_id, rol_id)
);

-- Datos iniciales: los roles sugeridos en el documento maestro.
INSERT INTO roles (codigo, nombre, descripcion, is_system) VALUES
  ('administrador', 'Administrador', 'Acceso total al sistema', true),
  ('cajero',        'Cajero',        'Ventas, cobros y caja', false),
  ('ventas',        'Ventas',        'Registro de ventas y servicios', false),
  ('contador',      'Contador',      'Contabilidad y reportes financieros', false),
  ('auditor',       'Auditor',       'Consulta y revisión, sin modificar', false),
  ('supervisor',    'Supervisor',    'Supervisión y aprobaciones', false);

-- Primeros permisos (los demás módulos agregarán los suyos).
INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('usuarios.ver',        'usuarios', 'ver',        'Ver la lista de usuarios'),
  ('usuarios.crear',      'usuarios', 'crear',      'Crear usuarios'),
  ('usuarios.editar',     'usuarios', 'editar',     'Editar usuarios'),
  ('usuarios.desactivar', 'usuarios', 'desactivar', 'Activar o desactivar usuarios'),
  ('roles.ver',           'roles',    'ver',        'Ver roles y permisos'),
  ('roles.gestionar',     'roles',    'gestionar',  'Crear roles y asignar permisos');

-- El Administrador recibe todos los permisos existentes.
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permisos p
WHERE r.codigo = 'administrador';

COMMIT;