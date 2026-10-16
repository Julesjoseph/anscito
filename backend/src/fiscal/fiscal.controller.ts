import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermisosGuard } from '../auth/permisos.guard';
import { RequierePermiso } from '../auth/permisos.decorator';
import { FiscalService } from './fiscal.service';

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('fiscal')
export class FiscalController {
  constructor(private readonly fiscal: FiscalService) {}

  // 606, 607, 608 y estimado del ITBIS del período (AAAAMM).
  @Get()
  @RequierePermiso('fiscal.ver')
  resumen(@Query('periodo') periodo?: string) {
    return this.fiscal.resumen(periodo);
  }

  // Archivo del formato: /fiscal/606/txt?periodo=202610 (o xlsx; 607).
  @Get(':formato/:tipo')
  @RequierePermiso('fiscal.ver')
  async archivo(
    @Param('formato') formato: string,
    @Param('tipo') tipo: string,
    @Query('periodo') periodo: string | undefined,
    @Res() res: Response,
  ) {
    const { archivo, nombre, mime } = await this.fiscal.archivo(
      formato,
      tipo,
      periodo,
    );
    res.set({
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'Cache-Control': 'no-store',
    });
    res.send(archivo);
  }
}
