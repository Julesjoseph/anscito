import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { UsuarioActual } from '../auth/jwt-auth.guard';
import { PermisosGuard } from '../auth/permisos.guard';
import { RequierePermiso } from '../auth/permisos.decorator';
import { ConciliacionService } from './conciliacion.service';

type Peticion = { usuario: UsuarioActual; ip?: string };
type Cuerpo = Record<string, unknown>;

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('conciliaciones')
export class ConciliacionController {
  constructor(private readonly conciliacion: ConciliacionService) {}

  @Get()
  @RequierePermiso('bancos.ver')
  listar(@Query('cuentaId') cuentaId?: string) {
    return this.conciliacion.listar(cuentaId);
  }

  @Get(':id')
  @RequierePermiso('bancos.ver')
  detalle(@Param('id') id: string) {
    return this.conciliacion.detalle(id);
  }

  @Post()
  @RequierePermiso('bancos.confirmar')
  crear(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.conciliacion.crear(req.usuario.id, req.ip, body ?? {});
  }

  @Patch(':id')
  @RequierePermiso('bancos.confirmar')
  editar(@Req() req: Peticion, @Param('id') id: string, @Body() body: Cuerpo) {
    return this.conciliacion.editar(req.usuario.id, id, req.ip, body ?? {});
  }

  @Put(':id/partidas')
  @RequierePermiso('bancos.confirmar')
  marcar(@Req() req: Peticion, @Param('id') id: string, @Body() body: Cuerpo) {
    return this.conciliacion.marcar(req.usuario.id, id, body ?? {});
  }

  @Post(':id/cerrar')
  @HttpCode(200)
  @RequierePermiso('bancos.confirmar')
  cerrar(@Req() req: Peticion, @Param('id') id: string) {
    return this.conciliacion.cerrar(req.usuario.id, id, req.ip);
  }

  @Post(':id/descartar')
  @HttpCode(200)
  @RequierePermiso('bancos.confirmar')
  descartar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: Cuerpo,
  ) {
    return this.conciliacion.descartar(req.usuario.id, id, req.ip, body ?? {});
  }
}
