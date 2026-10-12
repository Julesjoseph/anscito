// Crea la base REAL "anscito" desde cero (una sola vez):
//   - Aplica todas las migraciones (lo mínimo para funcionar).
//   - Agrega los agentes activos de SCITO TRANSFER (decisión del dueño).
// No copia usuarios, servicios, clientes, cuentas ni movimientos.
// Si la base "anscito" ya existe, NO hace nada (nunca la borra).
//
// Uso (desde backend):  node scripts/crear-base-real.js
// Después, crear el administrador:
//   $env:DB_NAME = 'anscito'; node scripts/crear-admin.js
'use strict';

const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '..');
const MIGRACIONES = path.resolve(BACKEND, '..', 'database');
require('dotenv').config({ path: path.join(BACKEND, '.env'), quiet: true });
const { Client } = require('pg');

const REAL = 'anscito';
const AGENTES_DESDE = process.env.AGENTES_DESDE || 'anscito_dev';

function conexion(database) {
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database,
  };
}

async function main() {
  const admin = new Client(conexion('postgres'));
  await admin.connect();
  const ya = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [REAL]);
  if (ya.rowCount > 0) {
    await admin.end();
    console.log(`La base ${REAL} ya existe: no se hizo nada (nunca se borra).`);
    return;
  }
  console.log(`== Creando la base ${REAL}`);
  await admin.query(`CREATE DATABASE ${REAL}`);
  await admin.end();

  const c = new Client(conexion(REAL));
  await c.connect();
  try {
    const archivos = fs.readdirSync(MIGRACIONES).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
    console.log(`== Aplicando ${archivos.length} migraciones`);
    for (const f of archivos) {
      await c.query(fs.readFileSync(path.join(MIGRACIONES, f), 'utf8'));
      console.log(`   ${f}`);
    }

    // Agentes activos (los 13 importados del Excel), sin datos de prueba.
    const src = new Client(conexion(AGENTES_DESDE));
    await src.connect();
    const agentes = (
      await src.query(
        `SELECT codigo, nombre, telefono, tipo, frecuencia_pago, grupo_whatsapp
         FROM remesa_agentes WHERE is_active AND codigo ~ '^SC-[0-9]{3}$' ORDER BY codigo`,
      )
    ).rows;
    await src.end();

    await c.query('BEGIN');
    for (const a of agentes) {
      const r = await c.query(
        `INSERT INTO remesa_agentes (codigo, nombre, telefono, tipo, frecuencia_pago, grupo_whatsapp, notas)
         VALUES ($1, $2, $3, $4, $5, $6, 'Agente cargado al crear la base real') RETURNING id`,
        [a.codigo, a.nombre, a.telefono, a.tipo, a.frecuencia_pago, a.grupo_whatsapp],
      );
      await c.query(
        `INSERT INTO auditoria (accion, entidad, entidad_id, valor_nuevo, motivo)
         VALUES ('remesa_agente.importar', 'remesa_agentes', $1, $2, 'Agentes cargados al crear la base real')`,
        [r.rows[0].id, JSON.stringify({ codigo: a.codigo, nombre: a.nombre, tipo: a.tipo })],
      );
    }
    await c.query('COMMIT');
    console.log(`== ${agentes.length} agentes cargados`);

    const v = (
      await c.query(`
        SELECT (SELECT count(*) FROM usuarios)::int AS usuarios,
               (SELECT count(*) FROM servicios)::int AS servicios,
               (SELECT count(*) FROM ventas)::int AS ventas,
               (SELECT count(*) FROM remesas)::int AS envios,
               (SELECT count(*) FROM remesa_agentes)::int AS agentes,
               (SELECT tasa || ' HTG/RD$' FROM remesas_tarifas LIMIT 1) AS tasa`)
    ).rows[0];
    console.log('== Comprobación:', v);
    console.log('\nFalta crear el administrador (con su contraseña):');
    console.log("   $env:DB_NAME = 'anscito'; node scripts/crear-admin.js");
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(`NO SE PUDO CREAR LA BASE REAL: ${e.message}`);
  process.exitCode = 1;
});
