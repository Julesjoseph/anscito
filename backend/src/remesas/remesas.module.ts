import { Module } from '@nestjs/common';
import { RemesasController } from './remesas.controller';
import { RemesasService } from './remesas.service';

@Module({
  controllers: [RemesasController],
  providers: [RemesasService],
})
export class RemesasModule {}
