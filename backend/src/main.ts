import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // 1 MB alcanza para el logo de la empresa (512 KB en base64).
  app.useBodyParser('json', { limit: '1mb' });
  // Pantallas que pueden usar este servidor. Sin configurar es el entorno
  // de PRUEBAS (5180); los accesos ANSCITO (5173) y DEMO (5174) lo indican.
  const origenes = (process.env.CORS_ORIGENES ?? 'http://localhost:5180')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origenes });
  // Pruebas: 3010. ANSCITO real: 3000. DEMO: 3001 (los da cada acceso).
  await app.listen(process.env.PORT ?? 3010);
}
void bootstrap();
