import { Module } from '@nestjs/common';
import { FiscalController } from './fiscal.controller';
import { FiscalService } from './fiscal.service';

@Module({
  controllers: [FiscalController],
  providers: [FiscalService],
})
export class FiscalModule {}
