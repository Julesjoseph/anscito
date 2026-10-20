import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
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
import { TercerosService } from './terceros.service';
import type { DatosTercero } from './terceros.service';

type Peticion = { usuario: UsuarioActual; ip?: string };
type DatosEstado = { is_active?: unknown; motivo?: unknown };

// Dos listas separadas con sus propios permisos; la lógica es la misma.

export function enviarArchivo(
  res: Response,
  { archivo, nombre }: { archivo: Buffer; nombre: string },
) {
  res.set({
    'Content-Type': nombre.endsWith('.xlsx')
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/pdf',
    'Content-Disposition': `attachment; filename="${nombre}"`,
    'Cache-Control': 'no-store',
  });
  res.send(archivo);
}

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('clientes')
export class ClientesController {
  constructor(private readonly terceros: TercerosService) {}

  @Get()
  @RequierePermiso('clientes.ver')
  listar(
    @Req() req: Peticion,
    @Query('texto') texto?: string,
    @Query('estado') estado?: string,
    @Query('contribuyente') contribuyente?: string,
    @Query('pagina') pagina?: string,
  ) {
    return this.terceros.listar('cliente', req.usuario.id, {
      texto,
      estado,
      contribuyente,
      pagina,
    });
  }

  @Get('tipos-documento')
  @RequierePermiso('clientes.ver')
  tipos() {
    return this.terceros.tiposDocumento();
  }

  // Descarga de la lista (con la búsqueda de la pantalla): xlsx o pdf.
  @Get('exportar/:formato')
  @RequierePermiso('clientes.ver')
  async exportar(
    @Req() req: Peticion,
    @Param('formato') formato: string,
    @Query('texto') texto: string | undefined,
    @Query('estado') estado: string | undefined,
    @Query('contribuyente') contribuyente: string | undefined,
    @Res() res: Response,
  ) {
    enviarArchivo(
      res,
      await this.terceros.exportar(
        'cliente',
        req.usuario.id,
        { texto, estado, contribuyente },
        formato,
        req.ip,
      ),
    );
  }

  @Post()
  @RequierePermiso('clientes.crear')
  crear(@Req() req: Peticion, @Body() body: DatosTercero) {
    return this.terceros.crear('cliente', req.usuario.id, req.ip, body ?? {});
  }

  @Patch(':id')
  @RequierePermiso('clientes.editar')
  editar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: DatosTercero,
  ) {
    return this.terceros.editar(
      'cliente',
      req.usuario.id,
      id,
      req.ip,
      body ?? {},
    );
  }

  @Patch(':id/estado')
  @RequierePermiso('clientes.desactivar')
  estado(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: DatosEstado,
  ) {
    return this.terceros.cambiarEstado(
      'cliente',
      req.usuario.id,
      id,
      body?.is_active,
      body?.motivo,
      req.ip,
    );
  }
}

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('proveedores')
export class ProveedoresController {
  constructor(private readonly terceros: TercerosService) {}

  @Get()
  @RequierePermiso('proveedores.ver')
  listar(
    @Req() req: Peticion,
    @Query('texto') texto?: string,
    @Query('estado') estado?: string,
    @Query('contribuyente') contribuyente?: string,
    @Query('pagina') pagina?: string,
  ) {
    return this.terceros.listar('proveedor', req.usuario.id, {
      texto,
      estado,
      contribuyente,
      pagina,
    });
  }

  @Get('tipos-documento')
  @RequierePermiso('proveedores.ver')
  tipos() {
    return this.terceros.tiposDocumento();
  }

  // Descarga de la lista (con la búsqueda de la pantalla): xlsx o pdf.
  @Get('exportar/:formato')
  @RequierePermiso('proveedores.ver')
  async exportar(
    @Req() req: Peticion,
    @Param('formato') formato: string,
    @Query('texto') texto: string | undefined,
    @Query('estado') estado: string | undefined,
    @Query('contribuyente') contribuyente: string | undefined,
    @Res() res: Response,
  ) {
    enviarArchivo(
      res,
      await this.terceros.exportar(
        'proveedor',
        req.usuario.id,
        { texto, estado, contribuyente },
        formato,
        req.ip,
      ),
    );
  }

  @Post()
  @RequierePermiso('proveedores.crear')
  crear(@Req() req: Peticion, @Body() body: DatosTercero) {
    return this.terceros.crear('proveedor', req.usuario.id, req.ip, body ?? {});
  }

  @Patch(':id')
  @RequierePermiso('proveedores.editar')
  editar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: DatosTercero,
  ) {
    return this.terceros.editar(
      'proveedor',
      req.usuario.id,
      id,
      req.ip,
      body ?? {},
    );
  }

  @Patch(':id/estado')
  @RequierePermiso('proveedores.desactivar')
  estado(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: DatosEstado,
  ) {
    return this.terceros.cambiarEstado(
      'proveedor',
      req.usuario.id,
      id,
      body?.is_active,
      body?.motivo,
      req.ip,
    );
  }
}
