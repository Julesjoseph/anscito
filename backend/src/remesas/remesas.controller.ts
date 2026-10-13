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
import { RemesasService } from './remesas.service';

type Peticion = { usuario: UsuarioActual; ip?: string };
type Cuerpo = Record<string, unknown>;

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('remesas')
export class RemesasController {
  constructor(private readonly remesas: RemesasService) {}

  @Get('preparar')
  @RequierePermiso('remesas.ver')
  preparar(@Req() req: Peticion) {
    return this.remesas.preparar(req.usuario.id);
  }

  @Post('calcular')
  @HttpCode(200)
  @RequierePermiso('remesas.registrar')
  calcular(@Body() body: Cuerpo) {
    return this.remesas.calcular(body ?? {});
  }

  // ---------- Tarifas ----------

  @Get('tarifas')
  @RequierePermiso('remesas.ver')
  tarifas() {
    return this.remesas.tarifas();
  }

  @Post('tarifas')
  @RequierePermiso('remesas.tarifas')
  nuevaTarifa(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.remesas.nuevaTarifa(req.usuario.id, req.ip, body ?? {});
  }

  // ---------- Agentes ----------

  @Get('agentes')
  @RequierePermiso('remesas.ver')
  agentes() {
    return this.remesas.agentes();
  }

  @Post('agentes')
  @RequierePermiso('remesas.gestionar')
  crearAgente(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.remesas.crearAgente(req.usuario.id, req.ip, body ?? {});
  }

  @Patch('agentes/:id')
  @RequierePermiso('remesas.gestionar')
  editarAgente(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: Cuerpo,
  ) {
    return this.remesas.editarAgente(req.usuario.id, id, req.ip, body ?? {});
  }

  @Patch('agentes/:id/estado')
  @RequierePermiso('remesas.gestionar')
  estadoAgente(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: { is_active?: unknown; motivo?: unknown },
  ) {
    return this.remesas.estadoAgente(
      req.usuario.id,
      id,
      body?.is_active,
      body?.motivo,
      req.ip,
    );
  }

  // Lo que debe cada agente y sus comisiones sin pagar.
  @Get('cuentas-agentes')
  @RequierePermiso('remesas.entregas')
  cuentasAgentes() {
    return this.remesas.cuentasAgentes();
  }

  @Get('cuentas-agentes/:id')
  @RequierePermiso('remesas.entregas')
  movimientosAgente(@Param('id') id: string) {
    return this.remesas.movimientosAgente(id);
  }

  @Get('reporte-dia')
  @RequierePermiso('remesas.entregas')
  reporteDia(@Query('dia') dia?: string) {
    return this.remesas.reporteDia(dia);
  }

  @Post('entregas')
  @RequierePermiso('remesas.entregas')
  entrega(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.remesas.registrarEntrega(req.usuario.id, req.ip, body ?? {});
  }

  @Post('pagos-comision')
  @RequierePermiso('remesas.comisiones')
  pagarComisiones(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.remesas.pagarComisiones(req.usuario.id, req.ip, body ?? {});
  }

  // ---------- Beneficiarios ----------

  @Get('beneficiarios')
  @RequierePermiso('remesas.ver')
  beneficiarios(@Query('texto') texto?: string) {
    return this.remesas.beneficiarios(texto);
  }

  // ---------- Envíos ----------

  @Get('envios')
  @RequierePermiso('remesas.ver')
  listar(
    @Req() req: Peticion,
    @Query('estado') estado?: string,
    @Query('agenteId') agenteId?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('texto') texto?: string,
    @Query('pagina') pagina?: string,
  ) {
    return this.remesas.listar(req.usuario.id, {
      estado,
      agenteId,
      desde,
      hasta,
      texto,
      pagina,
    });
  }

  @Get('envios/:id')
  @RequierePermiso('remesas.ver')
  detalle(@Req() req: Peticion, @Param('id') id: string) {
    return this.remesas.detalle(req.usuario.id, id);
  }

  @Post('envios')
  @RequierePermiso('remesas.registrar')
  crear(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.remesas.crear(req.usuario.id, req.ip, body ?? {});
  }

  @Post('envios/:id/confirmar')
  @HttpCode(200)
  @RequierePermiso('remesas.confirmar')
  confirmar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: Cuerpo,
  ) {
    return this.remesas.confirmar(req.usuario.id, id, req.ip, body ?? {});
  }

  @Post('envios/:id/rechazar')
  @HttpCode(200)
  @RequierePermiso('remesas.confirmar')
  rechazar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: { motivo?: unknown },
  ) {
    return this.remesas.rechazar(req.usuario.id, id, req.ip, body?.motivo);
  }

  @Get('envios/:id/ticket')
  @RequierePermiso('remesas.ver')
  reciboTicket(@Req() req: Peticion, @Param('id') id: string) {
    return this.remesas.reciboTicket(req.usuario.id, id);
  }

  @Get('envios/:id/recibo')
  @RequierePermiso('remesas.ver')
  async recibo(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Query('formato') formato: string | undefined,
    @Res() res: Response,
  ) {
    const { pdf, nombre } = await this.remesas.recibo(
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
}
