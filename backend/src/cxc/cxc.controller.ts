import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
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
import { CxcService } from './cxc.service';

type Peticion = { usuario: UsuarioActual; ip?: string };
type Cuerpo = Record<string, unknown>;

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('cxc')
export class CxcController {
  constructor(private readonly cxc: CxcService) {}

  @Get('preparar')
  @RequierePermiso('cxc.ver')
  preparar() {
    return this.cxc.preparar();
  }

  @Get('clientes')
  @RequierePermiso('cxc.ver')
  listar(@Query('texto') texto?: string, @Query('solo') solo?: string) {
    return this.cxc.listar({ texto, solo });
  }

  @Get('buscar-clientes')
  @RequierePermiso('cxc.gestionar')
  buscar(@Query('texto') texto?: string) {
    return this.cxc.buscarClientes(texto);
  }

  @Get('clientes/:id')
  @RequierePermiso('cxc.ver')
  detalle(@Param('id') id: string) {
    return this.cxc.detalle(id);
  }

  // Para la pantalla de Ventas (quien vende a crédito).
  @Get('clientes/:id/resumen')
  @RequierePermiso('cxc.vender')
  resumen(@Param('id') id: string) {
    return this.cxc.resumenVenta(id);
  }

  @Put('clientes/:id/credito')
  @RequierePermiso('cxc.gestionar')
  configurar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: Cuerpo,
  ) {
    return this.cxc.configurarCliente(req.usuario.id, id, req.ip, body ?? {});
  }

  @Post('clientes/:id/autorizacion')
  @RequierePermiso('cxc.autorizar')
  autorizar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: Cuerpo,
  ) {
    return this.cxc.autorizarPrevia(req.usuario.id, id, req.ip, body ?? {});
  }

  @Post('tasas')
  @RequierePermiso('cxc.gestionar')
  tasa(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.cxc.nuevaTasa(req.usuario.id, req.ip, body ?? {});
  }

  @Post('cuentas/:id/perdonar')
  @HttpCode(200)
  @RequierePermiso('cxc.perdonar')
  perdonar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: Cuerpo,
  ) {
    return this.cxc.perdonar(req.usuario.id, id, req.ip, body ?? {});
  }

  @Post('abonos')
  @RequierePermiso('cxc.abonar')
  abonar(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.cxc.abonar(req.usuario.id, req.ip, body ?? {});
  }

  @Post('abonos/:id/anular')
  @HttpCode(200)
  @RequierePermiso('cxc.anular_abono')
  anular(@Req() req: Peticion, @Param('id') id: string, @Body() body: Cuerpo) {
    return this.cxc.anularAbono(req.usuario.id, id, req.ip, body ?? {});
  }

  @Get('abonos/:id/ticket')
  @RequierePermiso('cxc.ver')
  ticket(@Param('id') id: string) {
    return this.cxc.reciboTicket(id);
  }

  @Get('abonos/:id/pdf')
  @RequierePermiso('cxc.ver')
  async pdf(
    @Param('id') id: string,
    @Query('formato') formato: string | undefined,
    @Res() res: Response,
  ) {
    const { pdf, nombre } = await this.cxc.reciboPdf(id, formato);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${nombre}"`,
      'Cache-Control': 'no-store',
    });
    res.send(pdf);
  }
}
