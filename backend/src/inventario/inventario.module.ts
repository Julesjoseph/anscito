import { Module } from '@nestjs/common';
import { EtiquetasController } from './etiquetas.controller';
import { EtiquetasService } from './etiquetas.service';
import { MovimientosController } from './movimientos.controller';
import { MovimientosService } from './movimientos.service';
import { ProductosController } from './productos.controller';
import { ProductosService } from './productos.service';

@Module({
  controllers: [
    ProductosController,
    MovimientosController,
    EtiquetasController,
  ],
  providers: [ProductosService, MovimientosService, EtiquetasService],
})
export class InventarioModule {}
