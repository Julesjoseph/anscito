import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from '../database/database.service';
import { PERMISO_KEY } from './permisos.decorator';

@Injectable()
export class PermisosGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requerido = this.reflector.getAllAndOverride<string>(PERMISO_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requerido) {
      throw new ForbiddenException('Ruta sin permiso definido');
    }

    const usuario = context.switchToHttp().getRequest().usuario;
    if (!usuario) {
      throw new ForbiddenException('No tiene permiso para esta acción');
    }

    const r = await this.db.query(
      `SELECT 1
       FROM usuario_roles ur
       JOIN roles ro ON ro.id = ur.rol_id AND ro.is_active = true
       JOIN rol_permisos rp ON rp.rol_id = ro.id
       JOIN permisos p ON p.id = rp.permiso_id
       WHERE ur.usuario_id = $1 AND p.codigo = $2
       LIMIT 1`,
      [usuario.id, requerido],
    );
    if (r.rowCount === 0) {
      throw new ForbiddenException('No tiene permiso para esta acción');
    }
    return true;
  }
}