import { contabilizar, revertir } from '../contabilidad/motor';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { registrarAuditoria } from '../auditoria/auditoria';
import { encabezado } from '../comun/ticket';
import type { ElementoTicket, Ticket } from '../comun/ticket';
import { SQL_ESPERADO } from '../caja/sql';
import { DatabaseService } from '../database/database.service';
import { centavos, fechaValida, texto2 } from '../sanes/calendario';
import { generarReciboSan } from '../sanes/recibo-san-pdf';
import { normalizarMonto } from '../servicios/calculo-itbis';
import { dinero } from '../ventas/recibo-pdf';
import type { Formato } from '../ventas/recibo-pdf';
import { estadoCliente, hoyLocal, numeroAbono, tasasRecargo } from './estado';

// Cuentas por Cobrar: crédito de cada cliente, abonos con recibo (se aplican
// a lo más viejo, primero el recargo, o como diga el cajero), perdón de
// recargos, anulación de abonos y el % de recargo con fecha de vigencia.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function texto(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
}

function motivoValido(v: unknown, max = 300): string {
  const t = texto(v);
  if (t.length < 5 || t.length > max)
    throw new BadRequestException(`Escriba el motivo (5 a ${max} caracteres)`);
  return t;
}

@Injectable()
export class CxcService {
  constructor(private readonly db: DatabaseService) {}

  private async cliente(c: Pick<DatabaseService, 'query'>, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Cliente no encontrado');
    const r = await c.query<{
      id: string;
      nombre: string;
      numero_documento: string | null;
      telefono: string | null;
      es_protegido: boolean;
    }>(
      `SELECT id, nombre, numero_documento, telefono, es_protegido FROM terceros
       WHERE id = $1 AND rol = 'cliente'`,
      [id],
    );
    if (r.rowCount === 0) throw new NotFoundException('Cliente no encontrado');
    return r.rows[0];
  }

  // ---------- Datos para la pantalla ----------

  async preparar() {
    const [cajas, cuentas, tasas, hoy] = await Promise.all([
      this.db.query(
        `SELECT c.id, c.nombre, s.id AS sesion_id FROM cajas c
         LEFT JOIN caja_sesiones s ON s.caja_id = c.id AND s.estado = 'abierta'
         WHERE c.is_active ORDER BY lower(c.nombre)`,
      ),
      this.db.query(
        `SELECT id, nombre FROM cuentas WHERE is_active AND moneda = 'DOP' ORDER BY lower(nombre)`,
      ),
      this.db.query(
        `SELECT to_char(vigente_desde, 'YYYY-MM-DD') AS desde, porcentaje, created_at
         FROM cxc_tasas_recargo ORDER BY vigente_desde DESC`,
      ),
      hoyLocal(this.db),
    ]);
    const vigente = (
      tasas.rows as { desde: string; porcentaje: string }[]
    ).find((t) => t.desde <= hoy);
    return {
      cajas: cajas.rows,
      cuentas: cuentas.rows,
      tasas: tasas.rows,
      recargoVigente: vigente?.porcentaje ?? '0.00',
      hoy,
    };
  }

  // Clientes con crédito o con deuda, con su resumen.
  async listar(f: { texto?: string; solo?: string }) {
    const t = texto(f.texto);
    const r = await this.db.query<{
      id: string;
      codigo: string | null;
      nombre: string;
      numero_documento: string | null;
      telefono: string | null;
    }>(
      `SELECT t.id, t.codigo, t.nombre, t.numero_documento, t.telefono FROM terceros t
       WHERE t.rol = 'cliente'
         AND (EXISTS (SELECT 1 FROM clientes_credito cc WHERE cc.tercero_id = t.id)
              OR EXISTS (SELECT 1 FROM cuentas_cobrar k WHERE k.cliente_id = t.id AND k.estado = 'activa'))
         AND ($1 = '' OR t.nombre ILIKE '%' || $1 || '%' OR t.numero_documento ILIKE '%' || $1 || '%'
              OR t.codigo ILIKE '%' || $1 || '%')
       ORDER BY lower(t.nombre) LIMIT 300`,
      [t.slice(0, 60)],
    );
    const hoy = await hoyLocal(this.db);
    const tasas = await tasasRecargo(this.db);
    const filas = [];
    for (const x of r.rows) {
      const e = await estadoCliente(this.db, x.id, hoy, tasas);
      if (f.solo === 'deudores' && e.totales.total === '0.00') continue;
      if (f.solo === 'vencidos' && e.totales.cuentas_vencidas === 0) continue;
      filas.push({
        ...x,
        limite: e.credito?.limite ?? null,
        plazo_dias: e.credito?.plazo_dias ?? null,
        credito_activo: e.credito?.is_active ?? false,
        ...e.totales,
        disponible: e.disponible,
      });
    }
    return { filas, hoy };
  }

  // Buscar cualquier cliente activo (para darle crédito).
  async buscarClientes(textoBuscado: unknown) {
    const t = texto(textoBuscado);
    if (t.length < 2) return [];
    const r = await this.db.query(
      `SELECT id, codigo, nombre, numero_documento, telefono FROM terceros
       WHERE rol = 'cliente' AND is_active AND NOT es_protegido
         AND (nombre ILIKE '%' || $1 || '%' OR numero_documento ILIKE '%' || $1 || '%' OR telefono ILIKE '%' || $1 || '%'
              OR codigo ILIKE '%' || $1 || '%')
       ORDER BY lower(nombre) LIMIT 20`,
      [t.slice(0, 60)],
    );
    return r.rows;
  }

  // Estado completo de un cliente.
  async detalle(id: string) {
    const cli = await this.cliente(this.db, id);
    const hoy = await hoyLocal(this.db);
    const [estado, abonos, autorizacion] = await Promise.all([
      estadoCliente(this.db, id, hoy),
      this.db.query<{ numero: string }>(
        `SELECT b.id, b.numero, to_char(b.fecha, 'YYYY-MM-DD') AS fecha, b.total, b.forma, b.referencia,
                b.estado, b.motivo_anulacion, u.username AS usuario
         FROM cxc_abonos b JOIN usuarios u ON u.id = b.usuario_id
         WHERE b.cliente_id = $1 ORDER BY b.created_at DESC LIMIT 100`,
        [id],
      ),
      this.db.query(
        `SELECT a.motivo, u.username AS por FROM cxc_autorizaciones a JOIN usuarios u ON u.id = a.autorizado_por
         WHERE a.cliente_id = $1 AND a.tipo = 'previa' AND a.usada_venta_id IS NULL AND a.valida_hasta >= $2::date
         ORDER BY a.created_at DESC LIMIT 1`,
        [id, hoy],
      ),
    ]);
    return {
      cliente: cli,
      hoy,
      ...estado,
      abonos: abonos.rows.map((b) => ({ ...b, codigo: numeroAbono(b.numero) })),
      autorizacionHoy: autorizacion.rows[0] ?? null,
    };
  }

  // Lo que necesita la pantalla de Ventas para vender a crédito.
  async resumenVenta(id: string) {
    const d = await this.detalle(id);
    return {
      credito: d.credito,
      disponible: d.disponible,
      totales: d.totales,
      autorizacionHoy: d.autorizacionHoy,
    };
  }

  // ---------- Crédito del cliente ----------

  async configurarCliente(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: {
      limite?: unknown;
      plazoDias?: unknown;
      activo?: unknown;
      notas?: unknown;
    },
  ) {
    const limite = normalizarMonto(datos.limite);
    if (limite === null || limite === '0.00')
      throw new BadRequestException(
        'Límite inválido: mayor que 0, con hasta 2 decimales',
      );
    const plazo = Number(texto(datos.plazoDias));
    if (!Number.isInteger(plazo) || plazo < 1 || plazo > 365)
      throw new BadRequestException('Plazo inválido: de 1 a 365 días');
    const activo = datos.activo !== false;
    const notas = texto(datos.notas).slice(0, 300) || null;
    return this.db.transaccion(async (c) => {
      const cli = await this.cliente(c, id);
      if (cli.es_protegido)
        throw new BadRequestException(
          'A "Consumidor final" no se le da crédito',
        );
      const antes = await c.query(
        'SELECT limite, plazo_dias, is_active FROM clientes_credito WHERE tercero_id = $1 FOR UPDATE',
        [id],
      );
      if (antes.rowCount === 0)
        await c.query(
          `INSERT INTO clientes_credito (tercero_id, limite, plazo_dias, is_active, notas, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, limite, plazo, activo, notas, actorId],
        );
      else
        await c.query(
          `UPDATE clientes_credito SET limite = $2, plazo_dias = $3, is_active = $4, notas = $5,
                  updated_by = $6, updated_at = now() WHERE tercero_id = $1`,
          [id, limite, plazo, activo, notas, actorId],
        );
      await c.query(
        'UPDATE terceros SET puede_credito = $2, updated_at = now() WHERE id = $1',
        [id, activo],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'cxc.credito_cliente',
        entidad: 'clientes_credito',
        entidadId: id,
        anterior: antes.rows[0] ?? undefined,
        nuevo: { cliente: cli.nombre, limite, plazo_dias: plazo, activo },
        ip,
      });
      return { ok: true };
    });
  }

  async autorizarPrevia(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: { motivo?: unknown },
  ) {
    const motivo = motivoValido(datos.motivo);
    return this.db.transaccion(async (c) => {
      const cli = await this.cliente(c, id);
      const hoy = await hoyLocal(c);
      const r = await c.query<{ id: string }>(
        `INSERT INTO cxc_autorizaciones (cliente_id, tipo, motivo, valida_hasta, autorizado_por)
         VALUES ($1, 'previa', $2, $3, $4) RETURNING id`,
        [id, motivo, hoy, actorId],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'cxc.autorizar_previa',
        entidad: 'cxc_autorizaciones',
        entidadId: r.rows[0].id,
        nuevo: { cliente: cli.nombre, valida_hasta: hoy },
        motivo,
        ip,
      });
      return { ok: true, validaHasta: hoy };
    });
  }

  // ---------- Recargo ----------

  async nuevaTasa(
    actorId: string,
    ip: string | undefined,
    datos: { porcentaje?: unknown; vigenteDesde?: unknown },
  ) {
    const pct = texto(datos.porcentaje);
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(pct) || Number(pct) > 100)
      throw new BadRequestException('Porcentaje inválido: de 0 a 100');
    const desde = texto(datos.vigenteDesde);
    if (!fechaValida(desde)) throw new BadRequestException('Fecha inválida');
    return this.db.transaccion(async (c) => {
      const hoy = await hoyLocal(c);
      // No se cambia el pasado: lo ya cobrado o calculado no se mueve.
      if (desde < hoy)
        throw new BadRequestException(
          'La nueva tasa debe empezar hoy o después',
        );
      try {
        await c.query(
          'INSERT INTO cxc_tasas_recargo (porcentaje, vigente_desde, created_by) VALUES ($1, $2, $3)',
          [pct, desde, actorId],
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          throw new BadRequestException('Ya hay una tasa que empieza ese día');
        throw e;
      }
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'cxc.tasa_recargo',
        entidad: 'cxc_tasas_recargo',
        nuevo: { porcentaje: pct, vigente_desde: desde },
        ip,
      });
      return { ok: true };
    });
  }

  async perdonar(
    actorId: string,
    cuentaId: string,
    ip: string | undefined,
    datos: { monto?: unknown; motivo?: unknown },
  ) {
    if (!UUID.test(cuentaId))
      throw new NotFoundException('Cuenta no encontrada');
    const motivo = motivoValido(datos.motivo);
    return this.db.transaccion(async (c) => {
      const k = await c.query<{ cliente_id: string }>(
        `SELECT cliente_id FROM cuentas_cobrar WHERE id = $1 AND estado = 'activa' FOR UPDATE`,
        [cuentaId],
      );
      if (k.rowCount === 0) throw new NotFoundException('Cuenta no encontrada');
      const est = await estadoCliente(
        c,
        k.rows[0].cliente_id,
        await hoyLocal(c),
      );
      const cta = est.cuentas.find((x) => x.id === cuentaId);
      if (!cta || cta.recargo_pendiente === '0.00')
        throw new BadRequestException(
          'Esta factura no tiene recargo pendiente',
        );
      const monto = texto(datos.monto)
        ? normalizarMonto(datos.monto)
        : cta.recargo_pendiente;
      if (
        monto === null ||
        monto === '0.00' ||
        centavos(monto) > centavos(cta.recargo_pendiente)
      )
        throw new BadRequestException(
          `Monto inválido: hasta RD$${cta.recargo_pendiente} de recargo pendiente`,
        );
      await c.query(
        'INSERT INTO cxc_perdones (cuenta_id, monto, motivo, usuario_id) VALUES ($1, $2, $3, $4)',
        [cuentaId, monto, motivo, actorId],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'cxc.perdonar_recargo',
        entidad: 'cuentas_cobrar',
        entidadId: cuentaId,
        nuevo: {
          venta: cta.venta,
          perdonado: monto,
          quedaba: cta.recargo_pendiente,
        },
        motivo,
        ip,
      });
      return { ok: true, perdonado: monto };
    });
  }

  // ---------- Abonos ----------

  private async destino(
    c: PoolClient,
    forma: string,
    cajaId: unknown,
    cuentaId: unknown,
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
      return {
        tipo: 'caja' as const,
        id: s.rows[0].id,
        nombre: s.rows[0].caja,
      };
    }
    if (forma !== 'transferencia')
      throw new BadRequestException('Forma inválida: efectivo o transferencia');
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
    return { tipo: 'cuenta' as const, id, nombre: ct.rows[0].nombre };
  }

  async abonar(
    actorId: string,
    ip: string | undefined,
    datos: {
      clienteId?: unknown;
      monto?: unknown;
      forma?: unknown;
      cajaId?: unknown;
      cuentaId?: unknown;
      referencia?: unknown;
      distribucion?: unknown; // [{ cuentaId, monto }] si el cliente elige qué paga
    },
  ) {
    const clienteId = texto(datos.clienteId).toLowerCase();
    const monto = normalizarMonto(datos.monto);
    if (monto === null || monto === '0.00')
      throw new BadRequestException(
        'Monto inválido: mayor que 0, con hasta 2 decimales',
      );
    const forma = texto(datos.forma);
    const referencia = texto(datos.referencia).slice(0, 60) || null;
    if (forma === 'transferencia' && !referencia)
      throw new BadRequestException(
        'Escriba la referencia de la transferencia',
      );
    const manual =
      Array.isArray(datos.distribucion) && datos.distribucion.length > 0;

    return this.db.transaccion(async (c) => {
      const cli = await this.cliente(c, clienteId);
      // Se bloquean las cuentas del cliente: dos abonos a la vez no se cruzan.
      await c.query(
        `SELECT id FROM cuentas_cobrar WHERE cliente_id = $1 AND estado = 'activa' FOR UPDATE`,
        [clienteId],
      );
      const hoy = await hoyLocal(c);
      const est = await estadoCliente(c, clienteId, hoy);
      if (centavos(est.totales.total) === 0n)
        throw new BadRequestException('Este cliente no debe nada');
      if (centavos(monto) > centavos(est.totales.total))
        throw new BadRequestException(
          `El abono pasa de lo que debe: debe RD$${est.totales.total}`,
        );

      // Cuánto va a cada factura (recargo primero, después capital).
      let porCuenta: { cuentaId: string; monto: bigint }[];
      if (manual) {
        porCuenta = (
          datos.distribucion as { cuentaId?: unknown; monto?: unknown }[]
        )
          .map((x) => {
            const m = normalizarMonto(x?.monto);
            if (m === null)
              throw new BadRequestException(
                'Monto inválido en la distribución',
              );
            return {
              cuentaId: texto(x?.cuentaId).toLowerCase(),
              monto: centavos(m),
            };
          })
          .filter((x) => x.monto > 0n);
        const suma = porCuenta.reduce((a, x) => a + x.monto, 0n);
        if (suma !== centavos(monto))
          throw new BadRequestException(
            `Lo repartido (RD$${texto2(suma)}) no es igual al abono (RD$${monto})`,
          );
      } else {
        let resto = centavos(monto);
        porCuenta = [];
        for (const k of est.cuentas) {
          if (resto === 0n) break;
          const debe = centavos(k.total_pendiente);
          if (debe === 0n) continue;
          const m = resto < debe ? resto : debe;
          porCuenta.push({ cuentaId: k.id, monto: m });
          resto -= m;
        }
      }
      const aplicaciones = porCuenta.map((x) => {
        const k = est.cuentas.find((y) => y.id === x.cuentaId);
        if (!k)
          throw new BadRequestException(
            'Una de las facturas no es de este cliente',
          );
        if (x.monto > centavos(k.total_pendiente))
          throw new BadRequestException(
            `A ${k.venta} se le asigna más de lo que debe (RD$${k.total_pendiente})`,
          );
        const rec = centavos(k.recargo_pendiente);
        const aRecargo = x.monto < rec ? x.monto : rec;
        return { k, recargo: aRecargo, capital: x.monto - aRecargo };
      });

      const dest = await this.destino(c, forma, datos.cajaId, datos.cuentaId);
      const n = (
        await c.query<{ valor: string }>(
          `UPDATE contadores SET valor = valor + 1 WHERE clave = 'cxc_abonos' RETURNING valor`,
        )
      ).rows[0].valor;
      const r = await c.query<{ id: string }>(
        `INSERT INTO cxc_abonos (numero, cliente_id, total, forma, referencia, fecha, usuario_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [n, clienteId, monto, forma, referencia, hoy, actorId],
      );
      const abonoId = r.rows[0].id;
      for (const a of aplicaciones)
        await c.query(
          `INSERT INTO cxc_aplicaciones (abono_id, cuenta_id, recargo, capital) VALUES ($1, $2, $3, $4)`,
          [abonoId, a.k.id, texto2(a.recargo), texto2(a.capital)],
        );
      if (dest.tipo === 'caja')
        await c.query(
          `INSERT INTO caja_movimientos (sesion_id, tipo, monto, cxc_abono_id, usuario_id)
           VALUES ($1, 'abono_credito', $2, $3, $4)`,
          [dest.id, monto, abonoId, actorId],
        );
      else
        await c.query(
          `INSERT INTO cuenta_movimientos
             (cuenta_id, tipo, signo, monto, tasa, monto_dop, fecha, por_confirmar, referencia, cxc_abono_id, usuario_id)
           VALUES ($1, 'abono_credito', 1, $2, 1, $2, $3, true, $4, $5, $6)`,
          [dest.id, monto, hoy, referencia, abonoId, actorId],
        );
      const codigo = numeroAbono(n);
      await contabilizar(c, 'cxc_abono', abonoId, actorId);
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'cxc.abono',
        entidad: 'cxc_abonos',
        entidadId: abonoId,
        nuevo: {
          recibo: codigo,
          cliente: cli.nombre,
          monto,
          forma,
          destino: dest.nombre,
          aplicado: aplicaciones.map(
            (a) =>
              `${a.k.venta}: recargo ${texto2(a.recargo)}, capital ${texto2(a.capital)}`,
          ),
          reparto: manual ? 'elegido' : 'automático (lo más viejo primero)',
        },
        ip,
      });
      return {
        id: abonoId,
        codigo,
        aplicado: aplicaciones.map((a) => ({
          venta: a.k.venta,
          recargo: texto2(a.recargo),
          capital: texto2(a.capital),
        })),
        debiaAntes: est.totales.total,
        debeAhora: texto2(centavos(est.totales.total) - centavos(monto)),
      };
    });
  }

  async anularAbono(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: { motivo?: unknown; cajaId?: unknown },
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Abono no encontrado');
    const motivo = motivoValido(datos.motivo, 500);
    return this.db.transaccion(async (c) => {
      const r = await c.query<{
        numero: string;
        estado: string;
        total: string;
        forma: string;
        cliente: string;
      }>(
        `SELECT b.numero, b.estado, b.total, b.forma, t.nombre AS cliente
         FROM cxc_abonos b JOIN terceros t ON t.id = b.cliente_id WHERE b.id = $1 FOR UPDATE OF b`,
        [id],
      );
      if (r.rowCount === 0) throw new NotFoundException('Abono no encontrado');
      const b = r.rows[0];
      if (b.estado === 'anulado')
        throw new BadRequestException('El abono ya está anulado');
      const codigo = numeroAbono(b.numero);
      let devuelto: string;
      if (b.forma === 'efectivo') {
        const cajaId = texto(datos.cajaId).toLowerCase();
        if (!UUID.test(cajaId))
          throw new BadRequestException(
            'Se pagó en efectivo: elija la caja (abierta) de donde sale la devolución',
          );
        const s = await c.query<{ id: string; caja: string }>(
          `SELECT s.id, c.nombre AS caja FROM caja_sesiones s JOIN cajas c ON c.id = s.caja_id
           WHERE s.caja_id = $1 AND s.estado = 'abierta' FOR UPDATE OF s`,
          [cajaId],
        );
        if (s.rowCount === 0)
          throw new BadRequestException('La caja no está abierta');
        const hay = (
          await c.query<{ esperado: string }>(SQL_ESPERADO, [s.rows[0].id])
        ).rows[0].esperado;
        if (centavos(hay) < centavos(b.total))
          throw new BadRequestException(
            `No hay suficiente efectivo en ${s.rows[0].caja}: hay RD$${hay}`,
          );
        await c.query(
          `INSERT INTO caja_movimientos (sesion_id, tipo, monto, cxc_abono_id, motivo, usuario_id)
           VALUES ($1, 'abono_anulado', $2, $3, $4, $5)`,
          [
            s.rows[0].id,
            b.total,
            id,
            `Anulación de ${codigo}: ${motivo}`,
            actorId,
          ],
        );
        devuelto = s.rows[0].caja;
      } else {
        const m = await c.query<{ id: string; cuenta_id: string }>(
          `SELECT id::text, cuenta_id FROM cuenta_movimientos WHERE cxc_abono_id = $1 AND tipo = 'abono_credito'`,
          [id],
        );
        if (m.rowCount === 0)
          throw new BadRequestException(
            'No se encontró el movimiento de la cuenta',
          );
        await c.query('SELECT id FROM cuentas WHERE id = $1 FOR UPDATE', [
          m.rows[0].cuenta_id,
        ]);
        await c.query(
          `INSERT INTO cuenta_movimientos
             (cuenta_id, tipo, signo, monto, tasa, monto_dop, fecha, motivo, reverso_de, cxc_abono_id, usuario_id)
           VALUES ($1, 'reverso', -1, $2, 1, $2, $3, $4, $5, $6, $7)`,
          [
            m.rows[0].cuenta_id,
            b.total,
            await hoyLocal(c),
            `Anulación de ${codigo}: ${motivo}`,
            m.rows[0].id,
            id,
            actorId,
          ],
        );
        devuelto = 'cuenta';
      }
      await c.query(
        `UPDATE cxc_abonos SET estado = 'anulado', anulado_por = $2, anulado_en = now(), motivo_anulacion = $3
         WHERE id = $1`,
        [id, actorId, motivo],
      );
      await revertir(c, 'cxc_abono', id, motivo, actorId);
      // Si su cobro se había marcado "No llegó", se deshace también eso.
      const noLlegaron = await c.query<{ id: string }>(
        `SELECT cf.id::text AS id FROM cuenta_confirmaciones cf
         JOIN cuenta_movimientos m ON m.id = cf.movimiento_id
         WHERE m.cxc_abono_id = $1 AND cf.resultado = 'no_llego'`,
        [id],
      );
      for (const nl of noLlegaron.rows)
        await revertir(c, 'no_llego', nl.id, motivo, actorId);
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'cxc.anular_abono',
        entidad: 'cxc_abonos',
        entidadId: id,
        anterior: {
          recibo: codigo,
          cliente: b.cliente,
          total: b.total,
          estado: 'activo',
        },
        nuevo: { estado: 'anulado', devuelto_desde: devuelto },
        motivo,
        ip,
      });
      return { ok: true };
    });
  }

  // ---------- Recibo del abono ----------

  private async reciboFilas(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Abono no encontrado');
    const r = await this.db.query<{
      numero: string;
      fecha: string;
      created_at: string;
      total: string;
      forma: string;
      referencia: string | null;
      estado: string;
      cliente_id: string;
      cliente: string;
      cliente_codigo: string | null;
      usuario: string;
    }>(
      `SELECT b.numero, to_char(b.fecha, 'DD/MM/YYYY') AS fecha, b.created_at, b.total, b.forma, b.referencia,
              b.estado, b.cliente_id, t.nombre AS cliente, t.codigo AS cliente_codigo, u.username AS usuario
       FROM cxc_abonos b JOIN terceros t ON t.id = b.cliente_id JOIN usuarios u ON u.id = b.usuario_id
       WHERE b.id = $1`,
      [id],
    );
    if (r.rowCount === 0) throw new NotFoundException('Abono no encontrado');
    const x = r.rows[0];
    const apl = await this.db.query<{
      venta: string;
      recargo: string;
      capital: string;
    }>(
      `SELECT 'V-' || lpad(v.numero::text, 6, '0') AS venta, a.recargo, a.capital
       FROM cxc_aplicaciones a JOIN cuentas_cobrar k ON k.id = a.cuenta_id JOIN ventas v ON v.id = k.venta_id
       WHERE a.abono_id = $1 ORDER BY a.id`,
      [id],
    );
    const est = await estadoCliente(
      this.db,
      x.cliente_id,
      await hoyLocal(this.db),
    );
    const codigo = numeroAbono(x.numero);
    const filas: ElementoTicket[] = [
      {
        tipo: 'titulo',
        texto:
          x.estado === 'anulado'
            ? 'RECIBO DE ABONO (ANULADO)'
            : 'RECIBO DE ABONO',
      },
      { tipo: 'fila', izq: 'Recibo:', der: codigo, negrita: true },
      { tipo: 'fila', izq: 'Fecha:', der: x.fecha },
      { tipo: 'fila', izq: 'Cliente:', der: x.cliente, negrita: true },
      ...(x.cliente_codigo
        ? [{ tipo: 'fila' as const, izq: 'Código:', der: x.cliente_codigo }]
        : []),
      { tipo: 'linea' },
    ];
    for (const a of apl.rows) {
      if (a.recargo !== '0.00')
        filas.push({
          tipo: 'fila',
          izq: `${a.venta} recargo`,
          der: dinero(a.recargo),
        });
      if (a.capital !== '0.00')
        filas.push({
          tipo: 'fila',
          izq: `${a.venta} capital`,
          der: dinero(a.capital),
        });
    }
    filas.push(
      { tipo: 'linea' },
      {
        tipo: 'fila',
        izq: 'TOTAL ABONADO:',
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
            : `Transferencia${x.referencia ? ` ${x.referencia}` : ''}`,
      },
      {
        tipo: 'fila',
        izq: 'Debe ahora:',
        der: dinero(est.totales.total),
        negrita: true,
      },
      { tipo: 'fila', izq: 'Atendió:', der: x.usuario },
      { tipo: 'linea' },
      { tipo: 'nota', texto: 'Conserve este recibo. ¡Gracias!' },
    );
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

  async reciboTicket(id: string): Promise<Ticket> {
    const { filas, codigo } = await this.reciboFilas(id);
    return {
      documento: codigo,
      encabezado: encabezado(await this.empresa()),
      elementos: filas,
    };
  }

  async reciboPdf(id: string, formato: unknown) {
    const f = texto(formato) || '80';
    if (f !== '80' && f !== '58' && f !== 'carta')
      throw new BadRequestException('Formato inválido: use 80, 58 o carta');
    const { filas, codigo } = await this.reciboFilas(id);
    const pdf = await generarReciboSan(
      { empresa: await this.empresa(), filas },
      f as Formato,
      'Recibo de abono',
    );
    return { pdf, nombre: `${codigo}.pdf` };
  }
}
