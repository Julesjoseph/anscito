import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { UsuarioActual } from '../auth/jwt-auth.guard';
import { PanelService } from './panel.service';

// El panel lo ve cualquier usuario con sesión; el servicio decide qué
// secciones incluir según sus permisos (ventas, inventario, costos).
@UseGuards(JwtAuthGuard)
@Controller('panel')
export class PanelController {
  constructor(private readonly panel: PanelService) {}

  @Get()
  resumen(
    @Req() req: { usuario: UsuarioActual },
    @Query('periodo') periodo?: string,
  ) {
    return this.panel.resumen(req.usuario.id, periodo ?? 'hoy');
  }
}
