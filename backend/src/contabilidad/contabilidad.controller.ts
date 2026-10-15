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
import { ContabilidadService } from './contabilidad.service';

type Peticion = { usuario: UsuarioActual; ip?: string };
type Cuerpo = Record<string, unknown>;

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('contabilidad')
export class ContabilidadController {
  constructor(private readonly conta: ContabilidadService) {}

  @Get('preparar')
  @RequierePermiso('contabilidad.ver')
  preparar() {
    return this.conta.preparar();
  }

  @Patch('fecha-inicio')
  @RequierePermiso('contabilidad.cerrar')
  fechaInicio(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.conta.fijarFechaInicio(req.usuario.id, req.ip, body ?? {});
  }

  // ---------- Catálogo ----------

  @Get('cuentas')
  @RequierePermiso('contabilidad.ver')
  catalogo() {
    return this.conta.catalogo();
  }

  @Post('cuentas')
  @RequierePermiso('contabilidad.catalogo')
  crearCuenta(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.conta.crearCuenta(req.usuario.id, req.ip, body ?? {});
  }

  @Put('cuentas/:id')
  @RequierePermiso('contabilidad.catalogo')
  editarCuenta(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: Cuerpo,
  ) {
    return this.conta.editarCuenta(req.usuario.id, id, req.ip, body ?? {});
  }

  @Patch('cuentas/:id/validada')
  @RequierePermiso('contabilidad.catalogo')
  validar(@Req() req: Peticion, @Param('id') id: string, @Body() body: Cuerpo) {
    return this.conta.validarCuenta(req.usuario.id, id, req.ip, body ?? {});
  }

  @Patch('cuentas/:id/estado')
  @RequierePermiso('contabilidad.catalogo')
  estado(@Req() req: Peticion, @Param('id') id: string, @Body() body: Cuerpo) {
    return this.conta.estadoCuenta(req.usuario.id, id, req.ip, body ?? {});
  }

  // ---------- Asientos ----------

  @Get('asientos')
  @RequierePermiso('contabilidad.ver')
  asientos(
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('texto') texto?: string,
    @Query('origen') origen?: string,
    @Query('pagina') pagina?: string,
  ) {
    return this.conta.asientos({ desde, hasta, texto, origen, pagina });
  }

  @Get('asientos/:id')
  @RequierePermiso('contabilidad.ver')
  asiento(@Param('id') id: string) {
    return this.conta.asiento(id);
  }

  @Post('asientos')
  @RequierePermiso('contabilidad.asientos')
  crearAsiento(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.conta.crearAsiento(req.usuario.id, req.ip, body ?? {});
  }

  @Post('asientos/:id/anular')
  @HttpCode(200)
  @RequierePermiso('contabilidad.anular')
  anular(@Req() req: Peticion, @Param('id') id: string, @Body() body: Cuerpo) {
    return this.conta.anularAsiento(req.usuario.id, id, req.ip, body ?? {});
  }

  // ---------- Meses y balanza ----------

  @Get('periodos')
  @RequierePermiso('contabilidad.ver')
  periodos() {
    return this.conta.periodos();
  }

  @Post('periodos/cerrar')
  @HttpCode(200)
  @RequierePermiso('contabilidad.cerrar')
  cerrar(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.conta.cerrarMes(req.usuario.id, req.ip, body ?? {});
  }

  @Post('periodos/reabrir')
  @HttpCode(200)
  @RequierePermiso('contabilidad.cerrar')
  reabrir(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.conta.reabrirMes(req.usuario.id, req.ip, body ?? {});
  }

  @Get('balanza')
  @RequierePermiso('contabilidad.ver')
  balanza(@Query('hasta') hasta?: string) {
    return this.conta.balanza({ hasta });
  }
}
