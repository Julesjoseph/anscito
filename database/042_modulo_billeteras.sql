-- ANSCITO 042: módulo Billeteras (MonCash / NatCash), separado de Bancos.
-- Pedido del dueño: las billeteras salen de Bancos y tienen su propio módulo.
-- No se mueve ningún dato: siguen en la tabla cuentas (tipo 'billetera'),
-- con sus movimientos, conciliaciones y cuentas contables. Solo cambian la
-- pantalla y los permisos.
-- Decisión del dueño: cada rol que hoy tiene un permiso de Bancos recibe el
-- mismo en Billeteras (nadie pierde acceso; después se ajusta en Roles).
-- Cada permiso dado queda en la auditoría (accion 'migracion.042').
-- Si se vuelve a ejecutar, no cambia nada.
BEGIN;

INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('billeteras.ver',         'billeteras', 'ver',         'Ver las billeteras MonCash / NatCash, sus saldos y movimientos'),
  ('billeteras.gestionar',   'billeteras', 'gestionar',   'Crear, editar y desactivar billeteras, saldo inicial y reversos'),
  ('billeteras.movimientos', 'billeteras', 'movimientos', 'Registrar pagos, cargos e ingresos de las billeteras'),
  ('billeteras.confirmar',   'billeteras', 'confirmar',   'Confirmar movimientos de las billeteras y conciliarlas'),
  ('billeteras.transferir',  'billeteras', 'transferir',  'Recargar las billeteras y transferir entre billeteras, bancos y cajas')
ON CONFLICT (codigo) DO NOTHING;

WITH dados AS (
  INSERT INTO rol_permisos (rol_id, permiso_id)
  SELECT rp.rol_id, pn.id
  FROM rol_permisos rp
  JOIN permisos pb ON pb.id = rp.permiso_id AND pb.modulo = 'bancos'
  JOIN permisos pn ON pn.codigo = 'billeteras.' || pb.accion
  WHERE NOT EXISTS (SELECT 1 FROM rol_permisos x WHERE x.rol_id = rp.rol_id AND x.permiso_id = pn.id)
  RETURNING rol_id, permiso_id
)
INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo, motivo)
SELECT NULL, 'migracion.042', 'rol_permisos', d.rol_id::text, NULL,
       jsonb_build_object('rol', r.codigo, 'permiso', p.codigo),
       'Migración 042: módulo Billeteras; el rol ya tenía el permiso equivalente de Bancos (decisión del dueño)'
FROM dados d JOIN roles r ON r.id = d.rol_id JOIN permisos p ON p.id = d.permiso_id;

COMMIT;
