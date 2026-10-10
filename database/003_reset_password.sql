-- ANSCITO 003: restablecer contraseña y cierre de sesiones
BEGIN;

ALTER TABLE usuarios
  ADD COLUMN password_changed_at timestamptz NOT NULL DEFAULT now();

INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('usuarios.resetear_password', 'usuarios', 'resetear_password',
   'Restablecer contraseñas y desbloquear usuarios');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.codigo = 'usuarios.resetear_password'
WHERE r.codigo = 'administrador';

COMMIT;