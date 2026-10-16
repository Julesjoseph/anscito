import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BancosModule } from './bancos/bancos.module';
import { CajaModule } from './caja/caja.module';
import { RemesasModule } from './remesas/remesas.module';
import { ReportesModule } from './reportes/reportes.module';
import { SanesModule } from './sanes/sanes.module';
import { FacturacionModule } from './facturacion/facturacion.module';
import { ComprasModule } from './compras/compras.module';
import { CxcModule } from './cxc/cxc.module';
import { CxpModule } from './cxp/cxp.module';
import { ContabilidadModule } from './contabilidad/contabilidad.module';
import { FiscalModule } from './fiscal/fiscal.module';
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
    BancosModule,
    CajaModule,
    RemesasModule,
    ReportesModule,
    SanesModule,
    FacturacionModule,
    ComprasModule,
    CxcModule,
    CxpModule,
    ContabilidadModule,
    FiscalModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
