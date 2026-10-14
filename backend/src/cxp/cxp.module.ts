import { Module } from '@nestjs/common';
import { CxpController } from './cxp.controller';
import { CxpService } from './cxp.service';

@Module({
  controllers: [CxpController],
  providers: [CxpService],
})
export class CxpModule {}
