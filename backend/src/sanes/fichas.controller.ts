import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { UsuarioActual } from '../auth/jwt-auth.guard';
import { PermisosGuard } from '../auth/permisos.guard';
import { RequierePermiso } from '../auth/permisos.decorator';
import { FichasService } from './fichas.service';

type Peticion = { usuario: UsuarioActual; ip?: string };
type Cuerpo = Record<string, unknown>;

// Ficha, referencias, fiador, fotos y contratos de los participantes del SAN.
// Va antes que SanesController en el módulo para que "plantillas" o
// "contratos" no se tomen como el id de un SAN.
@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('sanes')
export class FichasController {
  constructor(private readonly fichas: FichasService) {}

  @Post('personas')
  @RequierePermiso('sanes.fichas')
  crearPersona(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.fichas.crearPersona(req.usuario.id, req.ip, body ?? {});
  }

  @Get('fichas/:terceroId')
  @RequierePermiso('sanes.fichas')
  ver(@Param('terceroId') terceroId: string) {
    return this.fichas.ver(terceroId);
  }

  @Put('fichas/:terceroId')
  @RequierePermiso('sanes.fichas')
  guardar(
    @Req() req: Peticion,
    @Param('terceroId') terceroId: string,
    @Body() body: Cuerpo,
  ) {
    return this.fichas.guardarFicha(
      req.usuario.id,
      terceroId,
      req.ip,
      body ?? {},
    );
  }

  @Post('fichas/:terceroId/garantes')
  @RequierePermiso('sanes.fichas')
  agregarGarante(
    @Req() req: Peticion,
    @Param('terceroId') terceroId: string,
    @Body() body: Cuerpo,
  ) {
    return this.fichas.agregarGarante(
      req.usuario.id,
      terceroId,
      req.ip,
      body ?? {},
    );
  }

  @Post('fichas/:terceroId/fotos')
  @RequierePermiso('sanes.fichas')
  subirFoto(
    @Req() req: Peticion,
    @Param('terceroId') terceroId: string,
    @Body() body: Cuerpo,
  ) {
    return this.fichas.subirFoto(req.usuario.id, terceroId, req.ip, body ?? {});
  }

  @Post('garantes/:id/confirmar')
  @HttpCode(200)
  @RequierePermiso('sanes.verificar')
  confirmar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: Cuerpo,
  ) {
    return this.fichas.confirmarGarante(req.usuario.id, id, req.ip, body ?? {});
  }

  @Post('garantes/:id/quitar')
  @HttpCode(200)
  @RequierePermiso('sanes.fichas')
  quitar(@Req() req: Peticion, @Param('id') id: string, @Body() body: Cuerpo) {
    return this.fichas.quitarGarante(req.usuario.id, id, req.ip, body ?? {});
  }

  @Get('archivos/:id')
  @RequierePermiso('sanes.fichas')
  async archivo(@Param('id') id: string, @Res() res: Response) {
    const a = await this.fichas.archivo(id);
    res.set({
      'Content-Type': a.mime,
      'Content-Disposition': 'inline',
      'Cache-Control': 'no-store',
    });
    res.send(a.datos);
  }

  @Get('plantillas')
  @RequierePermiso('sanes.contratos')
  plantillas() {
    return this.fichas.plantillas();
  }

  @Post('plantillas')
  @RequierePermiso('sanes.plantillas')
  nuevaPlantilla(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.fichas.nuevaPlantilla(req.usuario.id, req.ip, body ?? {});
  }

  @Post('contratos')
  @RequierePermiso('sanes.contratos')
  generar(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.fichas.generarContrato(req.usuario.id, req.ip, body ?? {});
  }

  @Get('contratos/:id/pdf')
  @RequierePermiso('sanes.contratos')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const { pdf, nombre } = await this.fichas.contratoPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${nombre}"`,
      'Cache-Control': 'no-store',
    });
    res.send(pdf);
  }

  @Post('contratos/:id/firmado')
  @RequierePermiso('sanes.contratos')
  firmado(@Req() req: Peticion, @Param('id') id: string, @Body() body: Cuerpo) {
    return this.fichas.subirFirmado(req.usuario.id, id, req.ip, body ?? {});
  }

  @Post('contratos/:id/anular')
  @HttpCode(200)
  @RequierePermiso('sanes.contratos')
  anular(@Req() req: Peticion, @Param('id') id: string, @Body() body: Cuerpo) {
    return this.fichas.anularContrato(req.usuario.id, id, req.ip, body ?? {});
  }
}
