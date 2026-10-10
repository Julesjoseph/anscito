import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get('db')
  async comprobarBase() {
    const r = await this.db.query<{ base: string }>(
      'SELECT current_database() AS base',
    );
    return { ok: true, base: r.rows[0].base };
  }
}