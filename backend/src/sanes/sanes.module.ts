import { Module } from '@nestjs/common';
import { FichasController } from './fichas.controller';
import { FichasService } from './fichas.service';
import { SanesController } from './sanes.controller';
import { SanesService } from './sanes.service';

@Module({
  // FichasController primero: sus rutas fijas antes de las rutas ":id".
  controllers: [FichasController, SanesController],
  providers: [SanesService, FichasService],
})
export class SanesModule {}
