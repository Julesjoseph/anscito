import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { UsuariosController } from './usuarios.controller';
import { UsuariosSeguridadService } from './usuarios-seguridad.service';
import { UsuariosService } from './usuarios.service';

@Module({
  controllers: [UsuariosController, RolesController],
  providers: [UsuariosService, UsuariosSeguridadService],
})
export class UsuariosModule {}