import {
  Body,
  Controller,
  Delete,
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
import { NominaService } from './nomina.service';

type Peticion = { usuario: UsuarioActual; ip?: string };
type Cuerpo = Record<string, unknown>;

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('nomina')
export class NominaController {
  constructor(private readonly nomina: NominaService) {}

  @Get('preparar')
  @RequierePermiso('nomina.ver')
  preparar() {
    return this.nomina.preparar();
  }

  // ---------- Valores de ley ----------

  @Get('parametros')
  @RequierePermiso('nomina.ver')
  parametros() {
    return this.nomina.listarParametros();
  }

  @Post('parametros')
  @RequierePermiso('nomina.parametros')
  nuevoParametro(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.nomina.nuevoParametro(req.usuario.id, req.ip, body ?? {});
  }

  // ---------- Empleados ----------

  @Get('empleados')
  @RequierePermiso('nomina.ver')
  empleados(@Query('texto') texto?: string, @Query('estado') estado?: string) {
    return this.nomina.listarEmpleados({ texto, estado });
  }

  @Post('empleados')
  @RequierePermiso('nomina.empleados')
  crearEmpleado(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.nomina.crearEmpleado(req.usuario.id, req.ip, body ?? {});
  }

  @Patch('empleados/:id')
  @RequierePermiso('nomina.empleados')
  editarEmpleado(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: Cuerpo,
  ) {
    return this.nomina.editarEmpleado(req.usuario.id, id, req.ip, body ?? {});
  }

  @Patch('empleados/:id/estado')
  @RequierePermiso('nomina.empleados')
  estadoEmpleado(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: Cuerpo,
  ) {
    return this.nomina.estadoEmpleado(req.usuario.id, id, req.ip, body ?? {});
  }

  // ---------- Adelantos ----------

  @Get('adelantos')
  @RequierePermiso('nomina.ver')
  adelantos(
    @Query('empleadoId') empleadoId?: string,
    @Query('estado') estado?: string,
  ) {
    return this.nomina.listarAdelantos({ empleadoId, estado });
  }

  @Post('adelantos')
  @RequierePermiso('nomina.adelantos')
  darAdelanto(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.nomina.darAdelanto(req.usuario.id, req.ip, body ?? {});
  }

  @Patch('adelantos/:id/cuota')
  @RequierePermiso('nomina.adelantos')
  cambiarCuota(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: Cuerpo,
  ) {
    return this.nomina.cambiarCuota(req.usuario.id, id, req.ip, body ?? {});
  }

  @Post('adelantos/:id/anular')
  @RequierePermiso('nomina.adelantos')
  anularAdelanto(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: Cuerpo,
  ) {
    return this.nomina.anularAdelanto(req.usuario.id, id, req.ip, body ?? {});
  }

  // ---------- Nóminas ----------

  @Get('nominas')
  @RequierePermiso('nomina.ver')
  nominas(@Query('estado') estado?: string, @Query('pagina') pagina?: string) {
    return this.nomina.listarNominas({ estado, pagina });
  }

  @Get('nominas/:id')
  @RequierePermiso('nomina.ver')
  detalle(@Param('id') id: string) {
    return this.nomina.detalleNomina(id);
  }

  // Volantes de pago (PDF): de toda la nómina o, con lineaId, de un empleado.
  @Get('nominas/:id/volantes')
  @RequierePermiso('nomina.ver')
  async volantes(
    @Param('id') id: string,
    @Query('lineaId') lineaId: string | undefined,
    @Res() res: Response,
  ) {
    const { pdf, nombre } = await this.nomina.volantesPdf(id, lineaId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${nombre}"`,
      'Cache-Control': 'no-store',
    });
    res.send(pdf);
  }

  @Post('nominas')
  @RequierePermiso('nomina.preparar')
  crear(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.nomina.crearNomina(req.usuario.id, req.ip, body ?? {});
  }

  @Post('nominas/:id/empleados')
  @RequierePermiso('nomina.preparar')
  agregar(@Req() req: Peticion, @Param('id') id: string, @Body() body: Cuerpo) {
    return this.nomina.agregarEmpleado(req.usuario.id, id, req.ip, body ?? {});
  }

  @Delete('nominas/:id/lineas/:lineaId')
  @RequierePermiso('nomina.preparar')
  quitar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Param('lineaId') lineaId: string,
  ) {
    return this.nomina.quitarLinea(req.usuario.id, id, lineaId, req.ip);
  }

  @Patch('nominas/:id/lineas/:lineaId')
  @RequierePermiso('nomina.preparar')
  editarLinea(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Param('lineaId') lineaId: string,
    @Body() body: Cuerpo,
  ) {
    return this.nomina.editarLinea(
      req.usuario.id,
      id,
      lineaId,
      req.ip,
      body ?? {},
    );
  }

  @Post('nominas/:id/descartar')
  @RequierePermiso('nomina.preparar')
  descartar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: Cuerpo,
  ) {
    return this.nomina.descartar(req.usuario.id, id, req.ip, body ?? {});
  }

  @Post('nominas/:id/pagar')
  @RequierePermiso('nomina.pagar')
  pagar(@Req() req: Peticion, @Param('id') id: string, @Body() body: Cuerpo) {
    return this.nomina.pagar(req.usuario.id, id, req.ip, body ?? {});
  }

  @Post('nominas/:id/anular')
  @RequierePermiso('nomina.pagar')
  anular(@Req() req: Peticion, @Param('id') id: string, @Body() body: Cuerpo) {
    return this.nomina.anular(req.usuario.id, id, req.ip, body ?? {});
  }
}
