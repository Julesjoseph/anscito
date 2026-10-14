import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { registrarAuditoria } from '../auditoria/auditoria';
import { SQL_DISPONIBLE } from '../bancos/sql';
import { numeroSesion, SQL_ESPERADO } from '../caja/sql';
import { DatabaseService } from '../database/database.service';
import { esCero, esEntera, normalizarCantidad } from '../inventario/cantidades';
import { SQL_EXISTENCIA } from '../inventario/sql';
import { centavos, fechaValida, texto2 } from '../sanes/calendario';
import { normalizarMonto } from '../servicios/calculo-itbis';

// Compras: facturas de proveedor. Los productos entran al inventario con su
// costo (sin ITBIS) y el costo promedio se recalcula. Contado: se paga en el
// momento desde una caja abierta o una cuenta en pesos. Crédito: queda
// pendiente con su vencimiento (los abonos llegan con Cuentas por Pagar).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POR_PAGINA = 50;

type Consulta = Pick<DatabaseService, 'query'>;

function texto(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
}

function opcional(v: unknown, max: number, que: string): string | null {
  const t = texto(v);
  if (t.length > max)
    throw new BadRequestException(`${que}: máximo ${max} caracteres`);
  return t || null;
}

// Monto no negativo; vacío cuenta como 0.
function monto(v: unknown, que: string): string {
  if (texto(v) === '') return '0.00';
  const m = normalizarMonto(v);
  if (m === null)
    throw new BadRequestException(
      `${que}: número no negativo con hasta 2 decimales`,
    );
  return m;
}

// Un pago de una factura cuenta si es de contado (sin pago_id) o si su pago
// en Cuentas por Pagar no está anulado.
export const SQL_PAGO_VIGENTE = `(cp.pago_id IS NULL OR EXISTS (
  SELECT 1 FROM cxp_pagos pp WHERE pp.id = cp.pago_id AND pp.estado = 'activo'))`;

export function numeroCompra(n: number | string) {
  return `CP-${String(n).padStart(6, '0')}`;
}

// NCF de 11 (B01…) o e-NCF de 13 (E31…). Se acepta con guiones o espacios.
function leerNcf(v: unknown): string | null {
  const t = texto(v).toUpperCase().replace(/[\s-]/g, '');
  if (!t) return null;
  if (!/^(B\d{10}|E\d{12})$/.test(t))
    throw new BadRequestException(
      'NCF inválido: B + 10 números (ej.: B0100000123) o e-NCF E + 12 números (ej.: E310000000123)',
    );
  return t;
}

type Linea = {
  productoId: string;
  cantidad: string;
  costo: string;
};

@Injectable()
export class ComprasService {
  constructor(private readonly db: DatabaseService) {}

  private async hoy(c: Consulta) {
    const z = await c.query<{ valor: string }>(
      `SELECT valor FROM configuracion WHERE clave = 'empresa.zona_horaria'`,
    );
    const zona = z.rows[0]?.valor ?? 'America/Santo_Domingo';
    return (
      await c.query<{ hoy: string }>(
        `SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS hoy`,
        [zona],
      )
    ).rows[0].hoy;
  }

  // ---------- Datos para la pantalla ----------

  async preparar() {
    const [tipos, cajas, cuentas, hoy] = await Promise.all([
      this.db.query(
        'SELECT codigo, nombre FROM tipos_gasto WHERE is_active ORDER BY orden',
      ),
      this.db.query(
        `SELECT c.id, c.nombre, s.id AS sesion_id FROM cajas c
         LEFT JOIN caja_sesiones s ON s.caja_id = c.id AND s.estado = 'abierta'
         WHERE c.is_active ORDER BY lower(c.nombre)`,
      ),
      this.db.query(
        `SELECT id, nombre FROM cuentas WHERE is_active AND moneda = 'DOP' ORDER BY lower(nombre)`,
      ),
      this.hoy(this.db),
    ]);
    return {
      tiposGasto: tipos.rows,
      cajas: cajas.rows,
      cuentas: cuentas.rows,
      hoy,
    };
  }

  async proveedores(textoBuscado: unknown) {
    const t = texto(textoBuscado);
    if (t.length < 2) return [];
    const r = await this.db.query(
      `SELECT id, nombre, nombre_comercial, numero_documento, dias_credito FROM terceros
       WHERE rol = 'proveedor' AND is_active
         AND (nombre ILIKE '%' || $1 || '%' OR nombre_comercial ILIKE '%' || $1 || '%'
              OR numero_documento ILIKE '%' || $1 || '%')
       ORDER BY lower(nombre) LIMIT 20`,
      [t.slice(0, 60)],
    );
    return r.rows;
  }

  async productos(textoBuscado: unknown) {
    const t = texto(textoBuscado);
    if (t.length < 2) return [];
    const r = await this.db.query(
      `SELECT p.id, p.codigo, p.nombre, p.costo, um.nombre AS unidad, um.permite_decimales
       FROM productos p JOIN unidades_medida um ON um.id = p.unidad_id
       WHERE p.is_active AND (p.nombre ILIKE '%' || $1 || '%' OR p.codigo ILIKE '%' || $1 || '%')
       ORDER BY lower(p.nombre) LIMIT 20`,
      [t.slice(0, 60)],
    );
    return r.rows;
  }

  // ---------- Consultar ----------

  async listar(f: {
    texto?: string;
    desde?: string;
    hasta?: string;
    estado?: string;
    pagina?: string;
  }) {
    const cond: string[] = [];
    const params: unknown[] = [];
    const t = texto(f.texto);
    if (t) {
      params.push(`%${t}%`);
      const p = params.length;
      let porNumero = '';
      if (/^\d{1,12}$/.test(t)) {
        params.push(Number(t));
        porNumero = ` OR c.numero = $${params.length}`;
      }
      cond.push(
        `(pr.nombre ILIKE $${p} OR c.ncf ILIKE $${p} OR pr.numero_documento ILIKE $${p}${porNumero})`,
      );
    }
    for (const [campo, op, v] of [
      ['desde', '>=', texto(f.desde)],
      ['hasta', '<=', texto(f.hasta)],
    ] as const) {
      if (!v) continue;
      if (!fechaValida(v))
        throw new BadRequestException('Fecha inválida (AAAA-MM-DD)');
      params.push(v);
      cond.push(`c.fecha_comprobante ${op} $${params.length}::date`);
      void campo;
    }
    const estado = texto(f.estado);
    if (estado === 'pendientes')
      cond.push(`c.estado = 'registrada' AND x.pagado < c.a_pagar`);
    else if (estado === 'anuladas') cond.push(`c.estado = 'anulada'`);
    else if (estado === 'registradas') cond.push(`c.estado = 'registrada'`);
    const pagina = Math.max(1, Number(texto(f.pagina)) || 1);
    const donde = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const desde = `FROM compras c JOIN terceros pr ON pr.id = c.proveedor_id
      CROSS JOIN LATERAL (SELECT COALESCE(sum(cp.monto), 0)::numeric(14,2) AS pagado
                          FROM compra_pagos cp WHERE cp.compra_id = c.id AND ${SQL_PAGO_VIGENTE}) x ${donde}`;
    const [filas, total] = await Promise.all([
      this.db.query<{ numero: string }>(
        `SELECT c.id, c.numero, to_char(c.fecha_comprobante, 'YYYY-MM-DD') AS fecha, c.ncf,
                pr.nombre AS proveedor, c.tipo_gasto, c.condicion,
                to_char(c.vencimiento, 'YYYY-MM-DD') AS vencimiento, c.itbis, c.total, c.a_pagar,
                x.pagado, (c.a_pagar - x.pagado)::numeric(14,2) AS saldo, c.estado
         ${desde} ORDER BY c.fecha_comprobante DESC, c.numero DESC
         LIMIT ${POR_PAGINA} OFFSET ${(pagina - 1) * POR_PAGINA}`,
        params,
      ),
      this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n ${desde}`,
        params,
      ),
    ]);
    return {
      filas: filas.rows.map((x) => ({ ...x, codigo: numeroCompra(x.numero) })),
      total: total.rows[0].n,
      pagina,
      porPagina: POR_PAGINA,
    };
  }

  async detalle(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Compra no encontrada');
    const c = await this.db.query<{ numero: string }>(
      `SELECT c.*, to_char(c.fecha_comprobante, 'YYYY-MM-DD') AS fecha,
              to_char(c.vencimiento, 'YYYY-MM-DD') AS vence,
              pr.nombre AS proveedor, pr.numero_documento AS proveedor_documento,
              tg.nombre AS tipo_gasto_nombre, s.nombre AS sucursal,
              u.username AS registrada_por, ua.username AS anulada_por_usuario
       FROM compras c JOIN terceros pr ON pr.id = c.proveedor_id
       JOIN tipos_gasto tg ON tg.codigo = c.tipo_gasto
       JOIN sucursales s ON s.id = c.sucursal_id
       JOIN usuarios u ON u.id = c.created_by
       LEFT JOIN usuarios ua ON ua.id = c.anulada_por
       WHERE c.id = $1`,
      [id],
    );
    if (c.rowCount === 0) throw new NotFoundException('Compra no encontrada');
    const [lineas, pagos] = await Promise.all([
      this.db.query(
        `SELECT l.id, p.codigo, p.nombre, um.nombre AS unidad, l.cantidad, l.costo_unitario, l.subtotal
         FROM compra_lineas l JOIN productos p ON p.id = l.producto_id
         JOIN unidades_medida um ON um.id = p.unidad_id
         WHERE l.compra_id = $1 ORDER BY l.id`,
        [id],
      ),
      this.db.query(
        `SELECT cp.id, cp.monto, cp.forma, to_char(cp.fecha, 'YYYY-MM-DD') AS fecha, cp.referencia,
                cp.created_at, u.username AS usuario,
                COALESCE(cj.nombre, ct.nombre) AS origen,
                CASE WHEN cp.pago_id IS NULL THEN NULL
                     ELSE 'PP-' || lpad((SELECT numero FROM cxp_pagos WHERE id = cp.pago_id)::text, 6, '0') END AS comprobante,
                ${SQL_PAGO_VIGENTE} AS vigente
         FROM compra_pagos cp JOIN usuarios u ON u.id = cp.usuario_id
         LEFT JOIN caja_movimientos cm ON cm.compra_pago_id = cp.id AND cm.tipo = 'compra'
         LEFT JOIN caja_sesiones cs ON cs.id = cm.sesion_id
         LEFT JOIN cajas cj ON cj.id = cs.caja_id
         LEFT JOIN cuenta_movimientos km ON km.compra_pago_id = cp.id AND km.tipo = 'compra'
         LEFT JOIN cuentas ct ON ct.id = km.cuenta_id
         WHERE cp.compra_id = $1 ORDER BY cp.created_at`,
        [id],
      ),
    ]);
    const x = c.rows[0] as Record<string, unknown> & {
      numero: string;
      a_pagar: string;
    };
    // Solo cuentan las partes vigentes (las de un pago anulado se muestran, pero no suman).
    const pagado = (pagos.rows as { monto: string; vigente: boolean }[])
      .filter((p) => p.vigente)
      .reduce((a, p) => a + centavos(p.monto), 0n);
    return {
      ...x,
      codigo: numeroCompra(x.numero),
      lineas: lineas.rows,
      pagos: pagos.rows,
      pagado: texto2(pagado),
      saldo: texto2(centavos(x.a_pagar) - pagado),
    };
  }

  // ---------- Registrar ----------

  private leerLineas(datos: unknown): Linea[] {
    const lista = Array.isArray(datos) ? datos : [];
    if (lista.length > 100)
      throw new BadRequestException('Máximo 100 productos por factura');
    return lista.map(
      (
        l: {
          productoId?: unknown;
          cantidad?: unknown;
          costoUnitario?: unknown;
        },
        i,
      ) => {
        const productoId = texto(l?.productoId).toLowerCase();
        if (!UUID.test(productoId))
          throw new BadRequestException(`Línea ${i + 1}: producto inválido`);
        const cantidad = normalizarCantidad(l?.cantidad);
        if (cantidad === null || esCero(cantidad))
          throw new BadRequestException(
            `Línea ${i + 1}: cantidad mayor que 0 con hasta 3 decimales`,
          );
        const costo = normalizarMonto(l?.costoUnitario);
        if (costo === null)
          throw new BadRequestException(
            `Línea ${i + 1}: costo por unidad (sin ITBIS) no negativo con hasta 2 decimales`,
          );
        return { productoId, cantidad, costo };
      },
    );
  }

  // Origen del dinero de un pago de contado: caja abierta o cuenta en pesos.
  private async origen(
    c: PoolClient,
    forma: string,
    cajaId: unknown,
    cuentaId: unknown,
    monto: bigint,
  ) {
    if (forma === 'efectivo') {
      const id = texto(cajaId).toLowerCase();
      if (!UUID.test(id))
        throw new BadRequestException(
          'Seleccione la caja (debe estar abierta)',
        );
      const s = await c.query<{ id: string; caja: string; numero: string }>(
        `SELECT s.id, c.nombre AS caja, s.numero FROM caja_sesiones s JOIN cajas c ON c.id = s.caja_id
         WHERE s.caja_id = $1 AND s.estado = 'abierta' FOR UPDATE OF s`,
        [id],
      );
      if (s.rowCount === 0)
        throw new BadRequestException(
          'La caja no está abierta: ábrala en Caja',
        );
      const hay = (
        await c.query<{ esperado: string }>(SQL_ESPERADO, [s.rows[0].id])
      ).rows[0].esperado;
      if (centavos(hay) < monto)
        throw new BadRequestException(
          `No hay suficiente efectivo en ${s.rows[0].caja}: hay RD$${hay}`,
        );
      return {
        tipo: 'caja' as const,
        id: s.rows[0].id,
        nombre: `${s.rows[0].caja} (${numeroSesion(s.rows[0].numero)})`,
      };
    }
    if (forma !== 'banco')
      throw new BadRequestException('Forma de pago: efectivo o banco');
    const id = texto(cuentaId).toLowerCase();
    if (!UUID.test(id)) throw new BadRequestException('Seleccione la cuenta');
    const ct = await c.query<{ id: string; nombre: string }>(
      `SELECT id, nombre FROM cuentas WHERE id = $1 AND is_active AND moneda = 'DOP' FOR UPDATE`,
      [id],
    );
    if (ct.rowCount === 0)
      throw new BadRequestException(
        'La cuenta no existe, está desactivada o no es en pesos',
      );
    const hay = (await c.query<{ disponible: string }>(SQL_DISPONIBLE, [id]))
      .rows[0].disponible;
    if (centavos(hay) < monto)
      throw new BadRequestException(
        `No hay suficiente dinero en ${ct.rows[0].nombre}: hay RD$${hay}`,
      );
    return { tipo: 'cuenta' as const, id, nombre: ct.rows[0].nombre };
  }

  async registrar(
    actorId: string,
    ip: string | undefined,
    datos: Record<string, unknown>,
  ) {
    const proveedorId = texto(datos.proveedorId).toLowerCase();
    if (!UUID.test(proveedorId))
      throw new BadRequestException('Seleccione el proveedor');
    const ncf = leerNcf(datos.ncf);
    const fecha = texto(datos.fechaComprobante);
    if (!fechaValida(fecha))
      throw new BadRequestException('Fecha de la factura inválida');
    const tipoGasto = texto(datos.tipoGasto);
    if (!/^\d{2}$/.test(tipoGasto))
      throw new BadRequestException('Seleccione el tipo de gasto');
    const condicion = texto(datos.condicion);
    if (condicion !== 'contado' && condicion !== 'credito')
      throw new BadRequestException('Condición: contado o crédito');
    const lineas = this.leerLineas(datos.lineas);
    const otrosBienes = monto(datos.otrosBienes, 'Otros bienes');
    const servicios = monto(datos.servicios, 'Servicios');
    const itbis = monto(datos.itbis, 'ITBIS');
    const itbisRetenido = monto(datos.itbisRetenido, 'ITBIS retenido');
    const isrRetenido = monto(datos.isrRetenido, 'ISR retenido');
    if (centavos(itbisRetenido) > centavos(itbis))
      throw new BadRequestException(
        'El ITBIS retenido no puede ser mayor que el ITBIS de la factura',
      );
    const descripcion = opcional(datos.descripcion, 300, 'Descripción');
    const gastoFijoId = texto(datos.gastoFijoId).toLowerCase() || null;
    if (gastoFijoId && !UUID.test(gastoFijoId))
      throw new BadRequestException('Gasto fijo inválido');
    // Mes al que corresponde la factura del gasto fijo (por defecto, el de su fecha).
    const mesTexto = texto(datos.gastoFijoMes);
    if (mesTexto && !/^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/.test(mesTexto))
      throw new BadRequestException('Mes del gasto fijo inválido');
    const notas = opcional(datos.notas, 1000, 'Notas');
    const pago = (datos.pago ?? {}) as Record<string, unknown>;
    const referencia = opcional(pago.referencia, 60, 'Referencia del pago');

    try {
      return await this.db.transaccion(async (c) => {
        const hoy = await this.hoy(c);
        if (fecha > hoy)
          throw new BadRequestException(
            'La fecha de la factura no puede ser futura',
          );
        const prov = await c.query<{
          nombre: string;
          dias_credito: number | null;
        }>(
          `SELECT nombre, dias_credito FROM terceros WHERE id = $1 AND rol = 'proveedor' AND is_active`,
          [proveedorId],
        );
        if (prov.rowCount === 0)
          throw new BadRequestException(
            'El proveedor no existe o está desactivado',
          );
        const tg = await c.query(
          'SELECT 1 FROM tipos_gasto WHERE codigo = $1 AND is_active',
          [tipoGasto],
        );
        if (tg.rowCount === 0)
          throw new BadRequestException('Tipo de gasto inválido');
        if (gastoFijoId) {
          const gf = await c.query(
            'SELECT 1 FROM gastos_fijos WHERE id = $1 AND proveedor_id = $2',
            [gastoFijoId, proveedorId],
          );
          if (gf.rowCount === 0)
            throw new BadRequestException(
              'El gasto fijo no existe o es de otro proveedor',
            );
        }

        // Vencimiento: el escrito; en crédito, si no se escribe, los días del proveedor.
        let vence = texto(datos.vencimiento);
        if (condicion === 'contado') vence = fecha;
        else if (!vence) {
          const dias = prov.rows[0].dias_credito ?? 0;
          vence = (
            await c.query<{ v: string }>(
              `SELECT to_char($1::date + $2::int, 'YYYY-MM-DD') AS v`,
              [fecha, dias],
            )
          ).rows[0].v;
        }
        if (!fechaValida(vence))
          throw new BadRequestException('Fecha de vencimiento inválida');
        if (vence < fecha)
          throw new BadRequestException(
            'El vencimiento no puede ser antes de la fecha de la factura',
          );

        // Productos: se bloquean y se calcula el subtotal de cada línea.
        const prods: (Linea & {
          codigo: string;
          nombre: string;
          subtotal: string;
        })[] = [];
        for (const [i, l] of lineas.entries()) {
          const p = await c.query<{
            codigo: string;
            nombre: string;
            is_active: boolean;
            permite_decimales: boolean;
          }>(
            `SELECT p.codigo, p.nombre, p.is_active, um.permite_decimales
             FROM productos p JOIN unidades_medida um ON um.id = p.unidad_id
             WHERE p.id = $1 FOR UPDATE OF p`,
            [l.productoId],
          );
          if (p.rowCount === 0 || !p.rows[0].is_active)
            throw new BadRequestException(
              `Línea ${i + 1}: el producto no existe o está desactivado`,
            );
          if (!p.rows[0].permite_decimales && !esEntera(l.cantidad))
            throw new BadRequestException(
              `Línea ${i + 1}: ${p.rows[0].nombre} se cuenta en unidades enteras`,
            );
          const sub = (
            await c.query<{ s: string }>(
              'SELECT round($1::numeric * $2::numeric, 2)::numeric(14,2) AS s',
              [l.cantidad, l.costo],
            )
          ).rows[0].s;
          prods.push({ ...l, ...p.rows[0], subtotal: sub });
        }

        const bienes =
          prods.reduce((a, p) => a + centavos(p.subtotal), 0n) +
          centavos(otrosBienes);
        const total = bienes + centavos(servicios) + centavos(itbis);
        if (total <= 0n)
          throw new BadRequestException(
            'La factura no tiene montos: agregue productos, otros bienes o servicios',
          );
        const aPagar = total - centavos(itbisRetenido) - centavos(isrRetenido);
        if (aPagar < 0n)
          throw new BadRequestException(
            'Las retenciones no pueden ser mayores que el total',
          );

        // Contado: de dónde sale el dinero (se revisa antes de guardar nada).
        const dest =
          condicion === 'contado' && aPagar > 0n
            ? await this.origen(
                c,
                texto(pago.forma),
                pago.cajaId,
                pago.cuentaId,
                aPagar,
              )
            : null;

        const suc = await c.query<{ id: string }>(
          `SELECT COALESCE(
             (SELECT s.id FROM usuarios u JOIN sucursales s ON s.id = u.sucursal_id AND s.is_active
              WHERE u.id = $1),
             (SELECT id FROM sucursales WHERE es_principal)) AS id`,
          [actorId],
        );
        const n = (
          await c.query<{ valor: string }>(
            `UPDATE contadores SET valor = valor + 1 WHERE clave = 'compras' RETURNING valor`,
          )
        ).rows[0].valor;
        const r = await c.query<{ id: string }>(
          `INSERT INTO compras (numero, proveedor_id, sucursal_id, ncf, fecha_comprobante, tipo_gasto,
                                condicion, vencimiento, monto_bienes, monto_servicios, itbis,
                                itbis_retenido, isr_retenido, total, a_pagar, descripcion, notas, created_by,
                                gasto_fijo_id, gasto_fijo_mes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
           RETURNING id`,
          [
            n,
            proveedorId,
            suc.rows[0].id,
            ncf,
            fecha,
            tipoGasto,
            condicion,
            vence,
            texto2(bienes),
            servicios,
            itbis,
            itbisRetenido,
            isrRetenido,
            texto2(total),
            texto2(aPagar),
            descripcion,
            notas,
            actorId,
            gastoFijoId,
            gastoFijoId ? `${(mesTexto || fecha).slice(0, 7)}-01` : null,
          ],
        );
        const compraId = r.rows[0].id;
        const codigo = numeroCompra(n);

        // Entrada al inventario con costo promedio ponderado.
        for (const p of prods) {
          await c.query(
            `INSERT INTO compra_lineas (compra_id, producto_id, cantidad, costo_unitario, subtotal)
             VALUES ($1, $2, $3, $4, $5)`,
            [compraId, p.productoId, p.cantidad, p.costo, p.subtotal],
          );
          const actual = await c.query<{ existencia: string; costo: string }>(
            `SELECT (${SQL_EXISTENCIA}) AS existencia, (SELECT costo FROM productos WHERE id = $1) AS costo`,
            [p.productoId],
          );
          const { existencia, costo } = actual.rows[0];
          const nuevo = (
            await c.query<{ costo: string }>(
              `SELECT CASE WHEN $1::numeric <= 0 THEN $3::numeric(14,2)
                      ELSE round(($1::numeric * $2::numeric + $4::numeric * $3::numeric)
                                 / ($1::numeric + $4::numeric), 2)
                      END::numeric(14,2) AS costo`,
              [existencia, costo, p.costo, p.cantidad],
            )
          ).rows[0].costo;
          await c.query(
            `INSERT INTO movimientos_inventario
               (producto_id, sucursal_id, tipo, cantidad, costo_unitario, costo_promedio,
                proveedor, referencia, motivo, compra_id, usuario_id)
             VALUES ($1, $2, 'entrada', $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              p.productoId,
              suc.rows[0].id,
              p.cantidad,
              p.costo,
              nuevo,
              prov.rows[0].nombre,
              ncf ?? codigo,
              `Compra ${codigo}`,
              compraId,
              actorId,
            ],
          );
          if (nuevo !== costo)
            await c.query(
              'UPDATE productos SET costo = $2, updated_at = now() WHERE id = $1',
              [p.productoId, nuevo],
            );
        }

        // Pago de contado.
        if (dest) {
          const pg = await c.query<{ id: string }>(
            `INSERT INTO compra_pagos (compra_id, monto, forma, fecha, referencia, usuario_id)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [
              compraId,
              texto2(aPagar),
              dest.tipo === 'caja' ? 'efectivo' : 'banco',
              hoy,
              referencia,
              actorId,
            ],
          );
          if (dest.tipo === 'caja')
            await c.query(
              `INSERT INTO caja_movimientos (sesion_id, tipo, monto, compra_pago_id, comprobante, usuario_id)
               VALUES ($1, 'compra', $2, $3, $4, $5)`,
              [dest.id, texto2(aPagar), pg.rows[0].id, ncf ?? codigo, actorId],
            );
          else
            await c.query(
              `INSERT INTO cuenta_movimientos
                 (cuenta_id, tipo, signo, monto, tasa, monto_dop, fecha, beneficiario,
                  comprobante, referencia, compra_pago_id, usuario_id)
               VALUES ($1, 'compra', -1, $2, 1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                dest.id,
                texto2(aPagar),
                hoy,
                prov.rows[0].nombre.slice(0, 120),
                ncf ?? codigo,
                referencia,
                pg.rows[0].id,
                actorId,
              ],
            );
        }

        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'compra.registrar',
          entidad: 'compras',
          entidadId: compraId,
          nuevo: {
            compra: codigo,
            proveedor: prov.rows[0].nombre,
            ncf,
            condicion,
            vencimiento: vence,
            productos: prods.length,
            bienes: texto2(bienes),
            servicios,
            itbis,
            total: texto2(total),
            a_pagar: texto2(aPagar),
            pagado_desde: dest?.nombre ?? null,
          },
          ip,
        });
        return {
          id: compraId,
          codigo,
          total: texto2(total),
          aPagar: texto2(aPagar),
        };
      });
    } catch (e) {
      const err = e as { code?: string; constraint?: string };
      if (
        err.code === '23505' &&
        err.constraint === 'compras_gasto_fijo_mes_unico'
      )
        throw new ConflictException(
          'Ya hay una factura registrada de este gasto fijo para ese mes',
        );
      if (err.code === '23505')
        throw new ConflictException(
          'Esa factura (mismo NCF del mismo proveedor) ya está registrada',
        );
      throw e;
    }
  }

  // ---------- Anular ----------

  async anular(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: { motivo?: unknown; cajaId?: unknown },
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Compra no encontrada');
    const motivo = texto(datos.motivo);
    if (motivo.length < 5 || motivo.length > 500)
      throw new BadRequestException(
        'Escriba el motivo de la anulación (5 a 500 caracteres)',
      );
    return this.db.transaccion(async (c) => {
      const r = await c.query<{
        numero: string;
        estado: string;
        sucursal_id: string;
        ncf: string | null;
        proveedor: string;
      }>(
        `SELECT c.numero, c.estado, c.sucursal_id, c.ncf, pr.nombre AS proveedor
         FROM compras c JOIN terceros pr ON pr.id = c.proveedor_id WHERE c.id = $1 FOR UPDATE OF c`,
        [id],
      );
      if (r.rowCount === 0) throw new NotFoundException('Compra no encontrada');
      const x = r.rows[0];
      if (x.estado === 'anulada')
        throw new BadRequestException('La compra ya está anulada');
      const codigo = numeroCompra(x.numero);
      const hoy = await this.hoy(c);

      const enCxp = await c.query<{ numero: string }>(
        `SELECT DISTINCT pp.numero FROM compra_pagos cp JOIN cxp_pagos pp ON pp.id = cp.pago_id
         WHERE cp.compra_id = $1 AND pp.estado = 'activo' ORDER BY pp.numero`,
        [id],
      );
      if ((enCxp.rowCount ?? 0) > 0)
        throw new BadRequestException(
          `Esta factura tiene pagos en Cuentas por Pagar (${enCxp.rows.map((x) => `PP-${String(x.numero).padStart(6, '0')}`).join(', ')}): anúlelos primero`,
        );

      // La mercancía sale del inventario (devolución al proveedor).
      const lineas = await c.query<{
        producto_id: string;
        cantidad: string;
        nombre: string;
      }>(
        `SELECT l.producto_id, l.cantidad, p.nombre FROM compra_lineas l
         JOIN productos p ON p.id = l.producto_id WHERE l.compra_id = $1 ORDER BY l.producto_id, l.id`,
        [id],
      );
      for (const l of lineas.rows) {
        const p = await c.query<{ costo: string }>(
          'SELECT costo FROM productos WHERE id = $1 FOR UPDATE',
          [l.producto_id],
        );
        const ex = (
          await c.query<{ existencia: string }>(SQL_EXISTENCIA, [l.producto_id])
        ).rows[0].existencia;
        const ok = await c.query<{ ok: boolean }>(
          'SELECT $1::numeric >= $2::numeric AS ok',
          [ex, l.cantidad],
        );
        if (!ok.rows[0].ok)
          throw new BadRequestException(
            `No se puede anular: de ${l.nombre} quedan ${ex} y la compra trajo ${l.cantidad} (ya se vendió o salió una parte)`,
          );
        await c.query(
          `INSERT INTO movimientos_inventario
             (producto_id, sucursal_id, tipo, cantidad, costo_unitario, costo_promedio,
              causa, referencia, motivo, compra_id, usuario_id)
           VALUES ($1, $2, 'salida', $3, $4, $4, 'devolucion_proveedor', $5, $6, $7, $8)`,
          [
            l.producto_id,
            x.sucursal_id,
            l.cantidad,
            p.rows[0].costo,
            x.ncf ?? codigo,
            `Anulación de ${codigo}: ${motivo}`,
            id,
            actorId,
          ],
        );
      }

      // El dinero pagado vuelve a donde salió.
      const pagos = await c.query<{
        id: string;
        monto: string;
        forma: string;
        cuenta_mov: string | null;
        cuenta_id: string | null;
      }>(
        `SELECT cp.id, cp.monto, cp.forma, km.id::text AS cuenta_mov, km.cuenta_id
         FROM compra_pagos cp
         LEFT JOIN cuenta_movimientos km ON km.compra_pago_id = cp.id AND km.tipo = 'compra'
         WHERE cp.compra_id = $1 AND cp.pago_id IS NULL ORDER BY cp.created_at`,
        [id],
      );
      const devuelto: string[] = [];
      for (const pg of pagos.rows) {
        if (pg.forma === 'efectivo') {
          const cajaId = texto(datos.cajaId).toLowerCase();
          if (!UUID.test(cajaId))
            throw new BadRequestException(
              'Esta compra se pagó en efectivo: elija la caja (abierta) donde vuelve el dinero',
            );
          const s = await c.query<{ id: string; caja: string }>(
            `SELECT s.id, c.nombre AS caja FROM caja_sesiones s JOIN cajas c ON c.id = s.caja_id
             WHERE s.caja_id = $1 AND s.estado = 'abierta' FOR UPDATE OF s`,
            [cajaId],
          );
          if (s.rowCount === 0)
            throw new BadRequestException(
              'La caja no está abierta: ábrala para devolver el efectivo',
            );
          await c.query(
            `INSERT INTO caja_movimientos (sesion_id, tipo, monto, compra_pago_id, motivo, usuario_id)
             VALUES ($1, 'compra_reverso', $2, $3, $4, $5)`,
            [
              s.rows[0].id,
              pg.monto,
              pg.id,
              `Anulación de ${codigo}: ${motivo}`,
              actorId,
            ],
          );
          devuelto.push(`${s.rows[0].caja}: RD$${pg.monto}`);
        } else if (pg.cuenta_mov && pg.cuenta_id) {
          await c.query('SELECT id FROM cuentas WHERE id = $1 FOR UPDATE', [
            pg.cuenta_id,
          ]);
          await c.query(
            `INSERT INTO cuenta_movimientos
               (cuenta_id, tipo, signo, monto, tasa, monto_dop, fecha, motivo, reverso_de,
                compra_pago_id, usuario_id)
             VALUES ($1, 'reverso', 1, $2, 1, $2, $3, $4, $5, $6, $7)`,
            [
              pg.cuenta_id,
              pg.monto,
              hoy,
              `Anulación de ${codigo}: ${motivo}`,
              pg.cuenta_mov,
              pg.id,
              actorId,
            ],
          );
          devuelto.push(`cuenta: RD$${pg.monto}`);
        }
      }

      await c.query(
        `UPDATE compras SET estado = 'anulada', anulada_por = $2, anulada_en = now(),
                motivo_anulacion = $3 WHERE id = $1`,
        [id, actorId, motivo],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'compra.anular',
        entidad: 'compras',
        entidadId: id,
        anterior: { compra: codigo, estado: 'registrada' },
        nuevo: {
          compra: codigo,
          estado: 'anulada',
          productos_devueltos: lineas.rowCount,
          dinero_devuelto: devuelto,
        },
        motivo,
        ip,
      });
      return { ok: true };
    });
  }
}
