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
import { ProductosService } from './productos.service';
import type { DatosProducto } from './productos.service';

type Peticion = { usuario: UsuarioActual; ip?: string };

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('productos')
export class ProductosController {
  constructor(private readonly productos: ProductosService) {}

  @Get()
  @RequierePermiso('inventario.ver')
  listar(
    @Req() req: Peticion,
    @Query('texto') texto?: string,
    @Query('categoriaId') categoriaId?: string,
    @Query('estado') estado?: string,
    @Query('pagina') pagina?: string,
    @Query('porPagina') porPagina?: string,
  ) {
    return this.productos.listar(req.usuario.id, {
      texto,
      categoriaId,
      estado,
      pagina,
      porPagina,
    });
  }

  // Categorías (con prefijo), unidades e impuestos para el formulario.
  @Get('catalogos')
  @RequierePermiso('inventario.ver')
  catalogos() {
    return this.productos.catalogos();
  }

  @Post('calcular')
  @HttpCode(200)
  @RequierePermiso('inventario.ver')
  calcular(
    @Body()
    body: {
      monto?: unknown;
      impuestoId?: unknown;
      incluyeItbis?: unknown;
    },
  ) {
    return this.productos.calcular(body ?? {});
  }

  @Post()
  @RequierePermiso('inventario.crear')
  crear(@Req() req: Peticion, @Body() body: DatosProducto) {
    return this.productos.crear(req.usuario.id, req.ip, body ?? {});
  }

  @Patch(':id')
  @RequierePermiso('inventario.editar')
  editar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: DatosProducto,
  ) {
    return this.productos.editar(req.usuario.id, id, req.ip, body ?? {});
  }

  @Patch(':id/estado')
  @RequierePermiso('inventario.desactivar')
  estado(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: { is_active?: unknown; motivo?: unknown },
  ) {
    return this.productos.cambiarEstado(
      req.usuario.id,
      id,
      body?.is_active,
      body?.motivo,
      req.ip,
    );
  }
}
