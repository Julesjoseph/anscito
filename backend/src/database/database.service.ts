import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    max: 10,
  });

  query<T extends QueryResultRow = any>(text: string, params?: unknown[]) {
    return this.pool.query<T>(text, params);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}