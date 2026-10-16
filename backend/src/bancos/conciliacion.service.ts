import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { registrarAuditoria } from '../auditoria/auditoria';
import { DatabaseService } from '../database/database.service';
import { SQL_MOVS_CON_ESTADO } from './sql';

// Conciliación bancaria: a una fecha de corte, el saldo del estado de cuenta
// del banco contra el saldo del sistema. Se marcan los movimientos que
// aparecen en el estado ("cotejados"); los demás quedan en tránsito.
//   saldo ajustado = saldo del sistema − en tránsito
//   diferencia     = saldo del banco − saldo ajustado   (debe ser 0 para cerrar)
// Al cerrar, lo cotejado que estaba "por confirmar" queda confirmado.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTO = /^-?\d{1,12}(\.\d{1,2})?$/;

type Consulta = Pick<DatabaseService, 'query'>;

function texto(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
}

function fechaValida(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function centavos(v: string): bigint {
  const neg = v.startsWith('-');
  const [e, d = ''] = (neg ? v.slice(1) : v).split('.');
  const c = BigInt(e || '0') * 100n + BigInt((d + '00').slice(0, 2));
  return neg ? -c : c;
}

function texto2(c: bigint): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
}

function saldoBanco(v: unknown): string {
  const t = texto(v).replace(/,/g, '');
  if (!MONTO.test(t))
    throw new BadRequestException(
      'Saldo del estado de cuenta inválido (ej. 15250.75; negativo si está sobregirada)',
    );
  return texto2(centavos(t));
}

export function numeroConciliacion(n: number | string): string {
  return `CB-${String(n).padStart(6, '0')}`;
}

type Conciliacion = {
  id: string;
  numero: string;
  cuenta_id: string;
  fecha_corte: string;
  saldo_banco: string;
  estado: string;
  notas: string | null;
};

@Injectable()
export class ConciliacionService {
  constructor(private readonly db: DatabaseService) {}

  private async hoy(c: Consulta): Promise<string> {
    const r = await c.query<{ hoy: string }>(
      `SELECT to_char((now() AT TIME ZONE (SELECT valor FROM configuracion WHERE clave = 'empresa.zona_horaria'))::date, 'YYYY-MM-DD') AS hoy`,
    );
    return r.rows[0].hoy;
  }

  private async conciliacion(c: Consulta, id: string, bloquear = false) {
    if (!UUID.test(id))
      throw new NotFoundException('Conciliación no encontrada');
    const r = await c.query<Conciliacion>(
      `SELECT id, numero, cuenta_id, to_char(fecha_corte, 'YYYY-MM-DD') AS fecha_corte,
              saldo_banco, estado, notas
       FROM conciliaciones WHERE id = $1 ${bloquear ? 'FOR UPDATE' : ''}`,
      [id],
    );
    if (r.rowCount === 0)
      throw new NotFoundException('Conciliación no encontrada');
    return r.rows[0];
  }

  private async abierta(c: Consulta, id: string) {
    const k = await this.conciliacion(c, id, true);
    if (k.estado !== 'abierta')
      throw new BadRequestException('La conciliación ya no está abierta');
    return k;
  }

  // Movimientos que entran en la conciliación: los de la cuenta hasta la
  // fecha de corte que no fueron cotejados en una conciliación cerrada
  // ("No llegó" no cuenta). En una cerrada o descartada: los que tenía marcados.
  private async movimientos(c: Consulta, k: Conciliacion) {
    const r = await c.query<{
      id: string;
      tipo: string;
      signo: number;
      monto: string;
      fecha: string;
      estado: string;
      motivo: string | null;
      referencia: string | null;
      beneficiario: string | null;
      venta: string | null;
      cotejado: boolean;
    }>(
      k.estado === 'abierta'
        ? `SELECT x.id::text AS id, x.tipo, x.signo, x.monto, to_char(x.fecha, 'YYYY-MM-DD') AS fecha,
                  x.estado, x.motivo, x.referencia, x.beneficiario,
                  CASE WHEN v.numero IS NOT NULL THEN 'V-' || lpad(v.numero::text, 6, '0') END AS venta,
                  COALESCE(p.cotejado, false) AS cotejado
           FROM ${SQL_MOVS_CON_ESTADO} x
           LEFT JOIN ventas v ON v.id = x.venta_id
           LEFT JOIN conciliacion_partidas p ON p.conciliacion_id = $2 AND p.movimiento_id = x.id
           WHERE x.cuenta_id = $1 AND x.fecha <= $3::date AND x.estado <> 'no_llego'
             AND NOT EXISTS (SELECT 1 FROM conciliacion_partidas q JOIN conciliaciones k ON k.id = q.conciliacion_id
                             WHERE q.movimiento_id = x.id AND q.cotejado AND k.estado = 'cerrada')
           ORDER BY x.fecha, x.id`
        : `SELECT x.id::text AS id, x.tipo, x.signo, x.monto, to_char(x.fecha, 'YYYY-MM-DD') AS fecha,
                  x.estado, x.motivo, x.referencia, x.beneficiario,
                  CASE WHEN v.numero IS NOT NULL THEN 'V-' || lpad(v.numero::text, 6, '0') END AS venta,
                  p.cotejado
           FROM conciliacion_partidas p JOIN ${SQL_MOVS_CON_ESTADO} x ON x.id = p.movimiento_id
           LEFT JOIN ventas v ON v.id = x.venta_id
           WHERE p.conciliacion_id = $2 AND $1::uuid IS NOT NULL AND $3::date IS NOT NULL
           ORDER BY x.fecha, x.id`,
      [k.cuenta_id, k.id, k.fecha_corte],
    );
    return r.rows;
  }

  // Saldo del sistema a la fecha de corte (en la moneda de la cuenta).
  private async saldoSistema(c: Consulta, cuentaId: string, corte: string) {
    const r = await c.query<{ saldo: string }>(
      `SELECT COALESCE(sum(x.signo * x.monto) FILTER (WHERE x.estado <> 'no_llego'), 0)::numeric(16,2) AS saldo
       FROM ${SQL_MOVS_CON_ESTADO} x WHERE x.cuenta_id = $1 AND x.fecha <= $2::date`,
      [cuentaId, corte],
    );
    return centavos(r.rows[0].saldo);
  }

  private async calcular(c: Consulta, k: Conciliacion) {
    const movs = await this.movimientos(c, k);
    const sistema = await this.saldoSistema(c, k.cuenta_id, k.fecha_corte);
    let entradas = 0n;
    let salidas = 0n;
    for (const m of movs) {
      if (m.cotejado) continue;
      if (Number(m.signo) > 0) entradas += centavos(m.monto);
      else salidas += centavos(m.monto);
    }
    const transito = entradas - salidas;
    const ajustado = sistema - transito;
    const diferencia = centavos(k.saldo_banco) - ajustado;
    return {
      movs,
      totales: {
        saldoSistema: texto2(sistema),
        transitoEntradas: texto2(entradas),
        transitoSalidas: texto2(salidas),
        enTransito: texto2(transito),
        saldoAjustado: texto2(ajustado),
        saldoBanco: k.saldo_banco,
        diferencia: texto2(diferencia),
        cotejados: movs.filter((m) => m.cotejado).length,
      },
      diferencia,
      transito,
      sistema,
    };
  }

  // Lo que dice la contabilidad de la cuenta contable del banco (solo
  // informativo: puede diferir por la apertura o por pendientes).
  private async contable(c: Consulta, cuentaId: string, corte: string) {
    const r = await c.query<{
      cuenta_contable_id: string | null;
      codigo: string | null;
      nombre: string | null;
      contable: string | null;
      sistema_dop: string | null;
      inicio: string | null;
    }>(
      `SELECT ct.cuenta_contable_id, cc.codigo, cc.nombre,
              (SELECT COALESCE(sum(l.debito - l.credito), 0)::numeric(16,2) FROM asiento_lineas l
                 JOIN asientos a ON a.id = l.asiento_id
               WHERE l.cuenta_id = ct.cuenta_contable_id AND a.fecha <= $2::date) AS contable,
              (SELECT COALESCE(sum(x.signo * x.monto_dop) FILTER (WHERE x.estado <> 'no_llego'), 0)::numeric(16,2)
               FROM ${SQL_MOVS_CON_ESTADO} x JOIN cuentas o ON o.id = x.cuenta_id
               WHERE o.cuenta_contable_id = ct.cuenta_contable_id AND x.fecha <= $2::date) AS sistema_dop,
              NULLIF((SELECT valor FROM configuracion WHERE clave = 'contabilidad.fecha_inicio'), '') AS inicio
       FROM cuentas ct LEFT JOIN cuentas_contables cc ON cc.id = ct.cuenta_contable_id
       WHERE ct.id = $1`,
      [cuentaId, corte],
    );
    const x = r.rows[0];
    if (!x?.cuenta_contable_id || !x.inicio) return null;
    const dif = centavos(x.contable ?? '0') - centavos(x.sistema_dop ?? '0');
    return {
      cuenta: `${x.codigo} ${x.nombre}`,
      saldoContable: texto2(centavos(x.contable ?? '0')),
      saldoSistemaDop: texto2(centavos(x.sistema_dop ?? '0')),
      diferencia: texto2(dif),
    };
  }

  // ---------- Consultas ----------

  async listar(cuentaIdTexto: unknown) {
    const cuentaId = texto(cuentaIdTexto).toLowerCase();
    if (!UUID.test(cuentaId)) throw new BadRequestException('Escoja la cuenta');
    const r = await this.db.query(
      `SELECT k.id, k.numero, to_char(k.fecha_corte, 'YYYY-MM-DD') AS fecha_corte, k.saldo_banco, k.estado,
              k.saldo_sistema, k.en_transito, k.notas, k.motivo_descarte,
              u.username AS creada_por, c2.username AS cerrada_por, k.cerrada_en, k.created_at
       FROM conciliaciones k JOIN usuarios u ON u.id = k.created_by
       LEFT JOIN usuarios c2 ON c2.id = k.cerrada_por
       WHERE k.cuenta_id = $1 ORDER BY k.fecha_corte DESC, k.created_at DESC LIMIT 100`,
      [cuentaId],
    );
    return r.rows.map((x: { numero: string }) => ({
      ...x,
      codigo: numeroConciliacion(x.numero),
    }));
  }

  async detalle(id: string) {
    const k = await this.conciliacion(this.db, id);
    const cuenta = (
      await this.db.query<{ nombre: string; moneda: string; simbolo: string }>(
        `SELECT ct.nombre, ct.moneda, mo.simbolo FROM cuentas ct JOIN monedas mo ON mo.codigo = ct.moneda WHERE ct.id = $1`,
        [k.cuenta_id],
      )
    ).rows[0];
    const calc = await this.calcular(this.db, k);
    return {
      conciliacion: { ...k, codigo: numeroConciliacion(k.numero) },
      cuenta: { id: k.cuenta_id, ...cuenta },
      movimientos: calc.movs,
      totales: calc.totales,
      contable: await this.contable(this.db, k.cuenta_id, k.fecha_corte),
    };
  }

  // ---------- Acciones ----------

  async crear(
    actorId: string,
    ip: string | undefined,
    datos: {
      cuentaId?: unknown;
      fechaCorte?: unknown;
      saldoBanco?: unknown;
      notas?: unknown;
    },
  ) {
    const cuentaId = texto(datos.cuentaId).toLowerCase();
    if (!UUID.test(cuentaId)) throw new BadRequestException('Escoja la cuenta');
    const fecha = texto(datos.fechaCorte);
    if (!fechaValida(fecha))
      throw new BadRequestException('Fecha de corte inválida (AAAA-MM-DD)');
    const saldo = saldoBanco(datos.saldoBanco);
    const notas = texto(datos.notas).slice(0, 500) || null;
    try {
      return await this.db.transaccion(async (c) => {
        const ct = await c.query<{ nombre: string; is_active: boolean }>(
          'SELECT nombre, is_active FROM cuentas WHERE id = $1 FOR UPDATE',
          [cuentaId],
        );
        if (ct.rowCount === 0)
          throw new NotFoundException('Cuenta no encontrada');
        if (fecha > (await this.hoy(c)))
          throw new BadRequestException(
            'La fecha de corte no puede ser futura',
          );
        const ultima = await c.query<{ fecha: string }>(
          `SELECT to_char(max(fecha_corte), 'YYYY-MM-DD') AS fecha FROM conciliaciones
           WHERE cuenta_id = $1 AND estado = 'cerrada'`,
          [cuentaId],
        );
        if (ultima.rows[0].fecha && fecha <= ultima.rows[0].fecha)
          throw new BadRequestException(
            `La fecha de corte debe ser después de la última conciliación cerrada (${ultima.rows[0].fecha})`,
          );
        const n = (
          await c.query<{ valor: string }>(
            `UPDATE contadores SET valor = valor + 1 WHERE clave = 'conciliaciones' RETURNING valor`,
          )
        ).rows[0].valor;
        const r = await c.query<{ id: string }>(
          `INSERT INTO conciliaciones (numero, cuenta_id, fecha_corte, saldo_banco, notas, created_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [n, cuentaId, fecha, saldo, notas, actorId],
        );
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'conciliacion.crear',
          entidad: 'conciliaciones',
          entidadId: r.rows[0].id,
          nuevo: {
            conciliacion: numeroConciliacion(n),
            cuenta: ct.rows[0].nombre,
            fecha_corte: fecha,
            saldo_banco: saldo,
          },
          ip,
        });
        return { id: r.rows[0].id, codigo: numeroConciliacion(n) };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw new ConflictException(
          'Esa cuenta ya tiene una conciliación abierta: termínela o descártela',
        );
      throw e;
    }
  }

  async editar(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: { saldoBanco?: unknown; notas?: unknown },
  ) {
    const saldo = saldoBanco(datos.saldoBanco);
    const notas = texto(datos.notas).slice(0, 500) || null;
    return this.db.transaccion(async (c) => {
      const k = await this.abierta(c, id);
      await c.query(
        'UPDATE conciliaciones SET saldo_banco = $2, notas = $3, updated_at = now() WHERE id = $1',
        [id, saldo, notas],
      );
      if (k.saldo_banco !== saldo)
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'conciliacion.saldo_banco',
          entidad: 'conciliaciones',
          entidadId: id,
          anterior: { saldo_banco: k.saldo_banco },
          nuevo: { saldo_banco: saldo },
          ip,
        });
      return { ok: true };
    });
  }

  // Marca o desmarca movimientos como "aparece en el estado de cuenta".
  async marcar(actorId: string, id: string, datos: { movimientos?: unknown }) {
    if (!Array.isArray(datos.movimientos) || datos.movimientos.length === 0)
      throw new BadRequestException('Indique los movimientos');
    if (datos.movimientos.length > 2000)
      throw new BadRequestException('Máximo 2000 movimientos a la vez');
    const marcas = (datos.movimientos as Record<string, unknown>[]).map((m) => {
      const mid = texto(m?.id);
      if (!/^\d{1,18}$/.test(mid) || typeof m?.cotejado !== 'boolean')
        throw new BadRequestException('Marca inválida');
      return { id: mid, cotejado: m.cotejado };
    });
    return this.db.transaccion(async (c) => {
      const k = await this.abierta(c, id);
      const validos = new Set((await this.movimientos(c, k)).map((m) => m.id));
      for (const m of marcas) {
        if (!validos.has(m.id))
          throw new BadRequestException(
            `El movimiento ${m.id} no entra en esta conciliación`,
          );
        await c.query(
          `INSERT INTO conciliacion_partidas (conciliacion_id, movimiento_id, cotejado, updated_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (conciliacion_id, movimiento_id)
           DO UPDATE SET cotejado = EXCLUDED.cotejado, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [id, m.id, m.cotejado, actorId],
        );
      }
      const calc = await this.calcular(c, k);
      return { totales: calc.totales };
    });
  }

  // Cierra si la diferencia es 0. Lo cotejado "por confirmar" queda confirmado.
  async cerrar(actorId: string, id: string, ip: string | undefined) {
    return this.db.transaccion(async (c) => {
      const k = await this.abierta(c, id);
      await c.query('SELECT 1 FROM cuentas WHERE id = $1 FOR UPDATE', [
        k.cuenta_id,
      ]);
      const calc = await this.calcular(c, k);
      if (calc.diferencia !== 0n)
        throw new BadRequestException(
          `No cuadra: hay una diferencia de ${texto2(calc.diferencia)}. Registre en Bancos lo que falte (cargos, intereses…) o revise las marcas.`,
        );
      // Las no cotejadas quedan guardadas como "en tránsito" de esta conciliación.
      for (const m of calc.movs.filter((x) => !x.cotejado))
        await c.query(
          `INSERT INTO conciliacion_partidas (conciliacion_id, movimiento_id, cotejado, updated_by)
           VALUES ($1, $2, false, $3) ON CONFLICT (conciliacion_id, movimiento_id) DO NOTHING`,
          [id, m.id, actorId],
        );
      const confirmados: string[] = [];
      for (const m of calc.movs.filter(
        (x) => x.cotejado && x.estado === 'por_confirmar',
      )) {
        await c.query(
          `INSERT INTO cuenta_confirmaciones (movimiento_id, resultado, fecha_banco, motivo, usuario_id)
           VALUES ($1, 'confirmado', $2, $3, $4)`,
          [
            m.id,
            k.fecha_corte,
            `Conciliación ${numeroConciliacion(k.numero)}`,
            actorId,
          ],
        );
        confirmados.push(m.id);
      }
      await c.query(
        `UPDATE conciliaciones SET estado = 'cerrada', saldo_sistema = $2, en_transito = $3,
                cerrada_por = $4, cerrada_en = now(), updated_at = now()
         WHERE id = $1`,
        [id, texto2(calc.sistema), texto2(calc.transito), actorId],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'conciliacion.cerrar',
        entidad: 'conciliaciones',
        entidadId: id,
        nuevo: {
          conciliacion: numeroConciliacion(k.numero),
          fecha_corte: k.fecha_corte,
          saldo_banco: k.saldo_banco,
          saldo_sistema: texto2(calc.sistema),
          en_transito: texto2(calc.transito),
          cotejados: calc.totales.cotejados,
          confirmados,
        },
        ip,
      });
      return { ok: true, confirmados: confirmados.length };
    });
  }

  async descartar(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: { motivo?: unknown },
  ) {
    const motivo = texto(datos.motivo);
    if (motivo.length < 5 || motivo.length > 500)
      throw new BadRequestException('Escriba el motivo (5 a 500 caracteres)');
    return this.db.transaccion(async (c) => {
      const k = await this.abierta(c, id);
      await c.query(
        `UPDATE conciliaciones SET estado = 'descartada', motivo_descarte = $2, updated_at = now() WHERE id = $1`,
        [id, motivo],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'conciliacion.descartar',
        entidad: 'conciliaciones',
        entidadId: id,
        anterior: { estado: 'abierta' },
        nuevo: {
          conciliacion: numeroConciliacion(k.numero),
          estado: 'descartada',
        },
        motivo,
        ip,
      });
      return { ok: true };
    });
  }
}
