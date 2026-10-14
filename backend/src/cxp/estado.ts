import type { DatabaseService } from '../database/database.service';
import { SQL_PAGO_VIGENTE } from '../compras/compras.service';
import { diasEntre } from '../cxc/recargos';
import { centavos, texto2 } from '../sanes/calendario';

// Lo que se le debe a cada proveedor y las fechas de los gastos fijos.
// Lo usan Cuentas por Pagar, el Panel y Reportes.

type Consulta = Pick<DatabaseService, 'query'>;

export function numeroPago(n: number | string) {
  return `PP-${String(n).padStart(6, '0')}`;
}

export function numeroCompraTexto(n: number | string) {
  return `CP-${String(n).padStart(6, '0')}`;
}

function ultimoDia(a: number, m: number): number {
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

// Día "dia" del mes de "fecha" (si el mes es más corto, su último día).
export function fechaDelMes(fecha: string, dia: number, masMeses = 0): string {
  const [a, m] = fecha.split('-').map(Number);
  const total = m - 1 + masMeses;
  const aa = a + Math.floor(total / 12);
  const mm = (total % 12) + 1;
  const d = Math.min(dia, ultimoDia(aa, mm));
  return `${aa}-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export async function diasAlerta(c: Consulta): Promise<number> {
  const r = await c.query<{ valor: string }>(
    `SELECT valor FROM configuracion WHERE clave = 'cxp.dias_alerta'`,
  );
  const n = Number(r.rows[0]?.valor ?? '7');
  return Number.isInteger(n) && n >= 0 ? n : 7;
}

export type FacturaCxp = {
  id: string;
  codigo: string;
  proveedor_id: string;
  proveedor: string;
  ncf: string | null;
  fecha: string;
  vencimiento: string;
  condicion: string;
  a_pagar: string;
  pagado: string;
  saldo: string;
  vencida: boolean;
  dias_atraso: number;
  por_vencer: boolean; // vence dentro de los días de aviso
  dias_para_vencer: number;
};

// Facturas con saldo (todas o las de un proveedor), al día "hoy".
// Con "corte", solo cuenta lo registrado y pagado hasta ese día (reportes).
export async function facturasPendientes(
  c: Consulta,
  hoy: string,
  dias: number,
  proveedorId?: string,
): Promise<FacturaCxp[]> {
  const params: unknown[] = [hoy];
  let cond = '';
  if (proveedorId) {
    params.push(proveedorId);
    cond = 'AND c.proveedor_id = $2';
  }
  const r = await c.query<{
    id: string;
    numero: string;
    proveedor_id: string;
    proveedor: string;
    ncf: string | null;
    fecha: string;
    vencimiento: string;
    condicion: string;
    a_pagar: string;
    pagado: string;
  }>(
    `SELECT c.id, c.numero, c.proveedor_id, pr.nombre AS proveedor, c.ncf,
            to_char(c.fecha_comprobante, 'YYYY-MM-DD') AS fecha,
            to_char(c.vencimiento, 'YYYY-MM-DD') AS vencimiento, c.condicion, c.a_pagar,
            COALESCE((SELECT sum(cp.monto) FROM compra_pagos cp
                      WHERE cp.compra_id = c.id AND cp.fecha <= $1::date AND ${SQL_PAGO_VIGENTE}), 0)::numeric(14,2) AS pagado
     FROM compras c JOIN terceros pr ON pr.id = c.proveedor_id
     WHERE c.estado = 'registrada' AND c.fecha_comprobante <= $1::date ${cond}
     ORDER BY c.vencimiento, c.fecha_comprobante, c.numero`,
    params,
  );
  return r.rows
    .map((x) => {
      const saldo = centavos(x.a_pagar) - centavos(x.pagado);
      const vencida = saldo > 0n && x.vencimiento < hoy;
      const faltan = diasEntre(hoy, x.vencimiento);
      return {
        id: x.id,
        codigo: numeroCompraTexto(x.numero),
        proveedor_id: x.proveedor_id,
        proveedor: x.proveedor,
        ncf: x.ncf,
        fecha: x.fecha,
        vencimiento: x.vencimiento,
        condicion: x.condicion,
        a_pagar: x.a_pagar,
        pagado: x.pagado,
        saldo: texto2(saldo),
        vencida,
        dias_atraso: vencida ? -faltan : 0,
        por_vencer: saldo > 0n && !vencida && faltan <= dias,
        dias_para_vencer: vencida ? 0 : faltan,
      };
    })
    .filter((x) => x.saldo !== '0.00');
}

export type AvisoGastoFijo = {
  id: string;
  nombre: string;
  proveedor_id: string;
  proveedor: string;
  tipo_gasto: string;
  monto: string | null;
  itbis: string | null;
  fecha: string; // cuándo vence este mes (o el próximo)
  dias: number; // días que faltan (negativo: ya pasó)
};

// Gastos fijos que vencen pronto (o ya vencieron) y no se han registrado ese mes.
// El aviso del mes se apaga con una compra NO anulada de ese gasto fijo para ese mes
// (compras.gasto_fijo_mes: la factura del día 5 de noviembre puede registrarse en octubre).
export async function avisosGastosFijos(
  c: Consulta,
  hoy: string,
  dias: number,
): Promise<AvisoGastoFijo[]> {
  const g = await c.query<{
    id: string;
    nombre: string;
    proveedor_id: string;
    proveedor: string;
    tipo_gasto: string;
    dia_mes: number;
    monto: string | null;
    itbis: string | null;
  }>(
    `SELECT g.id, g.nombre, g.proveedor_id, t.nombre AS proveedor, g.tipo_gasto, g.dia_mes, g.monto, g.itbis
     FROM gastos_fijos g JOIN terceros t ON t.id = g.proveedor_id
     WHERE g.is_active ORDER BY g.dia_mes, g.nombre`,
  );
  const avisos: AvisoGastoFijo[] = [];
  for (const x of g.rows) {
    // Este mes y el próximo (si el día cae a principios del mes que viene).
    for (const mas of [0, 1]) {
      const fecha = fechaDelMes(hoy, x.dia_mes, mas);
      const faltan = diasEntre(hoy, fecha);
      if (faltan > dias) continue;
      const hecha = await c.query(
        `SELECT 1 FROM compras WHERE gasto_fijo_id = $1 AND estado = 'registrada'
           AND COALESCE(gasto_fijo_mes, date_trunc('month', fecha_comprobante)::date) = $2::date LIMIT 1`,
        [x.id, fechaDelMes(fecha, 1)],
      );
      if ((hecha.rowCount ?? 0) > 0) continue;
      avisos.push({
        id: x.id,
        nombre: x.nombre,
        proveedor_id: x.proveedor_id,
        proveedor: x.proveedor,
        tipo_gasto: x.tipo_gasto,
        monto: x.monto,
        itbis: x.itbis,
        fecha,
        dias: faltan,
      });
      break;
    }
  }
  return avisos;
}
