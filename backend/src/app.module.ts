import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}