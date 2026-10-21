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
import { BancosService } from './bancos.service';
import type { Ambito } from './bancos.service';
import { ConciliacionService } from './conciliacion.service';

type Peticion = { usuario: UsuarioActual; ip?: string };
type Cuerpo = Record<string, unknown>;

// Conciliación de las cuentas de banco (/conciliaciones, bancos.*) y de las
// billeteras (/billeteras/conciliaciones, billeteras.*).
function controladorConciliacion(ruta: string, ambito: Ambito, p: string) {
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Controller(ruta)
  class ControladorConciliacion {
    constructor(
      readonly conciliacion: ConciliacionService,
      readonly bancos: BancosService,
    ) {}

    @Get()
    @RequierePermiso(`${p}.ver`)
    async listar(@Query('cuentaId') cuentaId?: string) {
      await this.bancos.exigirAmbito(ambito, {
        cuentaId: String(cuentaId ?? '')
          .trim()
          .toLowerCase(),
      });
      return this.conciliacion.listar(cuentaId);
    }

    @Get(':id')
    @RequierePermiso(`${p}.ver`)
    async detalle(@Param('id') id: string) {
      await this.bancos.exigirAmbito(ambito, { conciliacionId: id });
      return this.conciliacion.detalle(id);
    }

    @Post()
    @RequierePermiso(`${p}.confirmar`)
    async crear(@Req() req: Peticion, @Body() body: Cuerpo) {
      await this.bancos.exigirAmbito(ambito, {
        cuentaId: String(body?.cuentaId ?? '')
          .trim()
          .toLowerCase(),
      });
      return this.conciliacion.crear(req.usuario.id, req.ip, body ?? {});
    }

    @Patch(':id')
    @RequierePermiso(`${p}.confirmar`)
    async editar(
      @Req() req: Peticion,
      @Param('id') id: string,
      @Body() body: Cuerpo,
    ) {
      await this.bancos.exigirAmbito(ambito, { conciliacionId: id });
      return this.conciliacion.editar(req.usuario.id, id, req.ip, body ?? {});
    }

    @Put(':id/partidas')
    @RequierePermiso(`${p}.confirmar`)
    async marcar(
      @Req() req: Peticion,
      @Param('id') id: string,
      @Body() body: Cuerpo,
    ) {
      await this.bancos.exigirAmbito(ambito, { conciliacionId: id });
      return this.conciliacion.marcar(req.usuario.id, id, body ?? {});
    }

    @Post(':id/cerrar')
    @HttpCode(200)
    @RequierePermiso(`${p}.confirmar`)
    async cerrar(@Req() req: Peticion, @Param('id') id: string) {
      await this.bancos.exigirAmbito(ambito, { conciliacionId: id });
      return this.conciliacion.cerrar(req.usuario.id, id, req.ip);
    }

    @Post(':id/descartar')
    @HttpCode(200)
    @RequierePermiso(`${p}.confirmar`)
    async descartar(
      @Req() req: Peticion,
      @Param('id') id: string,
      @Body() body: Cuerpo,
    ) {
      await this.bancos.exigirAmbito(ambito, { conciliacionId: id });
      return this.conciliacion.descartar(
        req.usuario.id,
        id,
        req.ip,
        body ?? {},
      );
    }
  }
  return ControladorConciliacion;
}

export const ConciliacionController = controladorConciliacion(
  'conciliaciones',
  'banco',
  'bancos',
);
export const ConciliacionBilleterasController = controladorConciliacion(
  'billeteras/conciliaciones',
  'billetera',
  'billeteras',
);
