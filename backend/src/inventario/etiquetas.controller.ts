import {
  Body,
  Controller,
  HttpCode,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermisosGuard } from '../auth/permisos.guard';
import { RequierePermiso } from '../auth/permisos.decorator';
import { EtiquetasService } from './etiquetas.service';
import type { DatosEtiquetas } from './etiquetas.service';

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('etiquetas')
export class EtiquetasController {
  constructor(private readonly etiquetas: EtiquetasService) {}

  // Qué se puede imprimir (y por qué no los demás), antes de descargar.
  @Post('revisar')
  @HttpCode(200)
  @RequierePermiso('inventario.ver')
  revisar(@Body() body: DatosEtiquetas) {
    return this.etiquetas.revisar(body ?? {});
  }

  @Post('pdf')
  @HttpCode(200)
  @RequierePermiso('inventario.ver')
  async pdf(@Body() body: DatosEtiquetas, @Res() res: Response) {
    const { archivo, nombre } = await this.etiquetas.pdf(body ?? {});
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'Cache-Control': 'no-store',
    });
    res.send(archivo);
  }
}
