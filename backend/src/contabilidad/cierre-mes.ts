import type { DatabaseService } from '../database/database.service';

// Revisión antes de cerrar un mes (decisión del dueño): lo grave bloquea el
// cierre (operaciones sin contabilizar, cajas sin cerrar, el mes anterior
// abierto); lo demás solo avisa y, para cerrar con avisos, se escribe un
// motivo que queda en la auditoría.

type Consulta = Pick<DatabaseService, 'query'>;

export type PuntoRevision = {
  clave: string;
  titulo: string;
  detalle: string;
  cantidad: number;
  donde: string; // pantalla donde se arregla
};

export type Revision = {
  anio: number;
  mes: number;
  desde: string;
  hasta: string;
  bloqueos: PuntoRevision[];
  avisos: PuntoRevision[];
  correctos: string[];
};

// Último día del mes (AAAA-MM-DD).
export function finDeMes(anio: number, mes: number): string {
  const d = new Date(Date.UTC(anio, mes, 0));
  return d.toISOString().slice(0, 10);
}

function fechaCorta(v: string): string {
  return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
}

export async function revisarMes(
  c: Consulta,
  anio: number,
  mes: number,
  inicio: string,
): Promise<Revision> {
  const desde = `${anio}-${String(mes).padStart(2, '0')}-01`;
  const hasta = finDeMes(anio, mes);
  const zona =
    (
      await c.query<{ valor: string }>(
        `SELECT valor FROM configuracion WHERE clave = 'empresa.zona_horaria'`,
      )
    ).rows[0]?.valor ?? 'America/Santo_Domingo';
  const bloqueos: PuntoRevision[] = [];
  const avisos: PuntoRevision[] = [];
  const correctos: string[] = [];

  // 1) El mes anterior (si es de la contabilidad) tiene que estar cerrado.
  const anterior =
    mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
  const inicioAnterior = `${anterior.anio}-${String(anterior.mes).padStart(2, '0')}`;
  if (inicioAnterior >= inicio.slice(0, 7)) {
    const p = await c.query(
      `SELECT 1 FROM periodos_contables WHERE anio = $1 AND mes = $2 AND estado = 'cerrado'`,
      [anterior.anio, anterior.mes],
    );
    if (p.rowCount === 0)
      bloqueos.push({
        clave: 'mes_anterior',
        titulo: 'El mes anterior está abierto',
        detalle: `Cierre primero ${String(anterior.mes).padStart(2, '0')}/${anterior.anio}: los meses se cierran en orden.`,
        cantidad: 1,
        donde: 'Contabilidad → Meses',
      });
    else correctos.push('El mes anterior está cerrado');
  }

  // 2) Operaciones sin contabilizar (pendientes) hasta el fin del mes.
  const pend = await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM contabilidad_pendientes WHERE estado = 'pendiente' AND fecha <= $1::date`,
    [hasta],
  );
  if (pend.rows[0].n > 0)
    bloqueos.push({
      clave: 'pendientes',
      titulo: 'Operaciones sin contabilizar',
      detalle:
        'Reintente, escoja la cuenta o descarte cada una antes de cerrar.',
      cantidad: pend.rows[0].n,
      donde: 'Contabilidad → Pendientes',
    });
  else correctos.push('Todas las operaciones del mes están contabilizadas');

  // 3) Cajas abiertas desde ese mes o antes (su cuadre aún no se contabilizó).
  const cajas = await c.query<{ caja: string; abierta: string }>(
    `SELECT cj.nombre AS caja, to_char((s.abierta_en AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS abierta
     FROM caja_sesiones s JOIN cajas cj ON cj.id = s.caja_id
     WHERE s.estado = 'abierta' AND (s.abierta_en AT TIME ZONE $2)::date <= $1::date
     ORDER BY s.abierta_en`,
    [hasta, zona],
  );
  if (cajas.rowCount)
    bloqueos.push({
      clave: 'cajas',
      titulo: 'Cajas abiertas',
      detalle: cajas.rows
        .map((x) => `${x.caja} (abierta el ${fechaCorta(x.abierta)})`)
        .join(', '),
      cantidad: cajas.rowCount ?? 0,
      donde: 'Caja → Cerrar caja',
    });
  else correctos.push('Las cajas del mes están cerradas');

  // 4) Dinero "por confirmar" en los bancos hasta el fin del mes.
  const porConfirmar = await c.query<{ cuenta: string; n: number }>(
    `SELECT ct.nombre AS cuenta, count(*)::int AS n
     FROM cuenta_movimientos m JOIN cuentas ct ON ct.id = m.cuenta_id
     LEFT JOIN cuenta_confirmaciones cf ON cf.movimiento_id = m.id
     WHERE m.por_confirmar AND cf.id IS NULL AND m.fecha <= $1::date
     GROUP BY ct.nombre ORDER BY ct.nombre`,
    [hasta],
  );
  if (porConfirmar.rowCount)
    avisos.push({
      clave: 'por_confirmar',
      titulo: 'Movimientos de banco por confirmar',
      detalle: porConfirmar.rows.map((x) => `${x.cuenta}: ${x.n}`).join(', '),
      cantidad: porConfirmar.rows.reduce((a, x) => a + x.n, 0),
      donde: 'Bancos → Por confirmar',
    });
  else correctos.push('No hay dinero por confirmar en los bancos');

  // 5) Cuentas con movimientos en el mes sin conciliación cerrada al fin del mes.
  const sinConciliar = await c.query<{ cuenta: string }>(
    `SELECT DISTINCT ct.nombre AS cuenta FROM cuenta_movimientos m JOIN cuentas ct ON ct.id = m.cuenta_id
     WHERE m.fecha BETWEEN $1::date AND $2::date
       AND NOT EXISTS (SELECT 1 FROM conciliaciones k WHERE k.cuenta_id = ct.id AND k.estado = 'cerrada'
                       AND k.fecha_corte >= $2::date)
     ORDER BY ct.nombre`,
    [desde, hasta],
  );
  if (sinConciliar.rowCount)
    avisos.push({
      clave: 'conciliacion',
      titulo: 'Cuentas sin conciliar al fin del mes',
      detalle: sinConciliar.rows.map((x) => x.cuenta).join(', '),
      cantidad: sinConciliar.rowCount ?? 0,
      donde: 'Bancos → Conciliación',
    });
  else correctos.push('Las cuentas con movimientos del mes están conciliadas');

  // 6) e-CF por emitir de ventas del mes.
  const ecf = await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ecf e JOIN ventas v ON v.id = e.venta_id
     WHERE e.estado = 'por_emitir' AND (v.fecha AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date`,
    [desde, hasta, zona],
  );
  if (ecf.rows[0].n > 0)
    avisos.push({
      clave: 'ecf',
      titulo: 'Comprobantes electrónicos por emitir',
      detalle: 'Anote el e-NCF de esas ventas (van en el 607 del mes).',
      cantidad: ecf.rows[0].n,
      donde: 'Facturación electrónica',
    });
  else correctos.push('Los e-CF de las ventas del mes están emitidos');

  // 7) El primer mes necesita el asiento de apertura.
  if (desde.slice(0, 7) === inicio.slice(0, 7)) {
    const ap = await c.query(
      `SELECT 1 FROM asientos WHERE origen = 'apertura' AND estado = 'activo'`,
    );
    if (ap.rowCount === 0)
      avisos.push({
        clave: 'apertura',
        titulo: 'Falta el asiento de apertura',
        detalle:
          'Los saldos con que empezó (caja, bancos, inventario, deudas) no están registrados.',
        cantidad: 1,
        donde: 'Contabilidad → Registrar apertura',
      });
    else correctos.push('El asiento de apertura está registrado');
  }

  return { anio, mes, desde, hasta, bloqueos, avisos, correctos };
}
