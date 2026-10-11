import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { UsuarioActual } from '../auth/jwt-auth.guard';
import { PermisosGuard } from '../auth/permisos.guard';
import { RequierePermiso } from '../auth/permisos.decorator';
import { EmpresaService } from './empresa.service';
import type { DatosEmpresa, DatosSucursal } from './empresa.service';

type Peticion = { usuario: UsuarioActual; ip?: string };

// Rutas PÚBLICAS: solo el nombre comercial y el logo, que se muestran en la
// pantalla de entrada antes de iniciar sesión. Nada más sale sin sesión.
@Controller('marca')
export class MarcaController {
  constructor(private readonly empresa: EmpresaService) {}

  @Get()
  @Header('Cache-Control', 'no-cache')
  marca() {
    return this.empresa.marca();
  }

  @Get('logo')
  async logo(@Res() res: Response) {
    const { datos, tipo } = await this.empresa.logo();
    res.set({
      'Content-Type': tipo,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(datos);
  }
}

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('empresa')
export class EmpresaController {
  constructor(private readonly empresa: EmpresaService) {}

  @Get()
  @RequierePermiso('empresa.ver')
  ver() {
    return this.empresa.ver();
  }

  @Patch()
  @RequierePermiso('empresa.editar')
  editar(@Req() req: Peticion, @Body() body: DatosEmpresa) {
    return this.empresa.editar(req.usuario.id, req.ip, body ?? {});
  }

  @Put('logo')
  @RequierePermiso('empresa.editar')
  cambiarLogo(@Req() req: Peticion, @Body() body: { imagen?: unknown }) {
    return this.empresa.cambiarLogo(req.usuario.id, req.ip, body?.imagen);
  }

  @Delete('logo')
  @RequierePermiso('empresa.editar')
  quitarLogo(@Req() req: Peticion) {
    return this.empresa.quitarLogo(req.usuario.id, req.ip);
  }
}

@UseGuards(JwtAuthGuard, PermisosGuard)
@Controller('sucursales')
export class SucursalesController {
  constructor(private readonly empresa: EmpresaService) {}

  @Get()
  @RequierePermiso('sucursales.ver')
  listar() {
    return this.empresa.sucursales();
  }

  @Post()
  @RequierePermiso('sucursales.gestionar')
  crear(@Req() req: Peticion, @Body() body: DatosSucursal) {
    return this.empresa.crearSucursal(req.usuario.id, req.ip, body ?? {});
  }

  @Patch(':id')
  @RequierePermiso('sucursales.gestionar')
  editar(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: DatosSucursal,
  ) {
    return this.empresa.editarSucursal(req.usuario.id, id, req.ip, body ?? {});
  }

  @Patch(':id/estado')
  @RequierePermiso('sucursales.gestionar')
  estado(
    @Req() req: Peticion,
    @Param('id') id: string,
    @Body() body: { is_active?: unknown; motivo?: unknown },
  ) {
    return this.empresa.estadoSucursal(
      req.usuario.id,
      id,
      body?.is_active,
      body?.motivo,
      req.ip,
    );
  }
}
