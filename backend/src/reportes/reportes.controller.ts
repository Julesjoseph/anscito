import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { UsuarioActual } from '../auth/jwt-auth.guard';
import { ReportesService } from './reportes.service';
import type { Filtros } from './reportes.service';

type Peticion = { usuario: UsuarioActual };

// Como el Panel: cada reporte revisa su permiso por área (reportes.ventas,
// reportes.envios, reportes.caja_bancos, reportes.inventario) en el servicio.
@UseGuards(JwtAuthGuard)
@Controller('reportes')
export class ReportesController {
  constructor(private readonly reportes: ReportesService) {}

  @Get()
  opciones(@Req() req: Peticion) {
    return this.reportes.opciones(req.usuario.id);
  }

  @Get(':codigo')
  generar(
    @Req() req: Peticion,
    @Param('codigo') codigo: string,
    @Query() q: Filtros,
  ) {
    return this.reportes.generar(req.usuario.id, codigo, q);
  }

  @Get(':codigo/:formato')
  async exportar(
    @Req() req: Peticion,
    @Param('codigo') codigo: string,
    @Param('formato') formato: string,
    @Query() q: Filtros,
    @Res() res: Response,
  ) {
    const { archivo, nombre } = await this.reportes.exportar(
      req.usuario.id,
      codigo,
      q,
      formato,
    );
    res.set({
      'Content-Type':
        formato === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/pdf',
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'Cache-Control': 'no-store',
    });
    res.send(archivo);
  }
}
