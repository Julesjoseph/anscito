import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';

@Module({
  controllers: [UsuariosController, RolesController],
  providers: [UsuariosService],
})
export class UsuariosModule {}