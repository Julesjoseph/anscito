// Revisa qué migraciones (de la 021 en adelante) tiene una base de ANSCITO y, si se pide,
// aplica las que faltan, en orden y una sola vez. Usa la conexión de backend/.env
// (no muestra credenciales).
//
//   node scripts/migraciones-pendientes.js anscito            -> solo revisa (no cambia nada)
//   node scripts/migraciones-pendientes.js anscito aplicar    -> aplica las pendientes
//
// Antes de aplicar: copia de seguridad de la base (pgAdmin > Backup).
// Se detiene si encuentra un hueco (una migración que falta antes de otra que
// sí está) o si una falla; la que falla se deshace completa (ROLLBACK).
const path = require('path');
const fs = require('fs');
const BACKEND = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(BACKEND, '.env'), quiet: true });
const { Client } = require('pg');

const DATABASE = path.resolve(BACKEND, '..', 'database');

// Cada migración y cómo saber si ya está aplicada (algo que ella crea).
const MIGRACIONES = [
  ['021', "SELECT to_regclass('public.compras') IS NOT NULL"],
  ['023', "SELECT to_regclass('public.cxc_abonos') IS NOT NULL"],
  ['024', "SELECT to_regclass('public.cxp_pagos') IS NOT NULL"],
  ['025', "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'compras' AND column_name = 'gasto_fijo_mes')"],
  ['026', "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'terceros' AND column_name = 'codigo')"],
  ['027', "SELECT to_regclass('public.tasas_dolar') IS NOT NULL"],
  ['028', "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'caja_movimientos_usd' AND column_name = 'monto_dop')"],
  ['029', "SELECT to_regclass('public.cuentas_contables') IS NOT NULL"],
  ['030', "SELECT to_regclass('public.contabilidad_reglas') IS NOT NULL"],
  ['031', "SELECT COALESCE((SELECT data_type = 'character varying' FROM information_schema.columns WHERE table_name = 'asientos' AND column_name = 'origen_id'), false)"],
  ['032', "SELECT EXISTS (SELECT 1 FROM auditoria WHERE accion = 'migracion.032')"],
  ['033', "SELECT to_regclass('public.contabilidad_clasificaciones') IS NOT NULL"],
  ['034', "SELECT EXISTS (SELECT 1 FROM configuracion WHERE clave = 'lineas.unidad_sol_cash')"],
  ['035', "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'categorias' AND column_name = 'impuesto_id')"],
  ['036', "SELECT to_regclass('public.tipos_retencion_isr') IS NOT NULL"],
  ['037', "SELECT NOT EXISTS (SELECT 1 FROM categorias WHERE prefijo IS NULL)"],
  // Cada migración nueva se agrega aquí con su comprobación, al publicarla.
].filter(([n]) => fs.readdirSync(DATABASE).some((x) => x.startsWith(`${n}_`) && x.endsWith('.sql')));
// (Solo cuentan las que vienen en esta versión del código: las que todavía no
// llegaron con git pull no se revisan.)
// Las que solo se revisan (no se aplican desde aquí): si faltan, hay que verlo aparte.
const SOLO_REVISAR = new Set(['021', '023']);

function archivo(numero) {
  const f = fs.readdirSync(DATABASE).find((x) => x.startsWith(`${numero}_`) && x.endsWith('.sql'));
  if (!f) throw new Error(`No se encontró database/${numero}_*.sql: haga git pull`);
  return f;
}

(async () => {
  const base = process.argv[2];
  const aplicar = process.argv[3] === 'aplicar';
  if (!base) {
    console.log('Uso: node scripts/migraciones-pendientes.js <base> [aplicar]');
    process.exit(1);
  }
  const c = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: base,
  });
  await c.connect();
  try {
    const estado = async () => {
      const r = [];
      for (const [n, sql] of MIGRACIONES) {
        const v = Object.values((await c.query(sql)).rows[0])[0];
        r.push([n, v === true]);
      }
      return r;
    };
    const antes = await estado();
    console.log(`Base ${base}:`);
    for (const [n, ok] of antes) console.log(`  ${n}  ${ok ? 'aplicada' : 'FALTA'}`);

    const primeraQueFalta = antes.findIndex(([, ok]) => !ok);
    if (primeraQueFalta === -1) {
      console.log(`\nNo falta ninguna (021 a ${MIGRACIONES.at(-1)[0]}).`);
      return;
    }
    const hueco = antes.slice(primeraQueFalta).some(([, ok]) => ok);
    if (hueco) {
      console.log('\nHay un hueco: falta una migración antes de otra que sí está. No se aplica nada; revíselo con Claude.');
      process.exitCode = 1;
      return;
    }
    const pendientes = antes.slice(primeraQueFalta).map(([n]) => n);
    const noAplicables = pendientes.filter((n) => SOLO_REVISAR.has(n));
    if (noAplicables.length) {
      console.log(`\nFaltan migraciones antiguas (${noAplicables.join(', ')}): no se aplica nada; revíselo con Claude.`);
      process.exitCode = 1;
      return;
    }
    console.log(`\nPendientes, en orden: ${pendientes.join(', ')}`);
    pendientes.forEach((n) => archivo(n)); // que existan todos los archivos antes de empezar
    if (!aplicar) {
      console.log('Solo se revisó: no se cambió nada. Para aplicarlas, agregue "aplicar" al final.');
      return;
    }
    for (const n of pendientes) {
      const f = archivo(n);
      try {
        await c.query(fs.readFileSync(path.join(DATABASE, f), 'utf8'));
        console.log(`  ${f}: aplicada`);
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        console.log(`  ${f}: ERROR ${e.message}\nSe detuvo aquí (esta migración se deshizo completa; las anteriores quedaron aplicadas).`);
        process.exitCode = 1;
        return;
      }
    }
    console.log('\nComprobación final:');
    for (const [n, ok] of await estado()) console.log(`  ${n}  ${ok ? 'aplicada' : 'FALTA'}`);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.log(`ERROR: ${e.message}`);
  process.exitCode = 1;
});
