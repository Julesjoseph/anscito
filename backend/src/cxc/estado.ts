import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { registrarAuditoria } from '../auditoria/auditoria';
import type { DatabaseService } from '../database/database.service';
import { centavos, texto2 } from '../sanes/calendario';
import { diasEntre, recargosDe } from './recargos';
import type { Recargo, Tasa } from './recargos';

// Estado de cuenta de un cliente (lo usan Cuentas por Cobrar, Ventas y
// Reportes) y la validación de una venta a crédito.

type Consulta = Pick<DatabaseService, 'query'>;

function texto(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
}

export type EstadoCuenta = {
  id: string;
  venta_id: string;
  venta: string;
  fecha: string;
  plazo_dias: number;
  vencimiento: string;
  monto: string;
  capital_pagado: string;
  capital_pendiente: string;
  recargos: Recargo[];
  recargo_total: string;
  recargo_pagado: string;
  recargo_perdonado: string;
  recargo_pendiente: string;
  total_pendiente: string;
  vencida: boolean;
  dias_atraso: number;
};

export type EstadoCliente = {
  credito: { limite: string; plazo_dias: number; is_active: boolean } | null;
  cuentas: EstadoCuenta[];
  totales: {
    capital: string;
    recargo: string;
    total: string;
    vencido: string;
    cuentas_vencidas: number;
  };
  disponible: string | null; // límite − capital pendiente
};

export function numeroAbono(n: number | string) {
  return `AC-${String(n).padStart(6, '0')}`;
}

export async function hoyLocal(c: Consulta): Promise<string> {
  const z = await c.query<{ valor: string }>(
    `SELECT valor FROM configuracion WHERE clave = 'empresa.zona_horaria'`,
  );
  return (
    await c.query<{ hoy: string }>(
      `SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS hoy`,
      [z.rows[0]?.valor ?? 'America/Santo_Domingo'],
    )
  ).rows[0].hoy;
}

export async function tasasRecargo(c: Consulta): Promise<Tasa[]> {
  const r = await c.query<{ desde: string; pct: string }>(
    `SELECT to_char(vigente_desde, 'YYYY-MM-DD') AS desde, porcentaje AS pct FROM cxc_tasas_recargo`,
  );
  return r.rows;
}

// Estado de las cuentas activas de un cliente al día "hoy".
export async function estadoCliente(
  c: Consulta,
  clienteId: string,
  hoy: string,
  tasas?: Tasa[],
): Promise<EstadoCliente> {
  const [cred, cuentas, apl, perdones, ts] = await Promise.all([
    c.query<{ limite: string; plazo_dias: number; is_active: boolean }>(
      'SELECT limite, plazo_dias, is_active FROM clientes_credito WHERE tercero_id = $1',
      [clienteId],
    ),
    c.query<{
      id: string;
      venta_id: string;
      venta_numero: string;
      fecha: string;
      plazo_dias: number;
      vencimiento: string;
      monto: string;
    }>(
      `SELECT k.id, k.venta_id, v.numero AS venta_numero, to_char(k.fecha, 'YYYY-MM-DD') AS fecha,
              k.plazo_dias, to_char(k.vencimiento, 'YYYY-MM-DD') AS vencimiento, k.monto
       FROM cuentas_cobrar k JOIN ventas v ON v.id = k.venta_id
       WHERE k.cliente_id = $1 AND k.estado = 'activa' AND k.fecha <= $2::date
       ORDER BY k.vencimiento, k.fecha, v.numero`,
      [clienteId, hoy],
    ),
    c.query<{
      cuenta_id: string;
      fecha: string;
      capital: string;
      recargo: string;
    }>(
      `SELECT a.cuenta_id, to_char(b.fecha, 'YYYY-MM-DD') AS fecha, a.capital, a.recargo
       FROM cxc_aplicaciones a JOIN cxc_abonos b ON b.id = a.abono_id
       JOIN cuentas_cobrar k ON k.id = a.cuenta_id
       WHERE k.cliente_id = $1 AND b.estado = 'activo' AND b.fecha <= $2::date`,
      [clienteId, hoy],
    ),
    c.query<{ cuenta_id: string; monto: string }>(
      `SELECT p.cuenta_id, p.monto FROM cxc_perdones p
       JOIN cuentas_cobrar k ON k.id = p.cuenta_id
       WHERE k.cliente_id = $1
         AND (p.created_at AT TIME ZONE COALESCE(
               (SELECT valor FROM configuracion WHERE clave = 'empresa.zona_horaria'),
               'America/Santo_Domingo'))::date <= $2::date`,
      [clienteId, hoy],
    ),
    tasas ? Promise.resolve(tasas) : tasasRecargo(c),
  ]);
  let capital = 0n;
  let recargo = 0n;
  let vencido = 0n;
  let nVencidas = 0;
  const lista: EstadoCuenta[] = cuentas.rows.map((k) => {
    const mias = apl.rows.filter((a) => a.cuenta_id === k.id);
    const capPagado = mias.reduce((a, x) => a + centavos(x.capital), 0n);
    const recPagado = mias.reduce((a, x) => a + centavos(x.recargo), 0n);
    const recPerdonado = perdones.rows
      .filter((p) => p.cuenta_id === k.id)
      .reduce((a, p) => a + centavos(p.monto), 0n);
    const recs = recargosDe(
      { monto: k.monto, vencimiento: k.vencimiento },
      mias.map((x) => ({ fecha: x.fecha, capital: x.capital })),
      ts,
      hoy,
    );
    const recTotal = recs.reduce((a, r) => a + centavos(r.monto), 0n);
    const capPend = centavos(k.monto) - capPagado;
    let recPend = recTotal - recPagado - recPerdonado;
    if (recPend < 0n) recPend = 0n;
    const esVencida = capPend > 0n && k.vencimiento < hoy;
    capital += capPend;
    recargo += recPend;
    if (esVencida) {
      vencido += capPend + recPend;
      nVencidas++;
    }
    return {
      id: k.id,
      venta_id: k.venta_id,
      venta: `V-${String(k.venta_numero).padStart(6, '0')}`,
      fecha: k.fecha,
      plazo_dias: k.plazo_dias,
      vencimiento: k.vencimiento,
      monto: k.monto,
      capital_pagado: texto2(capPagado),
      capital_pendiente: texto2(capPend),
      recargos: recs,
      recargo_total: texto2(recTotal),
      recargo_pagado: texto2(recPagado),
      recargo_perdonado: texto2(recPerdonado),
      recargo_pendiente: texto2(recPend),
      total_pendiente: texto2(capPend + recPend),
      vencida: esVencida,
      dias_atraso: esVencida ? diasEntre(k.vencimiento, hoy) : 0,
    };
  });
  const credito = cred.rows[0] ?? null;
  return {
    credito,
    cuentas: lista,
    totales: {
      capital: texto2(capital),
      recargo: texto2(recargo),
      total: texto2(capital + recargo),
      vencido: texto2(vencido),
      cuentas_vencidas: nVencidas,
    },
    disponible: credito ? texto2(centavos(credito.limite) - capital) : null,
  };
}

async function tienePermiso(c: Consulta, usuarioId: string, codigo: string) {
  const r = await c.query(
    `SELECT 1 FROM usuario_roles ur JOIN roles ro ON ro.id = ur.rol_id AND ro.is_active
     JOIN rol_permisos rp ON rp.rol_id = ro.id JOIN permisos p ON p.id = rp.permiso_id
     WHERE ur.usuario_id = $1 AND p.codigo = $2 LIMIT 1`,
    [usuarioId, codigo],
  );
  return (r.rowCount ?? 0) > 0;
}

// Al registrar una venta con parte a crédito: valida y crea la cuenta por cobrar.
// Con facturas vencidas hace falta una autorización del administrador:
// la previa del día (sin usar) o la del momento (con permiso y motivo).
export async function registrarCredito(
  c: PoolClient,
  datos: {
    ventaId: string;
    ventaTexto: string;
    clienteId: string;
    monto: string;
    plazoDias: unknown;
    autorizarMotivo: unknown;
    actorId: string;
    ip: string | undefined;
  },
): Promise<{
  vencimiento: string;
  plazo: number;
  autorizacion: string | null;
}> {
  if (!(await tienePermiso(c, datos.actorId, 'cxc.vender')))
    throw new ForbiddenException('No tiene permiso para vender a crédito');
  // Bloquea el crédito del cliente: dos ventas a la vez no pasan del límite.
  const cr = await c.query<{
    limite: string;
    plazo_dias: number;
    is_active: boolean;
    nombre: string;
  }>(
    `SELECT cc.limite, cc.plazo_dias, cc.is_active, t.nombre FROM clientes_credito cc
     JOIN terceros t ON t.id = cc.tercero_id WHERE cc.tercero_id = $1 FOR UPDATE OF cc`,
    [datos.clienteId],
  );
  if (cr.rowCount === 0 || !cr.rows[0].is_active)
    throw new BadRequestException(
      'Este cliente no tiene crédito autorizado. El administrador se lo da en Cuentas por Cobrar.',
    );
  const credito = cr.rows[0];
  const textoPlazo = texto(datos.plazoDias);
  const plazo = textoPlazo ? Number(textoPlazo) : credito.plazo_dias;
  if (!Number.isInteger(plazo) || plazo < 1 || plazo > 365)
    throw new BadRequestException('Plazo inválido: de 1 a 365 días');

  const hoy = await hoyLocal(c);
  const est = await estadoCliente(c, datos.clienteId, hoy);
  const usado = centavos(est.totales.capital);
  if (usado + centavos(datos.monto) > centavos(credito.limite))
    throw new BadRequestException(
      `Pasa del límite de crédito: límite RD$${credito.limite}, ya debe RD$${est.totales.capital}, disponible RD$${texto2(centavos(credito.limite) - usado)}`,
    );

  let autorizacion: string | null = null;
  if (est.totales.cuentas_vencidas > 0) {
    // ¿Hay una autorización previa de hoy sin usar?
    const previa = await c.query<{ id: string }>(
      `SELECT id FROM cxc_autorizaciones
       WHERE cliente_id = $1 AND tipo = 'previa' AND usada_venta_id IS NULL AND valida_hasta >= $2::date
       ORDER BY created_at LIMIT 1 FOR UPDATE`,
      [datos.clienteId, hoy],
    );
    if ((previa.rowCount ?? 0) > 0) {
      autorizacion = previa.rows[0].id;
      await c.query(
        'UPDATE cxc_autorizaciones SET usada_venta_id = $2, usada_en = now() WHERE id = $1',
        [autorizacion, datos.ventaId],
      );
    } else {
      const motivo = texto(datos.autorizarMotivo);
      const puede = await tienePermiso(c, datos.actorId, 'cxc.autorizar');
      if (!puede || motivo.length < 5)
        throw new BadRequestException(
          puede
            ? `El cliente tiene ${est.totales.cuentas_vencidas} factura(s) vencida(s) (RD$${est.totales.vencido}). Para autorizar, escriba el motivo.`
            : `El cliente tiene ${est.totales.cuentas_vencidas} factura(s) vencida(s) (RD$${est.totales.vencido}). Solo el administrador puede autorizar esta venta a crédito.`,
        );
      if (motivo.length > 300)
        throw new BadRequestException('Motivo: máximo 300 caracteres');
      const a = await c.query<{ id: string }>(
        `INSERT INTO cxc_autorizaciones (cliente_id, tipo, motivo, valida_hasta, autorizado_por, usada_venta_id, usada_en)
         VALUES ($1, 'en_venta', $2, $3, $4, $5, now()) RETURNING id`,
        [datos.clienteId, motivo, hoy, datos.actorId, datos.ventaId],
      );
      autorizacion = a.rows[0].id;
    }
    await registrarAuditoria(c, {
      usuarioId: datos.actorId,
      accion: 'cxc.autorizacion_usada',
      entidad: 'cxc_autorizaciones',
      entidadId: autorizacion,
      nuevo: {
        venta: datos.ventaTexto,
        cliente: credito.nombre,
        vencidas: est.totales.cuentas_vencidas,
        vencido: est.totales.vencido,
      },
      motivo: texto(datos.autorizarMotivo) || undefined,
      ip: datos.ip,
    });
  }

  const vence = (
    await c.query<{ v: string }>(
      `SELECT to_char($1::date + $2::int, 'YYYY-MM-DD') AS v`,
      [hoy, plazo],
    )
  ).rows[0].v;
  await c.query(
    `INSERT INTO cuentas_cobrar (venta_id, cliente_id, monto, fecha, plazo_dias, vencimiento, autorizacion_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      datos.ventaId,
      datos.clienteId,
      datos.monto,
      hoy,
      plazo,
      vence,
      autorizacion,
      datos.actorId,
    ],
  );
  return { vencimiento: vence, plazo, autorizacion };
}
