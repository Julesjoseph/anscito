import {
  Body,
  Controller,
  Get,
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
import { BancosService } from '../bancos/bancos.service';
import { CajaService } from './caja.service';

type Peticion = { usuario: UsuarioActual; ip?: string };

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('caja')
export class CajaController {
  constructor(
    private readonly caja: CajaService,
    private readonly bancos: BancosService,
  ) {}

  // Cajas con su sesión abierta (si tienen) y lo que debería haber.
  // También la usa la pantalla de Ventas para saber si la caja está abierta.
  @Get('cajas')
  @RequierePermiso('caja.ver')
  cajas() {
    return this.caja.cajas();
  }

  @Get('preparar')
  @RequierePermiso('caja.ver')
  preparar() {
    return this.caja.preparar();
  }

  @Post('cajas')
  @RequierePermiso('caja.gestionar')
  crearCaja(
    @Req() req: Peticion,
    @Body() body: { codigo?: unknown; nombre?: unknown; sucursalId?: unknown },
  ) {
    return this.caja.crearCaja(req.usuario.id, req.ip, body ?? {});
  }

  @Patch('cajas/:id')
  @RequierePermiso('caja.gestionar')
  editarCaja(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: { nombre?: unknown },
  ) {
    return this.caja.editarCaja(req.usuario.id, id, req.ip, body ?? {});
  }

  @Patch('cajas/:id/estado')
  @RequierePermiso('caja.gestionar')
  estadoCaja(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: { is_active?: unknown; motivo?: unknown },
  ) {
    return this.caja.estadoCaja(
      req.usuario.id,
      id,
      body?.is_active,
      body?.motivo,
      req.ip,
    );
  }

  @Post('cajas/:id/abrir')
  @RequierePermiso('caja.abrir')
  abrir(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body()
    body: {
      fondoInicial?: unknown;
      fondoInicialUsd?: unknown;
      notas?: unknown;
    },
  ) {
    return this.caja.abrir(req.usuario.id, id, req.ip, body ?? {});
  }

  @Get('sesiones')
  @RequierePermiso('caja.ver')
  sesiones(
    @Query('cajaId') cajaId?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('estado') estado?: string,
    @Query('pagina') pagina?: string,
  ) {
    return this.caja.sesiones({ cajaId, desde, hasta, estado, pagina });
  }

  @Get('sesiones/:id')
  @RequierePermiso('caja.ver')
  detalle(@Param('id') id: string) {
    return this.caja.detalleSesion(id);
  }

  @Post('sesiones/:id/movimientos')
  @RequierePermiso('caja.movimientos')
  movimiento(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body()
    body: {
      tipo?: unknown;
      monto?: unknown;
      categoriaGastoId?: unknown;
      comprobante?: unknown;
      motivo?: unknown;
    },
  ) {
    return this.caja.movimiento(req.usuario.id, id, req.ip, body ?? {});
  }

  // Dólares que se meten o se sacan de la caja (ingreso o retiro).
  @Post('sesiones/:id/movimientos-usd')
  @RequierePermiso('caja.movimientos')
  movimientoUsd(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: { tipo?: unknown; monto?: unknown; motivo?: unknown },
  ) {
    return this.caja.movimientoUsd(req.usuario.id, id, req.ip, body ?? {});
  }

  // Llevar efectivo de la caja (abierta) a una cuenta: depósito o recarga.
  @Post('cajas/:id/depositar')
  @RequierePermiso('caja.movimientos')
  depositar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body()
    body: {
      cuentaId?: unknown;
      monto?: unknown;
      montoEntra?: unknown;
      cambiadoPor?: unknown;
      referencia?: unknown;
      motivo?: unknown;
    },
  ) {
    return this.bancos.transferir(req.usuario.id, req.ip, {
      origenCajaId: id,
      destinoCuentaId: body?.cuentaId,
      montoSale: body?.monto,
      montoEntra: body?.montoEntra,
      cambiadoPor: body?.cambiadoPor,
      referencia: body?.referencia,
      motivo: body?.motivo,
    });
  }

  // Traer efectivo de una cuenta a la caja (abierta), por ejemplo para cambio.
  @Post('cajas/:id/traer')
  @RequierePermiso('caja.movimientos')
  traer(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body()
    body: {
      cuentaId?: unknown;
      monto?: unknown;
      montoEntra?: unknown;
      cambiadoPor?: unknown;
      referencia?: unknown;
      motivo?: unknown;
    },
  ) {
    return this.bancos.transferir(req.usuario.id, req.ip, {
      origenCuentaId: body?.cuentaId,
      destinoCajaId: id,
      montoSale: body?.monto,
      montoEntra: body?.montoEntra,
      cambiadoPor: body?.cambiadoPor,
      referencia: body?.referencia,
      motivo: body?.motivo,
    });
  }

  @Post('sesiones/:id/cerrar')
  @RequierePermiso('caja.cerrar')
  cerrar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body()
    body: {
      conteo?: unknown;
      conteoUsd?: unknown;
      motivo?: unknown;
      notas?: unknown;
    },
  ) {
    return this.caja.cerrar(req.usuario.id, id, req.ip, body ?? {});
  }

  @Get('sesiones/:id/ticket')
  @RequierePermiso('caja.ver')
  cuadreTicket(@Param('id') id: string) {
    return this.caja.cuadreTicket(id);
  }

  @Get('sesiones/:id/cuadre')
  @RequierePermiso('caja.ver')
  async cuadre(
    @Param('id') id: string,
    @Query('formato') formato: string | undefined,
    @Res() res: Response,
  ) {
    const { pdf, nombre } = await this.caja.cuadre(id, formato);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${nombre}"`,
      'Cache-Control': 'no-store',
    });
    res.send(pdf);
  }
}
