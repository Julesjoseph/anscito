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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { UsuarioActual } from '../auth/jwt-auth.guard';
import { PermisosGuard } from '../auth/permisos.guard';
import { RequierePermiso } from '../auth/permisos.decorator';
import { FacturacionService } from './facturacion.service';

type Peticion = { usuario: UsuarioActual; ip?: string };
type Cuerpo = Record<string, unknown>;

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('facturacion')
export class FacturacionController {
  constructor(private readonly facturacion: FacturacionService) {}

  @Get('preparar')
  @RequierePermiso('facturacion.ver')
  preparar() {
    return this.facturacion.preparar();
  }

  @Patch('configuracion')
  @RequierePermiso('facturacion.configurar')
  configurar(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.facturacion.configurar(req.usuario.id, req.ip, body ?? {});
  }

  @Get()
  @RequierePermiso('facturacion.ver')
  listar(
    @Query('estado') estado?: string,
    @Query('texto') texto?: string,
    @Query('pagina') pagina?: string,
  ) {
    return this.facturacion.listar({ estado, texto, pagina });
  }

  @Post(':id/emitir')
  @HttpCode(200)
  @RequierePermiso('facturacion.emitir')
  emitir(@Req() req: Peticion, @Param('id') id: string, @Body() body: Cuerpo) {
    return this.facturacion.emitir(req.usuario.id, id, req.ip, body ?? {});
  }

  @Post(':id/corregir')
  @HttpCode(200)
  @RequierePermiso('facturacion.emitir')
  corregir(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: Cuerpo,
  ) {
    return this.facturacion.corregir(req.usuario.id, id, req.ip, body ?? {});
  }

  @Post(':id/tipo')
  @HttpCode(200)
  @RequierePermiso('facturacion.emitir')
  cambiarTipo(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: Cuerpo,
  ) {
    return this.facturacion.cambiarTipo(req.usuario.id, id, req.ip, body ?? {});
  }
}
