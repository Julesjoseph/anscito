import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { registrarAuditoria } from '../auditoria/auditoria';
import { DatabaseService } from '../database/database.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME = /^[a-z0-9._-]{3,50}$/;

export type DatosCrear = {
  username?: string;
  nombre?: string;
  apellido?: string;
  password?: string;
  rolId?: string;
};

export type DatosEditar = {
  nombre?: string;
  apellido?: string;
  rolId?: string;
};

type FilaEdicion = {
  id: string;
  nombre: string;
  apellido: string;
  rol_id: string | null;
  rol: string | null;
};

@Injectable()
export class UsuariosService {
  constructor(private readonly db: DatabaseService) {}

  async listar() {
    const r = await this.db.query(
      `SELECT u.id, u.username, u.nombre, u.apellido, u.is_active,
              u.last_login_at,
              COALESCE(string_agg(ro.nombre, ', ' ORDER BY ro.nombre), '') AS roles,
              (array_agg(ur.rol_id))[1] AS rol_id
       FROM usuarios u
       LEFT JOIN usuario_roles ur ON ur.usuario_id = u.id
       LEFT JOIN roles ro ON ro.id = ur.rol_id
       GROUP BY u.id
       ORDER BY u.username`,
    );
    return r.rows;
  }

  async listarRoles() {
    const r = await this.db.query(
      `SELECT id, codigo, nombre FROM roles
       WHERE is_active = true ORDER BY nombre`,
    );
    return r.rows;
  }

  async crear(actorId: string, ip: string | undefined, datos: DatosCrear) {
    const username = String(datos.username ?? '').trim().toLowerCase();
    const nombre = String(datos.nombre ?? '').trim();
    const apellido = String(datos.apellido ?? '').trim();
    const password = String(datos.password ?? '');
    const rolId = String(datos.rolId ?? '');

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
    if (!UUID.test(rolId)) {
      throw new BadRequestException('Seleccione un rol');
    }

    const hash = await bcrypt.hash(password, 12);

    try {
      return await this.db.transaccion(async (c) => {
        const rol = await c.query<{ id: string; nombre: string }>(
          'SELECT id, nombre FROM roles WHERE id = $1 AND is_active = true',
          [rolId],
        );
        if (rol.rowCount === 0) {
          throw new BadRequestException('El rol seleccionado no existe');
        }

        const u = await c.query<{ id: string }>(
          `INSERT INTO usuarios
             (username, nombre, apellido, password_hash,
              must_change_password, created_by)
           VALUES ($1, $2, $3, $4, true, $5)
           RETURNING id`,
          [username, nombre, apellido, hash, actorId],
        );
        const nuevoId = u.rows[0].id;

        await c.query(
          'INSERT INTO usuario_roles (usuario_id, rol_id) VALUES ($1, $2)',
          [nuevoId, rolId],
        );

        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'usuario.crear',
          entidad: 'usuarios',
          entidadId: nuevoId,
          nuevo: { username, nombre, apellido, rol: rol.rows[0].nombre },
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
    const rolId = String(datos.rolId ?? '');

    if (!nombre || !apellido || nombre.length > 100 || apellido.length > 100) {
      throw new BadRequestException('El nombre y el apellido son obligatorios');
    }
    if (!UUID.test(rolId)) throw new BadRequestException('Seleccione un rol');

    return this.db.transaccion(async (c) => {
      const act = await c.query<FilaEdicion>(
        `SELECT u.id, u.nombre, u.apellido, ur.rol_id, ro.nombre AS rol
         FROM usuarios u
         LEFT JOIN usuario_roles ur ON ur.usuario_id = u.id
         LEFT JOIN roles ro ON ro.id = ur.rol_id
         WHERE u.id = $1
         FOR UPDATE OF u`,
        [id],
      );
      if (act.rowCount === 0) throw new NotFoundException('Usuario no encontrado');
      const antes = act.rows[0];

      if (id === actorId && rolId !== antes.rol_id) {
        throw new BadRequestException('No puede cambiar su propio rol');
      }

      const rol = await c.query<{ id: string; nombre: string }>(
        'SELECT id, nombre FROM roles WHERE id = $1 AND is_active = true',
        [rolId],
      );
      if (rol.rowCount === 0) {
        throw new BadRequestException('El rol seleccionado no existe');
      }

      await c.query(
        'UPDATE usuarios SET nombre = $2, apellido = $3, updated_at = now() WHERE id = $1',
        [id, nombre, apellido],
      );
      if (rolId !== antes.rol_id) {
        await c.query('DELETE FROM usuario_roles WHERE usuario_id = $1', [id]);
        await c.query(
          'INSERT INTO usuario_roles (usuario_id, rol_id) VALUES ($1, $2)',
          [id, rolId],
        );
      }

      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'usuario.editar',
        entidad: 'usuarios',
        entidadId: id,
        anterior: { nombre: antes.nombre, apellido: antes.apellido, rol: antes.rol },
        nuevo: { nombre, apellido, rol: rol.rows[0].nombre },
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
      if (r.rowCount === 0) throw new NotFoundException('Usuario no encontrado');
      const antes = r.rows[0];
      if (antes.is_active === activo) return { ok: true };

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