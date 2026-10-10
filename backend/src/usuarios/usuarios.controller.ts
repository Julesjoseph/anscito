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
import { UsuariosService } from './usuarios.service';
import type { DatosCrear, DatosEditar } from './usuarios.service';

type Peticion = { usuario: UsuarioActual; ip?: string };

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  @RequierePermiso('usuarios.ver')
  listar() {
    return this.usuarios.listar();
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
}