import { numeroTransferencia } from '../bancos/sql';
import { numeroAbono } from '../cxc/estado';
import type { DatabaseService } from '../database/database.service';
import { numeroEnvio } from '../remesas/calculo';
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
  | 'caja_cierre'
  | 'cuenta_mov'
  | 'transferencia'
  | 'san_recibo'
  | 'san_entrega'
  | 'remesa'
  | 'remesa_entrega'
  | 'remesa_pago'
  | 'nomina'
  | 'adelanto'
  | 'llegada'
  | 'no_llego';

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
  cuenta_mov: 'cuenta_movimientos',
  transferencia: 'transferencias',
  san_recibo: 'san_recibos',
  san_entrega: 'san_entregas',
  remesa: 'remesas',
  remesa_entrega: 'remesa_entregas',
  remesa_pago: 'remesa_pagos_comision',
  nomina: 'nominas',
  adelanto: 'empleado_adelantos',
  llegada: 'transferencia_llegadas',
  no_llego: 'cuenta_confirmaciones',
};

// De la tabla al origen (para reintentar un pendiente).
export function origenDeTabla(tabla: string): Origen | null {
  const x = Object.entries(TABLA_ORIGEN).find(([, t]) => t === tabla);
  return x ? (x[0] as Origen) : null;
}

type Borrador = {
  fecha: string;
  concepto: string;
  documento: string | null;
  lineas: LineaAsiento[];
};

class ErrorContable extends Error {}

// Fin del mensaje de las operaciones que esperan que el contador escoja la
// cuenta (ingresos y retiros "otro"): solo esas se clasifican en Pendientes.
export const PIDE_CUENTA = 'el contador debe escoger la cuenta';

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

  // Cuenta que escogió el contador desde Pendientes (la última). Si no hay,
  // la operación queda pendiente con el mensaje.
  async clasificada(
    tabla: string,
    id: string,
    mensaje: string,
  ): Promise<string> {
    const r = await this.c.query<{ cuenta_id: string }>(
      `SELECT cuenta_id FROM contabilidad_clasificaciones
       WHERE origen_tabla = $1 AND origen_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [tabla, id],
    );
    if (r.rowCount === 0) throw new ErrorContable(mensaje);
    return r.rows[0].cuenta_id;
  }

  // Línea de negocio configurada (configuracion "lineas.…"); vacía = generales.
  async unidad(clave: 'sol_cash' | 'envios'): Promise<string | null> {
    const r = await this.c.query<{ id: string }>(
      `SELECT u.id FROM configuracion k JOIN unidades_negocio u ON u.id::text = k.valor
       WHERE k.clave = $1`,
      [`lineas.unidad_${clave}`],
    );
    return r.rows[0]?.id ?? null;
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
  columna:
    | 'venta_id'
    | 'cxc_abono_id'
    | 'compra_pago_id'
    | 'transferencia_id'
    | 'san_recibo_id'
    | 'san_entrega_id'
    | 'remesa_id'
    | 'remesa_entrega_id'
    | 'remesa_pago_id'
    | 'nomina_id'
    | 'adelanto_id',
  ids: string[],
  tiposCaja: { entra: string[]; sale: string[] },
  tiposCuenta: string[],
) {
  if (!ids.length) return;
  // La caja no tiene remesa_id (el envío sale de la billetera).
  const caja =
    columna === 'remesa_id'
      ? { rows: [] as { tipo: string; monto: string }[] }
      : await c.query<{ tipo: string; monto: string }>(
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
    unidad: string | null;
  }>(
    `SELECT c.numero, to_char(c.fecha_comprobante, 'YYYY-MM-DD') AS fecha, c.ncf, c.proveedor_id,
            t.nombre AS proveedor, c.monto_bienes, c.monto_servicios, c.itbis, c.itbis_retenido,
            c.isr_retenido, c.a_pagar, tg.cuenta_contable_id AS cuenta_gasto, c.tipo_gasto,
            c.unidad_negocio_id AS unidad,
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
    p.debe(x.cuenta_gasto, resto, { unidadNegocioId: x.unidad });
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
    unidad: string | null;
  }>(
    usd
      ? `SELECT m.tipo, m.monto_dop AS monto, m.clase, m.motivo,
                to_char((m.created_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS fecha,
                NULL::uuid AS cuenta_gasto, NULL AS categoria, NULL::uuid AS unidad
         FROM caja_movimientos_usd m WHERE m.id = $1`
      : `SELECT m.tipo, m.monto, m.clase, m.motivo,
                to_char((m.created_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS fecha,
                g.cuenta_contable_id AS cuenta_gasto, g.nombre AS categoria, m.unidad_negocio_id AS unidad
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
    p.debe(x.cuenta_gasto, monto, {
      descripcion,
      unidadNegocioId: x.unidad,
    });
    p.haber(caja, monto);
  } else if (x.tipo === 'ingreso' || x.tipo === 'retiro') {
    const clave = x.clase ? CLASES[x.clase] : undefined;
    const contra = clave
      ? await cu.regla(clave)
      : await cu.clasificada(
          TABLA_ORIGEN[usd ? 'caja_mov_usd' : 'caja_mov'],
          id,
          `${x.tipo === 'ingreso' ? 'Ingreso' : 'Retiro'} de caja sin clasificar ("otro"): ${PIDE_CUENTA}`,
        );
    if (x.tipo === 'ingreso') {
      p.debe(caja, monto);
      p.haber(contra, monto, { descripcion });
    } else {
      p.debe(contra, monto, { descripcion });
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

// ---------- Bancos ----------

// Pago, cargo, interés o ingreso registrado a mano en una cuenta de banco o
// billetera. Lo que viene de otro módulo (ventas, transferencias, SOL CASH,
// envíos, compras, abonos) se contabiliza con su operación. El saldo inicial
// no: ya está en el asiento de apertura. Un reverso anula el asiento del
// original; solo si el original es de antes de la fecha de inicio (no tenía
// asiento) se registra el reverso como asiento al revés.
async function movCuenta(
  c: Consulta,
  cu: Cuentas,
  id: string,
  clasifId = id,
): Promise<Borrador | null> {
  const r = await c.query<{
    tipo: string;
    monto: string;
    monto_dop: string;
    clase: string | null;
    motivo: string | null;
    fecha: string;
    cuenta_id: string;
    cuenta: string;
    simbolo: string;
    reverso_de: string | null;
    cuenta_gasto: string | null;
    categoria: string | null;
    unidad: string | null;
    de_otro: boolean;
  }>(
    `SELECT m.tipo, m.monto, m.monto_dop, m.clase, m.motivo, to_char(m.fecha, 'YYYY-MM-DD') AS fecha,
            m.cuenta_id, ct.nombre AS cuenta, mo.simbolo, m.reverso_de::text AS reverso_de,
            g.cuenta_contable_id AS cuenta_gasto, g.nombre AS categoria, m.unidad_negocio_id AS unidad,
            (m.venta_id IS NOT NULL OR m.transferencia_id IS NOT NULL OR m.remesa_id IS NOT NULL
              OR m.remesa_entrega_id IS NOT NULL OR m.remesa_pago_id IS NOT NULL
              OR m.san_recibo_id IS NOT NULL OR m.san_entrega_id IS NOT NULL
              OR m.compra_pago_id IS NOT NULL OR m.cxc_abono_id IS NOT NULL
              OR m.nomina_id IS NOT NULL OR m.adelanto_id IS NOT NULL) AS de_otro
     FROM cuenta_movimientos m JOIN cuentas ct ON ct.id = m.cuenta_id
     JOIN monedas mo ON mo.codigo = ct.moneda
     LEFT JOIN categorias_gasto g ON g.id = m.categoria_gasto_id
     WHERE m.id = $1`,
    [id],
  );
  if (r.rowCount === 0)
    throw new ErrorContable('Movimiento de banco no encontrado');
  const x = r.rows[0];
  if (x.de_otro) return null;
  const documento = `BN-${id}`;
  if (x.tipo === 'reverso') {
    if (!x.reverso_de) return null;
    const inicio = await fechaInicio(c);
    const o = await c.query<{ fecha: string }>(
      `SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha FROM cuenta_movimientos WHERE id = $1`,
      [x.reverso_de],
    );
    if (!inicio || !o.rows[0] || o.rows[0].fecha >= inicio) return null;
    const original = await movCuenta(c, cu, x.reverso_de, id);
    if (!original) return null;
    return {
      fecha: x.fecha,
      concepto: `Reverso de ${original.concepto}`.slice(0, 300),
      documento,
      lineas: original.lineas.map((l) => ({
        ...l,
        debito: l.credito,
        credito: l.debito,
      })),
    };
  }
  const banco = await cu.banco(x.cuenta_id);
  const monto = centavos(x.monto_dop);
  const descripcion = x.motivo?.slice(0, 300) ?? null;
  const p = new Partida();
  let que: string;
  if (x.tipo === 'pago') {
    if (!x.cuenta_gasto)
      throw new ErrorContable(
        `La categoría de gasto "${x.categoria}" no tiene cuenta contable`,
      );
    p.debe(x.cuenta_gasto, monto, {
      descripcion,
      unidadNegocioId: x.unidad,
    });
    p.haber(banco, monto);
    que = `Pago (${x.categoria})`;
  } else if (x.tipo === 'cargo') {
    p.debe(await cu.regla('cargos_bancarios'), monto, { descripcion });
    p.haber(banco, monto);
    que = 'Cargo del banco';
  } else if (x.tipo === 'interes') {
    p.debe(banco, monto);
    p.haber(await cu.regla('intereses_ganados'), monto, { descripcion });
    que = 'Intereses';
  } else if (x.tipo === 'ingreso') {
    const clave = x.clase ? CLASES[x.clase] : undefined;
    const contra = clave
      ? await cu.regla(clave)
      : await cu.clasificada(
          TABLA_ORIGEN.cuenta_mov,
          clasifId,
          `Ingreso de banco sin clasificar ("otro"): ${PIDE_CUENTA}`,
        );
    p.debe(banco, monto);
    p.haber(contra, monto, { descripcion });
    que = 'Ingreso';
  } else return null; // saldo inicial (va en la apertura) y los demás tipos
  const moneda = x.simbolo === 'RD$' ? '' : ` (${x.simbolo}${x.monto})`;
  return {
    fecha: x.fecha,
    concepto:
      `${que} en ${x.cuenta}${moneda}${x.motivo ? `: ${x.motivo}` : ''}`.slice(
        0,
        300,
      ),
    documento,
    lineas: p.juntas(),
  };
}

// Transferencia entre cuentas, o entre la caja y una cuenta: el dinero
// cambia de lugar (no es ingreso ni gasto). Las dos puntas van por el mismo
// valor en RD$ (el lado en pesos manda; si ninguno, la tasa del día).
async function transferencia(
  c: Consulta,
  cu: Cuentas,
  id: string,
): Promise<Borrador | null> {
  const r = await c.query<{
    numero: string;
    fecha: string;
    origen: string;
    destino: string;
    motivo: string | null;
  }>(
    `SELECT t.numero,
            COALESCE((SELECT to_char(min(m.fecha), 'YYYY-MM-DD') FROM cuenta_movimientos m WHERE m.transferencia_id = t.id),
                     to_char((t.created_at AT TIME ZONE $2)::date, 'YYYY-MM-DD')) AS fecha,
            COALESCE(co.nombre, cjo.nombre) AS origen, COALESCE(cd.nombre, cjd.nombre) AS destino, t.motivo
     FROM transferencias t
     LEFT JOIN cuentas co ON co.id = t.origen_cuenta_id
     LEFT JOIN cuentas cd ON cd.id = t.destino_cuenta_id
     LEFT JOIN caja_sesiones so ON so.id = t.origen_sesion_id LEFT JOIN cajas cjo ON cjo.id = so.caja_id
     LEFT JOIN caja_sesiones sd ON sd.id = t.destino_sesion_id LEFT JOIN cajas cjd ON cjd.id = sd.caja_id
     WHERE t.id = $1`,
    [id, await zona(c)],
  );
  if (r.rowCount === 0) throw new ErrorContable('Transferencia no encontrada');
  const x = r.rows[0];
  const p = new Partida();
  await patasDinero(
    c,
    cu,
    p,
    'transferencia_id',
    [id],
    { entra: ['desde_cuenta'], sale: ['deposito'] },
    ['transferencia_entrada', 'transferencia_salida'],
  );
  // Recarga de una billetera todavía sin confirmar (o que no llegó): su
  // valor en RD$ ya se conoce y entra a la billetera; las gourdes se anotan
  // al confirmarla. Si no llegó, el asiento de la llegada lo saca.
  const pendiente = await c.query<{ cuenta_id: string; monto_dop: string }>(
    `SELECT t.destino_cuenta_id AS cuenta_id, t.monto_dop FROM transferencias t
     WHERE t.id = $1 AND t.monto_entra IS NULL AND t.destino_cuenta_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM cuenta_movimientos m
                       WHERE m.transferencia_id = t.id AND m.tipo = 'transferencia_entrada')`,
    [id],
  );
  if (pendiente.rowCount)
    p.debe(
      await cu.banco(pendiente.rows[0].cuenta_id),
      centavos(pendiente.rows[0].monto_dop),
    );
  await cerrarRedondeo(p, cu, 0n);
  const documento = numeroTransferencia(x.numero);
  return {
    fecha: x.fecha,
    concepto:
      `Transferencia ${documento}: ${x.origen} → ${x.destino}${x.motivo ? ` · ${x.motivo}` : ''}`.slice(
        0,
        300,
      ),
    documento,
    lineas: p.juntas(),
  };
}

// Una recarga de billetera que no llegó: su valor ya entró a la billetera
// con la recarga; sale de ahí y el contador escoge la cuenta (una pérdida,
// algo que se debe cobrar…). Si la recarga no tiene asiento, nada que hacer.
async function llegada(
  c: Consulta,
  cu: Cuentas,
  id: string,
): Promise<Borrador | null> {
  const r = await c.query<{
    fecha: string;
    resultado: string;
    transferencia_id: string;
    numero: string;
    cuenta_id: string;
    cuenta: string;
    monto_dop: string;
    motivo: string | null;
  }>(
    `SELECT to_char((l.created_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS fecha, l.resultado,
            t.id AS transferencia_id, t.numero, t.destino_cuenta_id AS cuenta_id, ct.nombre AS cuenta,
            t.monto_dop, l.motivo
     FROM transferencia_llegadas l JOIN transferencias t ON t.id = l.transferencia_id
     JOIN cuentas ct ON ct.id = t.destino_cuenta_id
     WHERE l.id = $1`,
    [id, await zona(c)],
  );
  if (r.rowCount === 0) throw new ErrorContable('Llegada no encontrada');
  const x = r.rows[0];
  if (x.resultado !== 'no_llego') return null;
  const asentado = await c.query(
    `SELECT 1 FROM asientos WHERE origen_tabla = 'transferencias' AND origen_id = $1
       AND reverso_de IS NULL AND estado = 'activo'`,
    [x.transferencia_id],
  );
  if (!asentado.rowCount) return null;
  const documento = numeroTransferencia(x.numero);
  const contra = await cu.clasificada(
    TABLA_ORIGEN.llegada,
    id,
    `La recarga ${documento} no llegó a ${x.cuenta} (RD$${x.monto_dop}): ${PIDE_CUENTA}`,
  );
  const monto = centavos(x.monto_dop);
  const p = new Partida();
  p.debe(contra, monto, { descripcion: x.motivo?.slice(0, 300) ?? null });
  p.haber(await cu.banco(x.cuenta_id), monto);
  return {
    fecha: x.fecha,
    concepto: `Recarga ${documento} que no llegó a ${x.cuenta}`,
    documento,
    lineas: p.juntas(),
  };
}

// ---------- SOL CASH ----------
// (Los números R-000001 y M-000001 son los mismos de sanes.service.)

// Cobro de cuotas: las cuotas son dinero de los participantes (se deben);
// solo la mora es ganancia de SCITO.
async function sanRecibo(
  c: Consulta,
  cu: Cuentas,
  id: string,
): Promise<Borrador | null> {
  const r = await c.query<{
    numero: string;
    fecha: string;
    tercero_id: string;
    persona: string;
    cuotas: string;
    mora: string;
    san: string;
  }>(
    `SELECT r.numero, to_char((r.created_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS fecha,
            r.tercero_id, t.nombre AS persona, r.cuotas, r.mora, s.nombre AS san
     FROM san_recibos r JOIN terceros t ON t.id = r.tercero_id JOIN sanes s ON s.id = r.san_id
     WHERE r.id = $1`,
    [id, await zona(c)],
  );
  if (r.rowCount === 0)
    throw new ErrorContable('Recibo de SOL CASH no encontrado');
  const x = r.rows[0];
  const quien = { terceroId: x.tercero_id };
  const p = new Partida();
  p.haber(await cu.regla('sol_cash_cuotas'), centavos(x.cuotas), quien);
  p.haber(await cu.regla('moras_sol_cash'), centavos(x.mora), {
    ...quien,
    unidadNegocioId: await cu.unidad('sol_cash'),
  });
  await patasDinero(
    c,
    cu,
    p,
    'san_recibo_id',
    [id],
    { entra: ['san_cuota'], sale: [] },
    ['san_cuota'],
  );
  await cerrarRedondeo(p, cu, 0n);
  const documento = `R-${String(x.numero).padStart(6, '0')}`;
  return {
    fecha: x.fecha,
    concepto: `SOL CASH ${documento} · ${x.persona} (${x.san})`,
    documento,
    lineas: p.juntas(),
  };
}

// Entrega de la mano: sale el dinero de los participantes; la comisión es
// ganancia de SCITO y lo que debía (cuotas y moras) se paga con la mano.
async function sanEntrega(
  c: Consulta,
  cu: Cuentas,
  id: string,
): Promise<Borrador | null> {
  const r = await c.query<{
    numero: string;
    fecha: string;
    tercero_id: string;
    persona: string;
    bruto: string;
    comision: string;
    cuotas: string;
    moras: string;
    san: string;
  }>(
    `SELECT e.numero, to_char((e.created_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS fecha,
            p.tercero_id, t.nombre AS persona, e.bruto, e.comision, s.nombre AS san,
            COALESCE((SELECT sum(cuota) FROM san_pagos WHERE entrega_id = e.id), 0)::numeric(16,2) AS cuotas,
            COALESCE((SELECT sum(mora) FROM san_pagos WHERE entrega_id = e.id), 0)::numeric(16,2) AS moras
     FROM san_entregas e JOIN san_participaciones p ON p.id = e.participacion_id
     JOIN terceros t ON t.id = p.tercero_id JOIN sanes s ON s.id = e.san_id
     WHERE e.id = $1`,
    [id, await zona(c)],
  );
  if (r.rowCount === 0)
    throw new ErrorContable('Entrega de SOL CASH no encontrada');
  const x = r.rows[0];
  const quien = { terceroId: x.tercero_id };
  const p = new Partida();
  const cuotas = await cu.regla('sol_cash_cuotas');
  p.debe(cuotas, centavos(x.bruto), quien);
  const sol = { ...quien, unidadNegocioId: await cu.unidad('sol_cash') };
  p.haber(await cu.regla('comision_sol_cash'), centavos(x.comision), sol);
  p.haber(cuotas, centavos(x.cuotas), {
    ...quien,
    descripcion: 'Cuotas descontadas de la mano',
  });
  p.haber(await cu.regla('moras_sol_cash'), centavos(x.moras), sol);
  await patasDinero(
    c,
    cu,
    p,
    'san_entrega_id',
    [id],
    { entra: [], sale: ['san_mano'] },
    ['san_mano'],
  );
  await cerrarRedondeo(p, cu, 0n);
  const documento = `M-${String(x.numero).padStart(6, '0')}`;
  return {
    fecha: x.fecha,
    concepto: `SOL CASH mano ${documento} · ${x.persona} (${x.san})`,
    documento,
    lineas: p.juntas(),
  };
}

// ---------- SCITO TRANSFER ----------

// Envío confirmado: el agente debe lo que cobró (envío + comisión), las
// gourdes salen de la billetera y la comisión es ganancia. La parte del
// agente autorizado es gasto el día que se le paga (decisión del dueño).
async function remesa(
  c: Consulta,
  cu: Cuentas,
  id: string,
): Promise<Borrador | null> {
  const r = await c.query<{
    numero: string;
    fecha: string;
    estado: string;
    origen: string;
    total_pagar: string;
    comision: string;
    agente: string;
    beneficiario: string;
  }>(
    `SELECT e.numero, to_char((e.resuelto_en AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS fecha,
            e.estado, e.origen, e.total_pagar, e.comision,
            a.codigo || ' ' || a.nombre AS agente, e.beneficiario_nombre AS beneficiario
     FROM remesas e JOIN remesa_agentes a ON a.id = e.agente_id WHERE e.id = $1`,
    [id, await zona(c)],
  );
  if (r.rowCount === 0) throw new ErrorContable('Envío no encontrado');
  const x = r.rows[0];
  if (x.estado !== 'confirmado' || x.origen !== 'sistema') return null;
  const agente = { descripcion: x.agente };
  const p = new Partida();
  p.debe(await cu.regla('agentes_envios'), centavos(x.total_pagar), agente);
  p.haber(await cu.regla('comision_envios'), centavos(x.comision), {
    unidadNegocioId: await cu.unidad('envios'),
  });
  await patasDinero(c, cu, p, 'remesa_id', [id], { entra: [], sale: [] }, [
    'remesa',
  ]);
  await cerrarRedondeo(p, cu, 0n);
  const documento = numeroEnvio(x.numero);
  return {
    fecha: x.fecha,
    concepto: `Envío ${documento} · ${x.agente} → ${x.beneficiario}`.slice(
      0,
      300,
    ),
    documento,
    lineas: p.juntas(),
  };
}

// El agente entrega lo cobrado (a la caja o a una cuenta).
async function remesaEntrega(
  c: Consulta,
  cu: Cuentas,
  id: string,
): Promise<Borrador | null> {
  const r = await c.query<{
    fecha: string;
    dia: string;
    monto: string;
    agente: string;
  }>(
    `SELECT to_char((e.created_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS fecha,
            to_char(e.dia, 'YYYY-MM-DD') AS dia, e.monto, a.codigo || ' ' || a.nombre AS agente
     FROM remesa_entregas e JOIN remesa_agentes a ON a.id = e.agente_id WHERE e.id = $1`,
    [id, await zona(c)],
  );
  if (r.rowCount === 0)
    throw new ErrorContable('Entrega del agente no encontrada');
  const x = r.rows[0];
  const p = new Partida();
  p.haber(await cu.regla('agentes_envios'), centavos(x.monto), {
    descripcion: x.agente,
  });
  await patasDinero(
    c,
    cu,
    p,
    'remesa_entrega_id',
    [id],
    { entra: ['ingreso'], sale: [] },
    ['ingreso'],
  );
  await cerrarRedondeo(p, cu, 0n);
  return {
    fecha: x.fecha,
    concepto: `Entrega de envíos de ${x.agente} (${x.dia})`,
    documento: null,
    lineas: p.juntas(),
  };
}

// Pago de la comisión a un agente autorizado: gasto del día del pago.
async function remesaPago(
  c: Consulta,
  cu: Cuentas,
  id: string,
): Promise<Borrador | null> {
  const r = await c.query<{
    fecha: string;
    desde: string;
    hasta: string;
    cantidad: number;
    monto: string;
    agente: string;
  }>(
    `SELECT to_char((p.created_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS fecha,
            to_char(p.desde, 'YYYY-MM-DD') AS desde, to_char(p.hasta, 'YYYY-MM-DD') AS hasta,
            p.cantidad, p.monto, a.codigo || ' ' || a.nombre AS agente
     FROM remesa_pagos_comision p JOIN remesa_agentes a ON a.id = p.agente_id WHERE p.id = $1`,
    [id, await zona(c)],
  );
  if (r.rowCount === 0)
    throw new ErrorContable('Pago de comisión no encontrado');
  const x = r.rows[0];
  const p = new Partida();
  p.debe(await cu.regla('comision_agentes'), centavos(x.monto), {
    descripcion: x.agente,
    unidadNegocioId: await cu.unidad('envios'),
  });
  await patasDinero(
    c,
    cu,
    p,
    'remesa_pago_id',
    [id],
    { entra: [], sale: ['gasto'] },
    ['pago'],
  );
  await cerrarRedondeo(p, cu, 0n);
  return {
    fecha: x.fecha,
    concepto: `Comisión de envíos de ${x.agente} (${x.desde} a ${x.hasta}, ${x.cantidad} envíos)`,
    documento: null,
    lineas: p.juntas(),
  };
}

// ---------- Nómina ----------

// Pago de una nómina: el gasto de cada parte (sueldo y horas extra,
// comisiones y bonos, regalía o vacaciones), lo que se descuenta de los
// adelantos (el empleado debe menos) y el dinero que salió. Los "otros
// descuentos" rebajan el gasto del sueldo.
async function nomina(
  c: Consulta,
  cu: Cuentas,
  id: string,
): Promise<Borrador | null> {
  const r = await c.query<{
    numero: string;
    tipo: 'regular' | 'regalia' | 'vacaciones';
    fecha: string | null;
    desde: string;
    hasta: string;
    sueldo: string;
    extra: string;
    bonos: string;
    adelantos: string;
    otros: string;
    empleados: number;
  }>(
    `SELECT n.numero, n.tipo, to_char(n.fecha_pago, 'YYYY-MM-DD') AS fecha,
            to_char(n.desde, 'YYYY-MM-DD') AS desde, to_char(n.hasta, 'YYYY-MM-DD') AS hasta,
            COALESCE(sum(l.sueldo), 0)::numeric(14,2) AS sueldo,
            COALESCE(sum(l.monto_extra), 0)::numeric(14,2) AS extra,
            COALESCE(sum(l.comisiones + l.bonos), 0)::numeric(14,2) AS bonos,
            COALESCE(sum(l.adelantos), 0)::numeric(14,2) AS adelantos,
            COALESCE(sum(l.otros_descuentos), 0)::numeric(14,2) AS otros,
            count(l.id)::int AS empleados
     FROM nominas n LEFT JOIN nomina_lineas l ON l.nomina_id = n.id
     WHERE n.id = $1 GROUP BY n.id`,
    [id],
  );
  if (r.rowCount === 0) throw new ErrorContable('Nómina no encontrada');
  const x = r.rows[0];
  if (!x.fecha) return null;
  const codigo = `NOM-${String(x.numero).padStart(6, '0')}`;
  const p = new Partida();
  const clave =
    x.tipo === 'regalia'
      ? 'regalia'
      : x.tipo === 'vacaciones'
        ? 'vacaciones'
        : 'sueldos';
  const principal = await cu.regla(clave);
  const sueldos = await cu.regla('sueldos');
  const otros = centavos(x.otros);
  // Los otros descuentos rebajan la cuenta principal (sin dejarla negativa).
  const base = centavos(x.sueldo) - otros;
  if (base > 0n) p.debe(principal, base);
  else if (base < 0n) p.haber(principal, -base);
  if (centavos(x.extra) > 0n) p.debe(sueldos, centavos(x.extra));
  if (centavos(x.bonos) > 0n)
    p.debe(await cu.regla('bonificaciones'), centavos(x.bonos));
  if (centavos(x.adelantos) > 0n)
    p.haber(await cu.regla('adelantos_empleados'), centavos(x.adelantos));
  await patasDinero(
    c,
    cu,
    p,
    'nomina_id',
    [id],
    { entra: [], sale: ['nomina'] },
    ['nomina'],
  );
  await cerrarRedondeo(p, cu, 0n);
  const que =
    x.tipo === 'regalia'
      ? 'Regalía pascual'
      : x.tipo === 'vacaciones'
        ? 'Vacaciones'
        : 'Nómina';
  return {
    fecha: x.fecha,
    concepto: `${que} ${codigo} (${x.desde} a ${x.hasta}, ${x.empleados} empleado${x.empleados === 1 ? '' : 's'})`,
    documento: codigo,
    lineas: p.juntas(),
  };
}

// Adelanto o préstamo a un empleado: no es gasto, el empleado lo debe.
async function adelanto(
  c: Consulta,
  cu: Cuentas,
  id: string,
): Promise<Borrador | null> {
  const r = await c.query<{
    numero: string;
    fecha: string;
    monto: string;
    empleado: string;
    motivo: string;
  }>(
    `SELECT a.numero, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.monto, e.nombre AS empleado, a.motivo
     FROM empleado_adelantos a JOIN empleados e ON e.id = a.empleado_id WHERE a.id = $1`,
    [id],
  );
  if (r.rowCount === 0) throw new ErrorContable('Adelanto no encontrado');
  const x = r.rows[0];
  const codigo = `ADL-${String(x.numero).padStart(6, '0')}`;
  const p = new Partida();
  p.debe(await cu.regla('adelantos_empleados'), centavos(x.monto), {
    descripcion: x.empleado,
  });
  await patasDinero(
    c,
    cu,
    p,
    'adelanto_id',
    [id],
    { entra: [], sale: ['nomina'] },
    ['nomina'],
  );
  await cerrarRedondeo(p, cu, 0n);
  return {
    fecha: x.fecha,
    concepto: `Adelanto ${codigo} a ${x.empleado}: ${x.motivo}`.slice(0, 300),
    documento: codigo,
    lineas: p.juntas(),
  };
}

// ---------- Dinero que no llegó al banco ----------

// Un movimiento "por confirmar" (cobro por transferencia, depósito de la caja,
// entrega de un agente…) se marcó "No llegó": su operación ya puso el dinero
// en el banco en la contabilidad. El contador escoge a qué cuenta va (el
// cliente lo sigue debiendo, una pérdida…). Si la operación no tiene asiento
// (es de antes de la fecha de inicio o quedó pendiente) o se anuló, no hay
// nada que corregir.
async function noLlego(
  c: Consulta,
  cu: Cuentas,
  id: string,
): Promise<Borrador | null> {
  const r = await c.query<{
    fecha: string;
    movimiento: string;
    tipo: string;
    signo: number;
    monto: string;
    monto_dop: string;
    cuenta_id: string;
    cuenta: string;
    simbolo: string;
    motivo: string | null;
    venta_id: string | null;
    venta_estado: string | null;
    cxc_abono_id: string | null;
    abono_estado: string | null;
    transferencia_id: string | null;
    remesa_entrega_id: string | null;
    san_recibo_id: string | null;
  }>(
    `SELECT to_char((cf.created_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS fecha, m.id::text AS movimiento,
            m.tipo, m.signo, m.monto, m.monto_dop, m.cuenta_id, ct.nombre AS cuenta, mo.simbolo, cf.motivo,
            m.venta_id, v.estado AS venta_estado, m.cxc_abono_id, ab.estado AS abono_estado,
            m.transferencia_id, m.remesa_entrega_id, m.san_recibo_id
     FROM cuenta_confirmaciones cf JOIN cuenta_movimientos m ON m.id = cf.movimiento_id
     JOIN cuentas ct ON ct.id = m.cuenta_id JOIN monedas mo ON mo.codigo = ct.moneda
     LEFT JOIN ventas v ON v.id = m.venta_id
     LEFT JOIN cxc_abonos ab ON ab.id = m.cxc_abono_id
     WHERE cf.id = $1 AND cf.resultado = 'no_llego'`,
    [id, await zona(c)],
  );
  if (r.rowCount === 0)
    throw new ErrorContable('Confirmación "No llegó" no encontrada');
  const x = r.rows[0];
  if (x.venta_estado === 'anulada' || x.abono_estado === 'anulado') return null;
  // La operación que puso el dinero en el banco en la contabilidad.
  const [tabla, origenId] = x.venta_id
    ? ['ventas', x.venta_id]
    : x.cxc_abono_id
      ? ['cxc_abonos', x.cxc_abono_id]
      : x.transferencia_id
        ? ['transferencias', x.transferencia_id]
        : x.remesa_entrega_id
          ? ['remesa_entregas', x.remesa_entrega_id]
          : x.san_recibo_id
            ? ['san_recibos', x.san_recibo_id]
            : ['cuenta_movimientos', x.movimiento];
  const asentado = await c.query(
    `SELECT 1 FROM asientos WHERE origen_tabla = $1 AND origen_id = $2
       AND reverso_de IS NULL AND estado = 'activo'`,
    [tabla, origenId],
  );
  if (!asentado.rowCount) return null;
  const banco = await cu.banco(x.cuenta_id);
  const contra = await cu.clasificada(
    TABLA_ORIGEN.no_llego,
    id,
    `No llegó a ${x.cuenta} (${x.simbolo}${x.monto}): ${PIDE_CUENTA}`,
  );
  const monto = centavos(x.monto_dop);
  const descripcion = x.motivo?.slice(0, 300) ?? null;
  const p = new Partida();
  if (Number(x.signo) > 0) {
    p.debe(contra, monto, { descripcion });
    p.haber(banco, monto);
  } else {
    p.debe(banco, monto);
    p.haber(contra, monto, { descripcion });
  }
  return {
    fecha: x.fecha,
    concepto:
      `No llegó a ${x.cuenta}: ${x.simbolo}${x.monto}${x.motivo ? ` · ${x.motivo}` : ''}`.slice(
        0,
        300,
      ),
    documento: `NL-${id}`,
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
    case 'cuenta_mov':
      return movCuenta(c, cu, id);
    case 'transferencia':
      return transferencia(c, cu, id);
    case 'san_recibo':
      return sanRecibo(c, cu, id);
    case 'san_entrega':
      return sanEntrega(c, cu, id);
    case 'remesa':
      return remesa(c, cu, id);
    case 'remesa_entrega':
      return remesaEntrega(c, cu, id);
    case 'remesa_pago':
      return remesaPago(c, cu, id);
    case 'nomina':
      return nomina(c, cu, id);
    case 'adelanto':
      return adelanto(c, cu, id);
    case 'llegada':
      return llegada(c, cu, id);
    case 'no_llego':
      return noLlego(c, cu, id);
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
  if ((ya.rowCount ?? 0) > 0) {
    await resolverPendiente(c, tabla, id, usuarioId);
    return 'omitido';
  }
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
