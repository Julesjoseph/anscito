import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { registrarAuditoria } from '../auditoria/auditoria';
import { SQL_DISPONIBLE } from '../bancos/sql';
import { SQL_ESPERADO } from '../caja/sql';
import { DatabaseService } from '../database/database.service';
import { normalizarMonto } from '../servicios/calculo-itbis';
import {
  calendario,
  centavos,
  cuotaDe,
  fechaValida,
  manoDe,
  moraDe,
  porcentaje,
  texto2,
} from './calendario';
import type { Frecuencia } from './calendario';
import { faltantesFicha } from './ficha-requisitos';
import { encabezado } from '../comun/ticket';
import type { Ticket } from '../comun/ticket';
import { generarReciboSan } from './recibo-san-pdf';
import type { FilaRecibo } from './recibo-san-pdf';
import { dinero } from '../ventas/recibo-pdf';
import type { Formato } from '../ventas/recibo-pdf';

// SAN administrado por SCITO. Las cuotas son dinero de los participantes;
// solo la comisión (de cada mano) y la mora son ganancia de SCITO.
// La mano se entrega completa aunque otros deban (SCITO adelanta), y a quien
// cobra se le descuentan sus cuotas vencidas sin pagar.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FRECUENCIAS = ['semanal', 'quincenal', 'mensual'];

type Consulta = Pick<DatabaseService, 'query'>;
type Parte = 'completo' | 'medio';

type San = {
  id: string;
  numero: string;
  nombre: string;
  frecuencia: Frecuencia;
  cuota: string;
  cantidad_numeros: number;
  fecha_inicio: string;
  comision_pct: string;
  mora_pct: string;
  dias_gracia: number;
  estado: 'preparacion' | 'activo' | 'terminado' | 'cancelado';
};

function texto(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
}

function opcional(v: unknown, max: number, que: string): string | null {
  const t = texto(v);
  if (t.length > max)
    throw new BadRequestException(`${que}: máximo ${max} caracteres`);
  return t || null;
}

function pct(v: unknown, que: string): string {
  const t = texto(v);
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t) || Number(t) > 100)
    throw new BadRequestException(`${que}: un porcentaje de 0 a 100`);
  return t;
}

export function numeroSan(n: number | string) {
  return `SOL-${String(n).padStart(4, '0')}`;
}
export function numeroRecibo(n: number | string) {
  return `R-${String(n).padStart(6, '0')}`;
}
export function numeroEntrega(n: number | string) {
  return `M-${String(n).padStart(6, '0')}`;
}

const SQL_SAN = `SELECT id, numero, nombre, frecuencia, cuota, cantidad_numeros,
    to_char(fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio, comision_pct, mora_pct,
    dias_gracia, estado, notas FROM sanes`;

@Injectable()
export class SanesService {
  constructor(private readonly db: DatabaseService) {}

  private async config(c: Consulta, clave: string) {
    return (
      await c.query<{ valor: string }>(
        'SELECT valor FROM configuracion WHERE clave = $1',
        [clave],
      )
    ).rows[0]?.valor;
  }

  private async hoy(c: Consulta) {
    const zona =
      (await this.config(c, 'empresa.zona_horaria')) ?? 'America/Santo_Domingo';
    return (
      await c.query<{ hoy: string }>(
        `SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS hoy`,
        [zona],
      )
    ).rows[0].hoy;
  }

  private async san(c: Consulta, id: string, bloquear = false): Promise<San> {
    if (!UUID.test(id)) throw new NotFoundException('SOL CASH no encontrado');
    const r = await c.query<San>(
      `${SQL_SAN} WHERE id = $1 ${bloquear ? 'FOR UPDATE' : ''}`,
      [id],
    );
    if (r.rowCount === 0) throw new NotFoundException('SOL CASH no encontrado');
    return r.rows[0];
  }

  // ---------- Datos para la pantalla ----------

  async preparar() {
    const [com, mora, gracia, cajas, cuentas, tipos] = await Promise.all([
      this.config(this.db, 'sanes.comision_pct'),
      this.config(this.db, 'sanes.mora_pct'),
      this.config(this.db, 'sanes.dias_gracia'),
      this.db.query(
        `SELECT c.id, c.nombre, s.id AS sesion_id FROM cajas c
         LEFT JOIN caja_sesiones s ON s.caja_id = c.id AND s.estado = 'abierta'
         WHERE c.is_active ORDER BY lower(c.nombre)`,
      ),
      this.db.query(
        `SELECT id, nombre FROM cuentas WHERE is_active AND moneda = 'DOP' ORDER BY lower(nombre)`,
      ),
      this.db.query(
        'SELECT id, codigo, nombre, ayuda FROM tipos_documento ORDER BY orden',
      ),
    ]);
    return {
      comisionPct: com ?? '5.00',
      moraPct: mora ?? '10.00',
      diasGracia: Number(gracia ?? 3),
      cajas: cajas.rows,
      cuentas: cuentas.rows,
      tiposDocumento: tipos.rows,
    };
  }

  // Valores por defecto (administrador).
  async configurar(
    actorId: string,
    ip: string | undefined,
    datos: { comisionPct?: unknown; moraPct?: unknown; diasGracia?: unknown },
  ) {
    const com = pct(datos.comisionPct, 'Comisión');
    const mora = pct(datos.moraPct, 'Mora');
    const gracia = texto(datos.diasGracia);
    if (!/^\d{1,2}$/.test(gracia) || Number(gracia) > 60)
      throw new BadRequestException('Días de gracia: de 0 a 60');
    return this.db.transaccion(async (c) => {
      const antes = await this.preparar();
      for (const [k, v] of [
        ['sanes.comision_pct', com],
        ['sanes.mora_pct', mora],
        ['sanes.dias_gracia', gracia],
      ]) {
        await c.query(
          'UPDATE configuracion SET valor = $2, updated_by = $3, updated_at = now() WHERE clave = $1',
          [k, v, actorId],
        );
      }
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'san.configurar',
        entidad: 'configuracion',
        anterior: {
          comision_pct: antes.comisionPct,
          mora_pct: antes.moraPct,
          dias_gracia: antes.diasGracia,
        },
        nuevo: { comision_pct: com, mora_pct: mora, dias_gracia: gracia },
        ip,
      });
      return { ok: true };
    });
  }

  // ---------- SAN ----------

  async listar() {
    const r = await this.db.query(
      `SELECT s.id, s.numero, s.nombre, s.frecuencia, s.cuota, s.cantidad_numeros,
              to_char(s.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio, s.comision_pct, s.mora_pct,
              s.dias_gracia, s.estado,
              (s.cuota * s.cantidad_numeros)::numeric(16,2) AS mano,
              (SELECT count(DISTINCT p.numero)::int FROM san_participaciones p WHERE p.san_id = s.id) AS asignados,
              (SELECT count(*)::int FROM san_entregas e WHERE e.san_id = s.id) AS entregas,
              -- Próximo turno: el primero cuyo número tiene alguien sin cobrar.
              (SELECT to_char(min(t.fecha), 'YYYY-MM-DD') FROM san_turnos t
                WHERE t.san_id = s.id AND EXISTS (
                  SELECT 1 FROM san_participaciones p
                  WHERE p.san_id = s.id AND p.numero = t.turno
                    AND NOT EXISTS (SELECT 1 FROM san_entregas e WHERE e.participacion_id = p.id))) AS proximo_turno
       FROM sanes s
       ORDER BY CASE s.estado WHEN 'activo' THEN 0 WHEN 'preparacion' THEN 1 ELSE 2 END, s.numero DESC`,
    );
    return r.rows.map((f: { numero: string }) => ({
      ...f,
      codigo: numeroSan(f.numero),
    }));
  }

  private datosSan(datos: Record<string, unknown>) {
    const nombre = texto(datos.nombre);
    if (nombre.length < 3 || nombre.length > 80)
      throw new BadRequestException(
        'Escriba el nombre del SOL CASH (3 a 80 caracteres)',
      );
    const frecuencia = texto(datos.frecuencia) as Frecuencia;
    if (!FRECUENCIAS.includes(frecuencia))
      throw new BadRequestException(
        'Frecuencia inválida: semanal, quincenal o mensual',
      );
    const cuota = normalizarMonto(datos.cuota);
    if (cuota === null || cuota === '0.00')
      throw new BadRequestException(
        'Cuota inválida: mayor que 0, con hasta 2 decimales',
      );
    if (centavos(cuota) % 2n !== 0n)
      throw new BadRequestException(
        'La cuota debe poder dividirse entre dos (medio número) sin perder centavos',
      );
    const n = Number(texto(datos.cantidadNumeros));
    if (!Number.isInteger(n) || n < 2 || n > 200)
      throw new BadRequestException('Cantidad de números: de 2 a 200');
    const inicio = texto(datos.fechaInicio);
    if (!fechaValida(inicio))
      throw new BadRequestException(
        'Fecha de inicio inválida (use AAAA-MM-DD)',
      );
    const gracia = texto(datos.diasGracia);
    if (!/^\d{1,2}$/.test(gracia) || Number(gracia) > 60)
      throw new BadRequestException('Días de gracia: de 0 a 60');
    return {
      nombre,
      frecuencia,
      cuota,
      n,
      inicio,
      comision: pct(datos.comisionPct, 'Comisión'),
      mora: pct(datos.moraPct, 'Mora'),
      gracia: Number(gracia),
      notas: opcional(datos.notas, 500, 'Notas'),
    };
  }

  private async generarTurnos(
    c: PoolClient,
    sanId: string,
    inicio: string,
    frecuencia: Frecuencia,
    n: number,
  ) {
    await c.query('DELETE FROM san_turnos WHERE san_id = $1', [sanId]);
    const fechas = calendario(inicio, frecuencia, n);
    await c.query(
      `INSERT INTO san_turnos (san_id, turno, fecha)
       SELECT $1, t.turno, t.fecha FROM unnest($2::int[], $3::date[]) AS t(turno, fecha)`,
      [sanId, fechas.map((_, i) => i + 1), fechas],
    );
  }

  async crear(
    actorId: string,
    ip: string | undefined,
    datos: Record<string, unknown>,
  ) {
    const d = this.datosSan(datos);
    try {
      return await this.db.transaccion(async (c) => {
        const n = (
          await c.query<{ valor: string }>(
            `UPDATE contadores SET valor = valor + 1 WHERE clave = 'sanes' RETURNING valor`,
          )
        ).rows[0].valor;
        const r = await c.query<{ id: string }>(
          `INSERT INTO sanes (numero, nombre, frecuencia, cuota, cantidad_numeros, fecha_inicio,
                              comision_pct, mora_pct, dias_gracia, notas, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [
            n,
            d.nombre,
            d.frecuencia,
            d.cuota,
            d.n,
            d.inicio,
            d.comision,
            d.mora,
            d.gracia,
            d.notas,
            actorId,
          ],
        );
        await this.generarTurnos(c, r.rows[0].id, d.inicio, d.frecuencia, d.n);
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'san.crear',
          entidad: 'sanes',
          entidadId: r.rows[0].id,
          nuevo: { codigo: numeroSan(n), ...d },
          ip,
        });
        return { id: r.rows[0].id, codigo: numeroSan(n) };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw new ConflictException('Ya existe un SOL CASH con ese nombre');
      throw e;
    }
  }

  // Solo en preparación (después no se cambian las reglas del juego).
  async editar(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: Record<string, unknown>,
  ) {
    const d = this.datosSan(datos);
    try {
      return await this.db.transaccion(async (c) => {
        const s = await this.san(c, id, true);
        if (s.estado !== 'preparacion')
          throw new BadRequestException(
            'Solo se puede editar un SOL CASH en preparación',
          );
        const fuera = await c.query(
          'SELECT 1 FROM san_participaciones WHERE san_id = $1 AND numero > $2 LIMIT 1',
          [id, d.n],
        );
        if ((fuera.rowCount ?? 0) > 0)
          throw new BadRequestException(
            'Hay números asignados por encima de la nueva cantidad: quítelos primero',
          );
        await c.query(
          `UPDATE sanes SET nombre = $2, frecuencia = $3, cuota = $4, cantidad_numeros = $5,
                  fecha_inicio = $6, comision_pct = $7, mora_pct = $8, dias_gracia = $9,
                  notas = $10, updated_at = now() WHERE id = $1`,
          [
            id,
            d.nombre,
            d.frecuencia,
            d.cuota,
            d.n,
            d.inicio,
            d.comision,
            d.mora,
            d.gracia,
            d.notas,
          ],
        );
        await this.generarTurnos(c, id, d.inicio, d.frecuencia, d.n);
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'san.editar',
          entidad: 'sanes',
          entidadId: id,
          anterior: s,
          nuevo: d,
          ip,
        });
        return { ok: true };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw new ConflictException('Ya existe un SOL CASH con ese nombre');
      throw e;
    }
  }

  // Cambiar la fecha de un turno (en preparación), manteniendo el orden.
  async fechaTurno(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: { turno?: unknown; fecha?: unknown },
  ) {
    const turno = Number(texto(datos.turno));
    const fecha = texto(datos.fecha);
    if (!fechaValida(fecha))
      throw new BadRequestException('Fecha inválida (use AAAA-MM-DD)');
    return this.db.transaccion(async (c) => {
      const s = await this.san(c, id, true);
      if (s.estado !== 'preparacion')
        throw new BadRequestException(
          'Las fechas solo se cambian antes de activar el SOL CASH',
        );
      const r = await c.query<{
        antes: string | null;
        despues: string | null;
        actual: string | null;
      }>(
        `SELECT (SELECT to_char(fecha, 'YYYY-MM-DD') FROM san_turnos WHERE san_id = $1 AND turno = $2 - 1) AS antes,
                (SELECT to_char(fecha, 'YYYY-MM-DD') FROM san_turnos WHERE san_id = $1 AND turno = $2 + 1) AS despues,
                (SELECT to_char(fecha, 'YYYY-MM-DD') FROM san_turnos WHERE san_id = $1 AND turno = $2) AS actual`,
        [id, turno],
      );
      const f = r.rows[0];
      if (!f.actual) throw new NotFoundException('Turno no encontrado');
      if ((f.antes && fecha <= f.antes) || (f.despues && fecha >= f.despues))
        throw new BadRequestException(
          'La fecha debe quedar entre la del turno anterior y la del siguiente',
        );
      await c.query(
        'UPDATE san_turnos SET fecha = $3 WHERE san_id = $1 AND turno = $2',
        [id, turno, fecha],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'san.fecha_turno',
        entidad: 'sanes',
        entidadId: id,
        anterior: { turno, fecha: f.actual },
        nuevo: { turno, fecha },
        ip,
      });
      return { ok: true };
    });
  }

  // ---------- Números ----------

  async asignar(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: { numero?: unknown; terceroId?: unknown; parte?: unknown },
  ) {
    const numero = Number(texto(datos.numero));
    const terceroId = texto(datos.terceroId).toLowerCase();
    const parte = texto(datos.parte) as Parte;
    if (!UUID.test(terceroId))
      throw new BadRequestException('Seleccione el participante (cliente)');
    if (parte !== 'completo' && parte !== 'medio')
      throw new BadRequestException('Parte inválida: completo o medio');
    try {
      return await this.db.transaccion(async (c) => {
        const s = await this.san(c, id, true);
        if (s.estado !== 'preparacion' && s.estado !== 'activo')
          throw new BadRequestException(`El SOL CASH está ${s.estado}`);
        if (
          !Number.isInteger(numero) ||
          numero < 1 ||
          numero > s.cantidad_numeros
        )
          throw new BadRequestException(
            `Número inválido: de 1 a ${s.cantidad_numeros}`,
          );
        const t = await c.query<{
          nombre: string;
          numero_documento: string | null;
        }>(
          `SELECT nombre, numero_documento FROM terceros WHERE id = $1 AND rol = 'cliente' AND is_active`,
          [terceroId],
        );
        if (t.rowCount === 0)
          throw new BadRequestException(
            'El cliente no existe o está desactivado',
          );
        if (!t.rows[0].numero_documento)
          throw new BadRequestException(
            'El participante no tiene documento (cédula o pasaporte). Agréguelo en Clientes.',
          );
        // Ficha completa: datos, foto del documento, fiador y referencia confirmados.
        const falta = await faltantesFicha(c, terceroId);
        if (falta.length)
          throw new BadRequestException(
            `A ${t.rows[0].nombre} le falta: ${falta.join(', ')}. Complete su ficha del SOL CASH.`,
          );
        const ocupado = await c.query<{ parte: string }>(
          'SELECT parte FROM san_participaciones WHERE san_id = $1 AND numero = $2',
          [id, numero],
        );
        const partes = ocupado.rows.map((f) => f.parte);
        if (parte === 'completo' && partes.length > 0)
          throw new BadRequestException(`El número ${numero} ya tiene dueño`);
        if (
          parte === 'medio' &&
          (partes.includes('completo') || partes.length >= 2)
        )
          throw new BadRequestException(`El número ${numero} ya está completo`);
        if (s.estado === 'activo') {
          // En un SAN activo solo se completa un número que nadie ha cobrado.
          const cobrado = await c.query(
            'SELECT 1 FROM san_entregas WHERE san_id = $1 AND turno = $2',
            [id, numero],
          );
          if ((cobrado.rowCount ?? 0) > 0)
            throw new BadRequestException(
              `El número ${numero} ya cobró su mano`,
            );
        }
        const r = await c.query<{ id: string }>(
          `INSERT INTO san_participaciones (san_id, numero, tercero_id, parte, created_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [id, numero, terceroId, parte, actorId],
        );
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'san.asignar',
          entidad: 'sanes',
          entidadId: id,
          nuevo: {
            san: numeroSan(s.numero),
            numero,
            participante: t.rows[0].nombre,
            parte,
          },
          ip,
        });
        return { id: r.rows[0].id };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw new ConflictException(
          'Esa persona ya tiene ese número, o el número ya tiene dueño',
        );
      throw e;
    }
  }

  // Quitar a alguien de un número: solo si no ha pagado ni cobrado nada.
  async quitar(
    actorId: string,
    id: string,
    ip: string | undefined,
    participacionId: string,
  ) {
    if (!UUID.test(participacionId))
      throw new NotFoundException('Participación no encontrada');
    return this.db.transaccion(async (c) => {
      const s = await this.san(c, id, true);
      const p = await c.query<{ numero: number; nombre: string }>(
        `SELECT p.numero, t.nombre FROM san_participaciones p JOIN terceros t ON t.id = p.tercero_id
         WHERE p.id = $1 AND p.san_id = $2`,
        [participacionId, id],
      );
      if (p.rowCount === 0)
        throw new NotFoundException('Participación no encontrada');
      const usado = await c.query(
        `SELECT 1 FROM san_pagos WHERE participacion_id = $1
         UNION ALL SELECT 1 FROM san_entregas WHERE participacion_id = $1 LIMIT 1`,
        [participacionId],
      );
      if ((usado.rowCount ?? 0) > 0)
        throw new BadRequestException(
          'No se puede quitar: ya tiene pagos o cobró su mano',
        );
      // Los contratos quedan en el historial: con contrato ya no se quita.
      const contrato = await c.query(
        'SELECT 1 FROM san_contratos WHERE participacion_id = $1 LIMIT 1',
        [participacionId],
      );
      if ((contrato.rowCount ?? 0) > 0)
        throw new BadRequestException(
          'No se puede quitar: ya se le hizo contrato para este número (queda en el historial)',
        );
      await c.query('DELETE FROM san_participaciones WHERE id = $1', [
        participacionId,
      ]);
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'san.quitar',
        entidad: 'sanes',
        entidadId: id,
        anterior: {
          san: numeroSan(s.numero),
          numero: p.rows[0].numero,
          participante: p.rows[0].nombre,
        },
        ip,
      });
      return { ok: true };
    });
  }

  // Activar: todos los números deben tener dueño completo (o dos medios).
  async cambiarEstado(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: { estado?: unknown; motivo?: unknown },
  ) {
    const estado = texto(datos.estado);
    if (!['activo', 'cancelado', 'terminado'].includes(estado))
      throw new BadRequestException(
        'Estado inválido: activo, cancelado o terminado',
      );
    const motivo = texto(datos.motivo);
    return this.db.transaccion(async (c) => {
      const s = await this.san(c, id, true);
      if (estado === 'activo') {
        if (s.estado !== 'preparacion')
          throw new BadRequestException(
            'Solo se activa un SOL CASH en preparación',
          );
        const incompletos = await c.query<{ numero: number }>(
          `SELECT n AS numero FROM generate_series(1, $2::int) n
           WHERE NOT EXISTS (SELECT 1 FROM san_participaciones p WHERE p.san_id = $1 AND p.numero = n AND p.parte = 'completo')
             AND (SELECT count(*) FROM san_participaciones p WHERE p.san_id = $1 AND p.numero = n AND p.parte = 'medio') < 2
           ORDER BY n LIMIT 20`,
          [id, s.cantidad_numeros],
        );
        if ((incompletos.rowCount ?? 0) > 0)
          throw new BadRequestException(
            `Faltan dueños en los números: ${incompletos.rows.map((f) => f.numero).join(', ')}`,
          );
      } else if (estado === 'cancelado') {
        if (s.estado !== 'preparacion')
          throw new BadRequestException(
            'Solo se cancela un SOL CASH que no ha empezado (en preparación)',
          );
        if (motivo.length < 5)
          throw new BadRequestException(
            'Escriba el motivo (mínimo 5 caracteres)',
          );
      } else {
        if (s.estado !== 'activo')
          throw new BadRequestException('Solo se termina un SOL CASH activo');
        const pend = await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM san_participaciones p
           WHERE p.san_id = $1 AND NOT EXISTS (SELECT 1 FROM san_entregas e WHERE e.participacion_id = p.id)`,
          [id],
        );
        if (pend.rows[0].n > 0)
          throw new BadRequestException(
            `Faltan ${pend.rows[0].n} mano(s) por entregar`,
          );
      }
      await c.query(
        'UPDATE sanes SET estado = $2, updated_at = now() WHERE id = $1',
        [id, estado],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: `san.${estado === 'activo' ? 'activar' : estado === 'cancelado' ? 'cancelar' : 'terminar'}`,
        entidad: 'sanes',
        entidadId: id,
        anterior: { estado: s.estado },
        nuevo: { san: numeroSan(s.numero), estado },
        motivo: motivo || undefined,
        ip,
      });
      return { ok: true };
    });
  }

  // ---------- Detalle y deudas ----------

  // Para cada participación: sus períodos, cuáles pagó y qué debe hoy.
  private async estadoParticipaciones(
    c: Consulta,
    s: San,
    filtro: { terceroId?: string } = {},
  ) {
    const hoy = await this.hoy(c);
    const params: unknown[] = [s.id];
    let cond = '';
    if (filtro.terceroId) {
      params.push(filtro.terceroId);
      cond = 'AND p.tercero_id = $2';
    }
    const [parts, turnos, pagos, entregas] = await Promise.all([
      c.query<{
        id: string;
        numero: number;
        parte: Parte;
        tercero_id: string;
        nombre: string;
        telefono: string | null;
      }>(
        `SELECT p.id, p.numero, p.parte, p.tercero_id, t.nombre, t.telefono
         FROM san_participaciones p JOIN terceros t ON t.id = p.tercero_id
         WHERE p.san_id = $1 ${cond} ORDER BY p.numero, t.nombre`,
        params,
      ),
      c.query<{ turno: number; fecha: string }>(
        `SELECT turno, to_char(fecha, 'YYYY-MM-DD') AS fecha FROM san_turnos WHERE san_id = $1 ORDER BY turno`,
        [s.id],
      ),
      c.query<{
        participacion_id: string;
        turno: number;
        cuota: string;
        mora: string;
      }>(
        `SELECT pg.participacion_id, pg.turno, pg.cuota, pg.mora FROM san_pagos pg
         JOIN san_participaciones p ON p.id = pg.participacion_id WHERE p.san_id = $1`,
        [s.id],
      ),
      c.query<{
        id: string;
        participacion_id: string;
        numero: string;
        neto: string;
        created_at: string;
      }>(
        `SELECT id, participacion_id, numero, neto, created_at FROM san_entregas WHERE san_id = $1`,
        [s.id],
      ),
    ]);
    const pagado = new Set(
      pagos.rows.map((p) => `${p.participacion_id}:${p.turno}`),
    );
    const entrego = new Map(entregas.rows.map((e) => [e.participacion_id, e]));
    return {
      hoy,
      turnos: turnos.rows,
      participaciones: parts.rows.map((p) => {
        const cuota = cuotaDe(s.cuota, p.parte);
        const periodos = turnos.rows.map((t) => {
          const pagadoYa = pagado.has(`${p.id}:${t.turno}`);
          const vencido = t.fecha <= hoy;
          const m = moraDe(cuota, t.fecha, hoy, s.dias_gracia, s.mora_pct);
          return {
            turno: t.turno,
            fecha: t.fecha,
            estado: pagadoYa ? 'pagado' : vencido ? 'vencido' : 'por_vencer',
            cuota,
            mora: pagadoYa || !vencido ? '0.00' : m.mora,
            dias_atraso: pagadoYa || !vencido ? 0 : m.dias,
          };
        });
        const vencidos = periodos.filter((x) => x.estado === 'vencido');
        const e = entrego.get(p.id);
        return {
          ...p,
          cuota,
          mano: manoDe(s.cuota, s.cantidad_numeros, p.parte),
          pagados: periodos.filter((x) => x.estado === 'pagado').length,
          vencidos: vencidos.length,
          debe_cuotas: texto2(
            vencidos.reduce((a, x) => a + centavos(x.cuota), 0n),
          ),
          debe_mora: texto2(
            vencidos.reduce((a, x) => a + centavos(x.mora), 0n),
          ),
          entrega: e
            ? {
                id: e.id,
                numero: numeroEntrega(e.numero),
                neto: e.neto,
                fecha: e.created_at,
              }
            : null,
          periodos,
        };
      }),
    };
  }

  async detalle(id: string) {
    const s = await this.san(this.db, id);
    const est = await this.estadoParticipaciones(this.db, s);
    const fondo = await this.db.query<{
      cuotas: string;
      mora: string;
      bruto: string;
      comision: string;
      neto: string;
    }>(
      `SELECT COALESCE((SELECT sum(pg.cuota) FROM san_pagos pg JOIN san_participaciones p ON p.id = pg.participacion_id WHERE p.san_id = $1), 0)::numeric(16,2) AS cuotas,
              COALESCE((SELECT sum(pg.mora) FROM san_pagos pg JOIN san_participaciones p ON p.id = pg.participacion_id WHERE p.san_id = $1), 0)::numeric(16,2) AS mora,
              COALESCE((SELECT sum(bruto) FROM san_entregas WHERE san_id = $1), 0)::numeric(16,2) AS bruto,
              COALESCE((SELECT sum(comision) FROM san_entregas WHERE san_id = $1), 0)::numeric(16,2) AS comision,
              COALESCE((SELECT sum(neto) FROM san_entregas WHERE san_id = $1), 0)::numeric(16,2) AS neto`,
      [id],
    );
    const f = fondo.rows[0];
    // Contrato vigente y requisitos de cada participante.
    const contratos = await this.db.query<{
      participacion_id: string;
      id: string;
      numero: string;
      estado: string;
      idioma: string;
    }>(
      `SELECT ct.participacion_id, ct.id, ct.numero, ct.estado, ct.idioma FROM san_contratos ct
       JOIN san_participaciones p ON p.id = ct.participacion_id
       WHERE p.san_id = $1 AND ct.estado <> 'anulado'`,
      [id],
    );
    const contratoDe = new Map(
      contratos.rows.map((x) => [
        x.participacion_id,
        {
          id: x.id,
          codigo: `C-${String(x.numero).padStart(6, '0')}`,
          estado: x.estado,
          idioma: x.idioma,
        },
      ]),
    );
    const faltaDe = new Map<string, string[]>();
    for (const tid of new Set(est.participaciones.map((p) => p.tercero_id)))
      faltaDe.set(tid, await faltantesFicha(this.db, tid));
    // Fondo = cuotas cobradas − manos entregadas (bruto). Negativo: SCITO adelantó.
    const saldo = centavos(f.cuotas) - centavos(f.bruto);
    return {
      ...s,
      codigo: numeroSan(s.numero),
      mano: manoDe(s.cuota, s.cantidad_numeros, 'completo'),
      hoy: est.hoy,
      turnos: est.turnos.map((t) => ({
        ...t,
        entregado: est.participaciones.filter(
          (p) => p.numero === t.turno && p.entrega,
        ).length,
        duenos: est.participaciones.filter((p) => p.numero === t.turno).length,
      })),
      participaciones: est.participaciones.map(
        ({ periodos: _p, ...resto }) => ({
          ...resto,
          contrato: contratoDe.get(resto.id) ?? null,
          falta: faltaDe.get(resto.tercero_id) ?? [],
        }),
      ),
      dinero: {
        cuotas_cobradas: f.cuotas,
        mora_cobrada: f.mora,
        manos_entregadas: f.bruto,
        comision_ganada: f.comision,
        fondo: texto2(saldo > 0n ? saldo : 0n),
        adelantado_scito: texto2(saldo < 0n ? -saldo : 0n),
      },
    };
  }

  // Lo que debe y puede pagar un participante en un SAN (pantalla de cobro).
  async cuenta(id: string, terceroId: string) {
    if (!UUID.test(terceroId))
      throw new BadRequestException('Participante inválido');
    const s = await this.san(this.db, id);
    const est = await this.estadoParticipaciones(this.db, s, { terceroId });
    if (est.participaciones.length === 0)
      throw new NotFoundException(
        'Esa persona no tiene números en este SOL CASH',
      );
    return {
      san: { ...s, codigo: numeroSan(s.numero) },
      hoy: est.hoy,
      participaciones: est.participaciones,
    };
  }

  // SAN en los que participa una persona (para buscarla en Cobrar).
  async dePersona(terceroId: string) {
    if (!UUID.test(terceroId))
      throw new BadRequestException('Participante inválido');
    const r = await this.db.query(
      `SELECT DISTINCT s.id, s.numero, s.nombre, s.estado FROM san_participaciones p
       JOIN sanes s ON s.id = p.san_id WHERE p.tercero_id = $1 AND s.estado = 'activo'
       ORDER BY s.numero`,
      [terceroId],
    );
    return r.rows.map((f: { numero: string }) => ({
      ...f,
      codigo: numeroSan(f.numero),
    }));
  }

  // Buscar clientes por nombre, documento o teléfono. Con soloParticipantes,
  // solo quienes tienen números en un SAN activo (pantalla de cobro).
  async buscarClientes(textoBuscado: unknown, soloParticipantes: boolean) {
    const t = texto(textoBuscado);
    if (t.length < 2) return [];
    const r = await this.db.query(
      `SELECT t.id, t.nombre, t.numero_documento, t.telefono FROM terceros t
       WHERE t.rol = 'cliente' AND t.is_active
         AND (t.nombre ILIKE '%' || $1 || '%' OR t.numero_documento ILIKE '%' || $1 || '%'
              OR t.telefono ILIKE '%' || $1 || '%')
         AND (NOT $2 OR EXISTS (SELECT 1 FROM san_participaciones p JOIN sanes s ON s.id = p.san_id
                                WHERE p.tercero_id = t.id AND s.estado = 'activo'))
       ORDER BY lower(t.nombre) LIMIT 20`,
      [t.slice(0, 60), soloParticipantes],
    );
    return r.rows;
  }

  // Todos los atrasados de los SAN activos.
  async atrasados() {
    const sanes = await this.db.query<{ id: string }>(
      `SELECT id FROM sanes WHERE estado = 'activo' ORDER BY numero`,
    );
    const filas = [];
    for (const { id } of sanes.rows) {
      const s = await this.san(this.db, id);
      const est = await this.estadoParticipaciones(this.db, s);
      for (const p of est.participaciones.filter((x) => x.vencidos > 0)) {
        filas.push({
          san_id: s.id,
          san: numeroSan(s.numero),
          san_nombre: s.nombre,
          numero: p.numero,
          parte: p.parte,
          tercero_id: p.tercero_id,
          nombre: p.nombre,
          telefono: p.telefono,
          vencidos: p.vencidos,
          debe_cuotas: p.debe_cuotas,
          debe_mora: p.debe_mora,
          mas_antiguo:
            p.periodos.find((x) => x.estado === 'vencido')?.fecha ?? null,
        });
      }
    }
    return filas;
  }

  // ---------- Dinero: caja o cuenta ----------

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
    return {
      tipo: 'cuenta' as const,
      id: ct.rows[0].id,
      nombre: ct.rows[0].nombre,
    };
  }

  // ---------- Cobrar cuotas ----------

  async cobrar(
    actorId: string,
    ip: string | undefined,
    datos: {
      sanId?: unknown;
      terceroId?: unknown;
      periodos?: unknown; // [{ participacionId, turno }]
      forma?: unknown;
      cajaId?: unknown;
      cuentaId?: unknown;
      referencia?: unknown;
    },
  ) {
    const sanId = texto(datos.sanId).toLowerCase();
    const terceroId = texto(datos.terceroId).toLowerCase();
    if (!UUID.test(terceroId))
      throw new BadRequestException('Seleccione el participante');
    const forma = texto(datos.forma);
    if (forma !== 'efectivo' && forma !== 'transferencia')
      throw new BadRequestException('Forma inválida: efectivo o transferencia');
    const referencia = opcional(datos.referencia, 60, 'Referencia');
    if (forma === 'transferencia' && !referencia)
      throw new BadRequestException(
        'Escriba la referencia de la transferencia',
      );
    const lista = Array.isArray(datos.periodos) ? datos.periodos : [];
    const elegidos = lista.map(
      (x: { participacionId?: unknown; turno?: unknown }) => ({
        participacionId: texto(x?.participacionId).toLowerCase(),
        turno: Number(texto(x?.turno)),
      }),
    );
    if (elegidos.length === 0)
      throw new BadRequestException('Elija al menos un período a pagar');
    if (elegidos.length > 200)
      throw new BadRequestException('Demasiados períodos en un recibo');

    return this.db.transaccion(async (c) => {
      const s = await this.san(c, sanId, true);
      if (s.estado !== 'activo')
        throw new BadRequestException('El SOL CASH no está activo');
      const est = await this.estadoParticipaciones(c, s, { terceroId });
      const lineas: {
        participacionId: string;
        numero: number;
        turno: number;
        fecha: string;
        cuota: string;
        mora: string;
        dias: number;
      }[] = [];
      for (const e of elegidos) {
        const p = est.participaciones.find((x) => x.id === e.participacionId);
        if (!p)
          throw new BadRequestException(
            'Uno de los números no es de esta persona',
          );
        const per = p.periodos.find((x) => x.turno === e.turno);
        if (!per)
          throw new BadRequestException(`El período ${e.turno} no existe`);
        if (per.estado === 'pagado')
          throw new BadRequestException(
            `El número ${p.numero} ya pagó el período ${e.turno}`,
          );
        lineas.push({
          participacionId: p.id,
          numero: p.numero,
          turno: per.turno,
          fecha: per.fecha,
          cuota: per.cuota,
          mora: per.mora,
          dias: per.dias_atraso,
        });
      }
      // Se paga en orden: no se puede saltar un período anterior sin pagar.
      for (const p of est.participaciones) {
        const mios = new Set(
          lineas.filter((l) => l.participacionId === p.id).map((l) => l.turno),
        );
        if (mios.size === 0) continue;
        const ultimo = Math.max(...mios);
        const salto = p.periodos.find(
          (x) =>
            x.turno < ultimo && x.estado !== 'pagado' && !mios.has(x.turno),
        );
        if (salto)
          throw new BadRequestException(
            `El número ${p.numero} debe pagar primero el período ${salto.turno} (${salto.fecha})`,
          );
      }
      if (
        new Set(lineas.map((l) => `${l.participacionId}:${l.turno}`)).size !==
        lineas.length
      )
        throw new BadRequestException('Hay períodos repetidos');

      const cuotas = lineas.reduce((a, l) => a + centavos(l.cuota), 0n);
      const mora = lineas.reduce((a, l) => a + centavos(l.mora), 0n);
      const total = cuotas + mora;
      const dest = await this.destino(c, forma, datos.cajaId, datos.cuentaId);
      const n = (
        await c.query<{ valor: string }>(
          `UPDATE contadores SET valor = valor + 1 WHERE clave = 'san_recibos' RETURNING valor`,
        )
      ).rows[0].valor;
      const r = await c.query<{ id: string }>(
        `INSERT INTO san_recibos (numero, san_id, tercero_id, cuotas, mora, total, forma, referencia, usuario_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          n,
          s.id,
          terceroId,
          texto2(cuotas),
          texto2(mora),
          texto2(total),
          forma,
          referencia,
          actorId,
        ],
      );
      const reciboId = r.rows[0].id;
      for (const l of lineas) {
        await c.query(
          `INSERT INTO san_pagos (participacion_id, turno, cuota, mora, dias_atraso, recibo_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [l.participacionId, l.turno, l.cuota, l.mora, l.dias, reciboId],
        );
      }
      const hoy = est.hoy;
      if (dest.tipo === 'caja') {
        await c.query(
          `INSERT INTO caja_movimientos (sesion_id, tipo, monto, san_recibo_id, usuario_id)
           VALUES ($1, 'san_cuota', $2, $3, $4)`,
          [dest.id, texto2(total), reciboId, actorId],
        );
      } else {
        await c.query(
          `INSERT INTO cuenta_movimientos
             (cuenta_id, tipo, signo, monto, tasa, monto_dop, fecha, por_confirmar, referencia, san_recibo_id, usuario_id)
           VALUES ($1, 'san_cuota', 1, $2, 1, $2, $3, true, $4, $5, $6)`,
          [dest.id, texto2(total), hoy, referencia, reciboId, actorId],
        );
      }
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'san.cobrar',
        entidad: 'san_recibos',
        entidadId: reciboId,
        nuevo: {
          recibo: numeroRecibo(n),
          san: numeroSan(s.numero),
          periodos: lineas.map((l) => `#${l.numero} turno ${l.turno}`),
          cuotas: texto2(cuotas),
          mora: texto2(mora),
          total: texto2(total),
          forma,
          destino: dest.nombre,
        },
        ip,
      });
      return {
        id: reciboId,
        recibo: numeroRecibo(n),
        cuotas: texto2(cuotas),
        mora: texto2(mora),
        total: texto2(total),
      };
    });
  }

  // ---------- Entregar la mano ----------

  // Cuánto recibiría hoy una participación (vista previa y cálculo real).
  private async calcularEntrega(c: Consulta, s: San, participacionId: string) {
    const est = await this.estadoParticipaciones(c, s);
    const p = est.participaciones.find((x) => x.id === participacionId);
    if (!p) throw new NotFoundException('Participación no encontrada');
    if (p.entrega)
      throw new BadRequestException(
        `El número ${p.numero} ya cobró su mano (${p.entrega.numero})`,
      );
    const turno = est.turnos.find((t) => t.turno === p.numero);
    if (!turno) throw new BadRequestException('El turno no existe');
    const bruto = manoDe(s.cuota, s.cantidad_numeros, p.parte);
    const comision = porcentaje(bruto, s.comision_pct);
    // Se descuentan sus cuotas vencidas sin pagar (con su mora), incluida la de este turno.
    const debe = p.periodos.filter((x) => x.estado === 'vencido');
    const descuento = debe.reduce(
      (a, x) => a + centavos(x.cuota) + centavos(x.mora),
      0n,
    );
    const neto = centavos(bruto) - centavos(comision) - descuento;
    return {
      est,
      p,
      turno,
      bruto,
      comision,
      descuento: texto2(descuento),
      neto,
      debe,
    };
  }

  async previaEntrega(id: string, participacionId: string) {
    if (!UUID.test(participacionId))
      throw new NotFoundException('Participación no encontrada');
    const s = await this.san(this.db, id);
    const x = await this.calcularEntrega(this.db, s, participacionId);
    return {
      numero: x.p.numero,
      nombre: x.p.nombre,
      parte: x.p.parte,
      fecha_turno: x.turno.fecha,
      puede: x.turno.fecha <= x.est.hoy,
      bruto: x.bruto,
      comision: x.comision,
      descuento: x.descuento,
      neto: texto2(x.neto > 0n ? x.neto : 0n),
      cuotas_descontadas: x.debe.map((d) => ({
        turno: d.turno,
        fecha: d.fecha,
        cuota: d.cuota,
        mora: d.mora,
      })),
    };
  }

  async entregar(
    actorId: string,
    ip: string | undefined,
    datos: {
      sanId?: unknown;
      participacionId?: unknown;
      forma?: unknown;
      cajaId?: unknown;
      cuentaId?: unknown;
      referencia?: unknown;
    },
  ) {
    const sanId = texto(datos.sanId).toLowerCase();
    const participacionId = texto(datos.participacionId).toLowerCase();
    if (!UUID.test(participacionId))
      throw new BadRequestException('Seleccione a quién se entrega');
    const forma = texto(datos.forma);
    if (forma !== 'efectivo' && forma !== 'transferencia')
      throw new BadRequestException('Forma inválida: efectivo o transferencia');
    const referencia = opcional(datos.referencia, 60, 'Referencia');

    return this.db.transaccion(async (c) => {
      const s = await this.san(c, sanId, true);
      if (s.estado !== 'activo')
        throw new BadRequestException('El SOL CASH no está activo');
      const x = await this.calcularEntrega(c, s, participacionId);
      if (x.turno.fecha > x.est.hoy)
        throw new BadRequestException(
          `La mano del número ${x.p.numero} se entrega a partir del ${x.turno.fecha}`,
        );
      if (x.neto < 0n)
        throw new BadRequestException(
          'Lo que debe esta persona es mayor que su mano: cobre primero sus cuotas',
        );
      const neto = texto2(x.neto);
      const dest = await this.destino(c, forma, datos.cajaId, datos.cuentaId);
      if (x.neto > 0n) {
        const hay =
          dest.tipo === 'caja'
            ? (await c.query<{ esperado: string }>(SQL_ESPERADO, [dest.id]))
                .rows[0].esperado
            : (await c.query<{ disponible: string }>(SQL_DISPONIBLE, [dest.id]))
                .rows[0].disponible;
        if (centavos(hay) < x.neto)
          throw new BadRequestException(
            `No hay suficiente dinero en ${dest.nombre}: hay RD$${hay} y la mano es RD$${neto}`,
          );
      }
      const n = (
        await c.query<{ valor: string }>(
          `UPDATE contadores SET valor = valor + 1 WHERE clave = 'san_entregas' RETURNING valor`,
        )
      ).rows[0].valor;
      const e = await c.query<{ id: string }>(
        `INSERT INTO san_entregas (numero, san_id, turno, participacion_id, bruto, comision, descuento, neto, forma, referencia, usuario_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [
          n,
          s.id,
          x.p.numero,
          participacionId,
          x.bruto,
          x.comision,
          x.descuento,
          neto,
          forma,
          referencia,
          actorId,
        ],
      );
      const entregaId = e.rows[0].id;
      // Sus cuotas vencidas quedan pagadas con la mano.
      for (const d of x.debe) {
        await c.query(
          `INSERT INTO san_pagos (participacion_id, turno, cuota, mora, dias_atraso, entrega_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [participacionId, d.turno, d.cuota, d.mora, d.dias_atraso, entregaId],
        );
      }
      if (x.neto > 0n) {
        if (dest.tipo === 'caja') {
          await c.query(
            `INSERT INTO caja_movimientos (sesion_id, tipo, monto, san_entrega_id, usuario_id)
             VALUES ($1, 'san_mano', $2, $3, $4)`,
            [dest.id, neto, entregaId, actorId],
          );
        } else {
          await c.query(
            `INSERT INTO cuenta_movimientos
               (cuenta_id, tipo, signo, monto, tasa, monto_dop, fecha, referencia, san_entrega_id, usuario_id)
             VALUES ($1, 'san_mano', -1, $2, 1, $2, $3, $4, $5, $6)`,
            [dest.id, neto, x.est.hoy, referencia, entregaId, actorId],
          );
        }
      }
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'san.entregar',
        entidad: 'san_entregas',
        entidadId: entregaId,
        nuevo: {
          entrega: numeroEntrega(n),
          san: numeroSan(s.numero),
          numero: x.p.numero,
          participante: x.p.nombre,
          bruto: x.bruto,
          comision: x.comision,
          descuento: x.descuento,
          neto,
          forma,
          origen: dest.nombre,
        },
        ip,
      });
      return {
        id: entregaId,
        entrega: numeroEntrega(n),
        bruto: x.bruto,
        comision: x.comision,
        descuento: x.descuento,
        neto,
      };
    });
  }

  // ---------- Recibos en PDF ----------

  private formato(v: unknown): Formato {
    const f = texto(v) || '80';
    if (f !== '80' && f !== '58' && f !== 'carta')
      throw new BadRequestException('Formato inválido: use 80, 58 o carta');
    return f;
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

  private async fechaLocal(iso: string) {
    const zona =
      (await this.config(this.db, 'empresa.zona_horaria')) ??
      'America/Santo_Domingo';
    return new Intl.DateTimeFormat('es-DO', {
      timeZone: zona,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));
  }

  private async reciboFilas(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Recibo no encontrado');
    const r = await this.db.query<{
      numero: string;
      created_at: string;
      cuotas: string;
      mora: string;
      total: string;
      forma: string;
      referencia: string | null;
      san_numero: string;
      san_nombre: string;
      participante: string;
      usuario: string;
    }>(
      `SELECT r.numero, r.created_at, r.cuotas, r.mora, r.total, r.forma, r.referencia,
              s.numero AS san_numero, s.nombre AS san_nombre, t.nombre AS participante, u.username AS usuario
       FROM san_recibos r JOIN sanes s ON s.id = r.san_id JOIN terceros t ON t.id = r.tercero_id
       JOIN usuarios u ON u.id = r.usuario_id WHERE r.id = $1`,
      [id],
    );
    if (r.rowCount === 0) throw new NotFoundException('Recibo no encontrado');
    const x = r.rows[0];
    const lineas = await this.db.query<{
      numero: number;
      parte: string;
      turno: number;
      fecha: string;
      cuota: string;
      mora: string;
    }>(
      `SELECT p.numero, p.parte, pg.turno, to_char(t.fecha, 'DD/MM/YYYY') AS fecha, pg.cuota, pg.mora
       FROM san_pagos pg JOIN san_participaciones p ON p.id = pg.participacion_id
       JOIN san_turnos t ON t.san_id = p.san_id AND t.turno = pg.turno
       WHERE pg.recibo_id = $1 ORDER BY p.numero, pg.turno`,
      [id],
    );
    const filas: FilaRecibo[] = [
      { tipo: 'titulo', texto: 'RECIBO DE PAGO - SOL CASH' },
      {
        tipo: 'fila',
        izq: 'Recibo:',
        der: numeroRecibo(x.numero),
        negrita: true,
      },
      { tipo: 'fila', izq: 'Fecha:', der: await this.fechaLocal(x.created_at) },
      {
        tipo: 'fila',
        izq: 'SOL CASH:',
        der: `${numeroSan(x.san_numero)} ${x.san_nombre}`,
      },
      {
        tipo: 'fila',
        izq: 'Participante:',
        der: x.participante,
        negrita: true,
      },
      { tipo: 'linea' },
      ...lineas.rows.flatMap((l): FilaRecibo[] => [
        {
          tipo: 'fila',
          izq: `Nº ${l.numero}${l.parte === 'medio' ? ' (medio)' : ''} · turno ${l.turno} (${l.fecha})`,
          der: dinero(l.cuota),
        },
        ...(l.mora !== '0.00'
          ? [
              {
                tipo: 'fila' as const,
                izq: '   Mora por atraso',
                der: dinero(l.mora),
              },
            ]
          : []),
      ]),
      { tipo: 'linea' },
      { tipo: 'fila', izq: 'Cuotas:', der: dinero(x.cuotas) },
      ...(x.mora !== '0.00'
        ? [{ tipo: 'fila' as const, izq: 'Mora:', der: dinero(x.mora) }]
        : []),
      {
        tipo: 'fila',
        izq: 'TOTAL PAGADO:',
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
      { tipo: 'fila', izq: 'Atendió:', der: x.usuario },
      { tipo: 'linea' },
      { tipo: 'nota', texto: 'Conserve este recibo. ¡Gracias!' },
    ];
    return { filas, codigo: numeroRecibo(x.numero) };
  }

  async reciboPdf(id: string, formato: unknown) {
    const f = this.formato(formato);
    const { filas, codigo } = await this.reciboFilas(id);
    const pdf = await generarReciboSan(
      { empresa: await this.empresa(), filas },
      f,
      'Recibo de SOL CASH',
    );
    return { pdf, nombre: `${codigo}.pdf` };
  }

  // Para imprimir directo (se ajusta al papel de la impresora).
  async reciboTicket(id: string): Promise<Ticket> {
    const { filas, codigo } = await this.reciboFilas(id);
    return {
      documento: codigo,
      encabezado: encabezado(await this.empresa()),
      elementos: filas,
    };
  }

  private async entregaFilas(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Entrega no encontrada');
    const r = await this.db.query<{
      numero: string;
      created_at: string;
      turno: number;
      bruto: string;
      comision: string;
      descuento: string;
      neto: string;
      forma: string;
      referencia: string | null;
      san_numero: string;
      san_nombre: string;
      comision_pct: string;
      participante: string;
      parte: string;
      usuario: string;
    }>(
      `SELECT e.numero, e.created_at, e.turno, e.bruto, e.comision, e.descuento, e.neto, e.forma, e.referencia,
              s.numero AS san_numero, s.nombre AS san_nombre, s.comision_pct, t.nombre AS participante,
              p.parte, u.username AS usuario
       FROM san_entregas e JOIN sanes s ON s.id = e.san_id
       JOIN san_participaciones p ON p.id = e.participacion_id JOIN terceros t ON t.id = p.tercero_id
       JOIN usuarios u ON u.id = e.usuario_id WHERE e.id = $1`,
      [id],
    );
    if (r.rowCount === 0) throw new NotFoundException('Entrega no encontrada');
    const x = r.rows[0];
    const filas: FilaRecibo[] = [
      { tipo: 'titulo', texto: 'ENTREGA DE MANO - SOL CASH' },
      {
        tipo: 'fila',
        izq: 'Entrega:',
        der: numeroEntrega(x.numero),
        negrita: true,
      },
      { tipo: 'fila', izq: 'Fecha:', der: await this.fechaLocal(x.created_at) },
      {
        tipo: 'fila',
        izq: 'SOL CASH:',
        der: `${numeroSan(x.san_numero)} ${x.san_nombre}`,
      },
      {
        tipo: 'fila',
        izq: 'Número:',
        der: `${x.turno}${x.parte === 'medio' ? ' (medio número)' : ''}`,
      },
      { tipo: 'fila', izq: 'Recibe:', der: x.participante, negrita: true },
      { tipo: 'linea' },
      { tipo: 'fila', izq: 'Mano:', der: dinero(x.bruto) },
      {
        tipo: 'fila',
        izq: `Comisión (${x.comision_pct.replace(/\.?0+$/, '')}%):`,
        der: `-${dinero(x.comision)}`,
      },
      ...(x.descuento !== '0.00'
        ? [
            {
              tipo: 'fila' as const,
              izq: 'Cuotas pendientes descontadas:',
              der: `-${dinero(x.descuento)}`,
            },
          ]
        : []),
      {
        tipo: 'fila',
        izq: 'RECIBE:',
        der: dinero(x.neto),
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
      { tipo: 'fila', izq: 'Entregó:', der: x.usuario },
      { tipo: 'firma', texto: 'Recibí conforme' },
    ];
    return { filas, codigo: numeroEntrega(x.numero) };
  }

  async entregaPdf(id: string, formato: unknown) {
    const f = this.formato(formato);
    const { filas, codigo } = await this.entregaFilas(id);
    const pdf = await generarReciboSan(
      { empresa: await this.empresa(), filas },
      f,
      'Entrega de mano',
    );
    return { pdf, nombre: `${codigo}.pdf` };
  }

  async entregaTicket(id: string): Promise<Ticket> {
    const { filas, codigo } = await this.entregaFilas(id);
    return {
      documento: codigo,
      encabezado: encabezado(await this.empresa()),
      elementos: filas,
    };
  }
}
