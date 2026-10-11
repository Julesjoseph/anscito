import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { registrarAuditoria } from '../auditoria/auditoria';
import { DatabaseService } from '../database/database.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODIGO = /^[a-z0-9_]{2,30}$/;
const TASA = /^\d{1,3}(\.\d{1,2})?$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function texto(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
}

function validarTasa(v: unknown): string {
  const t = texto(v);
  if (!TASA.test(t) || Number(t) > 100) {
    throw new BadRequestException(
      'Tasa inválida: un porcentaje entre 0 y 100 con hasta 2 decimales',
    );
  }
  return t;
}

function validarFecha(v: unknown): string {
  const f = texto(v);
  const d = new Date(`${f}T00:00:00Z`);
  if (
    !FECHA.test(f) ||
    isNaN(d.getTime()) ||
    d.toISOString().slice(0, 10) !== f
  ) {
    throw new BadRequestException('Fecha inválida (use AAAA-MM-DD)');
  }
  return f;
}

@Injectable()
export class ImpuestosService {
  constructor(private readonly db: DatabaseService) {}

  async listar() {
    const r = await this.db.query(
      `SELECT i.id, i.codigo, i.nombre, i.is_active,
              (SELECT t.tasa FROM impuesto_tasas t
                WHERE t.impuesto_id = i.id
                  AND t.vigente_desde <= current_date
                  AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= current_date)
                ORDER BY t.vigente_desde DESC LIMIT 1) AS tasa_vigente,
              COALESCE(
                (SELECT json_agg(json_build_object(
                          'tasa', t.tasa::text,
                          'vigente_desde', to_char(t.vigente_desde, 'YYYY-MM-DD'),
                          'vigente_hasta', to_char(t.vigente_hasta, 'YYYY-MM-DD'))
                        ORDER BY t.vigente_desde DESC)
                 FROM impuesto_tasas t WHERE t.impuesto_id = i.id),
                '[]'::json) AS tasas,
              (SELECT count(*)::int FROM servicios s
                WHERE s.impuesto_id = i.id AND s.is_active = true) AS servicios_activos
       FROM impuestos i
       ORDER BY i.nombre`,
    );
    return r.rows;
  }

  async crear(
    actorId: string,
    ip: string | undefined,
    datos: {
      codigo?: unknown;
      nombre?: unknown;
      tasa?: unknown;
      vigenteDesde?: unknown;
    },
  ) {
    const codigo = texto(datos.codigo).toLowerCase();
    const nombre = texto(datos.nombre);
    if (!CODIGO.test(codigo)) {
      throw new BadRequestException(
        'Código inválido: 2 a 30 letras minúsculas, números o guion bajo (ej: itbis_reducido)',
      );
    }
    if (!nombre || nombre.length > 100) {
      throw new BadRequestException('El nombre es obligatorio');
    }
    const tasa = validarTasa(datos.tasa);
    const desde = validarFecha(datos.vigenteDesde);

    try {
      return await this.db.transaccion(async (c) => {
        const r = await c.query<{ id: string }>(
          'INSERT INTO impuestos (codigo, nombre) VALUES ($1, $2) RETURNING id',
          [codigo, nombre],
        );
        const id = r.rows[0].id;
        await c.query(
          `INSERT INTO impuesto_tasas (impuesto_id, tasa, vigente_desde, created_by)
           VALUES ($1, $2, $3, $4)`,
          [id, tasa, desde, actorId],
        );
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'impuesto.crear',
          entidad: 'impuestos',
          entidadId: id,
          nuevo: { codigo, nombre, tasa, vigente_desde: desde },
          ip,
        });
        return { id };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException('Ese código de impuesto ya existe');
      }
      throw e;
    }
  }

  // Una tasa nueva no reemplaza a la anterior: la cierra el día antes y
  // queda guardada para el historial.
  async nuevaTasa(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: { tasa?: unknown; vigenteDesde?: unknown; motivo?: unknown },
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Impuesto no encontrado');
    const tasa = validarTasa(datos.tasa);
    const desde = validarFecha(datos.vigenteDesde);
    const motivo = texto(datos.motivo);
    if (motivo.length < 5) {
      throw new BadRequestException(
        'Escriba el motivo del cambio de tasa (mínimo 5 caracteres)',
      );
    }

    return this.db.transaccion(async (c) => {
      const imp = await c.query<{ nombre: string }>(
        'SELECT nombre FROM impuestos WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (imp.rowCount === 0)
        throw new NotFoundException('Impuesto no encontrado');

      const hoy = await c.query<{ ok: boolean }>(
        'SELECT $1::date >= current_date AS ok',
        [desde],
      );
      if (!hoy.rows[0].ok) {
        throw new BadRequestException(
          'La fecha de vigencia no puede ser anterior a hoy',
        );
      }

      const ult = await c.query<{
        id: string;
        tasa: string;
        vigente_desde: string;
      }>(
        `SELECT id, tasa, to_char(vigente_desde, 'YYYY-MM-DD') AS vigente_desde
         FROM impuesto_tasas WHERE impuesto_id = $1
         ORDER BY vigente_desde DESC LIMIT 1`,
        [id],
      );
      const anterior = ult.rows[0];
      if (anterior && desde <= anterior.vigente_desde) {
        throw new BadRequestException(
          `La nueva tasa debe empezar después del ${anterior.vigente_desde}`,
        );
      }

      if (anterior) {
        await c.query(
          `UPDATE impuesto_tasas SET vigente_hasta = $2::date - 1
           WHERE id = $1`,
          [anterior.id, desde],
        );
      }
      await c.query(
        `INSERT INTO impuesto_tasas (impuesto_id, tasa, vigente_desde, created_by)
         VALUES ($1, $2, $3, $4)`,
        [id, tasa, desde, actorId],
      );

      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'impuesto.cambiar_tasa',
        entidad: 'impuestos',
        entidadId: id,
        anterior: anterior
          ? {
              impuesto: imp.rows[0].nombre,
              tasa: anterior.tasa,
              vigente_desde: anterior.vigente_desde,
            }
          : undefined,
        nuevo: { impuesto: imp.rows[0].nombre, tasa, vigente_desde: desde },
        motivo,
        ip,
      });
      return { ok: true };
    });
  }

  async cambiarEstado(
    actorId: string,
    id: string,
    activo: unknown,
    motivo: unknown,
    ip: string | undefined,
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Impuesto no encontrado');
    if (typeof activo !== 'boolean')
      throw new BadRequestException('Estado inválido');
    const textoMotivo = texto(motivo);
    if (!activo && textoMotivo.length < 5) {
      throw new BadRequestException(
        'Escriba el motivo de la desactivación (mínimo 5 caracteres)',
      );
    }

    return this.db.transaccion(async (c) => {
      const r = await c.query<{ nombre: string; is_active: boolean }>(
        'SELECT nombre, is_active FROM impuestos WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (r.rowCount === 0)
        throw new NotFoundException('Impuesto no encontrado');
      const antes = r.rows[0];
      if (antes.is_active === activo) return { ok: true };

      if (!activo) {
        const uso = await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM servicios
           WHERE impuesto_id = $1 AND is_active = true`,
          [id],
        );
        if (uso.rows[0].n > 0) {
          throw new BadRequestException(
            `No se puede desactivar: ${uso.rows[0].n} servicio(s) activo(s) lo usan`,
          );
        }
      }

      await c.query(
        'UPDATE impuestos SET is_active = $2, updated_at = now() WHERE id = $1',
        [id, activo],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: activo ? 'impuesto.activar' : 'impuesto.desactivar',
        entidad: 'impuestos',
        entidadId: id,
        anterior: { nombre: antes.nombre, is_active: antes.is_active },
        nuevo: { nombre: antes.nombre, is_active: activo },
        motivo: textoMotivo || undefined,
        ip,
      });
      return { ok: true };
    });
  }
}
