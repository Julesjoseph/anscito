import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
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
import { UsuariosSeguridadService } from './usuarios-seguridad.service';
import { UsuariosService } from './usuarios.service';
import type { DatosCrear, DatosEditar } from './usuarios.service';

type Peticion = { usuario: UsuarioActual; ip?: string };

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('usuarios')
export class UsuariosController {
  constructor(
    private readonly usuarios: UsuariosService,
    private readonly seguridad: UsuariosSeguridadService,
  ) {}

  @Get()
  @RequierePermiso('usuarios.ver')
  listar() {
    return this.usuarios.listar();
  }

  @Get('sucursales')
  @RequierePermiso('usuarios.ver')
  sucursales() {
    return this.usuarios.listarSucursales();
  }

  @Post()
  @RequierePermiso('usuarios.crear')
  crear(@Req() req: Peticion, @Body() body: DatosCrear) {
    return this.usuarios.crear(req.usuario.id, req.ip, body ?? {});
  }

  @Patch(':id')
  @RequierePermiso('usuarios.editar')
  editar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: DatosEditar,
  ) {
    return this.usuarios.editar(req.usuario.id, id, req.ip, body ?? {});
  }

  @Patch(':id/estado')
  @RequierePermiso('usuarios.desactivar')
  estado(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: { is_active?: boolean; motivo?: string },
  ) {
    return this.usuarios.cambiarEstado(
      req.usuario.id,
      id,
      body?.is_active,
      body?.motivo,
      req.ip,
    );
  }

  @Post(':id/resetear-password')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequierePermiso('usuarios.resetear_password')
  resetear(@Req() req: Peticion, @Param('id') id: string) {
    return this.seguridad.resetearPassword(req.usuario.id, id, req.ip);
  }

  @Post(':id/desbloquear')
  @HttpCode(200)
  @RequierePermiso('usuarios.resetear_password')
  desbloquear(@Req() req: Peticion, @Param('id') id: string) {
    return this.seguridad.desbloquear(req.usuario.id, id, req.ip);
  }
}