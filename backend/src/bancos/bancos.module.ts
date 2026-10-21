import { Module } from '@nestjs/common';
import { BancosController, BilleterasController } from './bancos.controller';
import { BancosService } from './bancos.service';
import {
  ConciliacionBilleterasController,
  ConciliacionController,
} from './conciliacion.controller';
import { ConciliacionService } from './conciliacion.service';

@Module({
  controllers: [
    BancosController,
    BilleterasController,
    ConciliacionController,
    ConciliacionBilleterasController,
  ],
  providers: [BancosService, ConciliacionService],
  exports: [BancosService],
})
export class BancosModule {}
