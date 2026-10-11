import { Module } from '@nestjs/common';
import {
  EmpresaController,
  MarcaController,
  SucursalesController,
} from './empresa.controller';
import { EmpresaService } from './empresa.service';

@Module({
  controllers: [MarcaController, EmpresaController, SucursalesController],
  providers: [EmpresaService],
})
export class EmpresaModule {}
