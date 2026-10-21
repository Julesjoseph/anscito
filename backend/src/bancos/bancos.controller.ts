import {
  Body,
  Controller,
  ForbiddenException,
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
import type { Ambito, DatosTransferencia } from './bancos.service';

type Peticion = { usuario: UsuarioActual; ip?: string };

// Bancos (/bancos, permisos bancos.*) y Billeteras MonCash / NatCash
// (/billeteras, permisos billeteras.*): las mismas operaciones, cada módulo
// solo con sus cuentas. Las listas se filtran por tipo y cada acción revisa
// que la cuenta sea del módulo.
function controladorCuentas(ruta: string, ambito: Ambito, p: string) {
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Controller(ruta)
  class ControladorCuentas {
    constructor(readonly bancos: BancosService) {}

    // Las cuentas de los dos tipos (para transferir de un banco a una
    // billetera y al revés).
    @Get('preparar')
    @RequierePermiso(`${p}.ver`)
    preparar() {
      return this.bancos.preparar();
    }

    @Get('cuentas')
    @RequierePermiso(`${p}.ver`)
    async cuentas() {
      return (await this.bancos.cuentas()).filter(
        (x: { tipo: string }) => x.tipo === ambito,
      );
    }

    @Post('cuentas')
    @RequierePermiso(`${p}.gestionar`)
    crear(@Req() req: Peticion, @Body() body: Record<string, unknown>) {
      return this.bancos.crearCuenta(req.usuario.id, req.ip, {
        ...body,
        tipo: ambito,
      });
    }

    @Patch('cuentas/:id')
    @RequierePermiso(`${p}.gestionar`)
    async editar(
      @Req() req: Peticion,
      @Param('id') id: string,
      @Body() body: Record<string, unknown>,
    ) {
      await this.bancos.exigirAmbito(ambito, { cuentaId: id });
      return this.bancos.editarCuenta(req.usuario.id, id, req.ip, body ?? {});
    }

    @Patch('cuentas/:id/estado')
    @RequierePermiso(`${p}.gestionar`)
    async estado(
      @Req() req: Peticion,
      @Param('id') id: string,
      @Body() body: { is_active?: unknown; motivo?: unknown },
    ) {
      await this.bancos.exigirAmbito(ambito, { cuentaId: id });
      return this.bancos.estadoCuenta(
        req.usuario.id,
        id,
        body?.is_active,
        body?.motivo,
        req.ip,
      );
    }

    @Post('cuentas/:id/saldo-inicial')
    @RequierePermiso(`${p}.gestionar`)
    async saldoInicial(
      @Req() req: Peticion,
      @Param('id') id: string,
      @Body() body: { monto?: unknown; tasa?: unknown; fecha?: unknown },
    ) {
      await this.bancos.exigirAmbito(ambito, { cuentaId: id });
      return this.bancos.saldoInicial(req.usuario.id, id, req.ip, body ?? {});
    }

    @Get('cuentas/:id/movimientos')
    @RequierePermiso(`${p}.ver`)
    async movimientos(
      @Param('id') id: string,
      @Query('desde') desde?: string,
      @Query('hasta') hasta?: string,
      @Query('estado') estado?: string,
      @Query('pagina') pagina?: string,
    ) {
      await this.bancos.exigirAmbito(ambito, { cuentaId: id });
      return this.bancos.movimientos(id, { desde, hasta, estado, pagina });
    }

    @Post('cuentas/:id/movimientos')
    @RequierePermiso(`${p}.movimientos`)
    async movimiento(
      @Req() req: Peticion,
      @Param('id') id: string,
      @Body() body: Record<string, unknown>,
    ) {
      await this.bancos.exigirAmbito(ambito, { cuentaId: id });
      return this.bancos.movimiento(req.usuario.id, id, req.ip, body ?? {});
    }

    @Get('pendientes')
    @RequierePermiso(`${p}.ver`)
    async pendientes() {
      const r = await this.bancos.pendientes();
      const delModulo = (x: { cuenta_tipo: string }) =>
        x.cuenta_tipo === ambito;
      return {
        porConfirmar: r.porConfirmar.filter(delModulo),
        noLlegaron: r.noLlegaron.filter(delModulo),
        // Recargas de billeteras que esperan las gourdes que llegaron.
        recargas:
          ambito === 'billetera' ? await this.bancos.recargasPendientes() : [],
      };
    }

    @Post('recargas/:id/confirmar')
    @RequierePermiso(`${p}.confirmar`)
    confirmarRecarga(
      @Req() req: Peticion,
      @Param('id') id: string,
      @Body()
      body: {
        resultado?: unknown;
        montoEntra?: unknown;
        fechaBanco?: unknown;
        motivo?: unknown;
      },
    ) {
      if (ambito !== 'billetera')
        throw new ForbiddenException(
          'Las recargas se confirman en el módulo Billeteras',
        );
      return this.bancos.confirmarRecarga(
        req.usuario.id,
        id,
        req.ip,
        body ?? {},
      );
    }

    @Post('movimientos/:id/confirmar')
    @RequierePermiso(`${p}.confirmar`)
    async confirmar(
      @Req() req: Peticion,
      @Param('id') id: string,
      @Body()
      body: { resultado?: unknown; fechaBanco?: unknown; motivo?: unknown },
    ) {
      await this.bancos.exigirAmbito(ambito, { movimientoId: id });
      return this.bancos.confirmar(req.usuario.id, id, req.ip, body ?? {});
    }

    @Post('movimientos/:id/reversar')
    @RequierePermiso(`${p}.gestionar`)
    async reversar(
      @Req() req: Peticion,
      @Param('id') id: string,
      @Body() body: { motivo?: unknown },
    ) {
      await this.bancos.exigirAmbito(ambito, { movimientoId: id });
      return this.bancos.reversar(req.usuario.id, id, req.ip, body?.motivo);
    }

    @Post('transferencias')
    @RequierePermiso(`${p}.transferir`)
    async transferir(@Req() req: Peticion, @Body() body: DatosTransferencia) {
      await this.bancos.exigirAmbitoTransferencia(ambito, body ?? {});
      return this.bancos.transferir(req.usuario.id, req.ip, body ?? {});
    }
  }
  return ControladorCuentas;
}

export const BancosController = controladorCuentas('bancos', 'banco', 'bancos');
export const BilleterasController = controladorCuentas(
  'billeteras',
  'billetera',
  'billeteras',
);
