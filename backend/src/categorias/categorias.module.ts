import { Module } from '@nestjs/common';
import {
  CategoriasController,
  UnidadesNegocioController,
} from './categorias.controller';
import { CategoriasService } from './categorias.service';

@Module({
  controllers: [UnidadesNegocioController, CategoriasController],
  providers: [CategoriasService],
})
export class CategoriasModule {}
