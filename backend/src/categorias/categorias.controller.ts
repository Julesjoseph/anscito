import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { UsuarioActual } from '../auth/jwt-auth.guard';
import { PermisosGuard } from '../auth/permisos.guard';
import { RequierePermiso } from '../auth/permisos.decorator';
import { CategoriasService } from './categorias.service';

type Peticion = { usuario: UsuarioActual; ip?: string };
type DatosCategoria = {
  unidadNegocioId?: unknown;
  nombre?: unknown;
  descripcion?: unknown;
  prefijo?: unknown;
  impuestoId?: unknown;
};
type DatosEstado = { is_active?: unknown; motivo?: unknown };

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('unidades-negocio')
export class UnidadesNegocioController {
  constructor(private readonly categorias: CategoriasService) {}

  // Unidades con sus categorías, para la pantalla de Categorías.
  @Get()
  @RequierePermiso('categorias.ver')
  arbol() {
    return this.categorias.arbol();
  }

  @Post()
  @RequierePermiso('categorias.gestionar')
  crear(@Req() req: Peticion, @Body() body: { nombre?: unknown }) {
    return this.categorias.crearUnidad(req.usuario.id, req.ip, body ?? {});
  }

  @Patch(':id')
  @RequierePermiso('categorias.gestionar')
  editar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: { nombre?: unknown },
  ) {
    return this.categorias.editarUnidad(req.usuario.id, id, req.ip, body ?? {});
  }

  @Patch(':id/estado')
  @RequierePermiso('categorias.gestionar')
  estado(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: DatosEstado,
  ) {
    return this.categorias.estadoUnidad(
      req.usuario.id,
      id,
      body?.is_active,
      body?.motivo,
      req.ip,
    );
  }
}

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('categorias')
export class CategoriasController {
  constructor(private readonly categorias: CategoriasService) {}

  // Impuestos activos (para el impuesto sugerido de cada categoría).
  @Get('impuestos')
  @RequierePermiso('categorias.ver')
  impuestos() {
    return this.categorias.impuestos();
  }

  @Post()
  @RequierePermiso('categorias.gestionar')
  crear(@Req() req: Peticion, @Body() body: DatosCategoria) {
    return this.categorias.crearCategoria(req.usuario.id, req.ip, body ?? {});
  }

  @Patch(':id')
  @RequierePermiso('categorias.gestionar')
  editar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: DatosCategoria,
  ) {
    return this.categorias.editarCategoria(
      req.usuario.id,
      id,
      req.ip,
      body ?? {},
    );
  }

  @Patch(':id/estado')
  @RequierePermiso('categorias.gestionar')
  estado(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: DatosEstado,
  ) {
    return this.categorias.estadoCategoria(
      req.usuario.id,
      id,
      body?.is_active,
      body?.motivo,
      req.ip,
    );
  }
}
