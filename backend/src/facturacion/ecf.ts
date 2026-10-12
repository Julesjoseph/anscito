import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { registrarAuditoria } from '../auditoria/auditoria';
import type { DatabaseService } from '../database/database.service';

// Reglas del e-CF que usan Ventas y Facturación dentro de su transacción.
// Modo manual: aquí solo se decide el tipo y se deja "por emitir"; el e-NCF
// lo anota después quien emite en el Facturador Gratuito de la DGII.

export const TIPOS_FACTURA = ['31', '32'];

export const NOMBRE_TIPO: Record<string, string> = {
  '31': 'Crédito Fiscal',
  '32': 'Consumo',
  '34': 'Nota de Crédito',
};

type Consulta = Pick<DatabaseService, 'query'>;

async function config(c: Consulta, clave: string): Promise<string> {
  const r = await c.query<{ valor: string }>(
    'SELECT valor FROM configuracion WHERE clave = $1',
    [clave],
  );
  return r.rows[0]?.valor ?? '';
}

// ¿Las ventas de hoy ya llevan e-CF? (fecha de inicio configurada y alcanzada)
export async function facturacionActiva(c: Consulta): Promise<{
  activa: boolean;
  inicio: string;
  umbral: string;
}> {
  const inicio = await config(c, 'facturacion.inicio');
  const umbral =
    (await config(c, 'facturacion.consumo_identificar_desde')) || '250000.00';
  if (!inicio) return { activa: false, inicio, umbral };
  const zona =
    (await config(c, 'empresa.zona_horaria')) || 'America/Santo_Domingo';
  const r = await c.query<{ ok: boolean }>(
    `SELECT (now() AT TIME ZONE $1)::date >= $2::date AS ok`,
    [zona, inicio],
  );
  return { activa: r.rows[0].ok, inicio, umbral };
}

type Cliente = {
  nombre: string;
  numero_documento: string | null;
  es_contribuyente: boolean;
};

async function cliente(
  c: Consulta,
  ventaId: string,
): Promise<
  Cliente & {
    base_imponible: string;
    itbis: string;
    total: string;
  }
> {
  const r = await c.query(
    `SELECT t.nombre, t.numero_documento, t.es_contribuyente,
            v.base_imponible, v.itbis, v.total
     FROM ventas v JOIN terceros t ON t.id = v.cliente_id WHERE v.id = $1`,
    [ventaId],
  );
  return r.rows[0];
}

// El tipo que corresponde: el pedido, o 31 si el cliente es contribuyente.
// Valida que el comprador esté identificado cuando hace falta.
async function decidirTipo(
  c: Consulta,
  pedido: string,
  cli: Cliente & { total: string },
  umbral: string,
): Promise<'31' | '32'> {
  if (pedido && !TIPOS_FACTURA.includes(pedido))
    throw new BadRequestException(
      'Tipo de comprobante inválido: 31 (Crédito Fiscal) o 32 (Consumo)',
    );
  const tipo = (pedido || (cli.es_contribuyente ? '31' : '32')) as '31' | '32';
  if (tipo === '31' && !cli.numero_documento)
    throw new BadRequestException(
      'La factura de Crédito Fiscal necesita un cliente con RNC o cédula',
    );
  if (tipo === '32' && !cli.numero_documento) {
    const r = await c.query<{ alto: boolean }>(
      'SELECT $1::numeric >= $2::numeric AS alto',
      [cli.total, umbral],
    );
    if (r.rows[0].alto)
      throw new BadRequestException(
        `Una factura de Consumo de RD$${umbral} o más necesita un cliente con cédula o RNC`,
      );
  }
  return tipo;
}

async function insertar(
  c: Consulta,
  ventaId: string,
  tipo: string,
  cli: Cliente & { base_imponible: string; itbis: string; total: string },
  actorId: string,
  modificaId: string | null = null,
) {
  const r = await c.query<{ id: string }>(
    `INSERT INTO ecf (venta_id, tipo, modifica_id, comprador_documento, comprador_nombre,
                      base_imponible, itbis, total, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      ventaId,
      tipo,
      modificaId,
      cli.numero_documento,
      cli.nombre,
      cli.base_imponible,
      cli.itbis,
      cli.total,
      actorId,
    ],
  );
  return r.rows[0].id;
}

// Al registrar una venta: deja su e-CF "por emitir" (si ya empezó la facturación).
export async function crearEcfDeVenta(
  c: Consulta,
  ventaId: string,
  tipoPedido: string,
  actorId: string,
): Promise<{ id: string; tipo: string } | null> {
  const f = await facturacionActiva(c);
  if (!f.activa) return null;
  const cli = await cliente(c, ventaId);
  const tipo = await decidirTipo(c, tipoPedido, cli, f.umbral);
  const id = await insertar(c, ventaId, tipo, cli, actorId);
  return { id, tipo };
}

// Al anular una venta: si su e-CF no se había emitido, ya no hace falta;
// si ya se emitió, queda una Nota de Crédito (34) por emitir.
export async function anularEcfDeVenta(
  c: PoolClient,
  ventaId: string,
  actorId: string,
  motivo: string,
  ip: string | undefined,
): Promise<string | null> {
  const r = await c.query<{
    id: string;
    tipo: string;
    estado: string;
    encf: string | null;
  }>(
    `SELECT id, tipo, estado, encf FROM ecf
     WHERE venta_id = $1 AND tipo IN ('31', '32') AND estado <> 'cancelado' FOR UPDATE`,
    [ventaId],
  );
  if (r.rowCount === 0) return null;
  const e = r.rows[0];
  if (e.estado === 'por_emitir') {
    await c.query(
      `UPDATE ecf SET estado = 'cancelado', motivo_cancelacion = $2, cancelado_por = $3,
              cancelado_en = now(), updated_at = now() WHERE id = $1`,
      [e.id, `Venta anulada antes de emitir: ${motivo}`, actorId],
    );
    await registrarAuditoria(c, {
      usuarioId: actorId,
      accion: 'ecf.cancelar',
      entidad: 'ecf',
      entidadId: e.id,
      anterior: { estado: 'por_emitir', tipo: e.tipo },
      nuevo: { estado: 'cancelado' },
      motivo,
      ip,
    });
    return `e-CF ${e.tipo} por emitir: ya no se emite`;
  }
  const cli = await c.query(
    `SELECT comprador_documento AS numero_documento, comprador_nombre AS nombre,
            false AS es_contribuyente, base_imponible, itbis, total
     FROM ecf WHERE id = $1`,
    [e.id],
  );
  const notaId = await insertar(c, ventaId, '34', cli.rows[0], actorId, e.id);
  await registrarAuditoria(c, {
    usuarioId: actorId,
    accion: 'ecf.nota_credito',
    entidad: 'ecf',
    entidadId: notaId,
    nuevo: { tipo: '34', modifica: e.encf, estado: 'por_emitir' },
    motivo,
    ip,
  });
  return `Nota de Crédito por emitir (modifica ${e.encf})`;
}
