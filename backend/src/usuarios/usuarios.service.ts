import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { PoolClient } from 'pg';
import { registrarAuditoria } from '../auditoria/auditoria';
import {
  permisosFaltantesDeRol,
  puedeGestionarUsuario,
} from '../auth/jerarquia';
import { DatabaseService } from '../database/database.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME = /^[a-z0-9._-]{3,50}$/;
const MENSAJE_JERARQUIA =
  'No puede gestionar a un usuario con más permisos que los suyos';

// Roles pedidos: "rolIds" (lista) o "rolId" (uno, como antes). Sin repetir.
function leerRoles(datos: { rolId?: unknown; rolIds?: unknown }): string[] {
  const lista = Array.isArray(datos.rolIds)
    ? datos.rolIds
    : datos.rolId !== undefined
      ? [datos.rolId]
      : [];
  const ids = [
    ...new Set(
      lista.map((x) =>
        String(x ?? '')
          .trim()
          .toLowerCase(),
      ),
    ),
  ];
  if (ids.length === 0 || ids.some((x) => !UUID.test(x))) {
    throw new BadRequestException('Seleccione al menos un rol');
  }
  if (ids.length > 10)
    throw new BadRequestException('Máximo 10 roles por usuario');
  return ids.sort();
}

function errorRolSuperior(faltan: string[]) {
  return new ForbiddenException(
    `No puede asignar un rol con permisos que usted no tiene: ${faltan.join(', ')}`,
  );
}

export type DatosCrear = {
  username?: string;
  nombre?: string;
  apellido?: string;
  password?: string;
  rolId?: string;
  rolIds?: string[];
  sucursalId?: string;
};

export type DatosEditar = {
  nombre?: string;
  apellido?: string;
  rolId?: string;
  rolIds?: string[];
  sucursalId?: string;
};

type FilaEdicion = {
  id: string;
  nombre: string;
  apellido: string;
  rol_ids: string[];
  roles: string[];
  sucursal_id: string | null;
  sucursal: string | null;
};

@Injectable()
export class UsuariosService {
  constructor(private readonly db: DatabaseService) {}

  async listar() {
    const r = await this.db.query(
      `SELECT u.id, u.username, u.nombre, u.apellido, u.is_active,
              u.last_login_at, u.locked_until,
              COALESCE(string_agg(ro.nombre, ', ' ORDER BY ro.nombre), '') AS roles,
              (array_agg(ur.rol_id))[1] AS rol_id,
              COALESCE(array_agg(ur.rol_id::text) FILTER (WHERE ur.rol_id IS NOT NULL), '{}') AS rol_ids,
              u.sucursal_id, s.nombre AS sucursal
       FROM usuarios u
       LEFT JOIN usuario_roles ur ON ur.usuario_id = u.id
       LEFT JOIN roles ro ON ro.id = ur.rol_id
       LEFT JOIN sucursales s ON s.id = u.sucursal_id
       GROUP BY u.id, s.nombre
       ORDER BY u.username`,
    );
    return r.rows;
  }

  // Sucursales activas para el formulario de usuarios.
  async listarSucursales() {
    const r = await this.db.query(
      `SELECT id, codigo, nombre, es_principal FROM sucursales
       WHERE is_active = true ORDER BY es_principal DESC, lower(nombre)`,
    );
    return r.rows;
  }

  private async sucursalActiva(c: PoolClient, sucursalId: string) {
    const r = await c.query<{ nombre: string }>(
      'SELECT nombre FROM sucursales WHERE id = $1 AND is_active = true',
      [sucursalId],
    );
    if (r.rowCount === 0) {
      throw new BadRequestException('La sucursal no existe o está inactiva');
    }
    return r.rows[0].nombre;
  }

  async listarRoles() {
    const r = await this.db.query(
      `SELECT id, codigo, nombre FROM roles
       WHERE is_active = true ORDER BY nombre`,
    );
    return r.rows;
  }

  // Los roles deben existir y estar activos (los que ya tenía el usuario se
  // aceptan aunque estén inactivos). El actor no puede dar permisos que no
  // tiene: se revisan los roles de "revisar". Devuelve los nombres.
  private async rolesValidos(
    c: PoolClient,
    actorId: string,
    rolIds: string[],
    revisar: string[],
  ): Promise<string[]> {
    const r = await c.query<{ id: string; nombre: string; is_active: boolean }>(
      'SELECT id, nombre, is_active FROM roles WHERE id = ANY($1::uuid[])',
      [rolIds],
    );
    if (r.rowCount !== rolIds.length)
      throw new BadRequestException('Uno de los roles seleccionados no existe');
    if (r.rows.some((f) => !f.is_active && revisar.includes(f.id)))
      throw new BadRequestException(
        'Uno de los roles seleccionados está inactivo',
      );
    for (const rolId of revisar) {
      const faltan = await permisosFaltantesDeRol(c, actorId, rolId);
      if (faltan.length > 0) throw errorRolSuperior(faltan);
    }
    return r.rows.map((f) => f.nombre).sort();
  }

  async crear(actorId: string, ip: string | undefined, datos: DatosCrear) {
    const username = String(datos.username ?? '')
      .trim()
      .toLowerCase();
    const nombre = String(datos.nombre ?? '').trim();
    const apellido = String(datos.apellido ?? '').trim();
    const password = String(datos.password ?? '');
    const rolIds = leerRoles(datos);
    const sucursalId = String(datos.sucursalId ?? '');

    if (!USERNAME.test(username)) {
      throw new BadRequestException(
        'Usuario inválido: use 3 a 50 letras minúsculas, números, punto, guion o guion bajo',
      );
    }
    if (!nombre || !apellido || nombre.length > 100 || apellido.length > 100) {
      throw new BadRequestException('El nombre y el apellido son obligatorios');
    }
    if (password.length < 10) {
      throw new BadRequestException(
        'La contraseña debe tener al menos 10 caracteres',
      );
    }
    if (!UUID.test(sucursalId)) {
      throw new BadRequestException('Seleccione la sucursal');
    }

    const hash = await bcrypt.hash(password, 12);

    try {
      return await this.db.transaccion(async (c) => {
        const roles = await this.rolesValidos(c, actorId, rolIds, rolIds);
        const sucursal = await this.sucursalActiva(c, sucursalId);

        const u = await c.query<{ id: string }>(
          `INSERT INTO usuarios
             (username, nombre, apellido, password_hash,
              must_change_password, created_by, sucursal_id)
           VALUES ($1, $2, $3, $4, true, $5, $6)
           RETURNING id`,
          [username, nombre, apellido, hash, actorId, sucursalId],
        );
        const nuevoId = u.rows[0].id;

        await c.query(
          `INSERT INTO usuario_roles (usuario_id, rol_id)
           SELECT $1, unnest($2::uuid[])`,
          [nuevoId, rolIds],
        );

        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'usuario.crear',
          entidad: 'usuarios',
          entidadId: nuevoId,
          nuevo: {
            username,
            nombre,
            apellido,
            roles,
            sucursal,
          },
          ip,
        });

        return { id: nuevoId };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException('Ese nombre de usuario ya existe');
      }
      throw e;
    }
  }

  async editar(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: DatosEditar,
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Usuario no encontrado');

    const nombre = String(datos.nombre ?? '').trim();
    const apellido = String(datos.apellido ?? '').trim();
    const rolIds = leerRoles(datos);
    const sucursalId = String(datos.sucursalId ?? '');

    if (!nombre || !apellido || nombre.length > 100 || apellido.length > 100) {
      throw new BadRequestException('El nombre y el apellido son obligatorios');
    }
    if (!UUID.test(sucursalId)) {
      throw new BadRequestException('Seleccione la sucursal');
    }

    return this.db.transaccion(async (c) => {
      const act = await c.query<FilaEdicion>(
        `SELECT u.id, u.nombre, u.apellido, u.sucursal_id, s.nombre AS sucursal,
                COALESCE((SELECT array_agg(ur.rol_id::text ORDER BY ur.rol_id)
                          FROM usuario_roles ur WHERE ur.usuario_id = u.id), '{}') AS rol_ids,
                COALESCE((SELECT array_agg(ro.nombre ORDER BY ro.nombre)
                          FROM usuario_roles ur JOIN roles ro ON ro.id = ur.rol_id
                          WHERE ur.usuario_id = u.id), '{}') AS roles
         FROM usuarios u
         LEFT JOIN sucursales s ON s.id = u.sucursal_id
         WHERE u.id = $1
         FOR UPDATE OF u`,
        [id],
      );
      if (act.rowCount === 0)
        throw new NotFoundException('Usuario no encontrado');
      const antes = act.rows[0];

      const antesIds = [...antes.rol_ids].sort();
      const cambianRoles = antesIds.join(',') !== rolIds.join(',');
      if (id === actorId && cambianRoles) {
        throw new BadRequestException('No puede cambiar sus propios roles');
      }
      if (!(await puedeGestionarUsuario(c, actorId, id))) {
        throw new ForbiddenException(MENSAJE_JERARQUIA);
      }

      // Solo se revisan los roles que se agregan; los que ya tenía se respetan.
      const nuevos = rolIds.filter((r) => !antesIds.includes(r));
      const roles = await this.rolesValidos(c, actorId, rolIds, nuevos);

      // Si no cambia, se respeta aunque la sucursal esté inactiva.
      const sucursal =
        sucursalId === antes.sucursal_id
          ? antes.sucursal
          : await this.sucursalActiva(c, sucursalId);

      await c.query(
        `UPDATE usuarios SET nombre = $2, apellido = $3, sucursal_id = $4,
                updated_at = now()
         WHERE id = $1`,
        [id, nombre, apellido, sucursalId],
      );
      if (cambianRoles) {
        await c.query(
          `DELETE FROM usuario_roles
           WHERE usuario_id = $1 AND NOT (rol_id = ANY($2::uuid[]))`,
          [id, rolIds],
        );
        await c.query(
          `INSERT INTO usuario_roles (usuario_id, rol_id)
           SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
          [id, rolIds],
        );
      }

      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'usuario.editar',
        entidad: 'usuarios',
        entidadId: id,
        anterior: {
          nombre: antes.nombre,
          apellido: antes.apellido,
          roles: antes.roles,
          sucursal: antes.sucursal,
        },
        nuevo: { nombre, apellido, roles, sucursal },
        ip,
      });

      return { ok: true };
    });
  }

  async cambiarEstado(
    actorId: string,
    id: string,
    activo: unknown,
    motivo: unknown,
    ip: string | undefined,
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Usuario no encontrado');
    if (typeof activo !== 'boolean') {
      throw new BadRequestException('Estado inválido');
    }
    if (id === actorId) {
      throw new BadRequestException(
        'No puede cambiar el estado de su propio usuario',
      );
    }
    const texto = String(motivo ?? '').trim();
    if (!activo && texto.length < 5) {
      throw new BadRequestException(
        'Escriba el motivo de la desactivación (mínimo 5 caracteres)',
      );
    }

    return this.db.transaccion(async (c) => {
      const r = await c.query<{ username: string; is_active: boolean }>(
        'SELECT username, is_active FROM usuarios WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (r.rowCount === 0)
        throw new NotFoundException('Usuario no encontrado');
      const antes = r.rows[0];
      if (antes.is_active === activo) return { ok: true };
      if (!(await puedeGestionarUsuario(c, actorId, id))) {
        throw new ForbiddenException(MENSAJE_JERARQUIA);
      }

      await c.query(
        `UPDATE usuarios
         SET is_active = $2, failed_attempts = 0, locked_until = NULL,
             updated_at = now()
         WHERE id = $1`,
        [id, activo],
      );

      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: activo ? 'usuario.activar' : 'usuario.desactivar',
        entidad: 'usuarios',
        entidadId: id,
        anterior: { username: antes.username, is_active: antes.is_active },
        nuevo: { username: antes.username, is_active: activo },
        motivo: texto || undefined,
        ip,
      });

      return { ok: true };
    });
  }
}
