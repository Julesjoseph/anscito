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
import { SanesService } from './sanes.service';

type Peticion = { usuario: UsuarioActual; ip?: string };
type Cuerpo = Record<string, unknown>;

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('sanes')
export class SanesController {
  constructor(private readonly sanes: SanesService) {}

  // Las rutas fijas van antes de ":id".
  @Get('preparar')
  @RequierePermiso('sanes.ver')
  preparar() {
    return this.sanes.preparar();
  }

  // Formulario de solicitud de número (PDF rellenable, español y kreyòl).
  @Get('formulario')
  @RequierePermiso('sanes.ver')
  async formulario(@Res() res: Response) {
    const pdf = await this.sanes.formularioPdf();
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition':
        'attachment; filename="SOL-CASH-solicitud-de-numero.pdf"',
      'Cache-Control': 'no-store',
    });
    res.send(pdf);
  }

  @Patch('configuracion')
  @RequierePermiso('sanes.gestionar')
  configurar(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.sanes.configurar(req.usuario.id, req.ip, body ?? {});
  }

  @Get('atrasados')
  @RequierePermiso('sanes.ver')
  atrasados() {
    return this.sanes.atrasados();
  }

  @Get('clientes')
  @RequierePermiso('sanes.ver')
  clientes(
    @Query('texto') texto: string | undefined,
    @Query('participantes') participantes: string | undefined,
  ) {
    return this.sanes.buscarClientes(texto, participantes === 'si');
  }

  @Get('persona/:terceroId')
  @RequierePermiso('sanes.ver')
  dePersona(@Param('terceroId') terceroId: string) {
    return this.sanes.dePersona(terceroId);
  }

  @Post('cobros')
  @RequierePermiso('sanes.cobrar')
  cobrar(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.sanes.cobrar(req.usuario.id, req.ip, body ?? {});
  }

  @Post('entregas')
  @RequierePermiso('sanes.entregar')
  entregar(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.sanes.entregar(req.usuario.id, req.ip, body ?? {});
  }

  @Get('recibos/:id/ticket')
  @RequierePermiso('sanes.ver')
  reciboTicket(@Param('id') id: string) {
    return this.sanes.reciboTicket(id);
  }

  @Get('entregas/:id/ticket')
  @RequierePermiso('sanes.ver')
  entregaTicket(@Param('id') id: string) {
    return this.sanes.entregaTicket(id);
  }

  @Get('recibos/:id/pdf')
  @RequierePermiso('sanes.ver')
  async reciboPdf(
    @Param('id') id: string,
    @Query('formato') formato: string | undefined,
    @Res() res: Response,
  ) {
    const { pdf, nombre } = await this.sanes.reciboPdf(id, formato);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${nombre}"`,
      'Cache-Control': 'no-store',
    });
    res.send(pdf);
  }

  @Get('entregas/:id/pdf')
  @RequierePermiso('sanes.ver')
  async entregaPdf(
    @Param('id') id: string,
    @Query('formato') formato: string | undefined,
    @Res() res: Response,
  ) {
    const { pdf, nombre } = await this.sanes.entregaPdf(id, formato);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${nombre}"`,
      'Cache-Control': 'no-store',
    });
    res.send(pdf);
  }

  @Get()
  @RequierePermiso('sanes.ver')
  listar() {
    return this.sanes.listar();
  }

  @Post()
  @RequierePermiso('sanes.gestionar')
  crear(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.sanes.crear(req.usuario.id, req.ip, body ?? {});
  }

  @Get(':id')
  @RequierePermiso('sanes.ver')
  detalle(@Param('id') id: string) {
    return this.sanes.detalle(id);
  }

  @Patch(':id')
  @RequierePermiso('sanes.gestionar')
  editar(@Req() req: Peticion, @Param('id') id: string, @Body() body: Cuerpo) {
    return this.sanes.editar(req.usuario.id, id, req.ip, body ?? {});
  }

  @Patch(':id/turnos')
  @RequierePermiso('sanes.gestionar')
  fechaTurno(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: Cuerpo,
  ) {
    return this.sanes.fechaTurno(req.usuario.id, id, req.ip, body ?? {});
  }

  @Post(':id/numeros')
  @RequierePermiso('sanes.gestionar')
  asignar(@Req() req: Peticion, @Param('id') id: string, @Body() body: Cuerpo) {
    return this.sanes.asignar(req.usuario.id, id, req.ip, body ?? {});
  }

  @Post(':id/numeros/:participacionId/quitar')
  @HttpCode(200)
  @RequierePermiso('sanes.gestionar')
  quitar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Param('participacionId') pid: string,
  ) {
    return this.sanes.quitar(req.usuario.id, id, req.ip, pid);
  }

  @Patch(':id/estado')
  @RequierePermiso('sanes.gestionar')
  estado(@Req() req: Peticion, @Param('id') id: string, @Body() body: Cuerpo) {
    return this.sanes.cambiarEstado(req.usuario.id, id, req.ip, body ?? {});
  }

  @Get(':id/cuenta/:terceroId')
  @RequierePermiso('sanes.ver')
  cuenta(@Param('id') id: string, @Param('terceroId') terceroId: string) {
    return this.sanes.cuenta(id, terceroId);
  }

  @Get(':id/entrega/:participacionId')
  @RequierePermiso('sanes.ver')
  previaEntrega(
    @Param('id') id: string,
    @Param('participacionId') pid: string,
  ) {
    return this.sanes.previaEntrega(id, pid);
  }
}
