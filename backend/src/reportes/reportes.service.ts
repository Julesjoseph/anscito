import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SQL_MOVS_CON_ESTADO } from '../bancos/sql';
import { DatabaseService } from '../database/database.service';
import { SQL_SIGNO } from '../inventario/sql';
import { enmascarar } from '../terceros/documentos';
import { aExcel, aPdf } from './exportar';
import { calcularTotales } from './tipos';
import type { Columna, Fila, Reporte } from './tipos';

// Reportes por período (desde/hasta en hora de República Dominicana).
// Cada reporte arma columnas y filas; los mismos datos se ven en pantalla y
// se exportan a Excel o PDF. Los costos, la ganancia y la comisión de SCITO
// solo salen con el permiso que corresponde (igual que en el Panel).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Area =
  'ventas' | 'envios' | 'caja_bancos' | 'inventario' | 'clientes';

export const REPORTES: Record<string, { area: Area; titulo: string }> = {
  'ventas-dia': { area: 'ventas', titulo: 'Ventas por día' },
  'ventas-articulo': {
    area: 'ventas',
    titulo: 'Ventas por servicio y producto',
  },
  'ventas-vendedor': { area: 'ventas', titulo: 'Ventas por vendedor' },
  'envios-agente': { area: 'envios', titulo: 'Envíos por agente' },
  'estado-agente': { area: 'envios', titulo: 'Estado de cuenta del agente' },
  'envios-detalle': { area: 'envios', titulo: 'Detalle de envíos' },
  'cierres-caja': { area: 'caja_bancos', titulo: 'Cierres de caja' },
  'movimientos-cuenta': {
    area: 'caja_bancos',
    titulo: 'Movimientos de una cuenta',
  },
  'gastos-categoria': { area: 'caja_bancos', titulo: 'Gastos por categoría' },
  inventario: {
    area: 'inventario',
    titulo: 'Existencia y valor del inventario',
  },
  'clientes-servicio': { area: 'clientes', titulo: 'Clientes por servicio' },
  'clientes-general': { area: 'clientes', titulo: 'Clientes y sus servicios' },
};

// Servicios del reporte "Clientes por servicio".
export const SERVICIOS_CLIENTES: Record<string, string> = {
  transfer: 'SCITO TRANSFER (remitentes)',
  solcash: 'SOL CASH (participantes)',
  facturacion: 'Facturación (compras)',
  credito_fiscal: 'Crédito Fiscal (contribuyentes)',
};

export type Filtros = {
  desde?: string;
  hasta?: string;
  agenteId?: string;
  cuentaId?: string;
  estado?: string;
  servicio?: string;
};

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function fechaValida(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function dma(v: string): string {
  const [a, m, d] = v.split('-');
  return `${d}/${m}/${a}`;
}

const NOMBRE_TIPO_CUENTA: Record<string, string> = {
  saldo_inicial: 'Saldo inicial',
  venta: 'Cobro de venta',
  devolucion: 'Devolución de venta',
  transferencia_entrada: 'Transferencia recibida',
  transferencia_salida: 'Transferencia enviada',
  pago: 'Pago',
  cargo: 'Cargo del banco',
  interes: 'Intereses',
  ingreso: 'Otro ingreso',
  reverso: 'Reverso',
  remesa: 'Envío a Haití',
  san_cuota: 'Cuota de SOL CASH',
  san_mano: 'Mano de SOL CASH',
  compra: 'Pago de compra',
};

// Ganancia de una línea de venta "vl" (misma regla que el Panel).
const SQL_GANANCIA_LINEA = `CASE
  WHEN vl.comision_pct IS NOT NULL THEN round(vl.base * vl.comision_pct / 100, 2)
  WHEN vl.costo_unitario IS NOT NULL THEN vl.base - round(vl.costo_unitario * vl.cantidad, 2)
  ELSE vl.base END`;

type Contexto = {
  zona: string;
  desde: string;
  hasta: string;
  periodo: string;
  permisos: Set<string>;
};

@Injectable()
export class ReportesService {
  constructor(private readonly db: DatabaseService) {}

  private async permisos(usuarioId: string): Promise<Set<string>> {
    const r = await this.db.query<{ codigo: string }>(
      `SELECT DISTINCT p.codigo FROM usuario_roles ur
       JOIN roles ro ON ro.id = ur.rol_id AND ro.is_active
       JOIN rol_permisos rp ON rp.rol_id = ro.id
       JOIN permisos p ON p.id = rp.permiso_id
       WHERE ur.usuario_id = $1`,
      [usuarioId],
    );
    return new Set(r.rows.map((f) => f.codigo));
  }

  private async contexto(usuarioId: string, f: Filtros): Promise<Contexto> {
    const zona = (
      await this.db.query<{ valor: string }>(
        `SELECT valor FROM configuracion WHERE clave = 'empresa.zona_horaria'`,
      )
    ).rows[0].valor;
    const hoy = (
      await this.db.query<{ hoy: string; mes: string }>(
        `SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS hoy,
                to_char(date_trunc('month', now() AT TIME ZONE $1), 'YYYY-MM-DD') AS mes`,
        [zona],
      )
    ).rows[0];
    // Sin fechas: el mes en curso.
    const desde = texto(f.desde) || hoy.mes;
    const hasta = texto(f.hasta) || hoy.hoy;
    if (!fechaValida(desde) || !fechaValida(hasta))
      throw new BadRequestException('Fecha inválida (use AAAA-MM-DD)');
    if (desde > hasta)
      throw new BadRequestException('La fecha "desde" es posterior a "hasta"');
    return {
      zona,
      desde,
      hasta,
      periodo:
        desde === hasta
          ? `Día ${dma(desde)}`
          : `Del ${dma(desde)} al ${dma(hasta)}`,
      permisos: await this.permisos(usuarioId),
    };
  }

  private armar(
    codigo: string,
    cx: Contexto,
    columnas: Columna[],
    filas: Fila[],
    extra: {
      detalle?: string;
      notas?: string[];
      periodo?: string;
      totales?: Fila | null;
    } = {},
  ): Reporte {
    return {
      codigo,
      titulo: REPORTES[codigo].titulo,
      periodo: extra.periodo ?? cx.periodo,
      detalle: extra.detalle,
      columnas,
      filas,
      totales:
        extra.totales === undefined
          ? calcularTotales(columnas, filas)
          : extra.totales,
      notas: extra.notas ?? [],
    };
  }

  // Opciones para los filtros según los permisos del usuario.
  async opciones(usuarioId: string) {
    const p = await this.permisos(usuarioId);
    const areas = (
      ['ventas', 'envios', 'caja_bancos', 'inventario', 'clientes'] as Area[]
    ).filter((a) => p.has(`reportes.${a}`));
    const [agentes, cuentas] = await Promise.all([
      p.has('reportes.envios')
        ? this.db.query(
            `SELECT id, codigo, nombre, is_active FROM remesa_agentes ORDER BY is_active DESC, codigo`,
          )
        : null,
      p.has('reportes.caja_bancos')
        ? this.db.query(
            `SELECT ct.id, ct.nombre, ct.moneda, mo.simbolo, ct.is_active
             FROM cuentas ct JOIN monedas mo ON mo.codigo = ct.moneda
             ORDER BY ct.is_active DESC, ct.tipo, lower(ct.nombre)`,
          )
        : null,
    ]);
    return {
      reportes: Object.entries(REPORTES)
        .filter(([, r]) => areas.includes(r.area))
        .map(([codigo, r]) => ({ codigo, ...r })),
      agentes: agentes?.rows ?? [],
      cuentas: cuentas?.rows ?? [],
      servicios: Object.entries(SERVICIOS_CLIENTES).map(([codigo, nombre]) => ({
        codigo,
        nombre,
      })),
    };
  }

  async generar(
    usuarioId: string,
    codigo: string,
    f: Filtros,
  ): Promise<Reporte> {
    const def = REPORTES[codigo];
    if (!def) throw new NotFoundException('Reporte no encontrado');
    const cx = await this.contexto(usuarioId, f);
    if (!cx.permisos.has(`reportes.${def.area}`))
      throw new ForbiddenException('No tiene permiso para este reporte');
    switch (codigo) {
      case 'ventas-dia':
        return this.ventasDia(cx);
      case 'ventas-articulo':
        return this.ventasArticulo(cx);
      case 'ventas-vendedor':
        return this.ventasVendedor(cx);
      case 'envios-agente':
        return this.enviosAgente(cx);
      case 'estado-agente':
        return this.estadoAgente(cx, texto(f.agenteId));
      case 'envios-detalle':
        return this.enviosDetalle(cx, texto(f.agenteId), texto(f.estado));
      case 'cierres-caja':
        return this.cierresCaja(cx);
      case 'movimientos-cuenta':
        return this.movimientosCuenta(cx, texto(f.cuentaId));
      case 'gastos-categoria':
        return this.gastosCategoria(cx);
      case 'clientes-servicio':
        return this.clientesServicio(cx, texto(f.servicio));
      case 'clientes-general':
        return this.clientesGeneral(cx);
      default:
        return this.inventario(cx);
    }
  }

  async exportar(
    usuarioId: string,
    codigo: string,
    f: Filtros,
    formato: string,
  ) {
    if (formato !== 'xlsx' && formato !== 'pdf')
      throw new BadRequestException('Formato inválido: xlsx o pdf');
    const r = await this.generar(usuarioId, codigo, f);
    const e = (
      await this.db.query<{ nombre_comercial: string; rnc: string | null }>(
        'SELECT nombre_comercial, rnc FROM empresa WHERE id = 1',
      )
    ).rows[0];
    const zona = (
      await this.db.query<{ valor: string }>(
        `SELECT valor FROM configuracion WHERE clave = 'empresa.zona_horaria'`,
      )
    ).rows[0].valor;
    const enc = {
      empresa: e.nombre_comercial,
      rnc: e.rnc,
      generado: new Intl.DateTimeFormat('es-DO', {
        timeZone: zona,
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date()),
    };
    const archivo =
      formato === 'xlsx' ? await aExcel(r, enc) : await aPdf(r, enc);
    const nombre = `${codigo}_${f.desde || ''}_${f.hasta || ''}`.replace(
      /_+$/,
      '',
    );
    return { archivo, nombre: `${nombre}.${formato}` };
  }

  // ---------- 1. Ventas por día ----------
  private async ventasDia(cx: Contexto) {
    const r = await this.db.query(
      `SELECT to_char(x.dia, 'YYYY-MM-DD') AS dia,
              count(*) FILTER (WHERE x.estado = 'completada')::int AS ventas,
              COALESCE(sum(x.subtotal) FILTER (WHERE x.estado = 'completada'), 0)::numeric(16,2) AS subtotal,
              COALESCE(sum(x.descuento) FILTER (WHERE x.estado = 'completada'), 0)::numeric(16,2) AS descuento,
              COALESCE(sum(x.base_imponible) FILTER (WHERE x.estado = 'completada'), 0)::numeric(16,2) AS base,
              COALESCE(sum(x.itbis) FILTER (WHERE x.estado = 'completada'), 0)::numeric(16,2) AS itbis,
              COALESCE(sum(x.total) FILTER (WHERE x.estado = 'completada'), 0)::numeric(16,2) AS total,
              COALESCE(sum(x.efectivo) FILTER (WHERE x.estado = 'completada'), 0)::numeric(16,2) AS efectivo,
              COALESCE(sum(x.cuenta) FILTER (WHERE x.estado = 'completada'), 0)::numeric(16,2) AS transferencia,
              count(*) FILTER (WHERE x.estado = 'anulada')::int AS anuladas,
              COALESCE(sum(x.total) FILTER (WHERE x.estado = 'anulada'), 0)::numeric(16,2) AS total_anulado
       FROM (
         SELECT v.*, (v.fecha AT TIME ZONE $1)::date AS dia,
                (SELECT COALESCE(sum(vp.monto), 0) FROM venta_pagos vp
                   JOIN formas_pago fp ON fp.id = vp.forma_pago_id
                  WHERE vp.venta_id = v.id AND fp.usa_caja) AS efectivo,
                (SELECT COALESCE(sum(vp.monto), 0) FROM venta_pagos vp
                   JOIN formas_pago fp ON fp.id = vp.forma_pago_id
                  WHERE vp.venta_id = v.id AND NOT fp.usa_caja) AS cuenta
         FROM ventas v
         WHERE (v.fecha AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
       ) x
       GROUP BY x.dia ORDER BY x.dia`,
      [cx.zona, cx.desde, cx.hasta],
    );
    return this.armar(
      'ventas-dia',
      cx,
      [
        { clave: 'dia', titulo: 'Día', tipo: 'fecha' },
        { clave: 'ventas', titulo: 'Ventas', tipo: 'entero', total: true },
        { clave: 'subtotal', titulo: 'Subtotal', tipo: 'dinero', total: true },
        {
          clave: 'descuento',
          titulo: 'Descuentos',
          tipo: 'dinero',
          total: true,
        },
        {
          clave: 'base',
          titulo: 'Base imponible',
          tipo: 'dinero',
          total: true,
        },
        { clave: 'itbis', titulo: 'ITBIS', tipo: 'dinero', total: true },
        {
          clave: 'total',
          titulo: 'Total vendido',
          tipo: 'dinero',
          total: true,
        },
        { clave: 'efectivo', titulo: 'Efectivo', tipo: 'dinero', total: true },
        {
          clave: 'transferencia',
          titulo: 'Transferencia',
          tipo: 'dinero',
          total: true,
        },
        { clave: 'anuladas', titulo: 'Anuladas', tipo: 'entero', total: true },
        {
          clave: 'total_anulado',
          titulo: 'Monto anulado',
          tipo: 'dinero',
          total: true,
        },
      ],
      r.rows,
      {
        notas: [
          'Los totales no incluyen las ventas anuladas (se muestran aparte).',
        ],
      },
    );
  }

  // ---------- 2. Ventas por servicio y producto ----------
  private async ventasArticulo(cx: Contexto) {
    const costos = cx.permisos.has('inventario.ver_costos');
    const r = await this.db.query(
      `SELECT CASE WHEN vl.tipo = 'servicio' THEN 'Servicio' ELSE 'Producto' END AS tipo,
              vl.codigo, vl.descripcion,
              sum(vl.cantidad)::numeric(16,3) AS cantidad,
              count(DISTINCT vl.venta_id)::int AS ventas,
              sum(vl.base)::numeric(16,2) AS base,
              sum(vl.itbis)::numeric(16,2) AS itbis,
              sum(vl.total)::numeric(16,2) AS total,
              sum(vl.base - (${SQL_GANANCIA_LINEA}))::numeric(16,2) AS costo,
              sum(${SQL_GANANCIA_LINEA})::numeric(16,2) AS ganancia,
              CASE WHEN sum(vl.base) > 0
                   THEN round(sum(${SQL_GANANCIA_LINEA}) * 100 / sum(vl.base), 1) END AS margen
       FROM venta_lineas vl JOIN ventas v ON v.id = vl.venta_id
       WHERE v.estado = 'completada'
         AND (v.fecha AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
       GROUP BY vl.tipo, vl.codigo, vl.descripcion
       ORDER BY sum(vl.total) DESC`,
      [cx.zona, cx.desde, cx.hasta],
    );
    const columnas: Columna[] = [
      { clave: 'tipo', titulo: 'Tipo', tipo: 'texto' },
      { clave: 'codigo', titulo: 'Código', tipo: 'texto' },
      { clave: 'descripcion', titulo: 'Descripción', tipo: 'texto' },
      { clave: 'cantidad', titulo: 'Cantidad', tipo: 'cantidad', total: true },
      { clave: 'ventas', titulo: 'En ventas', tipo: 'entero' },
      { clave: 'base', titulo: 'Venta sin ITBIS', tipo: 'dinero', total: true },
      { clave: 'itbis', titulo: 'ITBIS', tipo: 'dinero', total: true },
      { clave: 'total', titulo: 'Total', tipo: 'dinero', total: true },
    ];
    if (costos)
      columnas.push(
        { clave: 'costo', titulo: 'Costo', tipo: 'dinero', total: true },
        { clave: 'ganancia', titulo: 'Ganancia', tipo: 'dinero', total: true },
        { clave: 'margen', titulo: 'Margen', tipo: 'porcentaje' },
      );
    return this.armar('ventas-articulo', cx, columnas, r.rows, {
      notas: costos
        ? [
            'Ganancia sin ITBIS: servicios por su comisión %, o precio menos costo; productos al costo promedio del momento de la venta. Sin ventas anuladas.',
          ]
        : ['Sin ventas anuladas.'],
    });
  }

  // ---------- 3. Ventas por vendedor ----------
  private async ventasVendedor(cx: Contexto) {
    const costos = cx.permisos.has('inventario.ver_costos');
    const r = await this.db.query(
      `SELECT u.username AS usuario, trim(u.nombre || ' ' || u.apellido) AS nombre,
              count(*) FILTER (WHERE v.estado = 'completada')::int AS ventas,
              COALESCE(sum(v.total) FILTER (WHERE v.estado = 'completada'), 0)::numeric(16,2) AS total,
              COALESCE(sum(v.descuento) FILTER (WHERE v.estado = 'completada'), 0)::numeric(16,2) AS descuento,
              COALESCE(sum(v.itbis) FILTER (WHERE v.estado = 'completada'), 0)::numeric(16,2) AS itbis,
              COALESCE(sum((SELECT sum(${SQL_GANANCIA_LINEA}) FROM venta_lineas vl WHERE vl.venta_id = v.id))
                FILTER (WHERE v.estado = 'completada'), 0)::numeric(16,2) AS ganancia,
              count(*) FILTER (WHERE v.estado = 'anulada')::int AS anuladas
       FROM ventas v JOIN usuarios u ON u.id = v.usuario_id
       WHERE (v.fecha AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
       GROUP BY u.username, u.nombre, u.apellido
       ORDER BY 4 DESC`,
      [cx.zona, cx.desde, cx.hasta],
    );
    const columnas: Columna[] = [
      { clave: 'usuario', titulo: 'Usuario', tipo: 'texto' },
      { clave: 'nombre', titulo: 'Nombre', tipo: 'texto' },
      { clave: 'ventas', titulo: 'Ventas', tipo: 'entero', total: true },
      { clave: 'total', titulo: 'Total vendido', tipo: 'dinero', total: true },
      {
        clave: 'descuento',
        titulo: 'Descuentos dados',
        tipo: 'dinero',
        total: true,
      },
      { clave: 'itbis', titulo: 'ITBIS', tipo: 'dinero', total: true },
    ];
    if (costos)
      columnas.push({
        clave: 'ganancia',
        titulo: 'Ganancia',
        tipo: 'dinero',
        total: true,
      });
    columnas.push({
      clave: 'anuladas',
      titulo: 'Anuladas',
      tipo: 'entero',
      total: true,
    });
    return this.armar('ventas-vendedor', cx, columnas, r.rows, {
      notas: ['Cada venta cuenta para el usuario que la registró.'],
    });
  }

  // ---------- 4. Envíos por agente ----------
  private async enviosAgente(cx: Contexto) {
    const dinero = cx.permisos.has('remesas.entregas');
    const r = await this.db.query(
      `SELECT a.codigo, a.nombre,
              CASE WHEN a.tipo = 'propio' THEN 'Punto propio' ELSE 'Autorizado' END AS tipo,
              count(*) FILTER (WHERE r.estado = 'confirmado')::int AS confirmados,
              count(*) FILTER (WHERE r.estado = 'pendiente')::int AS pendientes,
              count(*) FILTER (WHERE r.estado = 'rechazado')::int AS rechazados,
              COALESCE(sum(r.monto_enviado) FILTER (WHERE r.estado = 'confirmado'), 0)::numeric(16,2) AS enviado,
              COALESCE(sum(r.monto_recibir) FILTER (WHERE r.estado = 'confirmado'), 0)::numeric(16,2) AS recibido,
              COALESCE(sum(r.comision) FILTER (WHERE r.estado = 'confirmado'), 0)::numeric(16,2) AS comision,
              COALESCE(sum(r.comision_agente) FILTER (WHERE r.estado = 'confirmado'), 0)::numeric(16,2) AS comision_agente,
              COALESCE(sum(r.comision - r.comision_agente) FILTER (WHERE r.estado = 'confirmado'), 0)::numeric(16,2) AS comision_scito,
              COALESCE(sum(r.total_pagar) FILTER (WHERE r.estado = 'confirmado'), 0)::numeric(16,2) AS cobrado
       FROM remesas r JOIN remesa_agentes a ON a.id = r.agente_id
       WHERE (r.fecha AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
       GROUP BY a.codigo, a.nombre, a.tipo
       ORDER BY a.codigo`,
      [cx.zona, cx.desde, cx.hasta],
    );
    const columnas: Columna[] = [
      { clave: 'codigo', titulo: 'Agente', tipo: 'texto' },
      { clave: 'nombre', titulo: 'Nombre', tipo: 'texto' },
      { clave: 'tipo', titulo: 'Tipo', tipo: 'texto' },
      {
        clave: 'confirmados',
        titulo: 'Confirmados',
        tipo: 'entero',
        total: true,
      },
      {
        clave: 'pendientes',
        titulo: 'Pendientes',
        tipo: 'entero',
        total: true,
      },
      {
        clave: 'rechazados',
        titulo: 'Rechazados',
        tipo: 'entero',
        total: true,
      },
      { clave: 'enviado', titulo: 'Enviado RD$', tipo: 'dinero', total: true },
      {
        clave: 'recibido',
        titulo: 'Recibieron HTG',
        tipo: 'dinero',
        total: true,
      },
    ];
    if (dinero)
      columnas.push(
        { clave: 'comision', titulo: 'Comisión', tipo: 'dinero', total: true },
        {
          clave: 'comision_agente',
          titulo: 'Para el agente',
          tipo: 'dinero',
          total: true,
        },
        {
          clave: 'comision_scito',
          titulo: 'Para SCITO',
          tipo: 'dinero',
          total: true,
        },
      );
    columnas.push({
      clave: 'cobrado',
      titulo: 'Total cobrado',
      tipo: 'dinero',
      total: true,
    });
    return this.armar('envios-agente', cx, columnas, r.rows, {
      notas: [
        'Montos de envíos confirmados; los pendientes y rechazados solo se cuentan.',
      ],
    });
  }

  // ---------- 5. Estado de cuenta del agente ----------
  private async estadoAgente(cx: Contexto, agenteId: string) {
    if (!UUID.test(agenteId))
      throw new BadRequestException('Seleccione el agente');
    const ag = await this.db.query<{ codigo: string; nombre: string }>(
      'SELECT codigo, nombre FROM remesa_agentes WHERE id = $1',
      [agenteId],
    );
    if (ag.rowCount === 0) throw new NotFoundException('Agente no encontrado');
    const fecha = `(x.momento AT TIME ZONE $2)::date`;
    // Todo lo que mueve la cuenta del agente, en orden.
    const movimientos = `(
      SELECT r.resuelto_en AS momento, 'Envío ' || 'E-' || lpad(r.numero::text, 6, '0')
               || ' · ' || r.beneficiario_nombre AS concepto,
             r.codigo_externo AS referencia, r.total_pagar AS cargo, 0::numeric AS abono,
             r.comision_agente AS comision_ganada, 0::numeric AS comision_pagada, 1 AS orden
      FROM remesas r
      WHERE r.agente_id = $1 AND r.estado = 'confirmado' AND r.origen = 'sistema'
      UNION ALL
      SELECT (e.dia + time '23:59') AT TIME ZONE $2, 'Entrega ' || CASE WHEN e.forma = 'efectivo' THEN 'en efectivo' ELSE 'por depósito' END,
             e.referencia, 0, e.monto, 0, 0, 2
      FROM remesa_entregas e WHERE e.agente_id = $1
      UNION ALL
      SELECT p.created_at, 'Pago de comisión (' || p.cantidad || ' envíos, ' || to_char(p.desde, 'DD/MM') || ' a ' || to_char(p.hasta, 'DD/MM') || ')',
             p.referencia, 0, 0, 0, p.monto, 3
      FROM remesa_pagos_comision p WHERE p.agente_id = $1
    )`;
    const [antes, filas] = await Promise.all([
      this.db.query<{ saldo: string; comision: string }>(
        `SELECT COALESCE(sum(x.cargo - x.abono), 0)::numeric(16,2) AS saldo,
                COALESCE(sum(x.comision_ganada - x.comision_pagada), 0)::numeric(16,2) AS comision
         FROM ${movimientos} x WHERE ${fecha} < $3::date`,
        [agenteId, cx.zona, cx.desde],
      ),
      this.db.query<Record<string, string>>(
        `SELECT to_char(${fecha}, 'YYYY-MM-DD') AS fecha, x.concepto, x.referencia,
                x.cargo::numeric(16,2) AS cargo, x.abono::numeric(16,2) AS abono,
                x.comision_ganada::numeric(16,2) AS comision_ganada,
                x.comision_pagada::numeric(16,2) AS comision_pagada
         FROM ${movimientos} x
         WHERE ${fecha} BETWEEN $3::date AND $4::date
         ORDER BY x.momento, x.orden`,
        [agenteId, cx.zona, cx.desde, cx.hasta],
      ),
    ]);
    // Saldos corridos con enteros (centavos).
    const c = (v: string) => {
      const neg = v.startsWith('-');
      const [e, d = ''] = (neg ? v.slice(1) : v).split('.');
      const n = BigInt(e || '0') * 100n + BigInt((d + '00').slice(0, 2));
      return neg ? -n : n;
    };
    const t = (n: bigint) =>
      `${n < 0n ? '-' : ''}${(n < 0n ? -n : n) / 100n}.${String((n < 0n ? -n : n) % 100n).padStart(2, '0')}`;
    let saldo = c(antes.rows[0].saldo);
    let comision = c(antes.rows[0].comision);
    const rows: Fila[] = [
      {
        fecha: cx.desde,
        concepto: 'Saldo anterior',
        referencia: null,
        cargo: null,
        abono: null,
        saldo: t(saldo),
        comision_ganada: null,
        comision_pagada: null,
        comision_pendiente: t(comision),
      },
    ];
    for (const f of filas.rows) {
      saldo += c(f.cargo) - c(f.abono);
      comision += c(f.comision_ganada) - c(f.comision_pagada);
      rows.push({ ...f, saldo: t(saldo), comision_pendiente: t(comision) });
    }
    const columnas: Columna[] = [
      { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha' },
      { clave: 'concepto', titulo: 'Concepto', tipo: 'texto' },
      { clave: 'referencia', titulo: 'Referencia', tipo: 'texto' },
      { clave: 'cargo', titulo: 'Debe entregar', tipo: 'dinero', total: true },
      { clave: 'abono', titulo: 'Entregó', tipo: 'dinero', total: true },
      { clave: 'saldo', titulo: 'Saldo que debe', tipo: 'dinero' },
      {
        clave: 'comision_ganada',
        titulo: 'Comisión ganada',
        tipo: 'dinero',
        total: true,
      },
      {
        clave: 'comision_pagada',
        titulo: 'Comisión pagada',
        tipo: 'dinero',
        total: true,
      },
      {
        clave: 'comision_pendiente',
        titulo: 'Comisión por pagar',
        tipo: 'dinero',
      },
    ];
    return this.armar('estado-agente', cx, columnas, rows, {
      detalle: `${ag.rows[0].codigo} ${ag.rows[0].nombre}`,
      totales: calcularTotales(columnas, rows.slice(1)),
      notas: [
        'Debe entregar = total cobrado (envío + comisión) de cada envío confirmado. La comisión del agente se le paga aparte.',
      ],
    });
  }

  // ---------- 6. Detalle de envíos ----------
  private async enviosDetalle(cx: Contexto, agenteId: string, estado: string) {
    const dinero = cx.permisos.has('remesas.entregas');
    const params: unknown[] = [cx.zona, cx.desde, cx.hasta];
    const cond: string[] = [];
    if (agenteId) {
      if (!UUID.test(agenteId))
        throw new BadRequestException('Agente inválido');
      params.push(agenteId);
      cond.push(`r.agente_id = $${params.length}`);
    }
    if (estado && estado !== 'todos') {
      if (!['pendiente', 'confirmado', 'rechazado'].includes(estado))
        throw new BadRequestException('Estado inválido');
      params.push(estado);
      cond.push(`r.estado = $${params.length}`);
    }
    const r = await this.db.query(
      `SELECT 'E-' || lpad(r.numero::text, 6, '0') AS numero,
              to_char(r.fecha AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI') AS fecha, a.codigo AS agente,
              r.remitente_nombre AS remitente, r.beneficiario_nombre AS beneficiario,
              r.beneficiario_telefono AS telefono, ct.nombre AS billetera,
              r.monto_enviado AS enviado, r.monto_recibir AS recibido, r.comision,
              r.comision_agente, r.total_pagar AS total,
              CASE r.estado WHEN 'confirmado' THEN 'Confirmado' WHEN 'pendiente' THEN 'Pendiente'
                            ELSE 'Rechazado' END AS estado,
              r.codigo_externo AS codigo
       FROM remesas r
       JOIN remesa_agentes a ON a.id = r.agente_id
       LEFT JOIN cuentas ct ON ct.id = r.cuenta_id
       WHERE (r.fecha AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
         ${cond.length ? 'AND ' + cond.join(' AND ') : ''}
       ORDER BY r.numero`,
      params,
    );
    const columnas: Columna[] = [
      { clave: 'numero', titulo: 'Envío', tipo: 'texto' },
      { clave: 'fecha', titulo: 'Fecha', tipo: 'fechahora' },
      { clave: 'agente', titulo: 'Agente', tipo: 'texto' },
      { clave: 'remitente', titulo: 'Remitente', tipo: 'texto' },
      { clave: 'beneficiario', titulo: 'Beneficiario', tipo: 'texto' },
      { clave: 'telefono', titulo: 'Teléfono', tipo: 'texto' },
      { clave: 'billetera', titulo: 'Billetera', tipo: 'texto' },
      { clave: 'enviado', titulo: 'Enviado RD$', tipo: 'dinero', total: true },
      { clave: 'recibido', titulo: 'Recibe HTG', tipo: 'dinero', total: true },
    ];
    if (dinero)
      columnas.push(
        { clave: 'comision', titulo: 'Comisión', tipo: 'dinero', total: true },
        {
          clave: 'comision_agente',
          titulo: 'Agente',
          tipo: 'dinero',
          total: true,
        },
      );
    columnas.push(
      { clave: 'total', titulo: 'Total pagado', tipo: 'dinero', total: true },
      { clave: 'estado', titulo: 'Estado', tipo: 'texto' },
      { clave: 'codigo', titulo: 'Código NatCash/MonCash', tipo: 'texto' },
    );
    const agente = agenteId
      ? (
          await this.db.query<{ t: string }>(
            `SELECT codigo || ' ' || nombre AS t FROM remesa_agentes WHERE id = $1`,
            [agenteId],
          )
        ).rows[0]?.t
      : undefined;
    return this.armar('envios-detalle', cx, columnas, r.rows, {
      detalle:
        [agente, estado && estado !== 'todos' ? `solo ${estado}s` : '']
          .filter(Boolean)
          .join(' · ') || undefined,
      notas: ['Los totales suman todos los estados que aparecen en la lista.'],
    });
  }

  // ---------- 7. Cierres de caja ----------
  private async cierresCaja(cx: Contexto) {
    const r = await this.db.query(
      `SELECT 'S-' || lpad(s.numero::text, 6, '0') AS sesion, c.nombre AS caja,
              ua.username AS abrio,
              to_char(s.abierta_en AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI') AS abierta_en,
              to_char(s.cerrada_en AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI') AS cerrada_en,
              CASE WHEN s.estado = 'abierta' THEN 'Abierta' ELSE 'Cerrada' END AS estado,
              s.fondo_inicial AS fondo, t.ventas, t.ingresos, t.desde_cuentas, t.san_cuotas, t.gastos, t.retiros,
              t.devoluciones, t.depositos, t.san_manos, (t.compras - t.compras_devueltas)::numeric(16,2) AS compras,
              COALESCE(s.esperado, (s.fondo_inicial + t.ventas + t.ingresos + t.desde_cuentas
                + t.san_cuotas - t.gastos - t.retiros - t.devoluciones - t.depositos
                - t.san_manos - t.compras + t.compras_devueltas))::numeric(16,2) AS esperado,
              s.contado, s.diferencia, s.motivo_diferencia AS motivo
       FROM caja_sesiones s
       JOIN cajas c ON c.id = s.caja_id
       JOIN usuarios ua ON ua.id = s.abierta_por
       CROSS JOIN LATERAL (
         SELECT COALESCE(sum(monto) FILTER (WHERE tipo = 'venta'), 0)::numeric(16,2) AS ventas,
                COALESCE(sum(monto) FILTER (WHERE tipo = 'ingreso'), 0)::numeric(16,2) AS ingresos,
                COALESCE(sum(monto) FILTER (WHERE tipo = 'desde_cuenta'), 0)::numeric(16,2) AS desde_cuentas,
                COALESCE(sum(monto) FILTER (WHERE tipo = 'gasto'), 0)::numeric(16,2) AS gastos,
                COALESCE(sum(monto) FILTER (WHERE tipo = 'retiro'), 0)::numeric(16,2) AS retiros,
                COALESCE(sum(monto) FILTER (WHERE tipo = 'devolucion'), 0)::numeric(16,2) AS devoluciones,
                COALESCE(sum(monto) FILTER (WHERE tipo = 'deposito'), 0)::numeric(16,2) AS depositos,
                COALESCE(sum(monto) FILTER (WHERE tipo = 'san_cuota'), 0)::numeric(16,2) AS san_cuotas,
                COALESCE(sum(monto) FILTER (WHERE tipo = 'san_mano'), 0)::numeric(16,2) AS san_manos,
                COALESCE(sum(monto) FILTER (WHERE tipo = 'compra'), 0)::numeric(16,2) AS compras,
                COALESCE(sum(monto) FILTER (WHERE tipo = 'compra_reverso'), 0)::numeric(16,2) AS compras_devueltas
         FROM caja_movimientos m WHERE m.sesion_id = s.id
       ) t
       WHERE (s.abierta_en AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
       ORDER BY s.numero`,
      [cx.zona, cx.desde, cx.hasta],
    );
    return this.armar(
      'cierres-caja',
      cx,
      [
        { clave: 'sesion', titulo: 'Sesión', tipo: 'texto' },
        { clave: 'caja', titulo: 'Caja', tipo: 'texto' },
        { clave: 'abrio', titulo: 'Abrió', tipo: 'texto' },
        { clave: 'abierta_en', titulo: 'Apertura', tipo: 'fechahora' },
        { clave: 'cerrada_en', titulo: 'Cierre', tipo: 'fechahora' },
        { clave: 'estado', titulo: 'Estado', tipo: 'texto' },
        { clave: 'fondo', titulo: 'Fondo', tipo: 'dinero', total: true },
        { clave: 'ventas', titulo: 'Ventas', tipo: 'dinero', total: true },
        { clave: 'ingresos', titulo: 'Ingresos', tipo: 'dinero', total: true },
        {
          clave: 'desde_cuentas',
          titulo: 'Traído de cuentas',
          tipo: 'dinero',
          total: true,
        },
        {
          clave: 'san_cuotas',
          titulo: 'Cuotas SOL CASH',
          tipo: 'dinero',
          total: true,
        },
        { clave: 'gastos', titulo: 'Gastos', tipo: 'dinero', total: true },
        { clave: 'retiros', titulo: 'Retiros', tipo: 'dinero', total: true },
        {
          clave: 'devoluciones',
          titulo: 'Devoluciones',
          tipo: 'dinero',
          total: true,
        },
        {
          clave: 'depositos',
          titulo: 'Depósitos',
          tipo: 'dinero',
          total: true,
        },
        {
          clave: 'san_manos',
          titulo: 'Manos SOL CASH',
          tipo: 'dinero',
          total: true,
        },
        { clave: 'compras', titulo: 'Compras', tipo: 'dinero', total: true },
        {
          clave: 'esperado',
          titulo: 'Debía haber',
          tipo: 'dinero',
          total: true,
        },
        { clave: 'contado', titulo: 'Contado', tipo: 'dinero', total: true },
        {
          clave: 'diferencia',
          titulo: 'Diferencia',
          tipo: 'dinero',
          total: true,
        },
        { clave: 'motivo', titulo: 'Motivo de la diferencia', tipo: 'texto' },
      ],
      r.rows,
      {
        notas: [
          'Diferencia = contado - debía haber (negativo: faltante; positivo: sobrante). Las sesiones abiertas aún no tienen conteo.',
        ],
      },
    );
  }

  // ---------- 8. Movimientos de una cuenta ----------
  private async movimientosCuenta(cx: Contexto, cuentaId: string) {
    if (!UUID.test(cuentaId))
      throw new BadRequestException('Seleccione la cuenta');
    const ct = await this.db.query<{
      nombre: string;
      entidad: string;
      moneda: string;
      simbolo: string;
    }>(
      `SELECT ct.nombre, ct.entidad, ct.moneda, mo.simbolo
       FROM cuentas ct JOIN monedas mo ON mo.codigo = ct.moneda WHERE ct.id = $1`,
      [cuentaId],
    );
    if (ct.rowCount === 0) throw new NotFoundException('Cuenta no encontrada');
    const cuenta = ct.rows[0];
    const [antes, filas] = await Promise.all([
      this.db.query<{ saldo: string }>(
        `SELECT COALESCE(sum(x.signo * x.monto) FILTER (WHERE x.estado <> 'no_llego'), 0)::numeric(16,2) AS saldo
         FROM ${SQL_MOVS_CON_ESTADO} x WHERE x.cuenta_id = $1 AND x.fecha < $2::date`,
        [cuentaId, cx.desde],
      ),
      this.db.query<Record<string, string>>(
        `SELECT to_char(x.fecha, 'YYYY-MM-DD') AS fecha, x.tipo, x.estado, x.signo, x.monto,
                concat_ws(' · ',
                  CASE WHEN v.numero IS NOT NULL THEN 'V-' || lpad(v.numero::text, 6, '0') END,
                  CASE WHEN rm.numero IS NOT NULL THEN 'E-' || lpad(rm.numero::text, 6, '0') END,
                  CASE WHEN t.numero IS NOT NULL THEN 'T-' || lpad(t.numero::text, 6, '0') END,
                  cg.nombre, x.beneficiario, x.comprobante,
                  CASE WHEN x.referencia IS NOT NULL THEN 'Ref. ' || x.referencia END,
                  x.motivo) AS detalle
         FROM ${SQL_MOVS_CON_ESTADO} x
         LEFT JOIN ventas v ON v.id = x.venta_id
         LEFT JOIN remesas rm ON rm.id = x.remesa_id
         LEFT JOIN transferencias t ON t.id = x.transferencia_id
         LEFT JOIN categorias_gasto cg ON cg.id = x.categoria_gasto_id
         WHERE x.cuenta_id = $1 AND x.fecha BETWEEN $2::date AND $3::date
         ORDER BY x.fecha, x.id`,
        [cuentaId, cx.desde, cx.hasta],
      ),
    ]);
    const c = (v: string) => {
      const neg = v.startsWith('-');
      const [e, d = ''] = (neg ? v.slice(1) : v).split('.');
      const n = BigInt(e || '0') * 100n + BigInt((d + '00').slice(0, 2));
      return neg ? -n : n;
    };
    const t = (n: bigint) =>
      `${n < 0n ? '-' : ''}${(n < 0n ? -n : n) / 100n}.${String((n < 0n ? -n : n) % 100n).padStart(2, '0')}`;
    const ESTADO: Record<string, string> = {
      confirmado: 'Confirmado',
      por_confirmar: 'Por confirmar',
      no_llego: 'No llegó (no cuenta)',
    };
    let saldo = c(antes.rows[0].saldo);
    const rows: Fila[] = [
      {
        fecha: cx.desde,
        tipo: 'Saldo anterior',
        detalle: null,
        estado: null,
        entrada: null,
        salida: null,
        saldo: t(saldo),
      },
    ];
    for (const f of filas.rows) {
      const entra = Number(f.signo) > 0;
      if (f.estado !== 'no_llego') saldo += entra ? c(f.monto) : -c(f.monto);
      rows.push({
        fecha: f.fecha,
        tipo: NOMBRE_TIPO_CUENTA[f.tipo] ?? f.tipo,
        detalle: f.detalle || null,
        estado: ESTADO[f.estado] ?? f.estado,
        entrada: entra ? f.monto : null,
        salida: entra ? null : f.monto,
        saldo: t(saldo),
      });
    }
    const columnas: Columna[] = [
      { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha' },
      { clave: 'tipo', titulo: 'Movimiento', tipo: 'texto' },
      { clave: 'detalle', titulo: 'Detalle', tipo: 'texto' },
      { clave: 'estado', titulo: 'Estado', tipo: 'texto' },
      {
        clave: 'entrada',
        titulo: `Entrada ${cuenta.simbolo}`,
        tipo: 'dinero',
        total: true,
      },
      {
        clave: 'salida',
        titulo: `Salida ${cuenta.simbolo}`,
        tipo: 'dinero',
        total: true,
      },
      { clave: 'saldo', titulo: `Saldo ${cuenta.simbolo}`, tipo: 'dinero' },
    ];
    return this.armar('movimientos-cuenta', cx, columnas, rows, {
      detalle: `${cuenta.nombre} (${cuenta.entidad}, ${cuenta.moneda})`,
      totales: calcularTotales(columnas, rows.slice(1)),
      notas: [
        'El saldo incluye lo confirmado y lo que está por confirmar; lo que "no llegó" no cuenta. Las fechas son las del banco.',
      ],
    });
  }

  // ---------- 9. Gastos por categoría ----------
  private async gastosCategoria(cx: Contexto) {
    const r = await this.db.query(
      `SELECT x.categoria,
              count(*)::int AS cantidad,
              COALESCE(sum(x.monto) FILTER (WHERE x.origen = 'caja'), 0)::numeric(16,2) AS caja,
              COALESCE(sum(x.monto) FILTER (WHERE x.origen = 'banco'), 0)::numeric(16,2) AS banco,
              sum(x.monto)::numeric(16,2) AS total
       FROM (
         SELECT cg.nombre AS categoria, m.monto, 'caja' AS origen
         FROM caja_movimientos m JOIN categorias_gasto cg ON cg.id = m.categoria_gasto_id
         WHERE m.tipo = 'gasto' AND (m.created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
         UNION ALL
         SELECT COALESCE(cg.nombre, 'Cargos del banco'), cm.monto_dop, 'banco'
         FROM cuenta_movimientos cm
         LEFT JOIN categorias_gasto cg ON cg.id = cm.categoria_gasto_id
         WHERE cm.tipo IN ('pago', 'cargo') AND cm.fecha BETWEEN $2::date AND $3::date
           AND NOT EXISTS (SELECT 1 FROM cuenta_movimientos rv WHERE rv.reverso_de = cm.id)
       ) x
       GROUP BY x.categoria
       ORDER BY sum(x.monto) DESC`,
      [cx.zona, cx.desde, cx.hasta],
    );
    return this.armar(
      'gastos-categoria',
      cx,
      [
        { clave: 'categoria', titulo: 'Categoría', tipo: 'texto' },
        {
          clave: 'cantidad',
          titulo: 'Movimientos',
          tipo: 'entero',
          total: true,
        },
        {
          clave: 'caja',
          titulo: 'De la caja RD$',
          tipo: 'dinero',
          total: true,
        },
        {
          clave: 'banco',
          titulo: 'Del banco RD$',
          tipo: 'dinero',
          total: true,
        },
        { clave: 'total', titulo: 'Total RD$', tipo: 'dinero', total: true },
      ],
      r.rows,
      {
        notas: [
          'Gastos de caja y pagos y cargos de los bancos (en RD$; si la cuenta es en otra moneda, con su tasa). No incluye los pagos reversados. Revise con su contador qué categorías son gasto (por ejemplo, la compra de mercancía es inventario).',
        ],
      },
    );
  }

  // ---------- 10. Existencia y valor del inventario ----------
  private async inventario(cx: Contexto) {
    const costos = cx.permisos.has('inventario.ver_costos');
    const r = await this.db.query(
      `SELECT p.codigo, p.nombre, c.nombre AS categoria, um.nombre AS unidad,
              x.existencia,
              COALESCE(x.costo, p.costo)::numeric(14,2) AS costo,
              (x.existencia * COALESCE(x.costo, p.costo))::numeric(16,2) AS valor_costo,
              p.precio_venta,
              (x.existencia * COALESCE(p.precio_venta, 0))::numeric(16,2) AS valor_venta
       FROM productos p
       JOIN categorias c ON c.id = p.categoria_id
       JOIN unidades_medida um ON um.id = p.unidad_id
       CROSS JOIN LATERAL (
         SELECT COALESCE(sum(m.cantidad * ${SQL_SIGNO}), 0)::numeric(14,3) AS existencia,
                (SELECT m2.costo_promedio FROM movimientos_inventario m2
                  WHERE m2.producto_id = p.id AND m2.costo_promedio IS NOT NULL
                    AND (m2.created_at AT TIME ZONE $1)::date <= $2::date
                  ORDER BY m2.created_at DESC, m2.id DESC LIMIT 1) AS costo
         FROM movimientos_inventario m
         WHERE m.producto_id = p.id AND (m.created_at AT TIME ZONE $1)::date <= $2::date
       ) x
       WHERE p.is_active OR x.existencia <> 0
       ORDER BY c.nombre, p.nombre`,
      [cx.zona, cx.hasta],
    );
    const columnas: Columna[] = [
      { clave: 'codigo', titulo: 'Código', tipo: 'texto' },
      { clave: 'nombre', titulo: 'Producto', tipo: 'texto' },
      { clave: 'categoria', titulo: 'Categoría', tipo: 'texto' },
      { clave: 'unidad', titulo: 'Unidad', tipo: 'texto' },
      {
        clave: 'existencia',
        titulo: 'Existencia',
        tipo: 'cantidad',
        total: true,
      },
    ];
    if (costos)
      columnas.push(
        { clave: 'costo', titulo: 'Costo promedio', tipo: 'dinero' },
        {
          clave: 'valor_costo',
          titulo: 'Valor al costo',
          tipo: 'dinero',
          total: true,
        },
      );
    columnas.push(
      { clave: 'precio_venta', titulo: 'Precio de venta', tipo: 'dinero' },
      {
        clave: 'valor_venta',
        titulo: 'Valor a precio de venta',
        tipo: 'dinero',
        total: true,
      },
    );
    return this.armar('inventario', cx, columnas, r.rows, {
      periodo: `Al ${dma(cx.hasta)}`,
      notas: [
        'Existencia al final del día indicado. Costos y precios sin ITBIS.',
      ],
    });
  }

  // ---------- Clientes ----------

  // El documento completo solo con el permiso de verlo (como en Clientes).
  private documentos(cx: Contexto, filas: Fila[]): Fila[] {
    if (cx.permisos.has('terceros.ver_documento')) return filas;
    return filas.map((f) => ({
      ...f,
      documento: enmascarar((f.documento as string | null) ?? null),
    }));
  }

  private async clientesServicio(cx: Contexto, servicio: string) {
    const nombre = SERVICIOS_CLIENTES[servicio];
    if (!nombre) throw new BadRequestException('Seleccione el servicio');
    const enRango = (campo: string) =>
      `(${campo} AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date`;
    const contacto: Columna[] = [
      { clave: 'nombre', titulo: 'Cliente', tipo: 'texto' },
      { clave: 'documento', titulo: 'Documento', tipo: 'texto' },
      { clave: 'telefono', titulo: 'Teléfono', tipo: 'texto' },
      { clave: 'whatsapp', titulo: 'WhatsApp', tipo: 'texto' },
    ];
    let columnas: Columna[];
    let sql: string;
    let params: unknown[] = [cx.zona, cx.desde, cx.hasta];
    let periodo = cx.periodo;
    const notas: string[] = [];
    if (servicio === 'transfer') {
      sql = `SELECT t.nombre, t.numero_documento AS documento, t.telefono, t.whatsapp,
                    count(*)::int AS envios, sum(r.monto_enviado)::numeric(16,2) AS enviado,
                    to_char(max(r.fecha AT TIME ZONE $1), 'YYYY-MM-DD') AS ultimo
             FROM remesas r JOIN terceros t ON t.id = r.remitente_id
             WHERE r.estado = 'confirmado' AND r.origen = 'sistema' AND ${enRango('r.fecha')}
             GROUP BY t.id ORDER BY lower(t.nombre)`;
      columnas = [
        ...contacto,
        { clave: 'envios', titulo: 'Envíos', tipo: 'entero', total: true },
        {
          clave: 'enviado',
          titulo: 'Total enviado',
          tipo: 'dinero',
          total: true,
        },
        { clave: 'ultimo', titulo: 'Último envío', tipo: 'fecha' },
      ];
      notas.push('Remitentes con envíos confirmados en el período.');
    } else if (servicio === 'solcash') {
      sql = `SELECT t.nombre, t.numero_documento AS documento, t.telefono, t.whatsapp,
                    string_agg('SOL-' || lpad(s.numero::text, 4, '0') || ' #' || p.numero
                               || CASE WHEN p.parte = 'medio' THEN ' (medio)' ELSE '' END,
                               ', ' ORDER BY s.numero, p.numero) AS numeros,
                    count(*)::int AS cantidad,
                    count(ct.id) FILTER (WHERE ct.estado = 'firmado')::int AS firmados
             FROM san_participaciones p
             JOIN sanes s ON s.id = p.san_id AND s.estado IN ('preparacion', 'activo')
             JOIN terceros t ON t.id = p.tercero_id
             LEFT JOIN san_contratos ct ON ct.participacion_id = p.id AND ct.estado <> 'anulado'
             GROUP BY t.id ORDER BY lower(t.nombre)`;
      params = [];
      periodo = 'SOL CASH activos y en preparación';
      columnas = [
        ...contacto,
        { clave: 'numeros', titulo: 'SOL CASH y números', tipo: 'texto' },
        { clave: 'cantidad', titulo: 'Números', tipo: 'entero', total: true },
        {
          clave: 'firmados',
          titulo: 'Contratos firmados',
          tipo: 'entero',
          total: true,
        },
      ];
      notas.push('Las fechas no aplican: son los participantes de hoy.');
    } else if (servicio === 'facturacion') {
      sql = `SELECT t.nombre, t.numero_documento AS documento, t.telefono, t.whatsapp,
                    count(*)::int AS compras, sum(v.total)::numeric(16,2) AS total,
                    to_char(max(v.fecha AT TIME ZONE $1), 'YYYY-MM-DD') AS ultima
             FROM ventas v JOIN terceros t ON t.id = v.cliente_id AND NOT t.es_protegido
             WHERE v.estado = 'completada' AND ${enRango('v.fecha')}
             GROUP BY t.id ORDER BY lower(t.nombre)`;
      columnas = [
        ...contacto,
        { clave: 'compras', titulo: 'Compras', tipo: 'entero', total: true },
        {
          clave: 'total',
          titulo: 'Total comprado',
          tipo: 'dinero',
          total: true,
        },
        { clave: 'ultima', titulo: 'Última compra', tipo: 'fecha' },
      ];
      notas.push(
        'No incluye las ventas a "Consumidor final". Ventas anuladas no cuentan.',
      );
    } else {
      sql = `SELECT t.nombre, t.nombre_comercial, t.numero_documento AS documento, t.telefono,
                    t.correo, COALESCE(x.compras, 0) AS compras, COALESCE(x.total, 0)::numeric(16,2) AS total
             FROM terceros t
             LEFT JOIN LATERAL (
               SELECT count(*)::int AS compras, sum(v.total) AS total FROM ventas v
               WHERE v.cliente_id = t.id AND v.estado = 'completada' AND ${enRango('v.fecha')}
             ) x ON true
             WHERE t.rol = 'cliente' AND t.is_active AND t.es_contribuyente
             ORDER BY lower(t.nombre)`;
      columnas = [
        { clave: 'nombre', titulo: 'Razón social', tipo: 'texto' },
        {
          clave: 'nombre_comercial',
          titulo: 'Nombre comercial',
          tipo: 'texto',
        },
        { clave: 'documento', titulo: 'RNC / Cédula', tipo: 'texto' },
        { clave: 'telefono', titulo: 'Teléfono', tipo: 'texto' },
        { clave: 'correo', titulo: 'Correo', tipo: 'texto' },
        {
          clave: 'compras',
          titulo: 'Compras en el período',
          tipo: 'entero',
          total: true,
        },
        {
          clave: 'total',
          titulo: 'Total en el período',
          tipo: 'dinero',
          total: true,
        },
      ];
      notas.push(
        'Clientes activos marcados como contribuyentes (piden Crédito Fiscal).',
      );
    }
    const r = await this.db.query(sql, params);
    return this.armar(
      'clientes-servicio',
      cx,
      columnas,
      this.documentos(cx, r.rows),
      {
        detalle: nombre,
        periodo,
        notas: [...notas, `${r.rowCount ?? 0} cliente(s).`],
      },
    );
  }

  private async clientesGeneral(cx: Contexto) {
    const r = await this.db.query(
      `SELECT t.nombre, t.numero_documento AS documento, t.telefono, t.whatsapp, t.correo,
              COALESCE(v.compras, 0) AS compras, COALESCE(v.total, 0)::numeric(16,2) AS total_compras,
              COALESCE(e.envios, 0) AS envios, COALESCE(e.total, 0)::numeric(16,2) AS total_enviado,
              COALESCE(sc.numeros, 0) AS numeros_sol,
              CASE WHEN t.es_contribuyente THEN 'Sí' ELSE 'No' END AS credito_fiscal,
              to_char(GREATEST(u.venta, u.envio, u.sol) AT TIME ZONE $1, 'YYYY-MM-DD') AS ultima
       FROM terceros t
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS compras, sum(x.total) AS total FROM ventas x
         WHERE x.cliente_id = t.id AND x.estado = 'completada'
           AND (x.fecha AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
       ) v ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS envios, sum(x.monto_enviado) AS total FROM remesas x
         WHERE x.remitente_id = t.id AND x.estado = 'confirmado' AND x.origen = 'sistema'
           AND (x.fecha AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
       ) e ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS numeros FROM san_participaciones p
         JOIN sanes s ON s.id = p.san_id AND s.estado IN ('preparacion', 'activo')
         WHERE p.tercero_id = t.id
       ) sc ON true
       LEFT JOIN LATERAL (
         SELECT (SELECT max(fecha) FROM ventas WHERE cliente_id = t.id AND estado = 'completada') AS venta,
                (SELECT max(fecha) FROM remesas WHERE remitente_id = t.id AND estado = 'confirmado') AS envio,
                (SELECT max(created_at) FROM san_recibos WHERE tercero_id = t.id) AS sol
       ) u ON true
       WHERE t.rol = 'cliente' AND t.is_active AND NOT t.es_protegido
       ORDER BY lower(t.nombre)`,
      [cx.zona, cx.desde, cx.hasta],
    );
    const columnas: Columna[] = [
      { clave: 'nombre', titulo: 'Cliente', tipo: 'texto' },
      { clave: 'documento', titulo: 'Documento', tipo: 'texto' },
      { clave: 'telefono', titulo: 'Teléfono', tipo: 'texto' },
      { clave: 'whatsapp', titulo: 'WhatsApp', tipo: 'texto' },
      { clave: 'correo', titulo: 'Correo', tipo: 'texto' },
      { clave: 'compras', titulo: 'Compras', tipo: 'entero', total: true },
      {
        clave: 'total_compras',
        titulo: 'Total comprado',
        tipo: 'dinero',
        total: true,
      },
      { clave: 'envios', titulo: 'Envíos', tipo: 'entero', total: true },
      {
        clave: 'total_enviado',
        titulo: 'Total enviado',
        tipo: 'dinero',
        total: true,
      },
      {
        clave: 'numeros_sol',
        titulo: 'Números SOL CASH',
        tipo: 'entero',
        total: true,
      },
      { clave: 'credito_fiscal', titulo: 'Crédito Fiscal', tipo: 'texto' },
      { clave: 'ultima', titulo: 'Última actividad', tipo: 'fecha' },
    ];
    return this.armar(
      'clientes-general',
      cx,
      columnas,
      this.documentos(cx, r.rows),
      {
        notas: [
          'Compras y envíos: dentro del período. Números SOL CASH: los de hoy (activos y en preparación).',
          'Última actividad: la compra, el envío o el pago de SOL CASH más reciente (de cualquier fecha).',
          `${r.rowCount ?? 0} cliente(s) activos (sin "Consumidor final").`,
        ],
      },
    );
  }
}
