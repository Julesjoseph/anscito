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
import { ImpuestosService } from './impuestos.service';

type Peticion = { usuario: UsuarioActual; ip?: string };

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('impuestos')
export class ImpuestosController {
  constructor(private readonly impuestos: ImpuestosService) {}

  @Get()
  @RequierePermiso('impuestos.ver')
  listar() {
    return this.impuestos.listar();
  }

  @Post()
  @RequierePermiso('impuestos.gestionar')
  crear(
    @Req() req: Peticion,
    @Body()
    body: {
      codigo?: unknown;
      nombre?: unknown;
      tasa?: unknown;
      vigenteDesde?: unknown;
    },
  ) {
    return this.impuestos.crear(req.usuario.id, req.ip, body ?? {});
  }

  @Post(':id/tasas')
  @RequierePermiso('impuestos.gestionar')
  nuevaTasa(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: { tasa?: unknown; vigenteDesde?: unknown; motivo?: unknown },
  ) {
    return this.impuestos.nuevaTasa(req.usuario.id, id, req.ip, body ?? {});
  }

  @Patch(':id/estado')
  @RequierePermiso('impuestos.gestionar')
  estado(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: { is_active?: unknown; motivo?: unknown },
  ) {
    return this.impuestos.cambiarEstado(
      req.usuario.id,
      id,
      body?.is_active,
      body?.motivo,
      req.ip,
    );
  }
}
