// Reinicia la base DEMO (entrenamiento) y la deja como nueva:
//   1. Borra SOLO la base "anscito_demo" y la crea de nuevo.
//   2. Aplica todas las migraciones (database/NNN_*.sql).
//   3. Copia los catálogos ACTIVOS del sistema real (servicios, precios,
//      productos, agentes, tasa, roles, cuentas sin números, cajas...).
//      Nunca copia usuarios, clientes, ventas, envíos ni movimientos.
//   4. Crea usuarios de entrenamiento y datos inventados (clientes, ventas,
//      caja, bancos y envíos) usando las mismas reglas del sistema.
// La contraseña de los usuarios de entrenamiento se genera en cada
// reinicio y se guarda en un archivo de texto (DEMO_ARCHIVO_USUARIOS).
//
// Uso (desde backend, con el código compilado en dist):
//   node scripts/demo/reiniciar-demo.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const BACKEND = path.resolve(__dirname, '..', '..');
const MIGRACIONES = path.resolve(BACKEND, '..', 'database');
// En la versión publicada, el .env se lee de su lugar de siempre (publicado.json).
require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || path.join(BACKEND, '.env'), quiet: true });
const { Client, Pool } = require('pg');
const bcrypt = require('bcrypt');

// Única base que este script puede borrar.
const DEMO = 'anscito_demo';

function conexion(database) {
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database,
  };
}

function paso(texto) {
  console.log(`\n== ${texto}`);
}

function requerir(rel) {
  const ruta = path.join(BACKEND, 'dist', rel);
  if (!fs.existsSync(`${ruta}.js`)) {
    throw new Error(
      `Falta el código compilado (${rel}). Ejecute "npm run build" en la carpeta backend y vuelva a intentar.`,
    );
  }
  return require(ruta);
}

async function baseExiste(admin, nombre) {
  const r = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [nombre]);
  return r.rowCount > 0;
}

async function main() {
  if (DEMO !== 'anscito_demo') throw new Error('Nombre de base demo inesperado: no se hace nada');

  // ---------- 1. Borrar y crear la base demo ----------
  const admin = new Client(conexion('postgres'));
  await admin.connect();
  const origen =
    process.env.DEMO_CATALOGO_DB ||
    ((await baseExiste(admin, 'anscito')) ? 'anscito' : 'anscito_dev');
  if (origen === DEMO) throw new Error('El origen de los catálogos no puede ser la base demo');
  if (!(await baseExiste(admin, origen))) throw new Error(`No existe la base ${origen}`);

  paso(`Borrando y creando la base ${DEMO} (catálogos desde ${origen})`);
  await admin.query(`DROP DATABASE IF EXISTS ${DEMO} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DEMO}`);
  await admin.end();

  // ---------- 2. Migraciones ----------
  const pool = new Pool(conexion(DEMO));
  const archivos = fs
    .readdirSync(MIGRACIONES)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort();
  paso(`Aplicando ${archivos.length} migraciones`);
  for (const f of archivos) {
    await pool.query(fs.readFileSync(path.join(MIGRACIONES, f), 'utf8'));
    console.log(`   ${f}`);
  }

  // Igual que DatabaseService, pero sobre la base demo.
  const db = {
    query: (t, p) => pool.query(t, p),
    transaccion: async (fn) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await fn(c);
        await c.query('COMMIT');
        return r;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
  };
  const uno = async (sql, p) => (await pool.query(sql, p)).rows[0];

  // ---------- Usuarios de entrenamiento ----------
  const clave = `Demo-${crypto.randomBytes(3).toString('hex')}-${new Date().getFullYear()}`;
  const hash = await bcrypt.hash(clave, 12);
  const suc = (await uno('SELECT id FROM sucursales WHERE es_principal')).id;
  async function usuario(username, nombre, apellido, roles) {
    const u = await uno(
      `INSERT INTO usuarios (username, nombre, apellido, password_hash, must_change_password, sucursal_id)
       VALUES ($1, $2, $3, $4, false, $5) RETURNING id`,
      [username, nombre, apellido, hash, suc],
    );
    await pool.query(
      `INSERT INTO usuario_roles (usuario_id, rol_id)
       SELECT $1, id FROM roles WHERE codigo = ANY($2)`,
      [u.id, roles],
    );
    return u.id;
  }
  paso('Creando el administrador de entrenamiento');
  const adminId = await usuario('demo.admin', 'Administrador', 'Demo', ['administrador']);

  // ---------- 3. Catálogos del sistema real ----------
  const src = new Client(conexion(origen));
  await src.connect();
  const s = async (sql, p) => (await src.query(sql, p)).rows;
  paso('Copiando catálogos activos');

  const cols = async (tabla) =>
    (await uno(
      `SELECT array_agg(column_name::text) AS c FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`,
      [tabla],
    )).c;

  // Empresa y sucursal principal.
  const emp = (await s('SELECT * FROM empresa WHERE id = 1'))[0];
  const colsEmp = (await cols('empresa')).filter((c) => !['id', 'updated_by', 'updated_at'].includes(c));
  await pool.query(
    `UPDATE empresa SET ${colsEmp.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = 1`,
    colsEmp.map((c) => emp[c]),
  );
  const sp = (await s('SELECT nombre, direccion, telefono, encargado FROM sucursales WHERE es_principal'))[0];
  await pool.query(
    'UPDATE sucursales SET nombre = $1, direccion = $2, telefono = $3, encargado = $4 WHERE es_principal',
    [sp.nombre, sp.direccion, sp.telefono, sp.encargado],
  );
  console.log(`   empresa "${emp.nombre_comercial}", sucursal ${sp.nombre}`);

  // Configuración.
  for (const f of await s('SELECT clave, valor FROM configuracion')) {
    await pool.query('UPDATE configuracion SET valor = $2 WHERE clave = $1', [f.clave, f.valor]);
  }

  // Roles y sus permisos (el administrador ya tiene todos).
  const roles = await s(`
    SELECT r.codigo, r.nombre, r.descripcion,
           COALESCE(array_agg(p.codigo::text) FILTER (WHERE p.codigo IS NOT NULL), '{}') AS permisos
    FROM roles r LEFT JOIN rol_permisos rp ON rp.rol_id = r.id LEFT JOIN permisos p ON p.id = rp.permiso_id
    WHERE r.is_active AND r.codigo <> 'administrador'
    GROUP BY r.codigo, r.nombre, r.descripcion`);
  for (const r of roles) {
    const ro = await uno(
      `INSERT INTO roles (codigo, nombre, descripcion) VALUES ($1, $2, $3)
       ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, descripcion = EXCLUDED.descripcion
       RETURNING id`,
      [r.codigo, r.nombre, r.descripcion],
    );
    await pool.query('DELETE FROM rol_permisos WHERE rol_id = $1', [ro.id]);
    await pool.query(
      `INSERT INTO rol_permisos (rol_id, permiso_id) SELECT $1, id FROM permisos WHERE codigo = ANY($2)`,
      [ro.id, r.permisos],
    );
  }
  console.log(`   ${roles.length} roles con sus permisos`);

  // Servicios que crean datos (con sus reglas y su auditoría).
  const { CategoriasService } = requerir('categorias/categorias.service');
  const { ServiciosService } = requerir('servicios/servicios.service');
  const { ProductosService } = requerir('inventario/productos.service');
  const { CajaService } = requerir('caja/caja.service');
  const { BancosService } = requerir('bancos/bancos.service');
  const { RemesasService } = requerir('remesas/remesas.service');
  const { TercerosService } = requerir('terceros/terceros.service');
  const { VentasService } = requerir('ventas/ventas.service');
  const cat = new CategoriasService(db);
  const serv = new ServiciosService(db);
  const prod = new ProductosService(db);
  const caja = new CajaService(db);
  const banc = new BancosService(db);
  const rem = new RemesasService(db);
  const terc = new TercerosService(db);
  const vent = new VentasService(db);

  // Unidades de negocio y categorías.
  const unidadDe = {};
  for (const u of await s('SELECT codigo, nombre FROM unidades_negocio WHERE is_active')) {
    let d = await uno('SELECT id FROM unidades_negocio WHERE codigo = $1', [u.codigo]);
    if (!d) {
      await cat.crearUnidad(adminId, undefined, { nombre: u.nombre });
      d = await uno('SELECT id FROM unidades_negocio WHERE lower(nombre) = lower($1)', [u.nombre]);
    }
    unidadDe[u.codigo] = d.id;
  }
  const categoriaDe = {};
  for (const c of await s(`
      SELECT c.id, c.nombre, c.descripcion, c.prefijo, u.codigo AS unidad
      FROM categorias c JOIN unidades_negocio u ON u.id = c.unidad_negocio_id
      WHERE c.is_active AND u.is_active`)) {
    const r = await cat.crearCategoria(adminId, undefined, {
      unidadNegocioId: unidadDe[c.unidad],
      nombre: c.nombre,
      descripcion: c.descripcion ?? '',
      prefijo: c.prefijo ?? '',
    });
    categoriaDe[c.id] = r.id;
  }
  const mapa = async (tabla) =>
    Object.fromEntries((await pool.query(`SELECT codigo, id FROM ${tabla}`)).rows.map((f) => [f.codigo, f.id]));
  const impuestoDe = await mapa('impuestos');
  const medidaDe = await mapa('unidades_medida');

  // Servicios.
  const servicios = await s(`
    SELECT s.*, u.codigo AS unidad, um.codigo AS medida, i.codigo AS impuesto
    FROM servicios s
    JOIN unidades_negocio u ON u.id = s.unidad_negocio_id
    JOIN unidades_medida um ON um.id = s.unidad_medida_id
    JOIN impuestos i ON i.id = s.impuesto_id
    WHERE s.is_active`);
  for (const x of servicios) {
    await serv.crear(adminId, undefined, {
      codigo: x.codigo,
      nombre: x.nombre,
      descripcion: x.descripcion ?? '',
      unidadNegocioId: unidadDe[x.unidad],
      categoriaId: x.categoria_id ? (categoriaDe[x.categoria_id] ?? '') : '',
      unidadMedidaId: medidaDe[x.medida],
      precio: x.precio,
      costo: x.costo ?? '',
      impuestoId: impuestoDe[x.impuesto],
      precioIncluyeItbis: x.precio_incluye_itbis,
      gananciaTipo: x.ganancia_tipo,
      comisionPct: x.comision_pct ?? '',
    });
  }
  console.log(`   ${servicios.length} servicios`);

  // Productos (con existencia inventada para practicar).
  const productos = await s(`
    SELECT p.*, um.codigo AS medida, i.codigo AS impuesto
    FROM productos p
    JOIN categorias c ON c.id = p.categoria_id AND c.is_active
    JOIN unidades_medida um ON um.id = p.unidad_id
    JOIN impuestos i ON i.id = p.impuesto_id
    WHERE p.is_active`);
  for (const x of productos) {
    await prod.crear(adminId, undefined, {
      nombre: x.nombre,
      categoriaId: categoriaDe[x.categoria_id],
      unidadId: medidaDe[x.medida],
      costo: x.costo,
      impuestoId: impuestoDe[x.impuesto],
      precioVenta: x.precio_venta ?? '',
      precioIncluyeItbis: x.precio_incluye_itbis,
      stockMinimo: x.stock_minimo ?? '',
      existenciaInicial: '60',
    });
  }
  console.log(`   ${productos.length} productos (con 60 unidades cada uno)`);

  // Cajas, cuentas (sin números de cuenta), tasa y agentes.
  for (const c of await s('SELECT codigo, nombre FROM cajas WHERE is_active')) {
    if (!(await uno('SELECT 1 AS x FROM cajas WHERE codigo = $1', [c.codigo]))) {
      await caja.crearCaja(adminId, undefined, { codigo: c.codigo, nombre: c.nombre });
    }
  }
  const cuentas = [];
  for (const c of await s('SELECT * FROM cuentas WHERE is_active ORDER BY tipo, nombre')) {
    const r = await banc.crearCuenta(adminId, undefined, {
      codigo: c.codigo,
      tipo: c.tipo,
      entidad: c.entidad,
      nombre: c.nombre,
      tipoCuenta: c.tipo_cuenta ?? '',
      moneda: c.moneda,
      recibeVentas: c.recibe_ventas,
    });
    cuentas.push({ ...c, id: r.id });
  }
  console.log(`   ${cuentas.length} cuentas y billeteras (sin números de cuenta)`);
  const t = (await s(`SELECT tasa, comision_pct, comision_agente_pct FROM remesas_tarifas
                      WHERE vigente_desde <= now() ORDER BY vigente_desde DESC LIMIT 1`))[0];
  if (t) {
    await rem.nuevaTarifa(adminId, undefined, {
      tasa: t.tasa.replace(/\.?0+$/, ''),
      comisionPct: t.comision_pct,
      comisionAgentePct: t.comision_agente_pct,
      motivo: 'Tasa copiada del sistema real',
    });
  }
  const agentes = [];
  for (const a of await s('SELECT * FROM remesa_agentes WHERE is_active ORDER BY codigo')) {
    const r = await rem.crearAgente(adminId, undefined, {
      codigo: a.codigo,
      nombre: a.nombre,
      telefono: a.telefono ?? '',
      tipo: a.tipo,
      frecuenciaPago: a.frecuencia_pago ?? '',
      grupoWhatsapp: a.grupo_whatsapp ?? '',
      notas: '',
    });
    agentes.push({ ...a, id: r.id });
  }
  console.log(`   ${agentes.length} agentes, tasa ${t ? t.tasa : '(la de la migración)'}`);
  await src.end();

  // ---------- 4. Datos inventados ----------
  paso('Creando usuarios y datos de entrenamiento');
  const cajero = await usuario('demo.cajero', 'Cajero', 'Demo', ['cajero', 'ventas']);
  const opRd = await usuario('demo.envios.rd', 'Operador RD', 'Demo', ['operador_envios_rd']);
  const opHt = await usuario('demo.envios.haiti', 'Operador Haití', 'Demo', ['operador_envios_haiti']);

  // Saldos iniciales inventados.
  const tasaHtgEnPesos = t ? (1 / Number(t.tasa)).toFixed(6) : '0.48';
  for (const c of cuentas) {
    const datos =
      c.moneda === 'DOP'
        ? { monto: '150000' }
        : c.moneda === 'USD'
          ? { monto: '2500', tasa: '60.50' }
          : { monto: '120000', tasa: tasaHtgEnPesos };
    await banc.saldoInicial(adminId, c.id, undefined, datos);
  }

  // Clientes inventados (cédulas 999…: no son de personas reales).
  const nombres = [
    'María Altagracia Pérez', 'José Ramón Rodríguez', 'Carmen Julia Santos', 'Luis Alberto Fernández',
    'Ana Mercedes Díaz', 'Pedro Antonio Jiménez', 'Rosa Elena Martínez', 'Juan Carlos Batista',
    'Jean Pierre Louis', 'Marie Claude Joseph', 'Wilner Saint Fleur', 'Nadège Pierre',
  ];
  const cedula = (await uno("SELECT id FROM tipos_documento WHERE codigo = 'cedula'")).id;
  const clientes = [];
  for (let i = 0; i < nombres.length; i++) {
    const r = await terc.crear('cliente', adminId, undefined, {
      tipoDocumentoId: cedula,
      numeroDocumento: `999${String(1000001 + i).padStart(7, '0')}${i % 10}`,
      nombre: nombres[i],
      esContribuyente: false,
      puedeCredito: false,
      telefono: `809-555-${String(100 + i).padStart(4, '0')}`,
    });
    clientes.push(r.id);
  }

  // Caja abierta con ventas en efectivo y por transferencia.
  const caja1 = (await uno("SELECT id FROM cajas WHERE codigo = 'CAJA-1'")).id;
  const ses = await caja.abrir(cajero, caja1, undefined, { fondoInicial: '3000' });
  const prep = await vent.preparar(cajero);
  const F = Object.fromEntries(prep.formasPago.map((f) => [f.codigo, f.id]));
  const recibeVentas = prep.cuentasVenta[0];
  const articulos = await uno(`
    SELECT (SELECT array_agg(id ORDER BY codigo) FROM servicios WHERE is_active) AS servicios,
           (SELECT array_agg(id ORDER BY codigo) FROM productos WHERE is_active) AS productos`);
  const lineas = (i) => {
    const l = [];
    if (articulos.servicios?.length) l.push({ tipo: 'servicio', id: articulos.servicios[i % articulos.servicios.length], cantidad: '1' });
    if (articulos.productos?.length && i % 2 === 0) l.push({ tipo: 'producto', id: articulos.productos[0], cantidad: String(1 + (i % 3)) });
    return l;
  };
  const ventas = [];
  for (let i = 0; i < 8; i++) {
    if (!lineas(i).length) break;
    const efectivo = !recibeVentas || i % 3 !== 2;
    const v = await vent.crear(cajero, undefined, {
      clienteId: i % 2 ? clientes[i] : prep.consumidorFinal?.id,
      lineas: lineas(i),
      pago: efectivo
        ? { formaPagoId: F.efectivo, recibido: '5000', cajaId: caja1 }
        : { formaPagoId: F.transferencia, referencia: `TRX-DEMO-${100 + i}`, cuentaId: recibeVentas.id },
    });
    ventas.push(v);
  }
  if (ventas.length > 1) {
    await vent.anular(adminId, ventas[1].id, undefined, 'Venta de práctica anulada', caja1);
  }
  const limpieza = (await uno("SELECT id FROM categorias_gasto WHERE codigo = 'limpieza'")).id;
  await caja.movimiento(cajero, ses.id, undefined, {
    tipo: 'gasto',
    monto: '250',
    categoriaGastoId: limpieza,
    motivo: 'Artículos de limpieza (práctica)',
  });
  console.log(`   ${clientes.length} clientes, ${ventas.length} ventas (1 anulada), Caja 1 abierta`);

  // Envíos a Haití: confirmados, rechazado y pendientes.
  const rp = await rem.preparar(adminId);
  const billetera = rp.billeteras[0];
  const autorizados = agentes.filter((a) => a.tipo === 'autorizado').slice(0, 3);
  const propio = agentes.find((a) => a.tipo === 'propio');
  const beneficiarios = [
    ['Jean Baptiste Moïse', '3710-0001'], ['Marie Ange Dorval', '3710-0002'], ['Pierre Richard Noël', '3710-0003'],
    ['Rose Merline Jean', '3710-0004'], ['Jacques Antoine Paul', '3710-0005'], ['Guerline Saint Louis', '3710-0006'],
    ['Frantz Joseph', '3710-0007'], ['Mirlande Etienne', '3710-0008'], ['Wilson Charles', '3710-0009'],
  ];
  const parentescos = ['Madre', 'Hermano', 'Hermana', 'Padre', 'Hijo', 'Esposa', 'Tía', 'Primo', 'Amiga'];
  const montos = ['1000', '2500', '500', '3000', '1500', '800', '2000', '1200', '700'];
  const envios = [];
  if (billetera && (autorizados.length || propio)) {
    const quien = [...autorizados, propio].filter(Boolean);
    for (let i = 0; i < beneficiarios.length; i++) {
      const e = await rem.crear(opRd, undefined, {
        agenteId: quien[i % quien.length].id,
        remitenteId: clientes[8 + (i % 4)],
        beneficiarioNuevo: { nombre: beneficiarios[i][0], telefono: beneficiarios[i][1] },
        parentesco: parentescos[i],
        motivoEnvioId: rp.motivos[i % rp.motivos.length].id,
        cuentaId: billetera.id,
        montoEnviado: montos[i],
      });
      envios.push(e);
    }
    for (let i = 0; i < 6; i++) {
      await rem.confirmar(opHt, envios[i].id, undefined, { codigoExterno: `DEMO${String(100001 + i)}` });
    }
    await rem.rechazar(opHt, envios[6].id, undefined, 'Número de NatCash equivocado (práctica)');
    // Un agente ya entregó lo del día; los demás todavía deben.
    const cuentasAg = await rem.cuentasAgentes();
    const conDeuda = cuentasAg.find((a) => a.debe !== '0.00' && a.tipo === 'autorizado');
    if (conDeuda) {
      await rem.registrarEntrega(opRd, undefined, { agenteId: conDeuda.id, monto: conDeuda.debe, forma: 'efectivo', cajaId: caja1 });
    }
    console.log(`   ${envios.length} envíos: 6 confirmados, 1 rechazado, 2 pendientes; 1 entrega de agente`);
  }

  await pool.query(
    `INSERT INTO auditoria (usuario_id, accion, entidad, valor_nuevo, motivo)
     VALUES ($1, 'demo.reiniciar', 'sistema', $2, 'Base demo reiniciada para entrenamiento')`,
    [adminId, JSON.stringify({ catalogos_desde: origen })],
  );
  await pool.end();

  // ---------- 5. Usuarios y contraseña ----------
  // El escritorio puede estar dentro de OneDrive.
  const escritorio = [path.join(os.homedir(), 'OneDrive', 'Desktop'), path.join(os.homedir(), 'Desktop')].find(
    (d) => fs.existsSync(d),
  );
  const archivo =
    process.env.DEMO_ARCHIVO_USUARIOS ||
    path.join(escritorio ?? BACKEND, 'ANSCITO DEMO - usuarios.txt');
  const texto = [
    'ANSCITO DEMO - usuarios de entrenamiento',
    `Reiniciado: ${new Date().toLocaleString('es-DO')}`,
    '',
    'Los datos del DEMO son inventados. Esta contraseña solo sirve en el DEMO',
    'y cambia cada vez que se reinicia.',
    '',
    `Contraseña (todos): ${clave}`,
    '',
    'demo.admin         Administrador (ve todo)',
    'demo.cajero        Cajero + Ventas',
    'demo.envios.rd     Operador de envíos (RD)',
    'demo.envios.haiti  Operador de envíos (Haití)',
    '',
  ].join(os.EOL);
  fs.writeFileSync(archivo, texto, 'utf8');
  paso(`Listo. Usuarios y contraseña en: ${archivo}`);
}

main().catch((e) => {
  console.error(`\nNO SE PUDO REINICIAR EL DEMO: ${e.message}`);
  process.exitCode = 1;
});
