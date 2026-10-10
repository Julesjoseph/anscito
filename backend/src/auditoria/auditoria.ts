import type { PoolClient } from 'pg';

type Registro = {
  usuarioId: string;
  accion: string;
  entidad: string;
  entidadId?: string;
  anterior?: unknown;
  nuevo?: unknown;
  motivo?: string;
  ip?: string;
};

export async function registrarAuditoria(cliente: PoolClient, r: Registro) {
  await cliente.query(
    `INSERT INTO auditoria
       (usuario_id, accion, entidad, entidad_id,
        valor_anterior, valor_nuevo, motivo, ip)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
    [
      r.usuarioId,
      r.accion,
      r.entidad,
      r.entidadId ?? null,
      r.anterior === undefined ? null : JSON.stringify(r.anterior),
      r.nuevo === undefined ? null : JSON.stringify(r.nuevo),
      r.motivo ?? null,
      r.ip ?? null,
    ],
  );
}