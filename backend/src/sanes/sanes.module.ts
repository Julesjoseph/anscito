import { Module } from '@nestjs/common';
import { SanesController } from './sanes.controller';
import { SanesService } from './sanes.service';

@Module({
  controllers: [SanesController],
  providers: [SanesService],
})
export class SanesModule {}
