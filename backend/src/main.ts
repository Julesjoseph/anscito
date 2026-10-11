import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // 1 MB alcanza para el logo de la empresa (512 KB en base64).
  app.useBodyParser('json', { limit: '1mb' });
  app.enableCors({ origin: ['http://localhost:5173'] });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
