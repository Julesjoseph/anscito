import {
  CanActivate,
  ExecutionContext,
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
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    try {
      const datos = jwt.verify(token, secreto, { algorithms: ['HS256'] });
      if (typeof datos === 'string' || typeof datos.sub !== 'string') {
        throw new Error('token inválido');
      }
      id = datos.sub;
    } catch {
      throw new UnauthorizedException('Sesión inválida o vencida');
    }

    if (!UUID.test(id)) {
      throw new UnauthorizedException('Sesión inválida o vencida');
    }

    const r = await this.db.query<UsuarioActual>(
      `SELECT id, username, nombre, apellido
       FROM usuarios WHERE id = $1 AND is_active = true`,
      [id],
    );
    if (!r.rows[0]) {
      throw new UnauthorizedException('Sesión inválida o vencida');
    }

    req.usuario = r.rows[0];
    return true;
  }
}