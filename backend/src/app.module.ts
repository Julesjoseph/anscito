import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CategoriasModule } from './categorias/categorias.module';
import { DatabaseModule } from './database/database.module';
import { EmpresaModule } from './empresa/empresa.module';
import { HealthController } from './health/health.controller';
import { InventarioModule } from './inventario/inventario.module';
import { PanelModule } from './panel/panel.module';
import { ServiciosModule } from './servicios/servicios.module';
import { TercerosModule } from './terceros/terceros.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { VentasModule } from './ventas/ventas.module';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    UsuariosModule,
    ServiciosModule,
    CategoriasModule,
    InventarioModule,
    TercerosModule,
    EmpresaModule,
    VentasModule,
    PanelModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
