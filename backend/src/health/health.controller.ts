import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DatabaseService } from '../database/database.service';

@UseGuards(JwtAuthGuard)
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