-- ANSCITO 015: permisos de reportes (uno por área).
-- Los costos, la ganancia y la comisión de SCITO en los reportes siguen
-- exigiendo además "Ver costos" o "Entregas" de SCITO TRANSFER.
BEGIN;

INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('reportes.ventas',      'reportes', 'ventas',      'Reportes de ventas y SCITO SERVICE'),
  ('reportes.envios',      'reportes', 'envios',      'Reportes de SCITO TRANSFER (envíos y agentes)'),
  ('reportes.caja_bancos', 'reportes', 'caja_bancos', 'Reportes de caja, bancos y gastos'),
  ('reportes.inventario',  'reportes', 'inventario',  'Reporte de existencia y valor del inventario');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.modulo = 'reportes'
WHERE r.codigo = 'administrador';

COMMIT;
