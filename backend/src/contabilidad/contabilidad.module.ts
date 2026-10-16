import { Module } from '@nestjs/common';
import { ContabilidadController } from './contabilidad.controller';
import { ContabilidadService } from './contabilidad.service';
import { LibrosController } from './libros.controller';
import { LibrosService } from './libros.service';

@Module({
  controllers: [ContabilidadController, LibrosController],
  providers: [ContabilidadService, LibrosService],
})
export class ContabilidadModule {}
