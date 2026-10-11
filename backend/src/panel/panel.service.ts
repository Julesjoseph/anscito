import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  SQL_MOVS_CON_ESTADO,
  SQL_NO_LLEGO_PENDIENTE,
  SQL_SALDOS,
} from '../bancos/sql';
import { SQL_SIGNO_CAJA } from '../caja/sql';
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
    return resultado;
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

  // Lo que debería haber ahora en cada caja abierta (no depende del período).
  private async caja() {
    const r = await this.db.query<{
      caja: string;
      usuario: string;
      abierta_en: string;
      esperado: string;
    }>(
      `SELECT c.nombre AS caja, u.username AS usuario, s.abierta_en,
              (s.fondo_inicial + COALESCE((SELECT sum(m.monto * ${SQL_SIGNO_CAJA})
                 FROM caja_movimientos m WHERE m.sesion_id = s.id), 0))::numeric(14,2)
                AS esperado
       FROM caja_sesiones s
       JOIN cajas c ON c.id = s.caja_id
       JOIN usuarios u ON u.id = s.abierta_por
       WHERE s.estado = 'abierta'
       ORDER BY lower(c.nombre)`,
    );
    const total = await this.db.query<{ total: string }>(
      `SELECT COALESCE(sum(x), 0)::numeric(16,2) AS total
       FROM unnest($1::numeric[]) x`,
      [r.rows.map((f) => f.esperado)],
    );
    return { abiertas: r.rows, total: total.rows[0].total };
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
