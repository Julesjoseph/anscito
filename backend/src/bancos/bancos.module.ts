import { Module } from '@nestjs/common';
import { BancosController } from './bancos.controller';
import { BancosService } from './bancos.service';
import { ConciliacionController } from './conciliacion.controller';
import { ConciliacionService } from './conciliacion.service';

@Module({
  controllers: [BancosController, ConciliacionController],
  providers: [BancosService, ConciliacionService],
  exports: [BancosService],
})
export class BancosModule {}
