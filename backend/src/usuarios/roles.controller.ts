import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermisosGuard } from '../auth/permisos.guard';
import { RequierePermiso } from '../auth/permisos.decorator';
import { UsuariosService } from './usuarios.service';

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('roles')
export class RolesController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  @RequierePermiso('roles.ver')
  listar() {
    return this.usuarios.listarRoles();
  }
}