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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { UsuarioActual } from '../auth/jwt-auth.guard';
import { PermisosGuard } from '../auth/permisos.guard';
import { RequierePermiso } from '../auth/permisos.decorator';
import { VentasService } from './ventas.service';
import type { DatosVenta } from './ventas.service';

type Peticion = { usuario: UsuarioActual; ip?: string };

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('ventas')
export class VentasController {
  constructor(private readonly ventas: VentasService) {}

  @Get()
  @RequierePermiso('ventas.ver')
  listar(
    @Query('texto') texto?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('estado') estado?: string,
    @Query('pagina') pagina?: string,
  ) {
    return this.ventas.listar({ texto, desde, hasta, estado, pagina });
  }

  // Formas de pago, descuento máximo y Consumidor final.
  @Get('preparar')
  @RequierePermiso('ventas.crear')
  preparar(@Req() req: Peticion) {
    return this.ventas.preparar(req.usuario.id);
  }

  // Tasa del dólar: la ven quienes venden; la cambia el administrador.
  @Get('tasa-dolar')
  @RequierePermiso('ventas.ver')
  tasasDolar() {
    return this.ventas.tasasDolar();
  }

  @Post('tasa-dolar')
  @RequierePermiso('ventas.tasa_dolar')
  registrarTasaDolar(
    @Req() req: Peticion,
    @Body() body: { tasa?: unknown; motivo?: unknown },
  ) {
    return this.ventas.registrarTasaDolar(req.usuario.id, req.ip, body ?? {});
  }

  @Get('catalogo')
  @RequierePermiso('ventas.crear')
  catalogo(@Query('texto') texto?: string) {
    return this.ventas.catalogo(texto);
  }

  @Get('clientes')
  @RequierePermiso('ventas.crear')
  clientes(@Req() req: Peticion, @Query('texto') texto?: string) {
    return this.ventas.clientes(req.usuario.id, texto);
  }

  @Post('calcular')
  @HttpCode(200)
  @RequierePermiso('ventas.crear')
  calcular(@Req() req: Peticion, @Body() body: DatosVenta) {
    return this.ventas.previsualizar(req.usuario.id, body ?? {});
  }

  @Post()
  @RequierePermiso('ventas.crear')
  crear(@Req() req: Peticion, @Body() body: DatosVenta) {
    return this.ventas.crear(req.usuario.id, req.ip, body ?? {});
  }

  @Get(':id')
  @RequierePermiso('ventas.ver')
  detalle(@Req() req: Peticion, @Param('id') id: string) {
    return this.ventas.detalle(req.usuario.id, id);
  }

  // Datos del comprobante para imprimir directo en cualquier impresora.
  @Get(':id/ticket')
  @RequierePermiso('ventas.ver')
  ticket(@Req() req: Peticion, @Param('id') id: string) {
    return this.ventas.ticket(req.usuario.id, id);
  }

  // Comprobante interno en PDF, listo para imprimir o guardar.
  @Get(':id/recibo')
  @RequierePermiso('ventas.ver')
  async recibo(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Query('formato') formato: string | undefined,
    @Res() res: Response,
  ) {
    const { pdf, nombre } = await this.ventas.recibo(
      req.usuario.id,
      id,
      formato,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${nombre}"`,
      'Cache-Control': 'no-store',
    });
    res.send(pdf);
  }

  @Patch(':id/comprobante')
  @RequierePermiso('ventas.comprobante')
  comprobante(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: { comprobante?: unknown },
  ) {
    return this.ventas.comprobante(
      req.usuario.id,
      id,
      req.ip,
      body?.comprobante,
    );
  }

  @Post(':id/anular')
  @HttpCode(200)
  @RequierePermiso('ventas.anular')
  anular(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: { motivo?: unknown; cajaId?: unknown },
  ) {
    return this.ventas.anular(
      req.usuario.id,
      id,
      req.ip,
      body?.motivo,
      body?.cajaId,
    );
  }
}
