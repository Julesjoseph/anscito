import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermisosGuard } from '../auth/permisos.guard';
import { RequierePermiso } from '../auth/permisos.decorator';
import { DatabaseService } from '../database/database.service';

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @RequierePermiso('usuarios.ver')
  async listar() {
    const r = await this.db.query(
      `SELECT u.id, u.username, u.nombre, u.apellido, u.is_active,
              u.last_login_at,
              COALESCE(string_agg(ro.nombre, ', ' ORDER BY ro.nombre), '') AS roles
       FROM usuarios u
       LEFT JOIN usuario_roles ur ON ur.usuario_id = u.id
       LEFT JOIN roles ro ON ro.id = ur.rol_id
       GROUP BY u.id
       ORDER BY u.username`,
    );
    return r.rows;
  }
}