import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { DatabaseService } from '../database/database.service';

export type UsuarioActual = {
  id: string;
  username: string;
  nombre: string;
  apellido: string;
  must_change_password: boolean;
};

type FilaSesion = UsuarioActual & { password_changed_at: Date };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUTAS_SIN_CAMBIO = ['/auth/me', '/auth/cambiar-password'];

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const cabecera: string | undefined = req.headers['authorization'];

    if (!cabecera || !cabecera.startsWith('Bearer ')) {
      throw new UnauthorizedException('Debe iniciar sesión');
    }
    const token = cabecera.slice(7).trim();

    const secreto = process.env.JWT_SECRET;
    if (!secreto || secreto.length < 32) {
      throw new Error('JWT_SECRET no está configurado correctamente');
    }

    let id: string;
    let emitido: number;
    try {
      const datos = jwt.verify(token, secreto, { algorithms: ['HS256'] });
      if (
        typeof datos === 'string' ||
        typeof datos.sub !== 'string' ||
        typeof datos.iat !== 'number'
      ) {
        throw new Error('token inválido');
      }
      id = datos.sub;
      emitido = datos.iat;
    } catch {
      throw new UnauthorizedException('Sesión inválida o vencida');
    }

    if (!UUID.test(id)) {
      throw new UnauthorizedException('Sesión inválida o vencida');
    }

    const r = await this.db.query<FilaSesion>(
      `SELECT id, username, nombre, apellido, must_change_password,
              password_changed_at
       FROM usuarios WHERE id = $1 AND is_active = true`,
      [id],
    );
    const fila = r.rows[0];
    if (!fila) {
      throw new UnauthorizedException('Sesión inválida o vencida');
    }

    // Un restablecimiento de contraseña invalida las sesiones anteriores.
    if (emitido < Math.floor(fila.password_changed_at.getTime() / 1000)) {
      throw new UnauthorizedException('Sesión inválida o vencida');
    }

    if (fila.must_change_password && !RUTAS_SIN_CAMBIO.includes(req.path)) {
      throw new ForbiddenException(
        'Debe cambiar su contraseña antes de continuar',
      );
    }

    req.usuario = {
      id: fila.id,
      username: fila.username,
      nombre: fila.nombre,
      apellido: fila.apellido,
      must_change_password: fila.must_change_password,
    } satisfies UsuarioActual;
    return true;
  }
}