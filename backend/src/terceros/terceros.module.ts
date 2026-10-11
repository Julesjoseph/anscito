import { Module } from '@nestjs/common';
import {
  ClientesController,
  ProveedoresController,
} from './terceros.controller';
import { TercerosService } from './terceros.service';

@Module({
  controllers: [ClientesController, ProveedoresController],
  providers: [TercerosService],
})
export class TercerosModule {}
