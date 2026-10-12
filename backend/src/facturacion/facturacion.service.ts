import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { registrarAuditoria } from '../auditoria/auditoria';
import { DatabaseService } from '../database/database.service';
import { normalizarMonto } from '../servicios/calculo-itbis';
import { numeroVenta } from '../ventas/ventas.service';
import { NOMBRE_TIPO, TIPOS_FACTURA } from './ecf';

// Facturación electrónica en modo manual: la lista de e-CF por emitir, anotar
// el e-NCF que dio la DGII, corregirlo si se escribió mal y la configuración.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ESTADOS = ['por_emitir', 'emitido', 'cancelado'];
const POR_PAGINA = 50;

function texto(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
}

function fechaValida(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// e-NCF: E + tipo (2) + secuencia (10). Se acepta con espacios o minúscula.
function leerEncf(v: unknown, tipo: string): string {
  const e = texto(v).toUpperCase().replace(/\s/g, '');
  if (!/^E\d{12}$/.test(e))
    throw new BadRequestException(
      'e-NCF inválido: la letra E seguida de 12 números (ej.: E320000000001)',
    );
  if (e.slice(1, 3) !== tipo)
    throw new BadRequestException(
      `Este comprobante es tipo ${tipo} (${NOMBRE_TIPO[tipo]}): su e-NCF debe empezar con E${tipo}`,
    );
  return e;
}

function leerCodigo(v: unknown): string {
  const t = texto(v).replace(/\s/g, '');
  if (!/^[A-Za-z0-9]{6}$/.test(t))
    throw new BadRequestException(
      'Código de seguridad inválido: 6 letras o números (está en la factura de la DGII)',
    );
  return t;
}

const SQL_ECF = `SELECT e.id, e.venta_id, e.tipo, e.estado, e.comprador_documento, e.comprador_nombre,
    e.base_imponible, e.itbis, e.total, e.encf, to_char(e.fecha_emision, 'YYYY-MM-DD') AS fecha_emision,
    e.codigo_seguridad, e.emitido_en, ue.username AS emitido_por_usuario,
    e.motivo_cancelacion, e.created_at,
    v.numero AS venta_numero, v.fecha AS venta_fecha, v.estado AS venta_estado,
    m.encf AS modifica_encf, to_char(m.fecha_emision, 'YYYY-MM-DD') AS modifica_fecha
  FROM ecf e
  JOIN ventas v ON v.id = e.venta_id
  LEFT JOIN ecf m ON m.id = e.modifica_id
  LEFT JOIN usuarios ue ON ue.id = e.emitido_por`;

type FilaEcf = {
  id: string;
  venta_id: string;
  tipo: string;
  estado: string;
  encf: string | null;
  fecha_emision: string | null;
  codigo_seguridad: string | null;
  venta_numero: string;
  venta_fecha: string;
  modifica_encf: string | null;
  modifica_fecha: string | null;
};

@Injectable()
export class FacturacionService {
  constructor(private readonly db: DatabaseService) {}

  private async config(clave: string) {
    const r = await this.db.query<{ valor: string }>(
      'SELECT valor FROM configuracion WHERE clave = $1',
      [clave],
    );
    return r.rows[0]?.valor ?? '';
  }

  private async hoy() {
    const zona =
      (await this.config('empresa.zona_horaria')) || 'America/Santo_Domingo';
    const r = await this.db.query<{ hoy: string }>(
      `SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS hoy`,
      [zona],
    );
    return r.rows[0].hoy;
  }

  private conTexto<T extends FilaEcf>(f: T) {
    return {
      ...f,
      venta_numero_texto: numeroVenta(f.venta_numero),
      tipo_nombre: NOMBRE_TIPO[f.tipo] ?? f.tipo,
    };
  }

  async preparar() {
    const [modo, inicio, umbral, conteo, hoy] = await Promise.all([
      this.config('facturacion.modo'),
      this.config('facturacion.inicio'),
      this.config('facturacion.consumo_identificar_desde'),
      this.db.query<{ estado: string; n: number }>(
        'SELECT estado, count(*)::int AS n FROM ecf GROUP BY estado',
      ),
      this.hoy(),
    ]);
    const n = Object.fromEntries(conteo.rows.map((f) => [f.estado, f.n]));
    return {
      modo: modo || 'manual',
      inicio,
      umbral: umbral || '250000.00',
      hoy,
      activa: !!inicio && inicio <= hoy,
      porEmitir: n.por_emitir ?? 0,
      emitidos: n.emitido ?? 0,
      cancelados: n.cancelado ?? 0,
    };
  }

  async listar(filtros: { estado?: string; texto?: string; pagina?: string }) {
    const estado = texto(filtros.estado) || 'por_emitir';
    const cond: string[] = [];
    const params: unknown[] = [];
    if (estado !== 'todos') {
      if (!ESTADOS.includes(estado))
        throw new BadRequestException('Estado inválido');
      params.push(estado);
      cond.push(`e.estado = $${params.length}`);
    }
    const t = texto(filtros.texto);
    if (t) {
      params.push(`%${t}%`);
      const p = params.length;
      let porNumero = '';
      if (/^\d{1,12}$/.test(t)) {
        params.push(Number(t));
        porNumero = ` OR v.numero = $${params.length}`;
      }
      cond.push(
        `(e.comprador_nombre ILIKE $${p} OR e.encf ILIKE $${p} OR e.comprador_documento ILIKE $${p}${porNumero})`,
      );
    }
    const pagina = Math.max(1, Number(texto(filtros.pagina)) || 1);
    const donde = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    // Por emitir: lo más viejo primero (es una cola). Lo demás: lo más reciente.
    const orden =
      estado === 'por_emitir' ? 'e.created_at ASC' : 'e.created_at DESC';
    const [filas, total] = await Promise.all([
      this.db.query<FilaEcf>(
        `${SQL_ECF} ${donde} ORDER BY ${orden} LIMIT ${POR_PAGINA} OFFSET ${(pagina - 1) * POR_PAGINA}`,
        params,
      ),
      this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ecf e JOIN ventas v ON v.id = e.venta_id ${donde}`,
        params,
      ),
    ]);
    return {
      filas: filas.rows.map((f) => this.conTexto(f)),
      total: total.rows[0].n,
      pagina,
      porPagina: POR_PAGINA,
    };
  }

  private async bloquear(
    c: Pick<DatabaseService, 'query'>,
    id: string,
  ): Promise<FilaEcf> {
    if (!UUID.test(id))
      throw new NotFoundException('Comprobante no encontrado');
    const r = await c.query<FilaEcf>(
      `SELECT e.id, e.venta_id, e.tipo, e.estado, e.encf,
              to_char(e.fecha_emision, 'YYYY-MM-DD') AS fecha_emision, e.codigo_seguridad,
              v.numero AS venta_numero, to_char(v.fecha AT TIME ZONE $2, 'YYYY-MM-DD') AS venta_fecha,
              NULL AS modifica_encf, NULL AS modifica_fecha
       FROM ecf e JOIN ventas v ON v.id = e.venta_id WHERE e.id = $1 FOR UPDATE OF e`,
      [
        id,
        (await this.config('empresa.zona_horaria')) || 'America/Santo_Domingo',
      ],
    );
    if (r.rowCount === 0)
      throw new NotFoundException('Comprobante no encontrado');
    return r.rows[0];
  }

  private async leerEmision(
    e: FilaEcf,
    datos: {
      encf?: unknown;
      fechaEmision?: unknown;
      codigoSeguridad?: unknown;
    },
  ) {
    const encf = leerEncf(datos.encf, e.tipo);
    const fecha = texto(datos.fechaEmision);
    if (!fechaValida(fecha))
      throw new BadRequestException('Fecha de emisión inválida (AAAA-MM-DD)');
    const hoy = await this.hoy();
    if (fecha > hoy)
      throw new BadRequestException('La fecha de emisión no puede ser futura');
    if (fecha < e.venta_fecha)
      throw new BadRequestException(
        `La fecha de emisión no puede ser anterior a la venta (${e.venta_fecha})`,
      );
    return { encf, fecha, codigo: leerCodigo(datos.codigoSeguridad) };
  }

  // Anotar el e-NCF que dio la DGII al emitir.
  async emitir(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: {
      encf?: unknown;
      fechaEmision?: unknown;
      codigoSeguridad?: unknown;
    },
  ) {
    try {
      return await this.db.transaccion(async (c) => {
        const e = await this.bloquear(c, id);
        if (e.estado !== 'por_emitir')
          throw new BadRequestException(
            e.estado === 'emitido'
              ? `Este comprobante ya fue emitido (${e.encf})`
              : 'Este comprobante está cancelado',
          );
        const d = await this.leerEmision(e, datos);
        await c.query(
          `UPDATE ecf SET estado = 'emitido', encf = $2, fecha_emision = $3, codigo_seguridad = $4,
                  emitido_por = $5, emitido_en = now(), updated_at = now() WHERE id = $1`,
          [id, d.encf, d.fecha, d.codigo, actorId],
        );
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'ecf.emitir',
          entidad: 'ecf',
          entidadId: id,
          anterior: { estado: 'por_emitir' },
          nuevo: {
            venta: numeroVenta(e.venta_numero),
            tipo: e.tipo,
            encf: d.encf,
            fecha_emision: d.fecha,
          },
          ip,
        });
        return { ok: true, encf: d.encf };
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23505')
        throw new ConflictException(
          'Ese e-NCF ya está anotado en otro comprobante',
        );
      throw err;
    }
  }

  // Corregir un e-NCF mal escrito (con motivo y auditoría).
  async corregir(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: {
      encf?: unknown;
      fechaEmision?: unknown;
      codigoSeguridad?: unknown;
      motivo?: unknown;
    },
  ) {
    const motivo = texto(datos.motivo);
    if (motivo.length < 5 || motivo.length > 300)
      throw new BadRequestException(
        'Escriba el motivo de la corrección (5 a 300 caracteres)',
      );
    try {
      return await this.db.transaccion(async (c) => {
        const e = await this.bloquear(c, id);
        if (e.estado !== 'emitido')
          throw new BadRequestException(
            'Solo se corrige un comprobante ya emitido',
          );
        const d = await this.leerEmision(e, datos);
        await c.query(
          `UPDATE ecf SET encf = $2, fecha_emision = $3, codigo_seguridad = $4, updated_at = now()
           WHERE id = $1`,
          [id, d.encf, d.fecha, d.codigo],
        );
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'ecf.corregir',
          entidad: 'ecf',
          entidadId: id,
          anterior: {
            encf: e.encf,
            fecha_emision: e.fecha_emision,
            codigo_seguridad: e.codigo_seguridad,
          },
          nuevo: {
            encf: d.encf,
            fecha_emision: d.fecha,
            codigo_seguridad: d.codigo,
          },
          motivo,
          ip,
        });
        return { ok: true };
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23505')
        throw new ConflictException(
          'Ese e-NCF ya está anotado en otro comprobante',
        );
      throw err;
    }
  }

  // Cambiar 31 <-> 32 antes de emitir (p. ej. el cliente pidió Crédito Fiscal).
  // El tipo no se edita: se cancela el por emitir y se crea otro.
  async cambiarTipo(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: { tipo?: unknown },
  ) {
    const tipo = texto(datos.tipo);
    if (!TIPOS_FACTURA.includes(tipo))
      throw new BadRequestException(
        'Tipo inválido: 31 (Crédito Fiscal) o 32 (Consumo)',
      );
    return this.db.transaccion(async (c) => {
      const e = await this.bloquear(c, id);
      if (e.estado !== 'por_emitir' || !TIPOS_FACTURA.includes(e.tipo))
        throw new BadRequestException(
          'Solo se cambia el tipo de una factura por emitir',
        );
      if (e.tipo === tipo) return { ok: true, id };
      const cli = await c.query<{
        nombre: string;
        numero_documento: string | null;
        total: string;
        alto: boolean;
      }>(
        `SELECT t.nombre, t.numero_documento, v.total,
                v.total >= (SELECT valor::numeric FROM configuracion
                            WHERE clave = 'facturacion.consumo_identificar_desde') AS alto
         FROM ventas v JOIN terceros t ON t.id = v.cliente_id WHERE v.id = $1`,
        [e.venta_id],
      );
      const x = cli.rows[0];
      if (!x.numero_documento && (tipo === '31' || x.alto))
        throw new BadRequestException(
          tipo === '31'
            ? 'La factura de Crédito Fiscal necesita un cliente con RNC o cédula: agréguelo en Clientes'
            : 'Por el monto, la factura de Consumo necesita un cliente con cédula o RNC',
        );
      await c.query(
        `UPDATE ecf SET estado = 'cancelado', motivo_cancelacion = $2, cancelado_por = $3,
                cancelado_en = now(), updated_at = now() WHERE id = $1`,
        [id, `Cambiado a tipo ${tipo}`, actorId],
      );
      const n = await c.query<{ id: string }>(
        `INSERT INTO ecf (venta_id, tipo, comprador_documento, comprador_nombre,
                          base_imponible, itbis, total, created_by)
         SELECT e.venta_id, $2, t.numero_documento, t.nombre, v.base_imponible, v.itbis, v.total, $3
         FROM ecf e JOIN ventas v ON v.id = e.venta_id JOIN terceros t ON t.id = v.cliente_id
         WHERE e.id = $1 RETURNING id`,
        [id, tipo, actorId],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'ecf.cambiar_tipo',
        entidad: 'ecf',
        entidadId: n.rows[0].id,
        anterior: { tipo: e.tipo },
        nuevo: { venta: numeroVenta(e.venta_numero), tipo },
        ip,
      });
      return { ok: true, id: n.rows[0].id };
    });
  }

  async configurar(
    actorId: string,
    ip: string | undefined,
    datos: { inicio?: unknown; umbral?: unknown },
  ) {
    const inicio = texto(datos.inicio);
    if (inicio && !fechaValida(inicio))
      throw new BadRequestException('Fecha de inicio inválida (AAAA-MM-DD)');
    const umbral = normalizarMonto(datos.umbral);
    if (umbral === null || umbral === '0.00')
      throw new BadRequestException(
        'Monto inválido: mayor que 0, con hasta 2 decimales',
      );
    return this.db.transaccion(async (c) => {
      const antes = await this.preparar();
      for (const [k, v] of [
        ['facturacion.inicio', inicio],
        ['facturacion.consumo_identificar_desde', umbral],
      ]) {
        await c.query(
          'UPDATE configuracion SET valor = $2, updated_by = $3, updated_at = now() WHERE clave = $1',
          [k, v, actorId],
        );
      }
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'facturacion.configurar',
        entidad: 'configuracion',
        anterior: { inicio: antes.inicio, umbral: antes.umbral },
        nuevo: { inicio, umbral },
        ip,
      });
      return { ok: true };
    });
  }
}
