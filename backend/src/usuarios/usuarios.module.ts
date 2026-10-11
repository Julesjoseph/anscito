import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { UsuariosController } from './usuarios.controller';
import { UsuariosSeguridadService } from './usuarios-seguridad.service';
import { UsuariosService } from './usuarios.service';

@Module({
  controllers: [UsuariosController, RolesController],
  providers: [UsuariosService, UsuariosSeguridadService, RolesService],
})
export class UsuariosModule {}
