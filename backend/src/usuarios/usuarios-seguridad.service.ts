import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { registrarAuditoria } from '../auditoria/auditoria';
import { puedeGestionarUsuario } from '../auth/jerarquia';
import { DatabaseService } from '../database/database.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function claveTemporal(largo = 12): string {
  let s = '';
  for (let i = 0; i < largo; i++) {
    s += ALFABETO[randomInt(ALFABETO.length)];
  }
  return s;
}

@Injectable()
export class UsuariosSeguridadService {
  constructor(private readonly db: DatabaseService) {}

  async resetearPassword(actorId: string, id: string, ip: string | undefined) {
    if (!UUID.test(id)) throw new NotFoundException('Usuario no encontrado');
    if (id === actorId) {
      throw new BadRequestException(
        'Para su propio usuario use la opción de cambiar contraseña',
      );
    }

    const temporal = claveTemporal();
    const hash = await bcrypt.hash(temporal, 12);

    return this.db.transaccion(async (c) => {
      const r = await c.query<{ username: string }>(
        'SELECT username FROM usuarios WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (r.rowCount === 0)
        throw new NotFoundException('Usuario no encontrado');

      if (!(await puedeGestionarUsuario(c, actorId, id))) {
        throw new ForbiddenException(
          'No puede gestionar a un usuario con más permisos que los suyos',
        );
      }

      await c.query(
        `UPDATE usuarios
         SET password_hash = $2, must_change_password = true,
             failed_attempts = 0, locked_until = NULL,
             password_changed_at = now(), updated_at = now()
         WHERE id = $1`,
        [id, hash],
      );

      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'usuario.resetear_password',
        entidad: 'usuarios',
        entidadId: id,
        nuevo: { username: r.rows[0].username },
        ip,
      });

      return { username: r.rows[0].username, passwordTemporal: temporal };
    });
  }

  async desbloquear(actorId: string, id: string, ip: string | undefined) {
    if (!UUID.test(id)) throw new NotFoundException('Usuario no encontrado');

    return this.db.transaccion(async (c) => {
      const r = await c.query<{
        username: string;
        locked_until: Date | null;
        failed_attempts: number;
      }>(
        `SELECT username, locked_until, failed_attempts
         FROM usuarios WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (r.rowCount === 0)
        throw new NotFoundException('Usuario no encontrado');

      if (!(await puedeGestionarUsuario(c, actorId, id))) {
        throw new ForbiddenException(
          'No puede gestionar a un usuario con más permisos que los suyos',
        );
      }

      await c.query(
        `UPDATE usuarios
         SET failed_attempts = 0, locked_until = NULL, updated_at = now()
         WHERE id = $1`,
        [id],
      );

      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'usuario.desbloquear',
        entidad: 'usuarios',
        entidadId: id,
        anterior: {
          username: r.rows[0].username,
          locked_until: r.rows[0].locked_until,
          failed_attempts: r.rows[0].failed_attempts,
        },
        ip,
      });

      return { ok: true };
    });
  }
}
