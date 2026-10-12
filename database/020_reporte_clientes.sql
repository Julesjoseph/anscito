-- ANSCITO 020: permiso para los reportes de clientes por servicio (tienen
-- datos personales: documento, teléfono, correo).
BEGIN;

INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('reportes.clientes', 'reportes', 'clientes',
   'Reportes de clientes por servicio (SCITO TRANSFER, SOL CASH, Facturación, Crédito Fiscal)');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.codigo = 'reportes.clientes'
WHERE r.codigo = 'administrador';

COMMIT;
