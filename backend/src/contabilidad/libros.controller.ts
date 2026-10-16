import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import { LibrosService } from './libros.service';

type Peticion = { usuario: UsuarioActual; ip?: string };

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('contabilidad/libros')
export class LibrosController {
  constructor(private readonly libros: LibrosService) {}

  // Estado de resultados (del período) y balance general (a "hasta").
  @Get('estados')
  @RequierePermiso('contabilidad.ver')
  estados(@Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    return this.libros.estados({ desde, hasta });
  }

  @Get('mayor')
  @RequierePermiso('contabilidad.ver')
  mayor(
    @Query('cuentaId') cuentaId?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.libros.mayor({ cuentaId, desde, hasta });
  }

  @Patch('cierre-fiscal')
  @RequierePermiso('contabilidad.cerrar')
  cierre(@Req() req: Peticion, @Body() body: { cierre?: unknown }) {
    return this.libros.cambiarCierre(req.usuario.id, req.ip, body ?? {});
  }

  // /contabilidad/libros/balance/pdf?hasta=… (mayor, resultados o balance; xlsx o pdf)
  @Get(':reporte/:formato')
  @RequierePermiso('contabilidad.ver')
  async exportar(
    @Param('reporte') reporte: string,
    @Param('formato') formato: string,
    @Query('desde') desde: string | undefined,
    @Query('hasta') hasta: string | undefined,
    @Query('cuentaId') cuentaId: string | undefined,
    @Res() res: Response,
  ) {
    const { archivo, nombre } = await this.libros.exportar(reporte, formato, {
      desde,
      hasta,
      cuentaId,
    });
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
