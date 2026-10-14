import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { UsuarioActual } from '../auth/jwt-auth.guard';
import { PermisosGuard } from '../auth/permisos.guard';
import { RequierePermiso } from '../auth/permisos.decorator';
import { ComprasService } from './compras.service';

type Peticion = { usuario: UsuarioActual; ip?: string };
type Cuerpo = Record<string, unknown>;

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('compras')
export class ComprasController {
  constructor(private readonly compras: ComprasService) {}

  // Las rutas fijas van antes de ":id".
  @Get('preparar')
  @RequierePermiso('compras.ver')
  preparar() {
    return this.compras.preparar();
  }

  @Get('proveedores')
  @RequierePermiso('compras.registrar')
  proveedores(@Query('texto') texto: string | undefined) {
    return this.compras.proveedores(texto);
  }

  @Get('productos')
  @RequierePermiso('compras.registrar')
  productos(@Query('texto') texto: string | undefined) {
    return this.compras.productos(texto);
  }

  @Get()
  @RequierePermiso('compras.ver')
  listar(
    @Query('texto') texto?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('estado') estado?: string,
    @Query('pagina') pagina?: string,
  ) {
    return this.compras.listar({ texto, desde, hasta, estado, pagina });
  }

  @Get(':id')
  @RequierePermiso('compras.ver')
  detalle(@Param('id') id: string) {
    return this.compras.detalle(id);
  }

  @Post()
  @RequierePermiso('compras.registrar')
  registrar(@Req() req: Peticion, @Body() body: Cuerpo) {
    return this.compras.registrar(req.usuario.id, req.ip, body ?? {});
  }

  @Post(':id/anular')
  @HttpCode(200)
  @RequierePermiso('compras.anular')
  anular(@Req() req: Peticion, @Param('id') id: string, @Body() body: Cuerpo) {
    return this.compras.anular(req.usuario.id, id, req.ip, body ?? {});
  }
}
