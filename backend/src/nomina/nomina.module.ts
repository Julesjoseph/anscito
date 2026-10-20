import { Module } from '@nestjs/common';
import { NominaController } from './nomina.controller';
import { NominaService } from './nomina.service';

@Module({
  controllers: [NominaController],
  providers: [NominaService],
})
export class NominaModule {}
