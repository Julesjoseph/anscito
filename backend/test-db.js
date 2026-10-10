require('dotenv').config();
const { Client } = require('pg');

async function probar() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    await client.connect();
    const r = await client.query(
      'SELECT current_database() AS base, version() AS version',
    );
    console.log('Conexión correcta a la base:', r.rows[0].base);
    console.log(r.rows[0].version);
  } catch (e) {
    console.error('No se pudo conectar:', e.message);
  } finally {
    await client.end().catch(() => {});
  }
}

probar();