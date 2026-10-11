import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { UsuarioActual } from '../auth/jwt-auth.guard';
import { PermisosGuard } from '../auth/permisos.guard';
import { RequierePermiso } from '../auth/permisos.decorator';
import { MovimientosService } from './movimientos.service';

type Peticion = { usuario: UsuarioActual; ip?: string };

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('productos')
export class MovimientosController {
  constructor(private readonly movimientos: MovimientosService) {}

  @Post(':id/entradas')
  @RequierePermiso('inventario.entradas')
  entrada(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body()
    body: {
      cantidad?: unknown;
      costoUnitario?: unknown;
      proveedor?: unknown;
      referencia?: unknown;
      nota?: unknown;
    },
  ) {
    return this.movimientos.entrada(req.usuario.id, id, req.ip, body ?? {});
  }

  @Post(':id/salidas')
  @RequierePermiso('inventario.salidas')
  salida(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body()
    body: {
      cantidad?: unknown;
      causa?: unknown;
      motivo?: unknown;
      referencia?: unknown;
    },
  ) {
    return this.movimientos.salida(req.usuario.id, id, req.ip, body ?? {});
  }

  @Post(':id/ajustes')
  @RequierePermiso('inventario.ajustar')
  ajuste(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: { conteo?: unknown; motivo?: unknown },
  ) {
    return this.movimientos.ajuste(req.usuario.id, id, req.ip, body ?? {});
  }

  @Get(':id/kardex')
  @RequierePermiso('inventario.ver')
  kardex(@Req() req: Peticion, @Param('id') id: string) {
    return this.movimientos.kardex(req.usuario.id, id);
  }
}
