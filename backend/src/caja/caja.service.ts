import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { registrarAuditoria } from '../auditoria/auditoria';
import { DatabaseService } from '../database/database.service';
import { normalizarMonto } from '../servicios/calculo-itbis';
import type { Formato } from '../ventas/recibo-pdf';
import { generarCuadre, ticketCuadre } from './cuadre-pdf';
import type { DatosCuadre } from './cuadre-pdf';
import {
  numeroSesion,
  SQL_ESPERADO,
  SQL_SIGNO_CAJA,
  SQL_TOTALES_SESION,
} from './sql';

// Caja: cajas fijas, sesiones (abrir → movimientos → cerrar con arqueo).
// Los movimientos no se modifican ni borran; una sesión cerrada no se reabre.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function texto(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
}

function opcional(v: unknown, max: number, que: string): string | null {
  const t = texto(v);
  if (t.length > max)
    throw new BadRequestException(`${que}: máximo ${max} caracteres`);
  return t || null;
}

function fechaValida(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// a >= b con montos en texto (sin decimales flotantes).
async function mayorOIgual(
  c: Pick<DatabaseService, 'query'>,
  a: string,
  b: string,
) {
  const r = await c.query<{ ok: boolean }>(
    'SELECT $1::numeric >= $2::numeric AS ok',
    [a, b],
  );
  return r.rows[0].ok;
}

@Injectable()
export class CajaService {
  constructor(private readonly db: DatabaseService) {}

  private async config(clave: string) {
    const r = await this.db.query<{ valor: string }>(
      'SELECT valor FROM configuracion WHERE clave = $1',
      [clave],
    );
    if (r.rowCount === 0) throw new Error(`Falta la configuración ${clave}`);
    return r.rows[0].valor;
  }

  // ---------- Cajas ----------

  async cajas() {
    const r = await this.db.query(
      `SELECT c.id, c.codigo, c.nombre, c.is_active, s.nombre AS sucursal,
              ses.id AS sesion_id, ses.numero AS sesion_numero, ses.abierta_en,
              ses.fondo_inicial, u.username AS abierta_por,
              CASE WHEN ses.id IS NOT NULL THEN (
                ses.fondo_inicial + COALESCE((SELECT sum(m.monto * ${SQL_SIGNO_CAJA})
                  FROM caja_movimientos m WHERE m.sesion_id = ses.id), 0)
              )::numeric(14,2) END AS esperado
       FROM cajas c
       JOIN sucursales s ON s.id = c.sucursal_id
       LEFT JOIN caja_sesiones ses ON ses.caja_id = c.id AND ses.estado = 'abierta'
       LEFT JOIN usuarios u ON u.id = ses.abierta_por
       ORDER BY s.es_principal DESC, lower(c.nombre)`,
    );
    return r.rows.map((f: { sesion_numero: string | null }) => ({
      ...f,
      sesion_texto: f.sesion_numero ? numeroSesion(f.sesion_numero) : null,
    }));
  }

  async preparar() {
    const [cats, denom, cuentas] = await Promise.all([
      this.db.query(
        `SELECT id, codigo, nombre FROM categorias_gasto
         WHERE is_active ORDER BY orden, nombre`,
      ),
      this.config('caja.denominaciones'),
      // Para depositar o traer efectivo (solo nombre y moneda, sin saldos).
      this.db.query(
        `SELECT ct.id, ct.nombre, ct.moneda, mo.simbolo
         FROM cuentas ct JOIN monedas mo ON mo.codigo = ct.moneda
         WHERE ct.is_active ORDER BY ct.tipo, lower(ct.nombre)`,
      ),
    ]);
    return {
      categoriasGasto: cats.rows,
      denominaciones: denom.split(',').map((d) => d.trim()),
      cuentas: cuentas.rows,
    };
  }

  async crearCaja(
    actorId: string,
    ip: string | undefined,
    datos: { codigo?: unknown; nombre?: unknown; sucursalId?: unknown },
  ) {
    const codigo = texto(datos.codigo).toUpperCase();
    if (!/^[A-Z0-9_-]{2,20}$/.test(codigo)) {
      throw new BadRequestException(
        'Código inválido: 2 a 20 letras, números o guiones (ej: CAJA-2)',
      );
    }
    const nombre = texto(datos.nombre);
    if (!nombre || nombre.length > 60)
      throw new BadRequestException('El nombre es obligatorio (máximo 60)');
    const sucursalId = texto(datos.sucursalId).toLowerCase();
    try {
      return await this.db.transaccion(async (c) => {
        // Sin sucursal indicada, la caja va a la principal.
        const suc = UUID.test(sucursalId)
          ? await c.query<{ id: string }>(
              'SELECT id FROM sucursales WHERE id = $1 AND is_active',
              [sucursalId],
            )
          : await c.query<{ id: string }>(
              'SELECT id FROM sucursales WHERE es_principal',
            );
        if (suc.rowCount === 0)
          throw new BadRequestException(
            'La sucursal no existe o está inactiva',
          );
        const r = await c.query<{ id: string }>(
          `INSERT INTO cajas (sucursal_id, codigo, nombre, created_by)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [suc.rows[0].id, codigo, nombre, actorId],
        );
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'caja.crear',
          entidad: 'cajas',
          entidadId: r.rows[0].id,
          nuevo: { codigo, nombre },
          ip,
        });
        return { id: r.rows[0].id };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException(
          'Ya existe una caja con ese código o nombre',
        );
      }
      throw e;
    }
  }

  async editarCaja(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: { nombre?: unknown },
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Caja no encontrada');
    const nombre = texto(datos.nombre);
    if (!nombre || nombre.length > 60)
      throw new BadRequestException('El nombre es obligatorio (máximo 60)');
    try {
      return await this.db.transaccion(async (c) => {
        const r = await c.query<{ nombre: string }>(
          'SELECT nombre FROM cajas WHERE id = $1 FOR UPDATE',
          [id],
        );
        if (r.rowCount === 0) throw new NotFoundException('Caja no encontrada');
        if (r.rows[0].nombre === nombre) return { ok: true };
        await c.query(
          'UPDATE cajas SET nombre = $2, updated_at = now() WHERE id = $1',
          [id, nombre],
        );
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'caja.editar',
          entidad: 'cajas',
          entidadId: id,
          anterior: { nombre: r.rows[0].nombre },
          nuevo: { nombre },
          ip,
        });
        return { ok: true };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw new ConflictException('Ya existe una caja con ese nombre');
      throw e;
    }
  }

  async estadoCaja(
    actorId: string,
    id: string,
    activo: unknown,
    motivo: unknown,
    ip: string | undefined,
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Caja no encontrada');
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
        'SELECT nombre, is_active FROM cajas WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (r.rowCount === 0) throw new NotFoundException('Caja no encontrada');
      const antes = r.rows[0];
      if (antes.is_active === activo) return { ok: true };
      if (!activo) {
        const abierta = await c.query(
          `SELECT 1 FROM caja_sesiones WHERE caja_id = $1 AND estado = 'abierta'`,
          [id],
        );
        if ((abierta.rowCount ?? 0) > 0) {
          throw new BadRequestException(
            'No se puede desactivar: la caja está abierta. Ciérrela primero.',
          );
        }
      }
      await c.query(
        'UPDATE cajas SET is_active = $2, updated_at = now() WHERE id = $1',
        [id, activo],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: activo ? 'caja.activar' : 'caja.desactivar',
        entidad: 'cajas',
        entidadId: id,
        anterior: { nombre: antes.nombre, is_active: antes.is_active },
        nuevo: { nombre: antes.nombre, is_active: activo },
        motivo: textoMotivo || undefined,
        ip,
      });
      return { ok: true };
    });
  }

  // ---------- Sesiones ----------

  async abrir(
    actorId: string,
    cajaId: string,
    ip: string | undefined,
    datos: { fondoInicial?: unknown; notas?: unknown },
  ) {
    if (!UUID.test(cajaId)) throw new NotFoundException('Caja no encontrada');
    const fondo = normalizarMonto(datos.fondoInicial);
    if (fondo === null) {
      throw new BadRequestException(
        'Fondo inicial inválido: un monto de 0 en adelante (el cambio con que empieza la caja)',
      );
    }
    const notas = opcional(datos.notas, 500, 'Notas');
    try {
      return await this.db.transaccion(async (c) => {
        const caja = await c.query<{ nombre: string; is_active: boolean }>(
          'SELECT nombre, is_active FROM cajas WHERE id = $1 FOR UPDATE',
          [cajaId],
        );
        if (caja.rowCount === 0)
          throw new NotFoundException('Caja no encontrada');
        if (!caja.rows[0].is_active)
          throw new BadRequestException('La caja está desactivada');
        const abierta = await c.query<{ usuario: string; abierta_en: string }>(
          `SELECT u.username AS usuario, s.abierta_en FROM caja_sesiones s
           JOIN usuarios u ON u.id = s.abierta_por
           WHERE s.caja_id = $1 AND s.estado = 'abierta'`,
          [cajaId],
        );
        if ((abierta.rowCount ?? 0) > 0) {
          throw new ConflictException(
            `${caja.rows[0].nombre} ya está abierta (la abrió ${abierta.rows[0].usuario})`,
          );
        }
        const n = await c.query<{ valor: string }>(
          `UPDATE contadores SET valor = valor + 1 WHERE clave = 'caja_sesiones' RETURNING valor`,
        );
        const r = await c.query<{ id: string }>(
          `INSERT INTO caja_sesiones (numero, caja_id, fondo_inicial, abierta_por, notas)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [n.rows[0].valor, cajaId, fondo, actorId, notas],
        );
        const id = r.rows[0].id;
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'caja.abrir',
          entidad: 'caja_sesiones',
          entidadId: id,
          nuevo: {
            caja: caja.rows[0].nombre,
            sesion: numeroSesion(n.rows[0].valor),
            fondo_inicial: fondo,
          },
          ip,
        });
        return { id, sesion: numeroSesion(n.rows[0].valor) };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw new ConflictException('La caja ya está abierta');
      throw e;
    }
  }

  // Bloquea la sesión abierta (FOR UPDATE: espera a ventas en curso).
  private async sesionAbierta(c: PoolClient, sesionId: string) {
    if (!UUID.test(sesionId))
      throw new NotFoundException('Sesión de caja no encontrada');
    const r = await c.query<{
      numero: string;
      estado: string;
      caja: string;
      fondo_inicial: string;
    }>(
      `SELECT s.numero, s.estado, c.nombre AS caja, s.fondo_inicial
       FROM caja_sesiones s JOIN cajas c ON c.id = s.caja_id
       WHERE s.id = $1 FOR UPDATE OF s`,
      [sesionId],
    );
    if (r.rowCount === 0)
      throw new NotFoundException('Sesión de caja no encontrada');
    if (r.rows[0].estado !== 'abierta')
      throw new BadRequestException('La sesión de caja ya está cerrada');
    return r.rows[0];
  }

  async movimiento(
    actorId: string,
    sesionId: string,
    ip: string | undefined,
    datos: {
      tipo?: unknown;
      monto?: unknown;
      categoriaGastoId?: unknown;
      comprobante?: unknown;
      motivo?: unknown;
    },
  ) {
    const tipo = texto(datos.tipo);
    if (!['gasto', 'retiro', 'ingreso'].includes(tipo)) {
      throw new BadRequestException('Tipo inválido: gasto, retiro o ingreso');
    }
    const monto = normalizarMonto(datos.monto);
    if (monto === null || monto === '0.00') {
      throw new BadRequestException(
        'Monto inválido: mayor que 0, con hasta 2 decimales',
      );
    }
    const motivo = texto(datos.motivo);
    if (motivo.length < 5 || motivo.length > 500) {
      throw new BadRequestException(
        'Escriba el motivo (entre 5 y 500 caracteres)',
      );
    }
    const comprobante =
      opcional(datos.comprobante, 30, 'Comprobante')?.toUpperCase() ?? null;
    let categoria: string | null = null;
    if (tipo === 'gasto') {
      categoria = texto(datos.categoriaGastoId).toLowerCase();
      if (!UUID.test(categoria))
        throw new BadRequestException('Seleccione la categoría del gasto');
    }

    return this.db.transaccion(async (c) => {
      const s = await this.sesionAbierta(c, sesionId);
      let categoriaNombre: string | null = null;
      if (categoria) {
        const cat = await c.query<{ nombre: string }>(
          'SELECT nombre FROM categorias_gasto WHERE id = $1 AND is_active',
          [categoria],
        );
        if (cat.rowCount === 0)
          throw new BadRequestException('La categoría de gasto no existe');
        categoriaNombre = cat.rows[0].nombre;
      }
      if (tipo !== 'ingreso') {
        // No puede salir más efectivo del que hay.
        const e = await c.query<{ esperado: string }>(SQL_ESPERADO, [sesionId]);
        if (!(await mayorOIgual(c, e.rows[0].esperado, monto))) {
          throw new BadRequestException(
            `No hay suficiente efectivo en ${s.caja}: hay RD$${e.rows[0].esperado}`,
          );
        }
      }
      await c.query(
        `INSERT INTO caja_movimientos
           (sesion_id, tipo, monto, categoria_gasto_id, comprobante, motivo, usuario_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sesionId, tipo, monto, categoria, comprobante, motivo, actorId],
      );
      const e = await c.query<{ esperado: string }>(SQL_ESPERADO, [sesionId]);
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: `caja.${tipo}`,
        entidad: 'caja_sesiones',
        entidadId: sesionId,
        nuevo: {
          caja: s.caja,
          sesion: numeroSesion(s.numero),
          tipo,
          monto,
          categoria: categoriaNombre,
          comprobante,
        },
        motivo,
        ip,
      });
      return { esperado: e.rows[0].esperado };
    });
  }

  async cerrar(
    actorId: string,
    sesionId: string,
    ip: string | undefined,
    datos: { conteo?: unknown; motivo?: unknown; notas?: unknown },
  ) {
    const denominaciones = (await this.config('caja.denominaciones'))
      .split(',')
      .map((d) => d.trim());
    const conteo = datos.conteo;
    if (
      typeof conteo !== 'object' ||
      conteo === null ||
      Array.isArray(conteo)
    ) {
      throw new BadRequestException('Envíe el conteo de billetes y monedas');
    }
    const limpio: Record<string, number> = {};
    for (const [denom, cant] of Object.entries(
      conteo as Record<string, unknown>,
    )) {
      if (!denominaciones.includes(denom)) {
        throw new BadRequestException(
          `Billete o moneda desconocido: RD$${denom}`,
        );
      }
      const t = texto(cant) || '0';
      if (!/^\d{1,6}$/.test(t)) {
        throw new BadRequestException(
          `Cantidad inválida de RD$${denom}: un número entero`,
        );
      }
      if (Number(t) > 0) limpio[denom] = Number(t);
    }
    const motivo = texto(datos.motivo);
    const notas = opcional(datos.notas, 500, 'Notas');

    return this.db.transaccion(async (c) => {
      const s = await this.sesionAbierta(c, sesionId);
      // Contado = suma de cantidad × denominación (en SQL, sin flotantes).
      const contado = await c.query<{ contado: string }>(
        `SELECT COALESCE(sum(key::numeric * value::int), 0)::numeric(14,2) AS contado
         FROM jsonb_each_text($1::jsonb)`,
        [JSON.stringify(limpio)],
      );
      const esperado = (
        await c.query<{ esperado: string }>(SQL_ESPERADO, [sesionId])
      ).rows[0].esperado;
      const dif = await c.query<{ diferencia: string }>(
        'SELECT ($1::numeric - $2::numeric)::numeric(14,2) AS diferencia',
        [contado.rows[0].contado, esperado],
      );
      const diferencia = dif.rows[0].diferencia;
      if (diferencia !== '0.00' && (motivo.length < 5 || motivo.length > 500)) {
        throw new BadRequestException(
          `${diferencia.startsWith('-') ? 'Falta' : 'Sobra'} dinero (RD$${diferencia.replace('-', '')}). Escriba el motivo de la diferencia (mínimo 5 caracteres).`,
        );
      }
      await c.query(
        `UPDATE caja_sesiones
         SET estado = 'cerrada', cerrada_por = $2, cerrada_en = now(),
             esperado = $3, contado = $4, diferencia = $5, conteo = $6::jsonb,
             motivo_diferencia = $7, notas = COALESCE($8, notas)
         WHERE id = $1`,
        [
          sesionId,
          actorId,
          esperado,
          contado.rows[0].contado,
          diferencia,
          JSON.stringify(limpio),
          diferencia === '0.00' ? null : motivo,
          notas,
        ],
      );
      const totales = (await c.query(SQL_TOTALES_SESION, [sesionId])).rows[0];
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'caja.cerrar',
        entidad: 'caja_sesiones',
        entidadId: sesionId,
        nuevo: {
          caja: s.caja,
          sesion: numeroSesion(s.numero),
          fondo_inicial: s.fondo_inicial,
          ...totales,
          esperado,
          contado: contado.rows[0].contado,
          diferencia,
        },
        motivo: diferencia === '0.00' ? undefined : motivo,
        ip,
      });
      return { esperado, contado: contado.rows[0].contado, diferencia };
    });
  }

  // ---------- Consultas ----------

  async detalleSesion(id: string) {
    if (!UUID.test(id))
      throw new NotFoundException('Sesión de caja no encontrada');
    const s = await this.db.query(
      `SELECT s.*, c.nombre AS caja, c.codigo AS caja_codigo, suc.nombre AS sucursal,
              ua.username AS abierta_por_usuario, uc.username AS cerrada_por_usuario
       FROM caja_sesiones s
       JOIN cajas c ON c.id = s.caja_id
       JOIN sucursales suc ON suc.id = c.sucursal_id
       JOIN usuarios ua ON ua.id = s.abierta_por
       LEFT JOIN usuarios uc ON uc.id = s.cerrada_por
       WHERE s.id = $1`,
      [id],
    );
    if (s.rowCount === 0)
      throw new NotFoundException('Sesión de caja no encontrada');
    const [movs, totales, esperado] = await Promise.all([
      this.db.query(
        `SELECT m.id, m.tipo, m.monto, m.created_at AS fecha, m.comprobante, m.motivo,
                cg.nombre AS categoria, u.username AS usuario,
                CASE WHEN v.numero IS NOT NULL
                     THEN 'V-' || lpad(v.numero::text, 6, '0') END AS venta,
                m.venta_id,
                -- Cuenta del depósito (destino) o de donde vino el efectivo (origen).
                COALESCE(cd.nombre, co.nombre) AS cuenta
         FROM caja_movimientos m
         JOIN usuarios u ON u.id = m.usuario_id
         LEFT JOIN categorias_gasto cg ON cg.id = m.categoria_gasto_id
         LEFT JOIN ventas v ON v.id = m.venta_id
         LEFT JOIN transferencias t ON t.id = m.transferencia_id
         LEFT JOIN cuentas cd ON cd.id = t.destino_cuenta_id
         LEFT JOIN cuentas co ON co.id = t.origen_cuenta_id
         WHERE m.sesion_id = $1
         ORDER BY m.created_at, m.id`,
        [id],
      ),
      this.db.query(SQL_TOTALES_SESION, [id]),
      this.db.query<{ esperado: string }>(SQL_ESPERADO, [id]),
    ]);
    const sesion = s.rows[0] as Record<string, unknown>;
    return {
      ...sesion,
      sesion_texto: numeroSesion(sesion.numero as string),
      // Mientras está abierta, "esperado" se calcula al momento.
      esperado: sesion.esperado ?? esperado.rows[0].esperado,
      totales: totales.rows[0],
      movimientos: movs.rows,
    };
  }

  async sesiones(filtros: {
    cajaId?: string;
    desde?: string;
    hasta?: string;
    estado?: string;
    pagina?: string;
  }) {
    const params: unknown[] = [];
    const cond: string[] = [];
    const caja = texto(filtros.cajaId);
    if (caja) {
      if (!UUID.test(caja)) throw new BadRequestException('Caja inválida');
      params.push(caja);
      cond.push(`s.caja_id = $${params.length}`);
    }
    let zonaParam = 0;
    for (const [clave, op] of [
      ['desde', '>='],
      ['hasta', '<='],
    ] as const) {
      const f = texto(filtros[clave]);
      if (!f) continue;
      if (!fechaValida(f))
        throw new BadRequestException('Fecha inválida (use AAAA-MM-DD)');
      if (!zonaParam) {
        params.push(await this.config('empresa.zona_horaria'));
        zonaParam = params.length;
      }
      params.push(f);
      cond.push(
        `(s.abierta_en AT TIME ZONE $${zonaParam})::date ${op} $${params.length}::date`,
      );
    }
    const estado = texto(filtros.estado) || 'todas';
    if (estado === 'abiertas') cond.push(`s.estado = 'abierta'`);
    else if (estado === 'cerradas') cond.push(`s.estado = 'cerrada'`);
    else if (estado !== 'todas')
      throw new BadRequestException('Estado inválido');
    const pagina = Math.max(
      1,
      Number.parseInt(texto(filtros.pagina) || '1', 10) || 1,
    );
    const n = params.length;
    const r = await this.db.query(
      `SELECT s.id, s.numero, s.estado, s.abierta_en, s.cerrada_en, s.fondo_inicial,
              s.esperado, s.contado, s.diferencia, s.motivo_diferencia,
              c.nombre AS caja, ua.username AS abierta_por, uc.username AS cerrada_por,
              count(*) OVER ()::int AS total_filas
       FROM caja_sesiones s
       JOIN cajas c ON c.id = s.caja_id
       JOIN usuarios ua ON ua.id = s.abierta_por
       LEFT JOIN usuarios uc ON uc.id = s.cerrada_por
       ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
       ORDER BY s.numero DESC
       LIMIT 50 OFFSET $${n + 1}`,
      [...params, (pagina - 1) * 50],
    );
    return {
      filas: r.rows.map(
        ({ total_filas: _t, ...f }: Record<string, unknown>) => ({
          ...f,
          sesion_texto: numeroSesion(f.numero as string),
        }),
      ),
      total:
        (r.rows[0] as { total_filas?: number } | undefined)?.total_filas ?? 0,
      pagina,
      porPagina: 50,
    };
  }

  // Cuadre (o estado, si sigue abierta) en PDF.
  private async datosCuadre(id: string): Promise<DatosCuadre> {
    const sesion = (await this.detalleSesion(
      id,
    )) as unknown as DatosCuadre['sesion'];
    const e = await this.db.query<DatosCuadre['empresa']>(
      'SELECT nombre_comercial, rnc FROM empresa WHERE id = 1',
    );
    return {
      empresa: e.rows[0],
      sesion,
      denominaciones: (await this.config('caja.denominaciones')).split(','),
      zonaHoraria: await this.config('empresa.zona_horaria'),
    };
  }

  async cuadre(id: string, formato: unknown) {
    const f = texto(formato) || '80';
    if (f !== '80' && f !== '58' && f !== 'carta') {
      throw new BadRequestException('Formato inválido: use 80, 58 o carta');
    }
    const d = await this.datosCuadre(id);
    const pdf = await generarCuadre(d, f as Formato);
    return { pdf, nombre: `${d.sesion.sesion_texto}.pdf` };
  }

  // Para imprimir directo (se ajusta al papel de la impresora).
  async cuadreTicket(id: string) {
    return ticketCuadre(await this.datosCuadre(id));
  }
}
