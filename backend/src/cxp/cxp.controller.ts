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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { UsuarioActual } from '../auth/jwt-auth.guard';
import { PermisosGuard } from '../auth/permisos.guard';
import { RequierePermiso } from '../auth/permisos.decorator';
import { CxpService } from './cxp.service';

type Peticion = { usuario: UsuarioActual; ip?: string };
type Cuerpo = Record<string, unknown>;

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('cxp')
export class CxpController {
  constructor(private readonly cxp: CxpService) {}

  @Get('preparar')
  @RequierePermiso('cxp.ver')
  preparar() {
    return this.cxp.preparar();
  }

  @Get('alertas')
  @RequierePermiso('cxp.ver')
  alertas() {
    return this.cxp.alertas();
  }

  @Get('proveedores')
  @RequierePermiso('cxp.ver')
  proveedores() {
    return this.cxp.proveedores();
  }

  @Get('proveedores/:id')
  @RequierePermiso('cxp.ver')
  detalle(@Param('id') id: string) {
    return this.cxp.detalle(id);
  }

  @Post('pagos')
  @RequierePermiso('cxp.pagar')
  pagar(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.cxp.pagar(req.usuario.id, req.ip, body ?? {});
  }

  @Post('pagos/:id/anular')
  @HttpCode(200)
  @RequierePermiso('cxp.anular_pago')
  anular(@Req() req: Peticion, @Param('id') id: string, @Body() body: Cuerpo) {
    return this.cxp.anularPago(req.usuario.id, id, req.ip, body ?? {});
  }

  @Get('pagos/:id/ticket')
  @RequierePermiso('cxp.ver')
  ticket(@Param('id') id: string) {
    return this.cxp.comprobanteTicket(id);
  }

  @Get('pagos/:id/pdf')
  @RequierePermiso('cxp.ver')
  async pdf(
    @Param('id') id: string,
    @Query('formato') formato: string | undefined,
    @Res() res: Response,
  ) {
    const { pdf, nombre } = await this.cxp.comprobantePdf(id, formato);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${nombre}"`,
      'Cache-Control': 'no-store',
    });
    res.send(pdf);
  }

  @Get('gastos-fijos')
  @RequierePermiso('cxp.ver')
  gastosFijos() {
    return this.cxp.gastosFijos();
  }

  @Post('gastos-fijos')
  @RequierePermiso('cxp.gastos_fijos')
  crearGasto(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.cxp.guardarGastoFijo(req.usuario.id, null, req.ip, body ?? {});
  }

  @Put('gastos-fijos/:id')
  @RequierePermiso('cxp.gastos_fijos')
  editarGasto(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: Cuerpo,
  ) {
    return this.cxp.guardarGastoFijo(req.usuario.id, id, req.ip, body ?? {});
  }

  @Patch('configuracion')
  @RequierePermiso('cxp.gastos_fijos')
  configurar(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.cxp.configurarDias(req.usuario.id, req.ip, body ?? {});
  }
}
