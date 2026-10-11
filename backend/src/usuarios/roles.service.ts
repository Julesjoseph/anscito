import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { registrarAuditoria } from '../auditoria/auditoria';
import { permisosFaltantes, permisosFaltantesDeRol } from '../auth/jerarquia';
import { DatabaseService } from '../database/database.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODIGO = /^[a-z0-9_]{2,50}$/;

export type DatosRol = {
  codigo?: unknown;
  nombre?: unknown;
  descripcion?: unknown;
  permisos?: unknown;
};

type Limpio = {
  nombre: string;
  descripcion: string | null;
  permisos: string[];
};

function texto(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
}

@Injectable()
export class RolesService {
  constructor(private readonly db: DatabaseService) {}

  // Valida nombre, descripción y la lista de permisos (sin repetidos).
  validar(datos: DatosRol): Limpio {
    const nombre = texto(datos.nombre);
    const descripcion = texto(datos.descripcion);
    if (!nombre || nombre.length > 100) {
      throw new BadRequestException(
        'El nombre es obligatorio (máximo 100 caracteres)',
      );
    }
    if (descripcion.length > 500) {
      throw new BadRequestException(
        'La descripción no puede pasar de 500 caracteres',
      );
    }
    if (!Array.isArray(datos.permisos)) {
      throw new BadRequestException('La lista de permisos es inválida');
    }
    const permisos = [
      ...new Set(datos.permisos.map((p) => texto(p).toLowerCase())),
    ];
    if (permisos.length > 500 || permisos.some((p) => !UUID.test(p))) {
      throw new BadRequestException('La lista de permisos es inválida');
    }
    return { nombre, descripcion: descripcion || null, permisos };
  }

  async listar() {
    const r = await this.db.query(
      `SELECT ro.id, ro.codigo, ro.nombre, ro.descripcion,
              ro.is_system, ro.is_active,
              COALESCE(
                (SELECT array_agg(rp.permiso_id ORDER BY rp.permiso_id)
                 FROM rol_permisos rp WHERE rp.rol_id = ro.id),
                '{}') AS permisos,
              (SELECT count(*)::int FROM usuario_roles ur
                 JOIN usuarios u ON u.id = ur.usuario_id AND u.is_active = true
                WHERE ur.rol_id = ro.id) AS usuarios
       FROM roles ro
       ORDER BY ro.is_system DESC, ro.nombre`,
    );
    return r.rows;
  }

  async listarPermisos() {
    const r = await this.db.query(
      `SELECT id, codigo, modulo, accion, descripcion
       FROM permisos ORDER BY modulo, codigo`,
    );
    return r.rows;
  }

  // Comprueba que los permisos existan y que el actor los tenga todos.
  private async verificarPermisos(
    c: PoolClient,
    actorId: string,
    permisos: string[],
  ): Promise<string[]> {
    if (permisos.length === 0) return [];
    const r = await c.query<{ codigo: string }>(
      'SELECT codigo FROM permisos WHERE id = ANY($1::uuid[]) ORDER BY codigo',
      [permisos],
    );
    if (r.rowCount !== permisos.length) {
      throw new BadRequestException('Algún permiso seleccionado no existe');
    }
    const faltan = await permisosFaltantes(c, actorId, permisos);
    if (faltan.length > 0) {
      throw new ForbiddenException(
        `No puede dar permisos que usted no tiene: ${faltan.join(', ')}`,
      );
    }
    return r.rows.map((f) => f.codigo);
  }

  private async actorTieneRol(c: PoolClient, actorId: string, rolId: string) {
    const r = await c.query(
      'SELECT 1 FROM usuario_roles WHERE usuario_id = $1 AND rol_id = $2',
      [actorId, rolId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async crear(actorId: string, ip: string | undefined, datos: DatosRol) {
    const codigo = texto(datos.codigo).toLowerCase();
    if (!CODIGO.test(codigo)) {
      throw new BadRequestException(
        'Código inválido: 2 a 50 letras minúsculas, números o guion bajo (ej: cajero_noche)',
      );
    }
    const d = this.validar(datos);

    try {
      return await this.db.transaccion(async (c) => {
        const codigos = await this.verificarPermisos(c, actorId, d.permisos);
        const r = await c.query<{ id: string }>(
          `INSERT INTO roles (codigo, nombre, descripcion)
           VALUES ($1, $2, $3) RETURNING id`,
          [codigo, d.nombre, d.descripcion],
        );
        const id = r.rows[0].id;
        await c.query(
          `INSERT INTO rol_permisos (rol_id, permiso_id)
           SELECT $1, unnest($2::uuid[])`,
          [id, d.permisos],
        );
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'rol.crear',
          entidad: 'roles',
          entidadId: id,
          nuevo: {
            codigo,
            nombre: d.nombre,
            descripcion: d.descripcion,
            permisos: codigos,
          },
          ip,
        });
        return { id };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException('Ese código de rol ya existe');
      }
      throw e;
    }
  }

  async editar(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: DatosRol,
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Rol no encontrado');
    const d = this.validar(datos);

    return this.db.transaccion(async (c) => {
      const r = await c.query<{
        nombre: string;
        descripcion: string | null;
        is_system: boolean;
      }>(
        'SELECT nombre, descripcion, is_system FROM roles WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (r.rowCount === 0) throw new NotFoundException('Rol no encontrado');
      const antes = r.rows[0];

      const actuales = await c.query<{ permiso_id: string; codigo: string }>(
        `SELECT rp.permiso_id, p.codigo
         FROM rol_permisos rp JOIN permisos p ON p.id = rp.permiso_id
         WHERE rp.rol_id = $1 ORDER BY p.codigo`,
        [id],
      );
      const idsAntes = new Set(actuales.rows.map((f) => f.permiso_id));
      const idsNuevos = new Set(d.permisos);
      const agregados = d.permisos.filter((p) => !idsAntes.has(p));
      const quitados = [...idsAntes].filter((p) => !idsNuevos.has(p));
      const cambianPermisos = agregados.length > 0 || quitados.length > 0;

      // Nadie edita un rol que tiene permisos que él no tiene.
      const faltan = await permisosFaltantesDeRol(c, actorId, id);
      if (faltan.length > 0) {
        throw new ForbiddenException(
          `No puede editar un rol con permisos que usted no tiene: ${faltan.join(', ')}`,
        );
      }

      if (cambianPermisos) {
        if (antes.is_system) {
          throw new BadRequestException(
            'Este rol está protegido: no se le pueden cambiar los permisos',
          );
        }
        if (await this.actorTieneRol(c, actorId, id)) {
          throw new BadRequestException(
            'No puede cambiar los permisos de un rol que usted tiene',
          );
        }
      }

      const codigosNuevos = await this.verificarPermisos(
        c,
        actorId,
        d.permisos,
      );

      await c.query(
        `UPDATE roles SET nombre = $2, descripcion = $3, updated_at = now()
         WHERE id = $1`,
        [id, d.nombre, d.descripcion],
      );

      if (antes.nombre !== d.nombre || antes.descripcion !== d.descripcion) {
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'rol.editar',
          entidad: 'roles',
          entidadId: id,
          anterior: { nombre: antes.nombre, descripcion: antes.descripcion },
          nuevo: { nombre: d.nombre, descripcion: d.descripcion },
          ip,
        });
      }

      if (cambianPermisos) {
        if (quitados.length > 0) {
          await c.query(
            'DELETE FROM rol_permisos WHERE rol_id = $1 AND permiso_id = ANY($2::uuid[])',
            [id, quitados],
          );
        }
        if (agregados.length > 0) {
          await c.query(
            `INSERT INTO rol_permisos (rol_id, permiso_id)
             SELECT $1, unnest($2::uuid[])`,
            [id, agregados],
          );
        }
        const codigosAntes = actuales.rows.map((f) => f.codigo);
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'rol.cambiar_permisos',
          entidad: 'roles',
          entidadId: id,
          anterior: { rol: d.nombre, permisos: codigosAntes },
          nuevo: {
            rol: d.nombre,
            permisos: codigosNuevos,
            agregados: codigosNuevos.filter((p) => !codigosAntes.includes(p)),
            quitados: codigosAntes.filter((p) => !codigosNuevos.includes(p)),
          },
          ip,
        });
      }

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
    if (!UUID.test(id)) throw new NotFoundException('Rol no encontrado');
    if (typeof activo !== 'boolean') {
      throw new BadRequestException('Estado inválido');
    }
    const textoMotivo = texto(motivo);
    if (!activo && textoMotivo.length < 5) {
      throw new BadRequestException(
        'Escriba el motivo de la desactivación (mínimo 5 caracteres)',
      );
    }

    return this.db.transaccion(async (c) => {
      const r = await c.query<{
        nombre: string;
        is_active: boolean;
        is_system: boolean;
      }>(
        'SELECT nombre, is_active, is_system FROM roles WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (r.rowCount === 0) throw new NotFoundException('Rol no encontrado');
      const antes = r.rows[0];
      if (antes.is_active === activo) return { ok: true };

      if (antes.is_system) {
        throw new BadRequestException(
          'Este rol está protegido: no se puede desactivar',
        );
      }
      if (await this.actorTieneRol(c, actorId, id)) {
        throw new BadRequestException(
          'No puede cambiar el estado de un rol que usted tiene',
        );
      }
      const faltan = await permisosFaltantesDeRol(c, actorId, id);
      if (faltan.length > 0) {
        throw new ForbiddenException(
          `No puede gestionar un rol con permisos que usted no tiene: ${faltan.join(', ')}`,
        );
      }

      const usuarios = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM usuario_roles ur
         JOIN usuarios u ON u.id = ur.usuario_id AND u.is_active = true
         WHERE ur.rol_id = $1`,
        [id],
      );

      await c.query(
        'UPDATE roles SET is_active = $2, updated_at = now() WHERE id = $1',
        [id, activo],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: activo ? 'rol.activar' : 'rol.desactivar',
        entidad: 'roles',
        entidadId: id,
        anterior: { nombre: antes.nombre, is_active: antes.is_active },
        nuevo: {
          nombre: antes.nombre,
          is_active: activo,
          usuarios_afectados: usuarios.rows[0].n,
        },
        motivo: textoMotivo || undefined,
        ip,
      });
      return { ok: true };
    });
  }
}
