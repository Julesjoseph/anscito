import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { UsuarioActual } from '../auth/jwt-auth.guard';
import { PermisosGuard } from '../auth/permisos.guard';
import { RequierePermiso } from '../auth/permisos.decorator';
import { ServiciosService } from './servicios.service';
import type { DatosServicio } from './servicios.service';

type Peticion = { usuario: UsuarioActual; ip?: string };

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('servicios')
export class ServiciosController {
  constructor(private readonly servicios: ServiciosService) {}

  @Get()
  @RequierePermiso('servicios.ver')
  listar(
    @Query('texto') texto?: string,
    @Query('unidadNegocioId') unidadNegocioId?: string,
    @Query('categoriaId') categoriaId?: string,
    @Query('estado') estado?: string,
  ) {
    return this.servicios.listar({
      texto,
      unidadNegocioId,
      categoriaId,
      estado,
    });
  }

  @Get('catalogos')
  @RequierePermiso('servicios.ver')
  catalogos() {
    return this.servicios.catalogos();
  }

  @Post('calcular')
  @HttpCode(200)
  @RequierePermiso('servicios.ver')
  calcular(
    @Body()
    body: {
      precio?: unknown;
      impuestoId?: unknown;
      precioIncluyeItbis?: unknown;
    },
  ) {
    return this.servicios.calcular(body ?? {});
  }

  @Post()
  @RequierePermiso('servicios.crear')
  crear(@Req() req: Peticion, @Body() body: DatosServicio) {
    return this.servicios.crear(req.usuario.id, req.ip, body ?? {});
  }

  @Patch(':id')
  @RequierePermiso('servicios.editar')
  editar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: DatosServicio,
  ) {
    return this.servicios.editar(req.usuario.id, id, req.ip, body ?? {});
  }

  @Patch(':id/estado')
  @RequierePermiso('servicios.desactivar')
  estado(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: { is_active?: unknown; motivo?: unknown },
  ) {
    return this.servicios.cambiarEstado(
      req.usuario.id,
      id,
      body?.is_active,
      body?.motivo,
      req.ip,
    );
  }
}
