import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CategoriasModule } from './categorias/categorias.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { InventarioModule } from './inventario/inventario.module';
import { ServiciosModule } from './servicios/servicios.module';
import { UsuariosModule } from './usuarios/usuarios.module';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    UsuariosModule,
    ServiciosModule,
    CategoriasModule,
    InventarioModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
