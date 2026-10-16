// Respaldo de una base de ANSCITO (por defecto la real, "anscito"):
//   1. pg_dump en formato Custom a C:\SCITO-respaldos\<base>-AAAA-MM-DD_HHMM.backup
//   2. Verifica la copia (pg_restore --list la lee completa).
//   3. Copia el archivo a OneDrive\SCITO-respaldos (si esta laptop tiene OneDrive).
//   4. Deja solo las últimas N copias automáticas en cada carpeta (las copias
//      hechas a mano con otro nombre no se tocan).
//   5. Anota el resultado en C:\SCITO-respaldos\respaldos.log
// Usa la conexión de backend/.env (no muestra credenciales).
//
//   node scripts/respaldo.js                  -> respalda anscito
//   node scripts/respaldo.js anscito_demo     -> otra base
// Para restaurar: pgAdmin > clic derecho en una base vacía > Restore… > el archivo .backup
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const BACKEND = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(BACKEND, '.env'), quiet: true });

const BASE = process.argv[2] || 'anscito';
const CARPETA = process.env.RESPALDO_CARPETA || 'C:\\SCITO-respaldos';
const NUBE = process.env.OneDrive ? path.join(process.env.OneDrive, 'SCITO-respaldos') : null;
const GUARDAR = Number(process.env.RESPALDO_SEMANAS || 8);
const PATRON = new RegExp(`^${BASE}-\\d{4}-\\d{2}-\\d{2}_\\d{4}\\.backup$`);

fs.mkdirSync(CARPETA, { recursive: true });
const LOG = path.join(CARPETA, 'respaldos.log');
function anotar(texto) {
  const linea = `${new Date().toLocaleString('es-DO')}  ${texto}`;
  console.log(linea);
  fs.appendFileSync(LOG, linea + '\r\n', 'utf8');
}

// pg_dump y pg_restore de la versión más nueva de PostgreSQL instalada.
function herramienta(nombre) {
  const raiz = 'C:\\Program Files\\PostgreSQL';
  const versiones = fs.existsSync(raiz)
    ? fs.readdirSync(raiz).filter((v) => /^\d+$/.test(v)).sort((a, b) => Number(b) - Number(a))
    : [];
  for (const v of versiones) {
    const p = path.join(raiz, v, 'bin', `${nombre}.exe`);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`No se encontró ${nombre}.exe en ${raiz}\\<versión>\\bin`);
}

function dejarUltimas(carpeta) {
  const viejas = fs
    .readdirSync(carpeta)
    .filter((f) => PATRON.test(f))
    .sort()
    .reverse()
    .slice(GUARDAR);
  for (const f of viejas) {
    fs.unlinkSync(path.join(carpeta, f));
    anotar(`borrada copia vieja ${path.join(carpeta, f)}`);
  }
}

try {
  const ahora = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  const sello = `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}_${dos(ahora.getHours())}${dos(ahora.getMinutes())}`;
  const archivo = path.join(CARPETA, `${BASE}-${sello}.backup`);
  const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD };
  const conexion = ['-h', process.env.DB_HOST || 'localhost', '-p', String(process.env.DB_PORT || 5432), '-U', process.env.DB_USER];

  const dump = spawnSync(herramienta('pg_dump'), [...conexion, '-F', 'c', '-f', archivo, BASE], { env, encoding: 'utf8' });
  if (dump.status !== 0) throw new Error(`pg_dump falló: ${(dump.stderr || '').trim()}`);

  const lista = spawnSync(herramienta('pg_restore'), ['--list', archivo], { encoding: 'utf8' });
  const entradas = (lista.stdout || '').split('\n').filter((l) => l && !l.startsWith(';')).length;
  if (lista.status !== 0 || entradas === 0) throw new Error(`la copia no se pudo leer: ${(lista.stderr || '').trim()}`);
  const mb = (fs.statSync(archivo).size / 1048576).toFixed(1);
  anotar(`OK ${BASE}: ${archivo} (${mb} MB, ${entradas} objetos verificados)`);

  if (NUBE) {
    fs.mkdirSync(NUBE, { recursive: true });
    fs.copyFileSync(archivo, path.join(NUBE, path.basename(archivo)));
    anotar(`copiada a OneDrive: ${NUBE}`);
    dejarUltimas(NUBE);
  } else {
    anotar('AVISO: esta laptop no tiene OneDrive; la copia quedó solo en ' + CARPETA);
  }
  dejarUltimas(CARPETA);
} catch (e) {
  anotar(`ERROR ${BASE}: ${e.message}`);
  process.exitCode = 1;
}
