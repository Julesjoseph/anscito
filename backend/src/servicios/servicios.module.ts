import { Module } from '@nestjs/common';
import { ImpuestosController } from './impuestos.controller';
import { ImpuestosService } from './impuestos.service';
import { ServiciosController } from './servicios.controller';
import { ServiciosService } from './servicios.service';

@Module({
  controllers: [ServiciosController, ImpuestosController],
  providers: [ServiciosService, ImpuestosService],
})
export class ServiciosModule {}
