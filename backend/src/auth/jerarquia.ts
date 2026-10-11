import type { PoolClient } from 'pg';

// Reglas para evitar que alguien se dé (o dé a otros) más permisos de los
// que tiene. Se usan dentro de una transacción.

// Permisos efectivos del actor: la unión de todos sus roles activos.
const SQL_PERMISOS_ACTOR = `SELECT rp.permiso_id
  FROM usuario_roles ur
  JOIN roles ro ON ro.id = ur.rol_id AND ro.is_active = true
  JOIN rol_permisos rp ON rp.rol_id = ro.id
  WHERE ur.usuario_id = $1`;

// Verdadero si el usuario objetivo no tiene ningún permiso que el actor no tenga.
export async function puedeGestionarUsuario(
  c: PoolClient,
  actorId: string,
  objetivoId: string,
): Promise<boolean> {
  const r = await c.query<{ ok: boolean }>(
    `SELECT NOT EXISTS (
       SELECT 1
       FROM usuario_roles ur
       JOIN roles ro ON ro.id = ur.rol_id AND ro.is_active = true
       JOIN rol_permisos rp ON rp.rol_id = ro.id
       WHERE ur.usuario_id = $2
         AND rp.permiso_id NOT IN (${SQL_PERMISOS_ACTOR})
     ) AS ok`,
    [actorId, objetivoId],
  );
  return r.rows[0].ok;
}

// Códigos de los permisos del rol que el actor no tiene.
export async function permisosFaltantesDeRol(
  c: PoolClient,
  actorId: string,
  rolId: string,
): Promise<string[]> {
  const r = await c.query<{ codigo: string }>(
    `SELECT p.codigo
     FROM rol_permisos rp
     JOIN permisos p ON p.id = rp.permiso_id
     WHERE rp.rol_id = $2
       AND rp.permiso_id NOT IN (${SQL_PERMISOS_ACTOR})
     ORDER BY p.codigo`,
    [actorId, rolId],
  );
  return r.rows.map((f) => f.codigo);
}

// Códigos, de una lista de permisos, que el actor no tiene.
export async function permisosFaltantes(
  c: PoolClient,
  actorId: string,
  permisoIds: string[],
): Promise<string[]> {
  const r = await c.query<{ codigo: string }>(
    `SELECT p.codigo
     FROM permisos p
     WHERE p.id = ANY($2::uuid[])
       AND p.id NOT IN (${SQL_PERMISOS_ACTOR})
     ORDER BY p.codigo`,
    [actorId, permisoIds],
  );
  return r.rows.map((f) => f.codigo);
}
