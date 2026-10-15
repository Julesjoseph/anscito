import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  SQL_MOVS_CON_ESTADO,
  SQL_NO_LLEGO_PENDIENTE,
  SQL_SALDOS,
} from '../bancos/sql';
import { SQL_SIGNO_CAJA } from '../caja/sql';
import { SQL_SIGNO_CAJA_USD, tasaVigente } from '../comun/dolar';
import { estadoCliente, hoyLocal, tasasRecargo } from '../cxc/estado';
import {
  avisosGastosFijos,
  diasAlerta,
  facturasPendientes,
} from '../cxp/estado';
import { centavos, texto2 } from '../sanes/calendario';
import {
  SQL_TOTALES_PRODUCTO,
  STOCK_MINIMO_POR_DEFECTO,
} from '../inventario/sql';

// Panel (resumen del negocio). Cada sección solo se calcula y se envía si el
// usuario tiene el permiso del módulo correspondiente: el panel nunca muestra
// más de lo que la persona podría ver en ese módulo.

export type Periodo = 'hoy' | 'semana' | 'mes' | 'trimestre' | 'anio';

// Unidad de date_trunc de PostgreSQL para cada período.
const TRUNCAR: Record<Periodo, string> = {
  hoy: 'day',
  semana: 'week', // la semana empieza el lunes
  mes: 'month',
  trimestre: 'quarter',
  anio: 'year',
};

@Injectable()
export class PanelService {
  constructor(private readonly db: DatabaseService) {}

  private async permisos(usuarioId: string): Promise<Set<string>> {
    const r = await this.db.query<{ codigo: string }>(
      `SELECT DISTINCT p.codigo
       FROM usuario_roles ur
       JOIN roles ro ON ro.id = ur.rol_id AND ro.is_active = true
       JOIN rol_permisos rp ON rp.rol_id = ro.id
       JOIN permisos p ON p.id = rp.permiso_id
       WHERE ur.usuario_id = $1`,
      [usuarioId],
    );
    return new Set(r.rows.map((f) => f.codigo));
  }

  async resumen(usuarioId: string, periodoTexto: unknown) {
    const periodo = (
      typeof periodoTexto === 'string' ? periodoTexto : 'hoy'
    ) as Periodo;
    if (!(periodo in TRUNCAR)) {
      throw new BadRequestException(
        'Período inválido: hoy, semana, mes, trimestre o anio',
      );
    }
    const permisos = await this.permisos(usuarioId);
    const zona = (
      await this.db.query<{ valor: string }>(
        `SELECT valor FROM configuracion WHERE clave = 'empresa.zona_horaria'`,
      )
    ).rows[0].valor;

    // Inicio del período en hora local; el período anterior tiene el mismo
    // largo (ej.: hoy hasta esta hora contra ayer hasta esta hora).
    const rango = await this.db.query<{
      inicio: string;
      fin: string;
      inicio_anterior: string;
    }>(
      `SELECT inicio,
              -- 1 segundo de margen: una venta de este mismo instante entra.
              now() + interval '1 second' AS fin,
              inicio - (now() - inicio) AS inicio_anterior
       FROM (SELECT (date_trunc($1, now() AT TIME ZONE $2) AT TIME ZONE $2) AS inicio) x`,
      [TRUNCAR[periodo], zona],
    );
    const { inicio, fin, inicio_anterior } = rango.rows[0];

    const resultado: Record<string, unknown> = {
      periodo,
      desde: inicio,
      hasta: fin,
    };

    if (permisos.has('ventas.ver')) {
      resultado.ventas = await this.ventas(inicio, fin, inicio_anterior);
      resultado.servicios = await this.servicios(
        inicio,
        fin,
        permisos.has('inventario.ver_costos'),
      );
      if (permisos.has('inventario.ver_costos')) {
        resultado.ganancia = await this.ganancia(inicio, fin);
      }
    }
    if (permisos.has('caja.ver')) {
      resultado.caja = await this.caja();
    }
    if (permisos.has('bancos.ver')) {
      resultado.bancos = await this.bancos();
    }
    if (permisos.has('remesas.ver')) {
      resultado.remesas = await this.remesas(
        inicio,
        fin,
        permisos.has('remesas.entregas'),
      );
    }
    if (permisos.has('inventario.ver')) {
      resultado.inventario = await this.inventario(
        permisos.has('inventario.ver_costos'),
      );
    }
    if (permisos.has('cxp.ver')) {
      resultado.cxp = await this.cxp();
    }
    if (permisos.has('cxc.ver')) {
      resultado.cxc = await this.cxc();
    }
    // Dólares: lo que hay en US$ en las cajas abiertas y en las cuentas en US$.
    if (permisos.has('caja.ver') || permisos.has('bancos.ver')) {
      resultado.dolares = await this.dolares(
        permisos.has('caja.ver'),
        permisos.has('bancos.ver'),
      );
    }
    return resultado;
  }

  // Dólares en caja (cajas abiertas) y en bancos (cuentas en US$), y su valor
  // en RD$ con la tasa del día.
  private async dolares(verCaja: boolean, verBancos: boolean) {
    // Por cada caja activa: si está abierta, lo que debería haber ahora en
    // US$; si está cerrada, lo que se contó en US$ al cerrar su última sesión.
    const cajas = verCaja
      ? (
          await this.db.query<{
            caja: string;
            estado: 'abierta' | 'cerrada';
            usd: string;
            fecha: string | null;
          }>(
            `SELECT c.nombre AS caja,
                    CASE WHEN a.id IS NOT NULL THEN 'abierta' ELSE 'cerrada' END AS estado,
                    COALESCE(CASE WHEN a.id IS NOT NULL THEN
                      a.fondo_inicial_usd + COALESCE((SELECT sum(m.monto * ${SQL_SIGNO_CAJA_USD})
                        FROM caja_movimientos_usd m WHERE m.sesion_id = a.id), 0)
                    ELSE u.contado_usd END, 0)::numeric(16,2) AS usd,
                    CASE WHEN a.id IS NULL THEN u.cerrada_en END AS fecha
             FROM cajas c
             LEFT JOIN caja_sesiones a ON a.caja_id = c.id AND a.estado = 'abierta'
             LEFT JOIN LATERAL (
               SELECT s.contado_usd, s.cerrada_en FROM caja_sesiones s
               WHERE s.caja_id = c.id AND s.estado = 'cerrada'
               ORDER BY s.cerrada_en DESC LIMIT 1) u ON true
             WHERE c.is_active
             ORDER BY lower(c.nombre)`,
          )
        ).rows
      : null;
    const sumaCajas = await this.db.query<{ total: string }>(
      'SELECT COALESCE((SELECT sum(v) FROM unnest($1::numeric[]) v), 0)::numeric(16,2) AS total',
      [(cajas ?? []).map((x) => x.usd)],
    );
    const caja = cajas ? sumaCajas.rows[0].total : null;
    const bancos = verBancos
      ? await this.db.query<{
          nombre: string;
          confirmado: string;
          por_confirmar: string;
        }>(
          `SELECT ct.nombre, COALESCE(s.confirmado, 0)::numeric(16,2) AS confirmado,
                  COALESCE(s.por_confirmar, 0)::numeric(16,2) AS por_confirmar
           FROM cuentas ct LEFT JOIN (${SQL_SALDOS}) s ON s.cuenta_id = ct.id
           WHERE ct.is_active AND ct.moneda = 'USD' ORDER BY lower(ct.nombre)`,
        )
      : null;
    const tasa = await tasaVigente(this.db);
    const suma = await this.db.query<{
      bancos: string;
      total: string;
      total_dop: string | null;
    }>(
      `SELECT x.bancos, ($1::numeric + x.bancos)::numeric(16,2) AS total,
              CASE WHEN $3::numeric IS NULL THEN NULL
                   ELSE round(($1::numeric + x.bancos) * $3::numeric, 2)::numeric(16,2)::text END AS total_dop
       FROM (SELECT COALESCE((SELECT sum(v) FROM unnest($2::numeric[]) v), 0)::numeric(16,2) AS bancos) x`,
      [
        caja ?? '0',
        (bancos?.rows ?? []).map((b) => b.confirmado),
        tasa?.tasa ?? null,
      ],
    );
    return {
      caja,
      cajas: cajas?.filter((x) => x.usd !== '0.00') ?? null,
      bancos: bancos ? suma.rows[0].bancos : null,
      cuentas: bancos?.rows ?? null,
      total: suma.rows[0].total,
      totalDop: suma.rows[0].total_dop,
      tasa: tasa?.tasa ?? null,
    };
  }

  // Cuentas por Cobrar: lo que deben los clientes hoy (capital + recargo),
  // lo vencido y cuántos clientes deben (ahora, no depende del período).
  private async cxc() {
    const hoy = await hoyLocal(this.db);
    const tasas = await tasasRecargo(this.db);
    const clientes = await this.db.query<{ cliente_id: string }>(
      `SELECT DISTINCT cliente_id FROM cuentas_cobrar WHERE estado = 'activa'`,
    );
    let total = 0n;
    let vencido = 0n;
    let deudores = 0;
    let conVencidas = 0;
    for (const x of clientes.rows) {
      const e = await estadoCliente(this.db, x.cliente_id, hoy, tasas);
      const t = centavos(e.totales.total);
      if (t === 0n) continue;
      total += t;
      vencido += centavos(e.totales.vencido);
      deudores++;
      if (e.totales.cuentas_vencidas > 0) conVencidas++;
    }
    return {
      total: texto2(total),
      vencido: texto2(vencido),
      clientes: deudores,
      clientesVencidos: conVencidas,
    };
  }

  // Cuentas por Pagar: facturas vencidas o por vencer y gastos fijos que tocan.
  private async cxp() {
    const hoy = await hoyLocal(this.db);
    const dias = await diasAlerta(this.db);
    const facturas = await facturasPendientes(this.db, hoy, dias);
    const suma = (xs: typeof facturas) =>
      texto2(xs.reduce((a, f) => a + centavos(f.saldo), 0n));
    const vencidas = facturas.filter((f) => f.vencida);
    const porVencer = facturas.filter((f) => f.por_vencer);
    return {
      dias,
      deuda: suma(facturas),
      vencidas: { cantidad: vencidas.length, monto: suma(vencidas) },
      porVencer: { cantidad: porVencer.length, monto: suma(porVencer) },
      gastosFijos: await avisosGastosFijos(this.db, hoy, dias),
    };
  }

  private async ventas(inicio: string, fin: string, anterior: string) {
    const rango = `v.estado = 'completada' AND v.fecha >= $1 AND v.fecha < $2`;
    const [tot, prev, anuladas, pagos, top, ultimas] = await Promise.all([
      this.db.query<{
        cantidad: number;
        total: string;
        itbis: string;
        base: string;
        descuento: string;
      }>(
        `SELECT count(*)::int AS cantidad,
                COALESCE(sum(total), 0)::numeric(16,2) AS total,
                COALESCE(sum(itbis), 0)::numeric(16,2) AS itbis,
                COALESCE(sum(base_imponible), 0)::numeric(16,2) AS base,
                COALESCE(sum(descuento), 0)::numeric(16,2) AS descuento
         FROM ventas v WHERE ${rango}`,
        [inicio, fin],
      ),
      this.db.query<{ total: string }>(
        `SELECT COALESCE(sum(total), 0)::numeric(16,2) AS total
         FROM ventas v WHERE ${rango}`,
        [anterior, inicio],
      ),
      this.db.query<{ cantidad: number; total: string }>(
        `SELECT count(*)::int AS cantidad, COALESCE(sum(total), 0)::numeric(16,2) AS total
         FROM ventas v
         WHERE v.estado = 'anulada' AND v.fecha >= $1 AND v.fecha < $2`,
        [inicio, fin],
      ),
      this.db.query<{ forma: string; total: string; cantidad: number }>(
        `SELECT fp.nombre AS forma, sum(vp.monto)::numeric(16,2) AS total,
                count(DISTINCT v.id)::int AS cantidad
         FROM ventas v
         JOIN venta_pagos vp ON vp.venta_id = v.id
         JOIN formas_pago fp ON fp.id = vp.forma_pago_id
         WHERE ${rango}
         GROUP BY fp.nombre, fp.orden ORDER BY fp.orden`,
        [inicio, fin],
      ),
      this.db.query<{
        codigo: string;
        descripcion: string;
        tipo: string;
        cantidad: string;
        total: string;
      }>(
        `SELECT vl.codigo, vl.descripcion, vl.tipo,
                sum(vl.cantidad)::numeric(14,3) AS cantidad,
                sum(vl.total)::numeric(16,2) AS total
         FROM venta_lineas vl JOIN ventas v ON v.id = vl.venta_id
         WHERE ${rango}
         GROUP BY vl.codigo, vl.descripcion, vl.tipo
         ORDER BY sum(vl.total) DESC LIMIT 5`,
        [inicio, fin],
      ),
      this.db.query(
        `SELECT v.id, 'V-' || lpad(v.numero::text, 6, '0') AS numero, v.fecha,
                v.total, v.estado, t.nombre AS cliente
         FROM ventas v JOIN terceros t ON t.id = v.cliente_id
         ORDER BY v.numero DESC LIMIT 5`,
      ),
    ]);
    return {
      ...tot.rows[0],
      total_anterior: prev.rows[0].total,
      anuladas: anuladas.rows[0],
      por_forma_pago: pagos.rows,
      mas_vendidos: top.rows,
      ultimas: ultimas.rows,
    };
  }

  // Ganancia bruta estimada sobre la venta sin ITBIS:
  //  - servicios por comisión: base × % copiado en la venta;
  //  - productos y servicios por costo: base − costo copiado en la venta;
  //  - líneas sin costo ni comisión: cuentan con costo 0 (decisión del
  //    dueño) y se informan aparte.
  private async ganancia(inicio: string, fin: string) {
    const r = await this.db.query<{
      venta: string;
      costo: string;
      venta_sin_costo: string;
      venta_comision: string;
      ganancia_comision: string;
      ganancia: string;
      margen: string | null;
    }>(
      `SELECT venta, costo, venta_sin_costo, venta_comision, ganancia_comision,
              (venta - costo)::numeric(16,2) AS ganancia,
              CASE WHEN venta > 0
                   THEN round((venta - costo) * 100 / venta, 1)::text END AS margen
       FROM (
         SELECT COALESCE(sum(vl.base), 0)::numeric(16,2) AS venta,
                COALESCE(sum(CASE
                  WHEN vl.comision_pct IS NOT NULL
                    THEN vl.base - round(vl.base * vl.comision_pct / 100, 2)
                  WHEN vl.costo_unitario IS NOT NULL
                    THEN round(vl.costo_unitario * vl.cantidad, 2)
                  ELSE 0 END), 0)::numeric(16,2) AS costo,
                COALESCE(sum(vl.base) FILTER (
                  WHERE vl.comision_pct IS NULL AND vl.costo_unitario IS NULL), 0)::numeric(16,2)
                  AS venta_sin_costo,
                COALESCE(sum(vl.base) FILTER (WHERE vl.comision_pct IS NOT NULL), 0)::numeric(16,2)
                  AS venta_comision,
                COALESCE(sum(round(vl.base * vl.comision_pct / 100, 2))
                  FILTER (WHERE vl.comision_pct IS NOT NULL), 0)::numeric(16,2)
                  AS ganancia_comision
         FROM venta_lineas vl JOIN ventas v ON v.id = vl.venta_id
         WHERE v.estado = 'completada' AND v.fecha >= $1 AND v.fecha < $2
       ) x`,
      [inicio, fin],
    );
    return r.rows[0];
  }

  // SCITO SERVICE: servicios vendidos en el período (ventas completadas).
  // La ganancia sigue la misma regla que "Ganancia bruta": comisión % del
  // precio sin ITBIS, o precio − costo (costo 0 si no tiene).
  private async servicios(inicio: string, fin: string, verGanancia: boolean) {
    const r = await this.db.query<{
      cantidad: string;
      ventas: number;
      total: string;
      base: string;
      ganancia: string;
    }>(
      `SELECT COALESCE(sum(vl.cantidad), 0)::numeric(16,3) AS cantidad,
              count(DISTINCT vl.venta_id)::int AS ventas,
              COALESCE(sum(vl.total), 0)::numeric(16,2) AS total,
              COALESCE(sum(vl.base), 0)::numeric(16,2) AS base,
              COALESCE(sum(CASE
                WHEN vl.comision_pct IS NOT NULL THEN round(vl.base * vl.comision_pct / 100, 2)
                ELSE vl.base - round(COALESCE(vl.costo_unitario, 0) * vl.cantidad, 2) END), 0)::numeric(16,2)
                AS ganancia
       FROM venta_lineas vl JOIN ventas v ON v.id = vl.venta_id
       WHERE vl.tipo = 'servicio' AND v.estado = 'completada'
         AND v.fecha >= $1 AND v.fecha < $2`,
      [inicio, fin],
    );
    const top = await this.db.query<{
      descripcion: string;
      cantidad: string;
      total: string;
    }>(
      `SELECT vl.descripcion, sum(vl.cantidad)::numeric(16,3) AS cantidad,
              sum(vl.total)::numeric(16,2) AS total
       FROM venta_lineas vl JOIN ventas v ON v.id = vl.venta_id
       WHERE vl.tipo = 'servicio' AND v.estado = 'completada'
         AND v.fecha >= $1 AND v.fecha < $2
       GROUP BY vl.descripcion ORDER BY sum(vl.total) DESC LIMIT 1`,
      [inicio, fin],
    );
    const { ganancia, ...resto } = r.rows[0];
    return {
      ...resto,
      mas_vendido: top.rows[0] ?? null,
      ...(verGanancia ? { ganancia } : {}),
    };
  }

  // Lo que debería haber ahora en cada caja abierta (no depende del período).
  private async caja() {
    const r = await this.db.query<{
      caja: string;
      usuario: string;
      abierta_en: string;
      esperado: string;
      esperado_usd: string;
    }>(
      `SELECT c.nombre AS caja, u.username AS usuario, s.abierta_en,
              (s.fondo_inicial + COALESCE((SELECT sum(m.monto * ${SQL_SIGNO_CAJA})
                 FROM caja_movimientos m WHERE m.sesion_id = s.id), 0))::numeric(14,2)
                AS esperado,
              (s.fondo_inicial_usd + COALESCE((SELECT sum(m.monto * ${SQL_SIGNO_CAJA_USD})
                 FROM caja_movimientos_usd m WHERE m.sesion_id = s.id), 0))::numeric(14,2)
                AS esperado_usd
       FROM caja_sesiones s
       JOIN cajas c ON c.id = s.caja_id
       JOIN usuarios u ON u.id = s.abierta_por
       WHERE s.estado = 'abierta'
       ORDER BY lower(c.nombre)`,
    );
    const total = await this.db.query<{ total: string; total_usd: string }>(
      `SELECT COALESCE((SELECT sum(x) FROM unnest($1::numeric[]) x), 0)::numeric(16,2) AS total,
              COALESCE((SELECT sum(x) FROM unnest($2::numeric[]) x), 0)::numeric(16,2) AS total_usd`,
      [r.rows.map((f) => f.esperado), r.rows.map((f) => f.esperado_usd)],
    );
    return {
      abiertas: r.rows,
      total: total.rows[0].total,
      // Dólares en las cajas abiertas (aparte de los pesos).
      total_usd: total.rows[0].total_usd,
    };
  }

  // Envíos a Haití del período. Lo que gana SCITO y lo que deben los agentes
  // solo con el permiso de cuentas de agentes.
  private async remesas(inicio: string, fin: string, verDinero: boolean) {
    const r = await this.db.query<{
      confirmados: number;
      enviado: string;
      recibido: string;
      comision: string;
      comision_agentes: string;
      pendientes: number;
      rechazados: number;
    }>(
      `SELECT count(*) FILTER (WHERE estado = 'confirmado')::int AS confirmados,
              COALESCE(sum(monto_enviado) FILTER (WHERE estado = 'confirmado'), 0)::numeric(16,2) AS enviado,
              COALESCE(sum(monto_recibir) FILTER (WHERE estado = 'confirmado'), 0)::numeric(16,2) AS recibido,
              COALESCE(sum(comision) FILTER (WHERE estado = 'confirmado'), 0)::numeric(16,2) AS comision,
              COALESCE(sum(comision_agente) FILTER (WHERE estado = 'confirmado'), 0)::numeric(16,2) AS comision_agentes,
              count(*) FILTER (WHERE estado = 'rechazado')::int AS rechazados,
              (SELECT count(*)::int FROM remesas WHERE estado = 'pendiente') AS pendientes
       FROM remesas
       WHERE origen = 'sistema' AND fecha >= $1 AND fecha < $2`,
      [inicio, fin],
    );
    const f = r.rows[0];
    const base = {
      confirmados: f.confirmados,
      enviado: f.enviado,
      recibido: f.recibido,
      pendientes: f.pendientes,
      rechazados: f.rechazados,
    };
    if (!verDinero) return base;
    const deuda = await this.db.query<{ debe: string; agentes: number }>(
      `SELECT COALESCE(sum(d.debe), 0)::numeric(16,2) AS debe,
              count(*) FILTER (WHERE d.debe > 0)::int AS agentes
       FROM (
         SELECT a.id,
                COALESCE((SELECT sum(total_pagar) FROM remesas r
                          WHERE r.agente_id = a.id AND r.estado = 'confirmado'
                            AND r.origen = 'sistema'), 0)
              - COALESCE((SELECT sum(monto) FROM remesa_entregas e
                          WHERE e.agente_id = a.id), 0) AS debe
         FROM remesa_agentes a
       ) d`,
    );
    const ganancia = await this.db.query<{ v: string }>(
      'SELECT ($1::numeric - $2::numeric)::numeric(16,2) AS v',
      [f.comision, f.comision_agentes],
    );
    return {
      ...base,
      comision: f.comision,
      comision_agentes: f.comision_agentes,
      comision_scito: ganancia.rows[0].v,
      agentes_deben: deuda.rows[0].debe,
      agentes_con_deuda: deuda.rows[0].agentes,
    };
  }

  // Saldo de las cuentas activas por moneda (ahora, no depende del período).
  private async bancos() {
    const r = await this.db.query<{
      moneda: string;
      simbolo: string;
      confirmado: string;
      por_confirmar: string;
      cuentas: number;
    }>(
      `SELECT ct.moneda, mo.simbolo,
              COALESCE(sum(s.confirmado), 0)::numeric(16,2) AS confirmado,
              COALESCE(sum(s.por_confirmar), 0)::numeric(16,2) AS por_confirmar,
              count(*)::int AS cuentas
       FROM cuentas ct
       JOIN monedas mo ON mo.codigo = ct.moneda
       LEFT JOIN (${SQL_SALDOS}) s ON s.cuenta_id = ct.id
       WHERE ct.is_active
       GROUP BY ct.moneda, mo.simbolo, mo.orden
       ORDER BY mo.orden`,
    );
    const avisos = await this.db.query<{
      pendientes: number;
      no_llegaron: number;
    }>(
      `SELECT count(*) FILTER (WHERE x.estado = 'por_confirmar' AND ct.is_active)::int AS pendientes,
              count(*) FILTER (WHERE ${SQL_NO_LLEGO_PENDIENTE})::int AS no_llegaron
       FROM ${SQL_MOVS_CON_ESTADO} x
       JOIN cuentas ct ON ct.id = x.cuenta_id
       LEFT JOIN ventas v ON v.id = x.venta_id`,
    );
    return { monedas: r.rows, ...avisos.rows[0] };
  }

  private async inventario(verCostos: boolean) {
    const base = `FROM productos p ${SQL_TOTALES_PRODUCTO}
      CROSS JOIN LATERAL (
        SELECT COALESCE(p.stock_minimo, $1::numeric) AS minimo) mn
      WHERE p.is_active`;
    const [res, criticos] = await Promise.all([
      this.db.query<{
        productos: number;
        bajo: number;
        agotado: number;
        valor: string;
      }>(
        `SELECT count(*)::int AS productos,
                count(*) FILTER (WHERE mv.existencia > 0 AND mv.existencia <= mn.minimo)::int AS bajo,
                count(*) FILTER (WHERE mv.existencia <= 0)::int AS agotado,
                COALESCE(sum(round(mv.existencia * p.costo, 2)), 0)::numeric(16,2) AS valor
         ${base}`,
        [STOCK_MINIMO_POR_DEFECTO],
      ),
      this.db.query<{
        codigo: string;
        nombre: string;
        existencia: string;
        minimo: string;
      }>(
        `SELECT p.codigo, p.nombre, mv.existencia, mn.minimo::numeric(14,3) AS minimo
         ${base} AND mv.existencia <= mn.minimo
         ORDER BY mv.existencia - mn.minimo, p.codigo
         LIMIT 5`,
        [STOCK_MINIMO_POR_DEFECTO],
      ),
    ]);
    const { valor, ...resto } = res.rows[0];
    return {
      ...resto,
      ...(verCostos ? { valor_al_costo: valor } : {}),
      criticos: criticos.rows,
    };
  }
}
