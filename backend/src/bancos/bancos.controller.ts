import {
  Body,
  Controller,
  Get,
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
import { BancosService } from './bancos.service';
import type { DatosTransferencia } from './bancos.service';

type Peticion = { usuario: UsuarioActual; ip?: string };

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('bancos')
export class BancosController {
  constructor(private readonly bancos: BancosService) {}

  @Get('preparar')
  @RequierePermiso('bancos.ver')
  preparar() {
    return this.bancos.preparar();
  }

  @Get('cuentas')
  @RequierePermiso('bancos.ver')
  cuentas() {
    return this.bancos.cuentas();
  }

  @Post('cuentas')
  @RequierePermiso('bancos.gestionar')
  crear(@Req() req: Peticion, @Body() body: Record<string, unknown>) {
    return this.bancos.crearCuenta(req.usuario.id, req.ip, body ?? {});
  }

  @Patch('cuentas/:id')
  @RequierePermiso('bancos.gestionar')
  editar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.bancos.editarCuenta(req.usuario.id, id, req.ip, body ?? {});
  }

  @Patch('cuentas/:id/estado')
  @RequierePermiso('bancos.gestionar')
  estado(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: { is_active?: unknown; motivo?: unknown },
  ) {
    return this.bancos.estadoCuenta(
      req.usuario.id,
      id,
      body?.is_active,
      body?.motivo,
      req.ip,
    );
  }

  @Post('cuentas/:id/saldo-inicial')
  @RequierePermiso('bancos.gestionar')
  saldoInicial(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: { monto?: unknown; tasa?: unknown; fecha?: unknown },
  ) {
    return this.bancos.saldoInicial(req.usuario.id, id, req.ip, body ?? {});
  }

  @Get('cuentas/:id/movimientos')
  @RequierePermiso('bancos.ver')
  movimientos(
    @Param('id') id: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('estado') estado?: string,
    @Query('pagina') pagina?: string,
  ) {
    return this.bancos.movimientos(id, { desde, hasta, estado, pagina });
  }

  @Post('cuentas/:id/movimientos')
  @RequierePermiso('bancos.movimientos')
  movimiento(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.bancos.movimiento(req.usuario.id, id, req.ip, body ?? {});
  }

  @Get('pendientes')
  @RequierePermiso('bancos.ver')
  pendientes() {
    return this.bancos.pendientes();
  }

  @Post('movimientos/:id/confirmar')
  @RequierePermiso('bancos.confirmar')
  confirmar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body()
    body: { resultado?: unknown; fechaBanco?: unknown; motivo?: unknown },
  ) {
    return this.bancos.confirmar(req.usuario.id, id, req.ip, body ?? {});
  }

  @Post('movimientos/:id/reversar')
  @RequierePermiso('bancos.gestionar')
  reversar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: { motivo?: unknown },
  ) {
    return this.bancos.reversar(req.usuario.id, id, req.ip, body?.motivo);
  }

  @Post('transferencias')
  @RequierePermiso('bancos.transferir')
  transferir(@Req() req: Peticion, @Body() body: DatosTransferencia) {
    return this.bancos.transferir(req.usuario.id, req.ip, body ?? {});
  }
}
