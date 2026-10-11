import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { UsuarioActual } from '../auth/jwt-auth.guard';
import { PermisosGuard } from '../auth/permisos.guard';
import { RequierePermiso } from '../auth/permisos.decorator';
import { RolesService } from './roles.service';
import type { DatosRol } from './roles.service';
import { UsuariosService } from './usuarios.service';

type Peticion = { usuario: UsuarioActual; ip?: string };

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('roles')
export class RolesController {
  constructor(
    private readonly usuarios: UsuariosService,
    private readonly roles: RolesService,
  ) {}

  // Roles activos, para elegir en el formulario de usuarios.
  @Get()
  @RequierePermiso('roles.ver')
  listar() {
    return this.usuarios.listarRoles();
  }

  // Todos los roles con sus permisos, para la pantalla de Roles.
  @Get('gestion')
  @RequierePermiso('roles.ver')
  listarGestion() {
    return this.roles.listar();
  }

  @Get('permisos')
  @RequierePermiso('roles.ver')
  permisos() {
    return this.roles.listarPermisos();
  }

  @Post()
  @RequierePermiso('roles.gestionar')
  crear(@Req() req: Peticion, @Body() body: DatosRol) {
    return this.roles.crear(req.usuario.id, req.ip, body ?? {});
  }

  @Patch(':id')
  @RequierePermiso('roles.gestionar')
  editar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: DatosRol,
  ) {
    return this.roles.editar(req.usuario.id, id, req.ip, body ?? {});
  }

  @Patch(':id/estado')
  @RequierePermiso('roles.gestionar')
  estado(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: { is_active?: unknown; motivo?: unknown },
  ) {
    return this.roles.cambiarEstado(
      req.usuario.id,
      id,
      body?.is_active,
      body?.motivo,
      req.ip,
    );
  }
}
