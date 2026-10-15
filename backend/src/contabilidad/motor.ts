import { numeroAbono } from '../cxc/estado';
import type { DatabaseService } from '../database/database.service';
import { centavos, texto2 } from '../sanes/calendario';
import { anularAsientoEn, registrarAsiento } from './asientos';
import type { LineaAsiento } from './asientos';

// Asientos automáticos. Cada operación ya guardada (venta, abono, compra,
// pago, movimiento de caja…) se convierte en su asiento con las reglas de
// contabilidad_reglas y las cuentas de cada categoría, tipo 606 y banco.
// Las patas de dinero salen de los movimientos de caja y de cuentas que la
// operación ya registró. Si algo falla (falta una cuenta, mes cerrado…), la
// operación se guarda igual y queda en contabilidad_pendientes.
// Nada se contabiliza sin fecha de inicio ni con fecha anterior a ella.

type Consulta = Pick<DatabaseService, 'query'>;

export type Origen =
  | 'venta'
  | 'cxc_abono'
  | 'compra'
  | 'compra_pago'
  | 'cxp_pago'
  | 'caja_mov'
  | 'caja_mov_usd'
  | 'caja_cierre';

// Tabla de cada origen (lo que queda en asientos.origen_tabla).
export const TABLA_ORIGEN: Record<Origen, string> = {
  venta: 'ventas',
  cxc_abono: 'cxc_abonos',
  compra: 'compras',
  compra_pago: 'compra_pagos',
  cxp_pago: 'cxp_pagos',
  caja_mov: 'caja_movimientos',
  caja_mov_usd: 'caja_movimientos_usd',
  caja_cierre: 'caja_sesiones',
};

type Borrador = {
  fecha: string;
  concepto: string;
  documento: string | null;
  lineas: LineaAsiento[];
};

class ErrorContable extends Error {}

// ---------- Cuentas ----------

class Cuentas {
  private reglas = new Map<string, string>();
  constructor(private c: Consulta) {}

  async regla(clave: string): Promise<string> {
    const ya = this.reglas.get(clave);
    if (ya) return ya;
    const r = await this.c.query<{ cuenta_id: string }>(
      'SELECT cuenta_id FROM contabilidad_reglas WHERE clave = $1',
      [clave],
    );
    if (r.rowCount === 0)
      throw new ErrorContable(`Falta la regla contable "${clave}"`);
    this.reglas.set(clave, r.rows[0].cuenta_id);
    return r.rows[0].cuenta_id;
  }

  // Cuenta contable de una cuenta de banco o billetera.
  async banco(cuentaId: string): Promise<string> {
    const r = await this.c.query<{
      cuenta_contable_id: string | null;
      tipo: string;
      moneda: string;
      nombre: string;
    }>(
      'SELECT cuenta_contable_id, tipo, moneda, nombre FROM cuentas WHERE id = $1',
      [cuentaId],
    );
    const x = r.rows[0];
    if (!x) throw new ErrorContable('Cuenta de banco no encontrada');
    if (x.cuenta_contable_id) return x.cuenta_contable_id;
    return this.regla(
      x.tipo === 'billetera'
        ? 'billetera'
        : x.moneda === 'USD'
          ? 'banco_usd'
          : 'banco_rd',
    );
  }
}

// ---------- Armar líneas ----------

class Partida {
  lineas: LineaAsiento[] = [];
  debe(cuentaId: string, monto: bigint, extra: Partial<LineaAsiento> = {}) {
    if (monto > 0n)
      this.lineas.push({
        cuentaId,
        debito: texto2(monto),
        credito: '0.00',
        ...extra,
      });
    else if (monto < 0n) this.haber(cuentaId, -monto, extra);
  }
  haber(cuentaId: string, monto: bigint, extra: Partial<LineaAsiento> = {}) {
    if (monto > 0n)
      this.lineas.push({
        cuentaId,
        debito: '0.00',
        credito: texto2(monto),
        ...extra,
      });
    else if (monto < 0n) this.debe(cuentaId, -monto, extra);
  }
  diferencia(): bigint {
    return this.lineas.reduce(
      (a, l) => a + centavos(l.debito) - centavos(l.credito),
      0n,
    );
  }
  // Junta las líneas iguales (misma cuenta, lado, tercero y línea de negocio).
  juntas(): LineaAsiento[] {
    const m = new Map<string, LineaAsiento & { d: bigint; c: bigint }>();
    for (const l of this.lineas) {
      const lado = centavos(l.debito) > 0n ? 'D' : 'C';
      const k = [
        l.cuentaId,
        lado,
        l.terceroId ?? '',
        l.unidadNegocioId ?? '',
        l.descripcion ?? '',
      ].join('|');
      const x = m.get(k) ?? { ...l, d: 0n, c: 0n };
      x.d += centavos(l.debito);
      x.c += centavos(l.credito);
      m.set(k, x);
    }
    return [...m.values()].map(({ d, c, ...l }) => ({
      ...l,
      debito: texto2(d),
      credito: texto2(c),
    }));
  }
}

// La diferencia de redondeo de los cobros en US$ (subida al centavo de
// dólar) va a otros ingresos o a otros gastos; si es más que un peso, no
// cuadra y queda pendiente.
async function cerrarRedondeo(p: Partida, cu: Cuentas, permitido: bigint) {
  const dif = p.diferencia();
  if (dif === 0n) return;
  const abs = dif < 0n ? -dif : dif;
  if (abs > permitido)
    throw new ErrorContable(
      `La operación no cuadra contablemente (diferencia RD$${texto2(dif)})`,
    );
  if (dif > 0n)
    p.haber(await cu.regla('otros_ingresos'), dif, {
      descripcion: 'Redondeo a favor',
    });
  else
    p.debe(await cu.regla('otros_gastos'), -dif, {
      descripcion: 'Redondeo en contra',
    });
}

async function zona(c: Consulta): Promise<string> {
  const r = await c.query<{ valor: string }>(
    `SELECT valor FROM configuracion WHERE clave = 'empresa.zona_horaria'`,
  );
  return r.rows[0]?.valor ?? 'America/Santo_Domingo';
}

// Patas de dinero de una operación: efectivo en RD$ y US$ de la caja y
// movimientos de bancos enlazados por una columna (venta_id, compra_pago_id…).
async function patasDinero(
  c: Consulta,
  cu: Cuentas,
  p: Partida,
  columna: 'venta_id' | 'cxc_abono_id' | 'compra_pago_id',
  ids: string[],
  tiposCaja: { entra: string[]; sale: string[] },
  tiposCuenta: string[],
) {
  if (!ids.length) return;
  const caja = await c.query<{ tipo: string; monto: string }>(
    `SELECT tipo, monto FROM caja_movimientos WHERE ${columna} = ANY($1::uuid[]) AND tipo = ANY($2::text[])`,
    [ids, [...tiposCaja.entra, ...tiposCaja.sale]],
  );
  for (const m of caja.rows) {
    if (tiposCaja.entra.includes(m.tipo))
      p.debe(await cu.regla('caja_rd'), centavos(m.monto));
    else p.haber(await cu.regla('caja_rd'), centavos(m.monto));
  }
  if (columna === 'venta_id') {
    const usd = await c.query<{ tipo: string; monto_dop: string }>(
      `SELECT tipo, monto_dop FROM caja_movimientos_usd WHERE venta_id = ANY($1::uuid[]) AND tipo = 'venta'`,
      [ids],
    );
    for (const m of usd.rows)
      p.debe(await cu.regla('caja_usd'), centavos(m.monto_dop));
  }
  const cta = await c.query<{
    cuenta_id: string;
    signo: number;
    monto_dop: string;
  }>(
    `SELECT cuenta_id, signo, monto_dop FROM cuenta_movimientos
     WHERE ${columna} = ANY($1::uuid[]) AND tipo = ANY($2::text[])`,
    [ids, tiposCuenta],
  );
  for (const m of cta.rows) {
    const id = await cu.banco(m.cuenta_id);
    if (Number(m.signo) > 0) p.debe(id, centavos(m.monto_dop));
    else p.haber(id, centavos(m.monto_dop));
  }
}

// ---------- Cada operación ----------

async function venta(
  c: Consulta,
  cu: Cuentas,
  id: string,
): Promise<Borrador | null> {
  const v = await c.query<{
    numero: string;
    fecha: string;
    cliente_id: string;
    cliente: string;
    itbis: string;
  }>(
    `SELECT v.numero, to_char((v.fecha AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS fecha, v.cliente_id,
            t.nombre AS cliente, v.itbis
     FROM ventas v JOIN terceros t ON t.id = v.cliente_id WHERE v.id = $1`,
    [id, await zona(c)],
  );
  if (v.rowCount === 0) throw new ErrorContable('Venta no encontrada');
  const x = v.rows[0];
  const documento = `V-${String(x.numero).padStart(6, '0')}`;
  const p = new Partida();
  const lineas = await c.query<{
    tipo: string;
    base: string;
    costo: string;
    comision_pct: string | null;
    por_cuenta_tercero: boolean;
    unidad: string | null;
  }>(
    `SELECT l.tipo, l.base,
            CASE WHEN l.tipo = 'producto' THEN round(l.cantidad * COALESCE(l.costo_unitario, 0), 2) ELSE 0 END::numeric(16,2) AS costo,
            l.comision_pct, l.por_cuenta_tercero,
            COALESCE(cat.unidad_negocio_id, s.unidad_negocio_id) AS unidad
     FROM venta_lineas l
     LEFT JOIN productos pr ON pr.id = l.producto_id
     LEFT JOIN categorias cat ON cat.id = pr.categoria_id
     LEFT JOIN servicios s ON s.id = l.servicio_id
     WHERE l.venta_id = $1 ORDER BY l.id`,
    [id],
  );
  for (const l of lineas.rows) {
    const base = centavos(l.base);
    const un = { unidadNegocioId: l.unidad };
    if (l.tipo === 'producto') {
      p.haber(await cu.regla('ventas_mercancias'), base, un);
      const costo = centavos(l.costo);
      p.debe(await cu.regla('costo_mercancias'), costo, un);
      p.haber(await cu.regla('inventario'), costo, un);
    } else if (l.por_cuenta_tercero && l.comision_pct) {
      // Solo la comisión es ingreso; el resto se le debe al tercero.
      const pct = centavos(l.comision_pct); // en centésimas de punto
      const comision = (base * pct + 5000n) / 10000n;
      p.haber(await cu.regla('comision_terceros'), comision, un);
      p.haber(await cu.regla('terceros_servicios'), base - comision, un);
    } else p.haber(await cu.regla('ventas_servicios'), base, un);
  }
  p.haber(await cu.regla('itbis_ventas'), centavos(x.itbis));
  // Lo cobrado (caja, dólares, banco) y lo que quedó a crédito.
  await patasDinero(
    c,
    cu,
    p,
    'venta_id',
    [id],
    { entra: ['venta'], sale: ['cambio'] },
    ['venta'],
  );
  const cred = await c.query<{ monto: string }>(
    'SELECT monto FROM cuentas_cobrar WHERE venta_id = $1',
    [id],
  );
  if (cred.rowCount)
    p.debe(await cu.regla('clientes'), centavos(cred.rows[0].monto), {
      terceroId: x.cliente_id,
    });
  await cerrarRedondeo(p, cu, 100n);
  return {
    fecha: x.fecha,
    concepto: `Venta ${documento} · ${x.cliente}`,
    documento,
    lineas: p.juntas(),
  };
}

async function abono(
  c: Consulta,
  cu: Cuentas,
  id: string,
): Promise<Borrador | null> {
  const a = await c.query<{
    numero: string;
    fecha: string;
    cliente_id: string;
    cliente: string;
  }>(
    `SELECT b.numero, to_char(b.fecha, 'YYYY-MM-DD') AS fecha, b.cliente_id, t.nombre AS cliente
     FROM cxc_abonos b JOIN terceros t ON t.id = b.cliente_id WHERE b.id = $1`,
    [id],
  );
  if (a.rowCount === 0) throw new ErrorContable('Abono no encontrado');
  const x = a.rows[0];
  const documento = numeroAbono(x.numero);
  const ap = await c.query<{ capital: string; recargo: string }>(
    `SELECT COALESCE(sum(capital), 0)::numeric(16,2) AS capital, COALESCE(sum(recargo), 0)::numeric(16,2) AS recargo
     FROM cxc_aplicaciones WHERE abono_id = $1`,
    [id],
  );
  const p = new Partida();
  p.haber(await cu.regla('clientes'), centavos(ap.rows[0].capital), {
    terceroId: x.cliente_id,
  });
  p.haber(await cu.regla('recargos'), centavos(ap.rows[0].recargo), {
    terceroId: x.cliente_id,
  });
  await patasDinero(
    c,
    cu,
    p,
    'cxc_abono_id',
    [id],
    { entra: ['abono_credito'], sale: [] },
    ['abono_credito'],
  );
  await cerrarRedondeo(p, cu, 0n);
  return {
    fecha: x.fecha,
    concepto: `Abono ${documento} · ${x.cliente}`,
    documento,
    lineas: p.juntas(),
  };
}

async function compra(
  c: Consulta,
  cu: Cuentas,
  id: string,
): Promise<Borrador | null> {
  const r = await c.query<{
    numero: string;
    fecha: string;
    ncf: string | null;
    proveedor_id: string;
    proveedor: string;
    monto_bienes: string;
    monto_servicios: string;
    itbis: string;
    itbis_retenido: string;
    isr_retenido: string;
    a_pagar: string;
    cuenta_gasto: string | null;
    tipo_gasto: string;
    lineas: string;
  }>(
    `SELECT c.numero, to_char(c.fecha_comprobante, 'YYYY-MM-DD') AS fecha, c.ncf, c.proveedor_id,
            t.nombre AS proveedor, c.monto_bienes, c.monto_servicios, c.itbis, c.itbis_retenido,
            c.isr_retenido, c.a_pagar, tg.cuenta_contable_id AS cuenta_gasto, c.tipo_gasto,
            COALESCE((SELECT sum(subtotal) FROM compra_lineas WHERE compra_id = c.id), 0)::numeric(16,2) AS lineas
     FROM compras c JOIN terceros t ON t.id = c.proveedor_id
     JOIN tipos_gasto tg ON tg.codigo = c.tipo_gasto
     WHERE c.id = $1`,
    [id],
  );
  if (r.rowCount === 0) throw new ErrorContable('Compra no encontrada');
  const x = r.rows[0];
  const documento = `CP-${String(x.numero).padStart(6, '0')}`;
  const prov = { terceroId: x.proveedor_id };
  const p = new Partida();
  // Los productos van al inventario; el resto, a la cuenta del tipo 606.
  const inventario = centavos(x.lineas);
  const resto =
    centavos(x.monto_bienes) + centavos(x.monto_servicios) - inventario;
  p.debe(await cu.regla('inventario'), inventario);
  if (resto !== 0n) {
    if (!x.cuenta_gasto)
      throw new ErrorContable(
        `El tipo de gasto ${x.tipo_gasto} no tiene cuenta contable`,
      );
    p.debe(x.cuenta_gasto, resto);
  }
  p.debe(await cu.regla('itbis_compras'), centavos(x.itbis));
  p.haber(await cu.regla('itbis_retenido'), centavos(x.itbis_retenido), prov);
  p.haber(await cu.regla('isr_retenido'), centavos(x.isr_retenido), prov);
  p.haber(await cu.regla('proveedores'), centavos(x.a_pagar), prov);
  await cerrarRedondeo(p, cu, 0n);
  return {
    fecha: x.fecha,
    concepto: `Compra ${documento}${x.ncf ? ` ${x.ncf}` : ''} · ${x.proveedor}`,
    documento,
    lineas: p.juntas(),
  };
}

async function pagoCompra(
  c: Consulta,
  cu: Cuentas,
  id: string,
): Promise<Borrador | null> {
  const r = await c.query<{
    fecha: string;
    monto: string;
    proveedor_id: string;
    proveedor: string;
    numero: string;
  }>(
    `SELECT to_char(cp.fecha, 'YYYY-MM-DD') AS fecha, cp.monto, c.proveedor_id, t.nombre AS proveedor, c.numero
     FROM compra_pagos cp JOIN compras c ON c.id = cp.compra_id JOIN terceros t ON t.id = c.proveedor_id
     WHERE cp.id = $1`,
    [id],
  );
  if (r.rowCount === 0) throw new ErrorContable('Pago de compra no encontrado');
  const x = r.rows[0];
  const documento = `CP-${String(x.numero).padStart(6, '0')}`;
  const p = new Partida();
  p.debe(await cu.regla('proveedores'), centavos(x.monto), {
    terceroId: x.proveedor_id,
  });
  await patasDinero(
    c,
    cu,
    p,
    'compra_pago_id',
    [id],
    { entra: [], sale: ['compra'] },
    ['compra'],
  );
  await cerrarRedondeo(p, cu, 0n);
  return {
    fecha: x.fecha,
    concepto: `Pago de contado ${documento} · ${x.proveedor}`,
    documento,
    lineas: p.juntas(),
  };
}

async function pagoCxp(
  c: Consulta,
  cu: Cuentas,
  id: string,
): Promise<Borrador | null> {
  const r = await c.query<{
    numero: string;
    fecha: string;
    total: string;
    proveedor_id: string;
    proveedor: string;
  }>(
    `SELECT p.numero, to_char(p.fecha, 'YYYY-MM-DD') AS fecha, p.total, p.proveedor_id, t.nombre AS proveedor
     FROM cxp_pagos p JOIN terceros t ON t.id = p.proveedor_id WHERE p.id = $1`,
    [id],
  );
  if (r.rowCount === 0)
    throw new ErrorContable('Pago a proveedor no encontrado');
  const x = r.rows[0];
  const documento = `PP-${String(x.numero).padStart(6, '0')}`;
  const partes = await c.query<{ id: string }>(
    'SELECT id FROM compra_pagos WHERE pago_id = $1',
    [id],
  );
  const p = new Partida();
  p.debe(await cu.regla('proveedores'), centavos(x.total), {
    terceroId: x.proveedor_id,
  });
  await patasDinero(
    c,
    cu,
    p,
    'compra_pago_id',
    partes.rows.map((y) => y.id),
    { entra: [], sale: ['compra'] },
    ['compra'],
  );
  await cerrarRedondeo(p, cu, 0n);
  return {
    fecha: x.fecha,
    concepto: `Pago ${documento} · ${x.proveedor}`,
    documento,
    lineas: p.juntas(),
  };
}

const CLASES: Record<string, string> = {
  aporte: 'capital',
  prestamo: 'prestamos_recibidos',
  retiro_dueno: 'retiros_dueno',
};

// Gasto, retiro o ingreso de la caja (en RD$ o en US$).
async function movCaja(
  c: Consulta,
  cu: Cuentas,
  id: string,
  usd: boolean,
): Promise<Borrador | null> {
  const r = await c.query<{
    tipo: string;
    monto: string;
    clase: string | null;
    motivo: string | null;
    fecha: string;
    cuenta_gasto: string | null;
    categoria: string | null;
  }>(
    usd
      ? `SELECT m.tipo, m.monto_dop AS monto, m.clase, m.motivo,
                to_char((m.created_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS fecha,
                NULL::uuid AS cuenta_gasto, NULL AS categoria
         FROM caja_movimientos_usd m WHERE m.id = $1`
      : `SELECT m.tipo, m.monto, m.clase, m.motivo,
                to_char((m.created_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS fecha,
                g.cuenta_contable_id AS cuenta_gasto, g.nombre AS categoria
         FROM caja_movimientos m LEFT JOIN categorias_gasto g ON g.id = m.categoria_gasto_id
         WHERE m.id = $1`,
    [id, await zona(c)],
  );
  if (r.rowCount === 0)
    throw new ErrorContable('Movimiento de caja no encontrado');
  const x = r.rows[0];
  const caja = await cu.regla(usd ? 'caja_usd' : 'caja_rd');
  const monto = centavos(x.monto);
  const p = new Partida();
  const descripcion = x.motivo?.slice(0, 300) ?? null;
  if (x.tipo === 'gasto') {
    if (!x.cuenta_gasto)
      throw new ErrorContable(
        `La categoría de gasto "${x.categoria}" no tiene cuenta contable`,
      );
    p.debe(x.cuenta_gasto, monto, { descripcion });
    p.haber(caja, monto);
  } else if (x.tipo === 'ingreso' || x.tipo === 'retiro') {
    const clave = x.clase ? CLASES[x.clase] : undefined;
    if (!clave)
      throw new ErrorContable(
        `${x.tipo === 'ingreso' ? 'Ingreso' : 'Retiro'} de caja sin clasificar ("otro"): el contador debe escoger la cuenta`,
      );
    if (x.tipo === 'ingreso') {
      p.debe(caja, monto);
      p.haber(await cu.regla(clave), monto, { descripcion });
    } else {
      p.debe(await cu.regla(clave), monto, { descripcion });
      p.haber(caja, monto);
    }
  } else return null; // ventas, cuotas, depósitos… se contabilizan con su operación
  const que =
    x.tipo === 'gasto'
      ? `Gasto de caja (${x.categoria})`
      : x.tipo === 'ingreso'
        ? 'Ingreso a caja'
        : 'Retiro de caja';
  return {
    fecha: x.fecha,
    concepto: `${que}${usd ? ' en US$' : ''}${x.motivo ? `: ${x.motivo}` : ''}`,
    documento: `${usd ? 'CJU' : 'CJ'}-${id}`,
    lineas: p.juntas(),
  };
}

// Sobrante o faltante al cerrar la caja (pesos y dólares).
async function cierreCaja(
  c: Consulta,
  cu: Cuentas,
  id: string,
): Promise<Borrador | null> {
  const r = await c.query<{
    numero: string;
    fecha: string;
    diferencia: string | null;
    diferencia_usd: string | null;
    motivo: string | null;
  }>(
    `SELECT numero, to_char((cerrada_en AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS fecha,
            diferencia, diferencia_usd, motivo_diferencia AS motivo
     FROM caja_sesiones WHERE id = $1 AND estado = 'cerrada'`,
    [id, await zona(c)],
  );
  if (r.rowCount === 0) throw new ErrorContable('Cierre de caja no encontrado');
  const x = r.rows[0];
  const p = new Partida();
  const dif =
    centavos((x.diferencia ?? '0').replace('-', '')) *
    ((x.diferencia ?? '').startsWith('-') ? -1n : 1n);
  if (dif !== 0n) {
    p.debe(await cu.regla('caja_rd'), dif);
    if (dif > 0n)
      p.haber(await cu.regla('otros_ingresos'), dif, {
        descripcion: 'Sobrante de caja',
      });
    else
      p.debe(await cu.regla('otros_gastos'), -dif, {
        descripcion: 'Faltante de caja',
      });
  }
  const difUsd = x.diferencia_usd ?? '0.00';
  if (difUsd !== '0.00') {
    // Los dólares que sobran o faltan, por su valor en RD$ con la tasa del día.
    const t = await c.query<{ valor: string | null }>(
      `SELECT round(abs($1::numeric) * (SELECT tasa FROM tasas_dolar WHERE vigente_desde <= clock_timestamp()
                                         ORDER BY vigente_desde DESC LIMIT 1), 2)::text AS valor`,
      [difUsd],
    );
    if (!t.rows[0].valor)
      throw new ErrorContable(
        'No hay tasa del dólar para valorar la diferencia en US$',
      );
    const v = centavos(t.rows[0].valor) * (difUsd.startsWith('-') ? -1n : 1n);
    p.debe(await cu.regla('caja_usd'), v);
    if (v > 0n)
      p.haber(await cu.regla('otros_ingresos'), v, {
        descripcion: 'Sobrante de caja en US$',
      });
    else
      p.debe(await cu.regla('otros_gastos'), -v, {
        descripcion: 'Faltante de caja en US$',
      });
  }
  if (p.lineas.length === 0) return null; // cuadró: nada que contabilizar
  const documento = `S-${String(x.numero).padStart(6, '0')}`;
  return {
    fecha: x.fecha,
    concepto: `Diferencia al cerrar la caja ${documento}${x.motivo ? `: ${x.motivo}` : ''}`,
    documento,
    lineas: p.juntas(),
  };
}

async function armar(
  c: Consulta,
  origen: Origen,
  id: string,
): Promise<Borrador | null> {
  const cu = new Cuentas(c);
  switch (origen) {
    case 'venta':
      return venta(c, cu, id);
    case 'cxc_abono':
      return abono(c, cu, id);
    case 'compra':
      return compra(c, cu, id);
    case 'compra_pago':
      return pagoCompra(c, cu, id);
    case 'cxp_pago':
      return pagoCxp(c, cu, id);
    case 'caja_mov':
      return movCaja(c, cu, id, false);
    case 'caja_mov_usd':
      return movCaja(c, cu, id, true);
    case 'caja_cierre':
      return cierreCaja(c, cu, id);
  }
}

// ---------- Contabilizar y revertir ----------

async function fechaInicio(c: Consulta): Promise<string | null> {
  const r = await c.query<{ valor: string }>(
    `SELECT valor FROM configuracion WHERE clave = 'contabilidad.fecha_inicio'`,
  );
  return r.rows[0]?.valor || null;
}

async function hoy(c: Consulta): Promise<string> {
  const r = await c.query<{ hoy: string }>(
    `SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS hoy`,
    [await zona(c)],
  );
  return r.rows[0].hoy;
}

const CUADRE = 'asientos_cuadran, asiento_lineas_cuadran';

// Crea el asiento de la operación. Devuelve 'hecho', 'omitido' (sin fecha de
// inicio, antes de ella, ya contabilizada o nada que registrar) o 'pendiente'.
// Nunca hace fallar la operación: el error queda en contabilidad_pendientes.
export async function contabilizar(
  c: Consulta,
  origen: Origen,
  id: string,
  usuarioId: string,
): Promise<'hecho' | 'omitido' | 'pendiente'> {
  const inicio = await fechaInicio(c);
  if (!inicio) return 'omitido';
  const tabla = TABLA_ORIGEN[origen];
  const ya = await c.query(
    `SELECT 1 FROM asientos WHERE origen_tabla = $1 AND origen_id = $2
       AND reverso_de IS NULL AND estado = 'activo'`,
    [tabla, id],
  );
  if ((ya.rowCount ?? 0) > 0) return 'omitido';
  await c.query('SAVEPOINT conta_auto');
  let fecha: string | null = null;
  let documento: string | null = null;
  try {
    const b = await armar(c, origen, id);
    if (b) {
      fecha = b.fecha;
      documento = b.documento;
    }
    if (!b || b.fecha < inicio) {
      await c.query('RELEASE SAVEPOINT conta_auto');
      await resolverPendiente(c, tabla, id, usuarioId);
      return 'omitido';
    }
    await registrarAsiento(c, {
      fecha: b.fecha,
      concepto: b.concepto,
      origen,
      documento: b.documento,
      origenTabla: tabla,
      origenId: id,
      lineas: b.lineas,
      usuarioId,
    });
    await c.query(`SET CONSTRAINTS ${CUADRE} IMMEDIATE`);
    await c.query(`SET CONSTRAINTS ${CUADRE} DEFERRED`);
    await c.query('RELEASE SAVEPOINT conta_auto');
    await resolverPendiente(c, tabla, id, usuarioId);
    return 'hecho';
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT conta_auto');
    await c.query('RELEASE SAVEPOINT conta_auto');
    await c.query(`SET CONSTRAINTS ${CUADRE} DEFERRED`);
    const mensaje = (e as Error)?.message ?? 'Error desconocido';
    await c.query(
      `INSERT INTO contabilidad_pendientes (origen_tabla, origen_id, documento, fecha, error)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (origen_tabla, origen_id) WHERE estado = 'pendiente'
       DO UPDATE SET error = EXCLUDED.error, documento = COALESCE(EXCLUDED.documento, contabilidad_pendientes.documento)`,
      [tabla, id, documento, fecha ?? (await hoy(c)), mensaje.slice(0, 500)],
    );
    return 'pendiente';
  }
}

async function resolverPendiente(
  c: Consulta,
  tabla: string,
  id: string,
  usuarioId: string,
) {
  await c.query(
    `UPDATE contabilidad_pendientes SET estado = 'resuelto', resuelto_en = now(), resuelto_por = $3
     WHERE origen_tabla = $1 AND origen_id = $2 AND estado = 'pendiente'`,
    [tabla, id, usuarioId],
  );
}

// Al anular una operación: se anula su asiento (con su reverso). Si no tenía
// asiento porque estaba pendiente, el pendiente se descarta.
export async function revertir(
  c: Consulta,
  origen: Origen,
  id: string,
  motivo: string,
  usuarioId: string,
): Promise<'hecho' | 'omitido' | 'pendiente'> {
  const tabla = TABLA_ORIGEN[origen];
  await c.query(
    `UPDATE contabilidad_pendientes SET estado = 'descartado', resuelto_en = now(), resuelto_por = $3,
            nota = 'La operación se anuló antes de contabilizarse'
     WHERE origen_tabla = $1 AND origen_id = $2 AND estado = 'pendiente'`,
    [tabla, id, usuarioId],
  );
  const a = await c.query<{ id: string }>(
    `SELECT id FROM asientos WHERE origen_tabla = $1 AND origen_id = $2
       AND reverso_de IS NULL AND estado = 'activo'`,
    [tabla, id],
  );
  if (a.rowCount === 0) return 'omitido';
  await c.query('SAVEPOINT conta_rev');
  try {
    await anularAsientoEn(c, {
      id: a.rows[0].id,
      motivo: `Anulación: ${motivo}`,
      usuarioId,
      hoy: await hoy(c),
    });
    await c.query(`SET CONSTRAINTS ${CUADRE} IMMEDIATE`);
    await c.query(`SET CONSTRAINTS ${CUADRE} DEFERRED`);
    await c.query('RELEASE SAVEPOINT conta_rev');
    return 'hecho';
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT conta_rev');
    await c.query('RELEASE SAVEPOINT conta_rev');
    await c.query(`SET CONSTRAINTS ${CUADRE} DEFERRED`);
    await c.query(
      `INSERT INTO contabilidad_pendientes (origen_tabla, origen_id, fecha, error)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (origen_tabla, origen_id) WHERE estado = 'pendiente' DO UPDATE SET error = EXCLUDED.error`,
      [
        tabla,
        id,
        await hoy(c),
        `No se pudo anular su asiento: ${(e as Error)?.message ?? ''}`.slice(
          0,
          500,
        ),
      ],
    );
    return 'pendiente';
  }
}

export { ErrorContable };
