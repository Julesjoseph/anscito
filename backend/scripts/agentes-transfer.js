// Pasa los agentes de SCITO TRANSFER de una laptop a otra (cada una tiene su
// propia base). Usa la conexión de backend/.env (no muestra credenciales).
//
// En la laptop que TIENE los agentes:
//   node scripts/agentes-transfer.js exportar anscito <archivo.json>
// En la otra laptop (primero solo revisa; con "importar" agrega):
//   node scripts/agentes-transfer.js revisar  anscito <archivo.json>
//   node scripts/agentes-transfer.js importar anscito <archivo.json>
//
// Al importar solo se AGREGAN los que faltan (mismo código o mismo nombre =
// ya existe): no se cambia ni se borra ningún agente. Cada agente agregado
// queda en la auditoría ('remesa_agente.importar'). Todo en una transacción.
// El archivo tiene nombres y teléfonos: no lo suba a GitHub; bórrelo al terminar.
const path = require('path');
const fs = require('fs');
const BACKEND = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(BACKEND, '.env'), quiet: true });
const { Client } = require('pg');

const CAMPOS = ['codigo', 'nombre', 'telefono', 'tipo', 'frecuencia_pago', 'grupo_whatsapp', 'notas', 'is_active'];

(async () => {
  const [modo, base, archivo] = process.argv.slice(2);
  if (!['exportar', 'revisar', 'importar'].includes(modo) || !base || !archivo) {
    console.log('Uso: node scripts/agentes-transfer.js exportar|revisar|importar <base> <archivo.json>');
    process.exitCode = 1;
    return;
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
    if (modo === 'exportar') {
      const r = await c.query(`SELECT ${CAMPOS.join(', ')} FROM remesa_agentes ORDER BY codigo`);
      fs.writeFileSync(archivo, JSON.stringify({ base, exportado: new Date().toISOString(), agentes: r.rows }, null, 2), 'utf8');
      console.log(`${r.rowCount} agentes exportados de ${base} a ${archivo}`);
      for (const a of r.rows) console.log(`  ${a.codigo}  ${a.nombre}  (${a.tipo}${a.is_active ? '' : ', inactivo'})`);
      return;
    }

    // Sin la marca BOM que agregan el Bloc de notas o PowerShell al guardar.
    const datos = JSON.parse(fs.readFileSync(archivo, 'utf8').replace(/^﻿/, ''));
    if (!Array.isArray(datos.agentes)) throw new Error('El archivo no tiene la lista de agentes');
    const existentes = (await c.query('SELECT codigo, lower(nombre) AS nombre FROM remesa_agentes')).rows;
    const nuevos = [];
    console.log(`Base ${base}: ${existentes.length} agentes ahora; el archivo trae ${datos.agentes.length}.`);
    for (const a of datos.agentes) {
      const ya = existentes.find((x) => x.codigo === a.codigo || x.nombre === String(a.nombre).toLowerCase());
      if (ya) console.log(`  ya existe  ${a.codigo}  ${a.nombre}`);
      else {
        console.log(`  AGREGAR    ${a.codigo}  ${a.nombre}  (${a.tipo})`);
        nuevos.push(a);
      }
    }
    if (nuevos.length === 0) {
      console.log('\nNo hay agentes que agregar.');
      return;
    }
    if (modo === 'revisar') {
      console.log(`\nSolo se revisó: no se cambió nada. Para agregar los ${nuevos.length}, use "importar".`);
      return;
    }

    await c.query('BEGIN');
    try {
      for (const a of nuevos) {
        const r = await c.query(
          `INSERT INTO remesa_agentes (codigo, nombre, telefono, tipo, frecuencia_pago, grupo_whatsapp, notas, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          CAMPOS.map((k) => a[k] ?? null),
        );
        await c.query(
          `INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, valor_nuevo, motivo)
           VALUES (NULL, 'remesa_agente.importar', 'remesa_agentes', $1, $2, $3)`,
          [
            r.rows[0].id,
            JSON.stringify({ codigo: a.codigo, nombre: a.nombre, tipo: a.tipo }),
            `Importado de la base ${datos.base} (exportado ${datos.exportado})`,
          ],
        );
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
    const total = (await c.query('SELECT count(*)::int n FROM remesa_agentes')).rows[0].n;
    console.log(`\n${nuevos.length} agentes agregados. Ahora ${base} tiene ${total}.`);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.log(`ERROR: ${e.message} (no se agregó ningún agente)`);
  process.exitCode = 1;
});
