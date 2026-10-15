import { contabilizar, revertir } from '../contabilidad/motor';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { registrarAuditoria } from '../auditoria/auditoria';
import { SQL_DISPONIBLE } from '../bancos/sql';
import { SQL_ESPERADO } from '../caja/sql';
import { encabezado } from '../comun/ticket';
import type { ElementoTicket, Ticket } from '../comun/ticket';
import { hoyLocal } from '../cxc/estado';
import { DatabaseService } from '../database/database.service';
import { centavos, texto2 } from '../sanes/calendario';
import { generarReciboSan } from '../sanes/recibo-san-pdf';
import { normalizarMonto } from '../servicios/calculo-itbis';
import { dinero } from '../ventas/recibo-pdf';
import type { Formato } from '../ventas/recibo-pdf';
import {
  avisosGastosFijos,
  diasAlerta,
  facturasPendientes,
  numeroPago,
} from './estado';

// Cuentas por Pagar: pagos a proveedores (una o varias facturas, completas o
// en parte) desde la caja o una cuenta, su anulación, alertas de vencimiento
// y gastos fijos (recordatorios mensuales).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function texto(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
}

function motivoValido(v: unknown, max = 500): string {
  const t = texto(v);
  if (t.length < 5 || t.length > max)
    throw new BadRequestException(`Escriba el motivo (5 a ${max} caracteres)`);
  return t;
}

@Injectable()
export class CxpService {
  constructor(private readonly db: DatabaseService) {}

  private async proveedor(c: Pick<DatabaseService, 'query'>, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Proveedor no encontrado');
    const r = await c.query<{
      id: string;
      nombre: string;
      numero_documento: string | null;
      dias_credito: number | null;
    }>(
      `SELECT id, nombre, numero_documento, dias_credito FROM terceros WHERE id = $1 AND rol = 'proveedor'`,
      [id],
    );
    if (r.rowCount === 0)
      throw new NotFoundException('Proveedor no encontrado');
    return r.rows[0];
  }

  // ---------- Pantalla principal ----------

  async preparar() {
    const [cajas, cuentas, tipos, hoy, dias] = await Promise.all([
      this.db.query(
        `SELECT c.id, c.nombre, s.id AS sesion_id FROM cajas c
         LEFT JOIN caja_sesiones s ON s.caja_id = c.id AND s.estado = 'abierta'
         WHERE c.is_active ORDER BY lower(c.nombre)`,
      ),
      this.db.query(
        `SELECT id, nombre FROM cuentas WHERE is_active AND moneda = 'DOP' ORDER BY lower(nombre)`,
      ),
      this.db.query(
        'SELECT codigo, nombre FROM tipos_gasto WHERE is_active ORDER BY orden',
      ),
      hoyLocal(this.db),
      diasAlerta(this.db),
    ]);
    return {
      cajas: cajas.rows,
      cuentas: cuentas.rows,
      tiposGasto: tipos.rows,
      hoy,
      diasAlerta: dias,
    };
  }

  // Alertas: facturas vencidas y por vencer, y gastos fijos que tocan.
  async alertas() {
    const hoy = await hoyLocal(this.db);
    const dias = await diasAlerta(this.db);
    const facturas = await facturasPendientes(this.db, hoy, dias);
    return {
      hoy,
      dias,
      vencidas: facturas.filter((f) => f.vencida),
      porVencer: facturas.filter((f) => f.por_vencer),
      gastosFijos: await avisosGastosFijos(this.db, hoy, dias),
    };
  }

  // Proveedores a los que se les debe, con su resumen.
  async proveedores() {
    const hoy = await hoyLocal(this.db);
    const dias = await diasAlerta(this.db);
    const facturas = await facturasPendientes(this.db, hoy, dias);
    const por = new Map<
      string,
      {
        id: string;
        nombre: string;
        debe: bigint;
        vencido: bigint;
        por_vencer: bigint;
        facturas: number;
      }
    >();
    for (const f of facturas) {
      const x = por.get(f.proveedor_id) ?? {
        id: f.proveedor_id,
        nombre: f.proveedor,
        debe: 0n,
        vencido: 0n,
        por_vencer: 0n,
        facturas: 0,
      };
      x.debe += centavos(f.saldo);
      if (f.vencida) x.vencido += centavos(f.saldo);
      if (f.por_vencer) x.por_vencer += centavos(f.saldo);
      x.facturas++;
      por.set(f.proveedor_id, x);
    }
    return [...por.values()]
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((x) => ({
        ...x,
        debe: texto2(x.debe),
        vencido: texto2(x.vencido),
        por_vencer: texto2(x.por_vencer),
      }));
  }

  async detalle(proveedorId: string) {
    const prov = await this.proveedor(this.db, proveedorId);
    const hoy = await hoyLocal(this.db);
    const dias = await diasAlerta(this.db);
    const [facturas, pagos] = await Promise.all([
      facturasPendientes(this.db, hoy, dias, proveedorId),
      this.db.query<{ numero: string }>(
        `SELECT p.id, p.numero, to_char(p.fecha, 'YYYY-MM-DD') AS fecha, p.total, p.forma, p.referencia,
                p.estado, p.motivo_anulacion, u.username AS usuario
         FROM cxp_pagos p JOIN usuarios u ON u.id = p.usuario_id
         WHERE p.proveedor_id = $1 ORDER BY p.created_at DESC LIMIT 100`,
        [proveedorId],
      ),
    ]);
    const total = facturas.reduce((a, f) => a + centavos(f.saldo), 0n);
    const vencido = facturas
      .filter((f) => f.vencida)
      .reduce((a, f) => a + centavos(f.saldo), 0n);
    return {
      proveedor: prov,
      hoy,
      facturas,
      totales: { debe: texto2(total), vencido: texto2(vencido) },
      pagos: pagos.rows.map((p) => ({ ...p, codigo: numeroPago(p.numero) })),
    };
  }

  // ---------- Pagar ----------

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
      const s = await c.query<{ id: string; caja: string }>(
        `SELECT s.id, c.nombre AS caja FROM caja_sesiones s JOIN cajas c ON c.id = s.caja_id
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
        nombre: s.rows[0].caja,
      };
    }
    if (forma !== 'banco')
      throw new BadRequestException('Forma de pago: efectivo o banco');
    const id = texto(cuentaId).toLowerCase();
    if (!UUID.test(id)) throw new BadRequestException('Seleccione la cuenta');
    const ct = await c.query<{ nombre: string }>(
      `SELECT nombre FROM cuentas WHERE id = $1 AND is_active AND moneda = 'DOP' FOR UPDATE`,
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

  async pagar(
    actorId: string,
    ip: string | undefined,
    datos: {
      proveedorId?: unknown;
      monto?: unknown;
      forma?: unknown;
      cajaId?: unknown;
      cuentaId?: unknown;
      referencia?: unknown;
      distribucion?: unknown; // [{ compraId, monto }] si se eligen las facturas
    },
  ) {
    const proveedorId = texto(datos.proveedorId).toLowerCase();
    const monto = normalizarMonto(datos.monto);
    if (monto === null || monto === '0.00')
      throw new BadRequestException(
        'Monto inválido: mayor que 0, con hasta 2 decimales',
      );
    const forma = texto(datos.forma);
    if (forma !== 'efectivo' && forma !== 'banco')
      throw new BadRequestException('Forma de pago: efectivo o banco');
    const referencia = texto(datos.referencia).slice(0, 60) || null;
    const manual =
      Array.isArray(datos.distribucion) && datos.distribucion.length > 0;

    return this.db.transaccion(async (c) => {
      const prov = await this.proveedor(c, proveedorId);
      // Se bloquean las facturas del proveedor: dos pagos a la vez no se cruzan.
      await c.query(
        `SELECT id FROM compras WHERE proveedor_id = $1 AND estado = 'registrada' ORDER BY id FOR UPDATE`,
        [proveedorId],
      );
      const hoy = await hoyLocal(c);
      const facturas = await facturasPendientes(c, hoy, 0, proveedorId);
      const deuda = facturas.reduce((a, f) => a + centavos(f.saldo), 0n);
      if (deuda === 0n)
        throw new BadRequestException('No se le debe nada a este proveedor');
      if (centavos(monto) > deuda)
        throw new BadRequestException(
          `El pago pasa de lo que se le debe: RD$${texto2(deuda)}`,
        );

      // Cuánto va a cada factura: la más vieja primero, o como se eligió.
      let partes: { compraId: string; monto: bigint }[];
      if (manual) {
        partes = (
          datos.distribucion as { compraId?: unknown; monto?: unknown }[]
        )
          .map((x) => {
            const m = normalizarMonto(x?.monto);
            if (m === null)
              throw new BadRequestException('Monto inválido en el reparto');
            return {
              compraId: texto(x?.compraId).toLowerCase(),
              monto: centavos(m),
            };
          })
          .filter((x) => x.monto > 0n);
        if (new Set(partes.map((x) => x.compraId)).size !== partes.length)
          throw new BadRequestException(
            'Una factura aparece dos veces en el reparto',
          );
        const suma = partes.reduce((a, x) => a + x.monto, 0n);
        if (suma !== centavos(monto))
          throw new BadRequestException(
            `Lo repartido (RD$${texto2(suma)}) no es igual al pago (RD$${monto})`,
          );
      } else {
        let resto = centavos(monto);
        partes = [];
        for (const f of facturas) {
          if (resto === 0n) break;
          const debe = centavos(f.saldo);
          const m = resto < debe ? resto : debe;
          partes.push({ compraId: f.id, monto: m });
          resto -= m;
        }
      }
      const aplicadas = partes.map((x) => {
        // Solo facturas registradas de este proveedor y sin pagar de más.
        const f = facturas.find((y) => y.id === x.compraId);
        if (!f)
          throw new BadRequestException(
            'Una de las facturas no es de este proveedor o ya está pagada',
          );
        if (x.monto > centavos(f.saldo))
          throw new BadRequestException(
            `A ${f.codigo} se le asigna más de su saldo (RD$${f.saldo})`,
          );
        return { f, monto: x.monto };
      });

      const dest = await this.origen(
        c,
        forma,
        datos.cajaId,
        datos.cuentaId,
        centavos(monto),
      );
      const n = (
        await c.query<{ valor: string }>(
          `UPDATE contadores SET valor = valor + 1 WHERE clave = 'cxp_pagos' RETURNING valor`,
        )
      ).rows[0].valor;
      const r = await c.query<{ id: string }>(
        `INSERT INTO cxp_pagos (numero, proveedor_id, total, forma, referencia, fecha, usuario_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [n, proveedorId, monto, forma, referencia, hoy, actorId],
      );
      const pagoId = r.rows[0].id;
      const codigo = numeroPago(n);
      for (const a of aplicadas) {
        const parte = texto2(a.monto);
        const cp = await c.query<{ id: string }>(
          `INSERT INTO compra_pagos (compra_id, monto, forma, fecha, referencia, usuario_id, pago_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [a.f.id, parte, forma, hoy, referencia, actorId, pagoId],
        );
        if (dest.tipo === 'caja')
          await c.query(
            `INSERT INTO caja_movimientos (sesion_id, tipo, monto, compra_pago_id, comprobante, usuario_id)
             VALUES ($1, 'compra', $2, $3, $4, $5)`,
            [dest.id, parte, cp.rows[0].id, a.f.ncf ?? a.f.codigo, actorId],
          );
        else
          await c.query(
            `INSERT INTO cuenta_movimientos
               (cuenta_id, tipo, signo, monto, tasa, monto_dop, fecha, beneficiario, comprobante, referencia,
                compra_pago_id, usuario_id)
             VALUES ($1, 'compra', -1, $2, 1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              dest.id,
              parte,
              hoy,
              prov.nombre.slice(0, 120),
              a.f.ncf ?? a.f.codigo,
              referencia,
              cp.rows[0].id,
              actorId,
            ],
          );
      }
      await contabilizar(c, 'cxp_pago', pagoId, actorId);
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'cxp.pago',
        entidad: 'cxp_pagos',
        entidadId: pagoId,
        nuevo: {
          pago: codigo,
          proveedor: prov.nombre,
          total: monto,
          forma,
          origen: dest.nombre,
          aplicado: aplicadas.map((a) => `${a.f.codigo}: ${texto2(a.monto)}`),
          reparto: manual ? 'elegido' : 'automático (lo más viejo primero)',
        },
        ip,
      });
      return {
        id: pagoId,
        codigo,
        aplicado: aplicadas.map((a) => ({
          factura: a.f.codigo,
          ncf: a.f.ncf,
          monto: texto2(a.monto),
        })),
        debiaAntes: texto2(deuda),
        debeAhora: texto2(deuda - centavos(monto)),
      };
    });
  }

  async anularPago(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: { motivo?: unknown; cajaId?: unknown },
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Pago no encontrado');
    const motivo = motivoValido(datos.motivo);
    return this.db.transaccion(async (c) => {
      const r = await c.query<{
        numero: string;
        estado: string;
        total: string;
        forma: string;
        proveedor: string;
      }>(
        `SELECT p.numero, p.estado, p.total, p.forma, t.nombre AS proveedor
         FROM cxp_pagos p JOIN terceros t ON t.id = p.proveedor_id WHERE p.id = $1 FOR UPDATE OF p`,
        [id],
      );
      if (r.rowCount === 0) throw new NotFoundException('Pago no encontrado');
      const p = r.rows[0];
      if (p.estado === 'anulado')
        throw new BadRequestException('El pago ya está anulado');
      const codigo = numeroPago(p.numero);
      const hoy = await hoyLocal(c);
      const partes = await c.query<{
        id: string;
        monto: string;
        cuenta_mov: string | null;
        cuenta_id: string | null;
      }>(
        `SELECT cp.id, cp.monto, km.id::text AS cuenta_mov, km.cuenta_id
         FROM compra_pagos cp
         LEFT JOIN cuenta_movimientos km ON km.compra_pago_id = cp.id AND km.tipo = 'compra'
         WHERE cp.pago_id = $1 ORDER BY cp.created_at`,
        [id],
      );
      let sesion: { id: string; caja: string } | null = null;
      if (p.forma === 'efectivo') {
        const cajaId = texto(datos.cajaId).toLowerCase();
        if (!UUID.test(cajaId))
          throw new BadRequestException(
            'Se pagó en efectivo: elija la caja (abierta) donde vuelve el dinero',
          );
        const s = await c.query<{ id: string; caja: string }>(
          `SELECT s.id, c.nombre AS caja FROM caja_sesiones s JOIN cajas c ON c.id = s.caja_id
           WHERE s.caja_id = $1 AND s.estado = 'abierta' FOR UPDATE OF s`,
          [cajaId],
        );
        if (s.rowCount === 0)
          throw new BadRequestException('La caja no está abierta');
        sesion = s.rows[0];
      }
      // Una devolución por cada parte, enlazada a su parte.
      for (const x of partes.rows) {
        if (sesion)
          await c.query(
            `INSERT INTO caja_movimientos (sesion_id, tipo, monto, compra_pago_id, motivo, usuario_id)
             VALUES ($1, 'compra_reverso', $2, $3, $4, $5)`,
            [
              sesion.id,
              x.monto,
              x.id,
              `Anulación de ${codigo}: ${motivo}`,
              actorId,
            ],
          );
        else {
          if (!x.cuenta_mov || !x.cuenta_id)
            throw new BadRequestException(
              'No se encontró el movimiento de la cuenta de este pago',
            );
          await c.query('SELECT id FROM cuentas WHERE id = $1 FOR UPDATE', [
            x.cuenta_id,
          ]);
          await c.query(
            `INSERT INTO cuenta_movimientos
               (cuenta_id, tipo, signo, monto, tasa, monto_dop, fecha, motivo, reverso_de, compra_pago_id, usuario_id)
             VALUES ($1, 'reverso', 1, $2, 1, $2, $3, $4, $5, $6, $7)`,
            [
              x.cuenta_id,
              x.monto,
              hoy,
              `Anulación de ${codigo}: ${motivo}`,
              x.cuenta_mov,
              x.id,
              actorId,
            ],
          );
        }
      }
      await c.query(
        `UPDATE cxp_pagos SET estado = 'anulado', anulado_por = $2, anulado_en = now(), motivo_anulacion = $3
         WHERE id = $1`,
        [id, actorId, motivo],
      );
      await revertir(c, 'cxp_pago', id, motivo, actorId);
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'cxp.anular_pago',
        entidad: 'cxp_pagos',
        entidadId: id,
        anterior: {
          pago: codigo,
          proveedor: p.proveedor,
          total: p.total,
          estado: 'activo',
        },
        nuevo: {
          estado: 'anulado',
          partes: partes.rowCount,
          devuelto_a: sesion ? sesion.caja : 'cuenta',
        },
        motivo,
        ip,
      });
      return { ok: true };
    });
  }

  // ---------- Comprobante del pago ----------

  private async comprobanteFilas(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Pago no encontrado');
    const r = await this.db.query<{
      numero: string;
      fecha: string;
      total: string;
      forma: string;
      referencia: string | null;
      estado: string;
      proveedor: string;
      documento: string | null;
      usuario: string;
    }>(
      `SELECT p.numero, to_char(p.fecha, 'DD/MM/YYYY') AS fecha, p.total, p.forma, p.referencia, p.estado,
              t.nombre AS proveedor, t.numero_documento AS documento, u.username AS usuario
       FROM cxp_pagos p JOIN terceros t ON t.id = p.proveedor_id JOIN usuarios u ON u.id = p.usuario_id
       WHERE p.id = $1`,
      [id],
    );
    if (r.rowCount === 0) throw new NotFoundException('Pago no encontrado');
    const x = r.rows[0];
    const partes = await this.db.query<{
      numero: string;
      ncf: string | null;
      monto: string;
    }>(
      `SELECT c.numero, c.ncf, cp.monto FROM compra_pagos cp JOIN compras c ON c.id = cp.compra_id
       WHERE cp.pago_id = $1 ORDER BY cp.created_at`,
      [id],
    );
    const codigo = numeroPago(x.numero);
    const filas: ElementoTicket[] = [
      {
        tipo: 'titulo',
        texto:
          x.estado === 'anulado'
            ? 'PAGO A PROVEEDOR (ANULADO)'
            : 'PAGO A PROVEEDOR',
      },
      { tipo: 'fila', izq: 'Comprobante:', der: codigo, negrita: true },
      { tipo: 'fila', izq: 'Fecha:', der: x.fecha },
      { tipo: 'fila', izq: 'Proveedor:', der: x.proveedor, negrita: true },
      ...(x.documento
        ? [{ tipo: 'fila' as const, izq: 'RNC/Cédula:', der: x.documento }]
        : []),
      { tipo: 'linea' },
      ...partes.rows.map((p): ElementoTicket => ({
        tipo: 'fila',
        izq: `CP-${String(p.numero).padStart(6, '0')}${p.ncf ? ` · ${p.ncf}` : ''}`,
        der: dinero(p.monto),
      })),
      { tipo: 'linea' },
      {
        tipo: 'fila',
        izq: 'TOTAL PAGADO:',
        der: dinero(x.total),
        negrita: true,
        grande: true,
      },
      {
        tipo: 'fila',
        izq: 'Forma:',
        der:
          x.forma === 'efectivo'
            ? 'Efectivo'
            : `Banco${x.referencia ? ` ${x.referencia}` : ''}`,
      },
      { tipo: 'fila', izq: 'Registró:', der: x.usuario },
      { tipo: 'firma', texto: 'Recibí conforme (proveedor)' },
    ];
    return { filas, codigo };
  }

  private async empresa() {
    return (
      await this.db.query<{
        nombre_comercial: string;
        rnc: string | null;
        telefono: string | null;
      }>('SELECT nombre_comercial, rnc, telefono FROM empresa WHERE id = 1')
    ).rows[0];
  }

  async comprobanteTicket(id: string): Promise<Ticket> {
    const { filas, codigo } = await this.comprobanteFilas(id);
    return {
      documento: codigo,
      encabezado: encabezado(await this.empresa()),
      elementos: filas,
    };
  }

  async comprobantePdf(id: string, formato: unknown) {
    const f = texto(formato) || '80';
    if (f !== '80' && f !== '58' && f !== 'carta')
      throw new BadRequestException('Formato inválido: use 80, 58 o carta');
    const { filas, codigo } = await this.comprobanteFilas(id);
    const pdf = await generarReciboSan(
      { empresa: await this.empresa(), filas },
      f as Formato,
      'Pago a proveedor',
    );
    return { pdf, nombre: `${codigo}.pdf` };
  }

  // ---------- Gastos fijos ----------

  // Proveedores activos para elegir en un gasto fijo.
  async buscarProveedores(textoBuscado: unknown) {
    const t = texto(textoBuscado).slice(0, 60);
    if (t.length < 2) return [];
    const r = await this.db.query(
      `SELECT id, nombre, numero_documento FROM terceros
       WHERE rol = 'proveedor' AND is_active
         AND (nombre ILIKE '%' || $1 || '%' OR nombre_comercial ILIKE '%' || $1 || '%'
              OR numero_documento ILIKE '%' || $1 || '%')
       ORDER BY lower(nombre) LIMIT 20`,
      [t],
    );
    return r.rows;
  }

  async gastosFijos() {
    const r = await this.db.query(
      `SELECT g.id, g.nombre, g.proveedor_id, t.nombre AS proveedor, g.tipo_gasto, tg.nombre AS tipo_gasto_nombre,
              g.dia_mes, g.monto, g.itbis, g.notas, g.is_active
       FROM gastos_fijos g JOIN terceros t ON t.id = g.proveedor_id JOIN tipos_gasto tg ON tg.codigo = g.tipo_gasto
       ORDER BY g.is_active DESC, g.dia_mes, lower(g.nombre)`,
    );
    return r.rows;
  }

  private leerGasto(d: Record<string, unknown>) {
    const nombre = texto(d.nombre);
    if (nombre.length < 2 || nombre.length > 100)
      throw new BadRequestException(
        'Nombre: de 2 a 100 caracteres (ej.: Alquiler del local)',
      );
    const proveedorId = texto(d.proveedorId).toLowerCase();
    if (!UUID.test(proveedorId))
      throw new BadRequestException('Seleccione el proveedor');
    const tipoGasto = texto(d.tipoGasto);
    if (!/^\d{2}$/.test(tipoGasto))
      throw new BadRequestException('Seleccione el tipo de gasto');
    const dia = Number(texto(d.diaMes));
    if (!Number.isInteger(dia) || dia < 1 || dia > 31)
      throw new BadRequestException(
        'Día del mes: de 1 a 31 (si el mes es más corto, se usa su último día)',
      );
    const monto = texto(d.monto) ? normalizarMonto(d.monto) : null;
    if (texto(d.monto) && (monto === null || monto === '0.00'))
      throw new BadRequestException(
        'Monto inválido: mayor que 0, o déjelo vacío si cambia cada mes',
      );
    const itbis = texto(d.itbis) ? normalizarMonto(d.itbis) : null;
    if (texto(d.itbis) && itbis === null)
      throw new BadRequestException('ITBIS inválido');
    if (itbis !== null && monto === null)
      throw new BadRequestException('Si pone el ITBIS, ponga también el monto');
    const notas = texto(d.notas).slice(0, 300) || null;
    return {
      nombre,
      proveedorId,
      tipoGasto,
      dia,
      monto,
      itbis,
      notas,
      activo: d.activo !== false,
    };
  }

  async guardarGastoFijo(
    actorId: string,
    id: string | null,
    ip: string | undefined,
    datos: Record<string, unknown>,
  ) {
    const g = this.leerGasto(datos);
    return this.db.transaccion(async (c) => {
      const prov = await this.proveedor(c, g.proveedorId);
      const tg = await c.query(
        'SELECT 1 FROM tipos_gasto WHERE codigo = $1 AND is_active',
        [g.tipoGasto],
      );
      if (tg.rowCount === 0)
        throw new BadRequestException('Tipo de gasto inválido');
      let gid = id;
      let antes: unknown;
      if (id) {
        if (!UUID.test(id))
          throw new NotFoundException('Gasto fijo no encontrado');
        const a = await c.query(
          'SELECT * FROM gastos_fijos WHERE id = $1 FOR UPDATE',
          [id],
        );
        if (a.rowCount === 0)
          throw new NotFoundException('Gasto fijo no encontrado');
        antes = a.rows[0];
        await c.query(
          `UPDATE gastos_fijos SET nombre = $2, proveedor_id = $3, tipo_gasto = $4, dia_mes = $5, monto = $6,
                  itbis = $7, notas = $8, is_active = $9, updated_by = $10, updated_at = now() WHERE id = $1`,
          [
            id,
            g.nombre,
            g.proveedorId,
            g.tipoGasto,
            g.dia,
            g.monto,
            g.itbis,
            g.notas,
            g.activo,
            actorId,
          ],
        );
      } else {
        const r = await c.query<{ id: string }>(
          `INSERT INTO gastos_fijos (nombre, proveedor_id, tipo_gasto, dia_mes, monto, itbis, notas, is_active, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            g.nombre,
            g.proveedorId,
            g.tipoGasto,
            g.dia,
            g.monto,
            g.itbis,
            g.notas,
            g.activo,
            actorId,
          ],
        );
        gid = r.rows[0].id;
      }
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: id ? 'cxp.gasto_fijo_editar' : 'cxp.gasto_fijo_crear',
        entidad: 'gastos_fijos',
        entidadId: gid ?? undefined,
        anterior: antes,
        nuevo: { ...g, proveedor: prov.nombre },
        ip,
      });
      return { id: gid };
    });
  }

  async configurarDias(
    actorId: string,
    ip: string | undefined,
    datos: { dias?: unknown },
  ) {
    const n = Number(texto(datos.dias));
    if (!Number.isInteger(n) || n < 0 || n > 60)
      throw new BadRequestException('Días de aviso: de 0 a 60');
    return this.db.transaccion(async (c) => {
      const antes = await diasAlerta(c);
      await c.query(
        `UPDATE configuracion SET valor = $1, updated_by = $2, updated_at = now() WHERE clave = 'cxp.dias_alerta'`,
        [String(n), actorId],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'cxp.dias_alerta',
        entidad: 'configuracion',
        anterior: { dias: antes },
        nuevo: { dias: n },
        ip,
      });
      return { ok: true };
    });
  }
}
