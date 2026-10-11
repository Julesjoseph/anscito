import { Module } from '@nestjs/common';
import { BancosModule } from '../bancos/bancos.module';
import { CajaController } from './caja.controller';
import { CajaService } from './caja.service';

@Module({
  imports: [BancosModule],
  controllers: [CajaController],
  providers: [CajaService],
})
export class CajaModule {}
