import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { registrarAuditoria } from '../auditoria/auditoria';
import { hoyLocal } from '../cxc/estado';
import { DatabaseService } from '../database/database.service';
import { centavos, texto2 } from '../sanes/calendario';
import { normalizarMonto } from '../servicios/calculo-itbis';
import { numeroAsiento, registrarAsiento } from './asientos';
import type { LineaAsiento } from './asientos';

// Contabilidad: catálogo de cuentas, fecha de inicio, asientos manuales y de
// apertura, anulación con asiento de reverso, meses (cerrar y reabrir) y la
// balanza de comprobación. Los libros y estados suman TODOS los asientos
// (un anulado y su reverso se cancelan: original + reverso = 0).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIPOS = ['activo', 'pasivo', 'capital', 'ingreso', 'costo', 'gasto'];

function texto(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
}

function fechaValida(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function motivoValido(v: unknown, max = 500): string {
  const t = texto(v);
  if (t.length < 5 || t.length > max)
    throw new BadRequestException(`Escriba el motivo (5 a ${max} caracteres)`);
  return t;
}

// Los errores de las reglas de la base de datos (RAISE EXCEPTION) llegan con
// el código P0001 y un mensaje en español: se muestran tal cual.
function errorDeRegla(e: unknown): never {
  const x = e as { code?: string; message?: string };
  if (x?.code === 'P0001') throw new BadRequestException(x.message);
  if (x?.code === '23505')
    throw new ConflictException('Ya existe una cuenta con ese código');
  throw e;
}

// Saldo de cada cuenta de detalle (débitos − créditos de TODOS los asientos).
const SQL_SALDOS = `SELECT l.cuenta_id, sum(l.debito)::numeric(16,2) AS debitos, sum(l.credito)::numeric(16,2) AS creditos
  FROM asiento_lineas l JOIN asientos a ON a.id = l.asiento_id`;

@Injectable()
export class ContabilidadService {
  constructor(private readonly db: DatabaseService) {}

  private async fechaInicio(c: Pick<DatabaseService, 'query'>) {
    const r = await c.query<{ valor: string }>(
      `SELECT valor FROM configuracion WHERE clave = 'contabilidad.fecha_inicio'`,
    );
    return r.rows[0]?.valor || null;
  }

  async preparar() {
    const [inicio, hay, hoy, unidades] = await Promise.all([
      this.fechaInicio(this.db),
      this.db.query<{ n: number; apertura: boolean }>(
        `SELECT count(*)::int AS n,
                EXISTS (SELECT 1 FROM asientos WHERE origen = 'apertura' AND estado = 'activo') AS apertura
         FROM asientos`,
      ),
      hoyLocal(this.db),
      this.db.query(
        'SELECT id, nombre FROM unidades_negocio WHERE is_active ORDER BY lower(nombre)',
      ),
    ]);
    return {
      fechaInicio: inicio,
      hayAsientos: hay.rows[0].n > 0,
      hayApertura: hay.rows[0].apertura,
      hoy,
      unidadesNegocio: unidades.rows,
    };
  }

  // ---------- Fecha de inicio ----------

  async fijarFechaInicio(
    actorId: string,
    ip: string | undefined,
    datos: { fecha?: unknown },
  ) {
    const fecha = texto(datos.fecha);
    if (!fechaValida(fecha))
      throw new BadRequestException('Fecha inválida (AAAA-MM-DD)');
    return this.db.transaccion(async (c) => {
      await c.query(
        `SELECT 1 FROM configuracion WHERE clave = 'contabilidad.fecha_inicio' FOR UPDATE`,
      );
      const hay = await c.query('SELECT 1 FROM asientos LIMIT 1');
      if ((hay.rowCount ?? 0) > 0)
        throw new BadRequestException(
          'Ya hay asientos: la fecha de inicio no se puede cambiar',
        );
      const antes = await this.fechaInicio(c);
      await c.query(
        `UPDATE configuracion SET valor = $1, updated_by = $2, updated_at = now()
         WHERE clave = 'contabilidad.fecha_inicio'`,
        [fecha, actorId],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'contabilidad.fecha_inicio',
        entidad: 'configuracion',
        anterior: { fecha_inicio: antes },
        nuevo: { fecha_inicio: fecha },
        ip,
      });
      return { fechaInicio: fecha };
    });
  }

  // ---------- Catálogo ----------

  async catalogo() {
    const r = await this.db.query(
      `SELECT c.id, c.codigo, c.nombre, c.tipo, c.naturaleza, c.padre_id, c.nivel,
              c.acepta_movimientos, c.validada, c.notas, c.is_active,
              COALESCE(s.debitos, 0)::numeric(16,2) AS debitos,
              COALESCE(s.creditos, 0)::numeric(16,2) AS creditos,
              (s.cuenta_id IS NOT NULL) AS tiene_movimientos
       FROM cuentas_contables c
       LEFT JOIN (${SQL_SALDOS} GROUP BY l.cuenta_id) s ON s.cuenta_id = c.id
       ORDER BY c.codigo`,
    );
    return r.rows.map(
      (x: { debitos: string; creditos: string; naturaleza: string }) => {
        const d = centavos(x.debitos) - centavos(x.creditos);
        return { ...x, saldo: texto2(x.naturaleza === 'deudora' ? d : -d) };
      },
    );
  }

  private async cuenta(
    c: Pick<DatabaseService, 'query'>,
    id: string,
    bloquear = false,
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Cuenta no encontrada');
    const r = await c.query<{
      id: string;
      codigo: string;
      nombre: string;
      tipo: string;
      naturaleza: string;
      padre_id: string | null;
      nivel: number;
      acepta_movimientos: boolean;
      validada: boolean;
      notas: string | null;
      is_active: boolean;
    }>(
      `SELECT id, codigo, nombre, tipo, naturaleza, padre_id, nivel, acepta_movimientos, validada, notas, is_active
       FROM cuentas_contables WHERE id = $1 ${bloquear ? 'FOR UPDATE' : ''}`,
      [id],
    );
    if (r.rowCount === 0) throw new NotFoundException('Cuenta no encontrada');
    return r.rows[0];
  }

  private async saldoCuenta(c: Pick<DatabaseService, 'query'>, id: string) {
    const r = await c.query<{
      debitos: string | null;
      creditos: string | null;
    }>(
      `SELECT sum(debito)::numeric(16,2) AS debitos, sum(credito)::numeric(16,2) AS creditos
       FROM asiento_lineas WHERE cuenta_id = $1`,
      [id],
    );
    return (
      centavos(r.rows[0]?.debitos ?? '0') - centavos(r.rows[0]?.creditos ?? '0')
    );
  }

  async crearCuenta(
    actorId: string,
    ip: string | undefined,
    datos: {
      codigo?: unknown;
      nombre?: unknown;
      padreId?: unknown;
      tipo?: unknown;
      naturaleza?: unknown;
      aceptaMovimientos?: unknown;
      notas?: unknown;
    },
  ) {
    const codigo = texto(datos.codigo);
    if (!/^[1-9]\d{0,19}$/.test(codigo))
      throw new BadRequestException(
        'Código: solo números, sin empezar con 0 (ej.: 610215)',
      );
    const nombre = texto(datos.nombre);
    if (nombre.length < 2 || nombre.length > 150)
      throw new BadRequestException('Nombre: de 2 a 150 caracteres');
    const padreId = texto(datos.padreId).toLowerCase();
    const notas = texto(datos.notas).slice(0, 500) || null;
    try {
      return await this.db.transaccion(async (c) => {
        let tipo = texto(datos.tipo);
        let naturaleza = texto(datos.naturaleza);
        let nivel = 1;
        if (padreId) {
          const p = await this.cuenta(c, padreId, true);
          if (!codigo.startsWith(p.codigo) || codigo.length <= p.codigo.length)
            throw new BadRequestException(
              `El código debe empezar con el de la cuenta de arriba (${p.codigo}) y ser más largo`,
            );
          if (p.acepta_movimientos)
            throw new BadRequestException(
              `${p.codigo} ${p.nombre} acepta movimientos: no puede tener cuentas debajo`,
            );
          // El tipo es el de la cuenta de arriba; la naturaleza también,
          // salvo una cuenta contraria (ej.: depreciación acumulada).
          tipo = p.tipo;
          naturaleza = naturaleza || p.naturaleza;
          nivel = p.nivel + 1;
        } else if (codigo.length !== 1)
          throw new BadRequestException(
            'Una cuenta sin cuenta de arriba es de primer nivel (un solo dígito)',
          );
        if (!TIPOS.includes(tipo))
          throw new BadRequestException(
            'Tipo: activo, pasivo, capital, ingreso, costo o gasto',
          );
        if (naturaleza !== 'deudora' && naturaleza !== 'acreedora')
          throw new BadRequestException('Naturaleza: deudora o acreedora');
        const r = await c.query<{ id: string }>(
          `INSERT INTO cuentas_contables (codigo, nombre, tipo, naturaleza, padre_id, nivel, acepta_movimientos, notas, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            codigo,
            nombre,
            tipo,
            naturaleza,
            padreId || null,
            nivel,
            datos.aceptaMovimientos === true,
            notas,
            actorId,
          ],
        );
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'contabilidad.cuenta_crear',
          entidad: 'cuentas_contables',
          entidadId: r.rows[0].id,
          nuevo: {
            codigo,
            nombre,
            tipo,
            naturaleza,
            acepta_movimientos: datos.aceptaMovimientos === true,
          },
          ip,
        });
        return { id: r.rows[0].id };
      });
    } catch (e) {
      errorDeRegla(e);
    }
  }

  // Nombre, notas, naturaleza y si acepta movimientos. Las reglas fuertes
  // (cuenta con asientos, con hijas…) las revisa también la base de datos.
  async editarCuenta(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: {
      nombre?: unknown;
      naturaleza?: unknown;
      aceptaMovimientos?: unknown;
      notas?: unknown;
    },
  ) {
    const nombre = texto(datos.nombre);
    if (nombre.length < 2 || nombre.length > 150)
      throw new BadRequestException('Nombre: de 2 a 150 caracteres');
    const naturaleza = texto(datos.naturaleza);
    if (naturaleza !== 'deudora' && naturaleza !== 'acreedora')
      throw new BadRequestException('Naturaleza: deudora o acreedora');
    if (typeof datos.aceptaMovimientos !== 'boolean')
      throw new BadRequestException('Indique si acepta movimientos');
    const notas = texto(datos.notas).slice(0, 500) || null;
    try {
      return await this.db.transaccion(async (c) => {
        const antes = await this.cuenta(c, id, true);
        await c.query(
          `UPDATE cuentas_contables SET nombre = $2, naturaleza = $3, acepta_movimientos = $4, notas = $5,
                  updated_by = $6, updated_at = now() WHERE id = $1`,
          [id, nombre, naturaleza, datos.aceptaMovimientos, notas, actorId],
        );
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'contabilidad.cuenta_editar',
          entidad: 'cuentas_contables',
          entidadId: id,
          anterior: antes,
          nuevo: {
            nombre,
            naturaleza,
            acepta_movimientos: datos.aceptaMovimientos,
            notas,
          },
          ip,
        });
        return { ok: true };
      });
    } catch (e) {
      errorDeRegla(e);
    }
  }

  // El contador marca la cuenta como revisada (o la vuelve a pendiente).
  async validarCuenta(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: { validada?: unknown },
  ) {
    if (typeof datos.validada !== 'boolean')
      throw new BadRequestException('Indique si está validada');
    return this.db.transaccion(async (c) => {
      const antes = await this.cuenta(c, id, true);
      await c.query(
        `UPDATE cuentas_contables SET validada = $2, updated_by = $3, updated_at = now() WHERE id = $1`,
        [id, datos.validada, actorId],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'contabilidad.cuenta_validar',
        entidad: 'cuentas_contables',
        entidadId: id,
        anterior: { codigo: antes.codigo, validada: antes.validada },
        nuevo: { validada: datos.validada },
        ip,
      });
      return { ok: true };
    });
  }

  // Desactivar solo con saldo 0 y sin cuentas activas debajo.
  async estadoCuenta(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: { activo?: unknown; motivo?: unknown },
  ) {
    if (typeof datos.activo !== 'boolean')
      throw new BadRequestException('Estado inválido');
    const motivo = datos.activo
      ? texto(datos.motivo) || null
      : motivoValido(datos.motivo);
    return this.db.transaccion(async (c) => {
      const antes = await this.cuenta(c, id, true);
      if (antes.is_active === datos.activo) return { ok: true };
      if (!datos.activo) {
        if ((await this.saldoCuenta(c, id)) !== 0n)
          throw new BadRequestException(
            `${antes.codigo} ${antes.nombre} tiene saldo: solo se desactiva con saldo 0`,
          );
        const hijas = await c.query(
          'SELECT 1 FROM cuentas_contables WHERE padre_id = $1 AND is_active LIMIT 1',
          [id],
        );
        if ((hijas.rowCount ?? 0) > 0)
          throw new BadRequestException(
            'Tiene cuentas activas debajo: desactívelas primero',
          );
      }
      await c.query(
        `UPDATE cuentas_contables SET is_active = $2, updated_by = $3, updated_at = now() WHERE id = $1`,
        [id, datos.activo, actorId],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: datos.activo
          ? 'contabilidad.cuenta_activar'
          : 'contabilidad.cuenta_desactivar',
        entidad: 'cuentas_contables',
        entidadId: id,
        anterior: { codigo: antes.codigo, is_active: antes.is_active },
        nuevo: { is_active: datos.activo },
        motivo: motivo ?? undefined,
        ip,
      });
      return { ok: true };
    });
  }

  // ---------- Asientos ----------

  private leerLineas(v: unknown): LineaAsiento[] {
    if (!Array.isArray(v) || v.length < 2)
      throw new BadRequestException('Un asiento lleva al menos dos líneas');
    if (v.length > 200) throw new BadRequestException('Máximo 200 líneas');
    return v.map((x: Record<string, unknown>, i) => {
      const cuentaId = texto(x?.cuentaId).toLowerCase();
      if (!UUID.test(cuentaId))
        throw new BadRequestException(`Línea ${i + 1}: elija la cuenta`);
      const d = texto(x?.debito) ? normalizarMonto(x?.debito) : '0.00';
      const cr = texto(x?.credito) ? normalizarMonto(x?.credito) : '0.00';
      if (d === null || cr === null)
        throw new BadRequestException(`Línea ${i + 1}: monto inválido`);
      if ((d === '0.00') === (cr === '0.00'))
        throw new BadRequestException(
          `Línea ${i + 1}: escriba el débito o el crédito (uno solo)`,
        );
      const tercero = texto(x?.terceroId).toLowerCase();
      const unidad = texto(x?.unidadNegocioId).toLowerCase();
      if (tercero && !UUID.test(tercero))
        throw new BadRequestException(`Línea ${i + 1}: tercero inválido`);
      if (unidad && !UUID.test(unidad))
        throw new BadRequestException(
          `Línea ${i + 1}: línea de negocio inválida`,
        );
      return {
        cuentaId,
        debito: d,
        credito: cr,
        descripcion: texto(x?.descripcion).slice(0, 300) || null,
        terceroId: tercero || null,
        unidadNegocioId: unidad || null,
      };
    });
  }

  // Asiento manual o el de apertura (en la fecha de inicio).
  async crearAsiento(
    actorId: string,
    ip: string | undefined,
    datos: {
      fecha?: unknown;
      concepto?: unknown;
      apertura?: unknown;
      lineas?: unknown;
    },
  ) {
    const concepto = texto(datos.concepto);
    if (concepto.length < 3 || concepto.length > 300)
      throw new BadRequestException('Concepto: de 3 a 300 caracteres');
    const lineas = this.leerLineas(datos.lineas);
    const apertura = datos.apertura === true;
    try {
      return await this.db.transaccion(async (c) => {
        const inicio = await this.fechaInicio(c);
        if (!inicio)
          throw new BadRequestException(
            'Primero indique la fecha de inicio de la contabilidad',
          );
        const fecha = apertura ? inicio : texto(datos.fecha);
        if (!fechaValida(fecha))
          throw new BadRequestException('Fecha inválida (AAAA-MM-DD)');
        if (fecha > (await hoyLocal(c)))
          throw new BadRequestException('La fecha no puede ser futura');
        if (apertura) {
          const ya = await c.query(
            `SELECT 1 FROM asientos WHERE origen = 'apertura' AND estado = 'activo'`,
          );
          if ((ya.rowCount ?? 0) > 0)
            throw new BadRequestException(
              'Ya hay un asiento de apertura: anúlelo primero si hay que corregirlo',
            );
        }
        const a = await registrarAsiento(c, {
          fecha,
          concepto,
          origen: apertura ? 'apertura' : 'manual',
          lineas,
          usuarioId: actorId,
        });
        // Se fuerza la revisión de la base (cuadre) aquí, para dar un mensaje claro.
        await c.query('SET CONSTRAINTS ALL IMMEDIATE');
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: apertura ? 'contabilidad.apertura' : 'contabilidad.asiento',
          entidad: 'asientos',
          entidadId: a.id,
          nuevo: {
            asiento: a.codigo,
            fecha,
            concepto,
            lineas: lineas.length,
            total: texto2(lineas.reduce((x, l) => x + centavos(l.debito), 0n)),
          },
          ip,
        });
        return { id: a.id, codigo: a.codigo };
      });
    } catch (e) {
      errorDeRegla(e);
    }
  }

  // Anular: el original queda "anulado" y se registra su reverso (débitos y
  // créditos al revés). El reverso va en la fecha del original si su mes
  // está abierto; si no, hoy. Un reverso no se anula.
  async anularAsiento(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: { motivo?: unknown },
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Asiento no encontrado');
    const motivo = motivoValido(datos.motivo);
    try {
      return await this.db.transaccion(async (c) => {
        const r = await c.query<{
          numero: string;
          fecha: string;
          origen: string;
          estado: string;
          concepto: string;
          documento: string | null;
        }>(
          `SELECT numero, to_char(fecha, 'YYYY-MM-DD') AS fecha, origen, estado, concepto, documento
           FROM asientos WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (r.rowCount === 0)
          throw new NotFoundException('Asiento no encontrado');
        const a = r.rows[0];
        if (a.origen === 'reverso')
          throw new BadRequestException('Un asiento de reverso no se anula');
        if (a.estado === 'anulado')
          throw new BadRequestException('El asiento ya está anulado');
        const cerrado = await c.query(
          `SELECT 1 FROM periodos_contables
           WHERE anio = extract(year FROM $1::date) AND mes = extract(month FROM $1::date) AND estado = 'cerrado'`,
          [a.fecha],
        );
        const fecha = (cerrado.rowCount ?? 0) > 0 ? await hoyLocal(c) : a.fecha;
        const lineas = await c.query<{
          cuenta_id: string;
          debito: string;
          credito: string;
          descripcion: string | null;
          tercero_id: string | null;
          unidad_negocio_id: string | null;
        }>(
          `SELECT cuenta_id, debito, credito, descripcion, tercero_id, unidad_negocio_id
           FROM asiento_lineas WHERE asiento_id = $1 ORDER BY id`,
          [id],
        );
        const codigo = numeroAsiento(a.numero);
        await c.query(
          `UPDATE asientos SET estado = 'anulado', anulado_por = $2, anulado_en = now(), motivo_anulacion = $3
           WHERE id = $1`,
          [id, actorId, motivo],
        );
        const rev = await registrarAsiento(c, {
          fecha,
          concepto: `Reverso de ${codigo}: ${motivo}`.slice(0, 300),
          origen: 'reverso',
          documento: a.documento,
          reversoDe: id,
          lineas: lineas.rows.map((l) => ({
            cuentaId: l.cuenta_id,
            debito: l.credito,
            credito: l.debito,
            descripcion: l.descripcion,
            terceroId: l.tercero_id,
            unidadNegocioId: l.unidad_negocio_id,
          })),
          usuarioId: actorId,
        });
        await c.query('SET CONSTRAINTS ALL IMMEDIATE');
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'contabilidad.anular',
          entidad: 'asientos',
          entidadId: id,
          anterior: { asiento: codigo, estado: 'activo' },
          nuevo: {
            estado: 'anulado',
            reverso: rev.codigo,
            fecha_reverso: fecha,
          },
          motivo,
          ip,
        });
        return { ok: true, reverso: rev.codigo, fechaReverso: fecha };
      });
    } catch (e) {
      errorDeRegla(e);
    }
  }

  async asientos(filtros: {
    desde?: string;
    hasta?: string;
    texto?: string;
    origen?: string;
    pagina?: string;
  }) {
    const params: unknown[] = [];
    const cond: string[] = [];
    for (const [k, op] of [
      ['desde', '>='],
      ['hasta', '<='],
    ] as const) {
      const f = texto(filtros[k]);
      if (!f) continue;
      if (!fechaValida(f))
        throw new BadRequestException('Fecha inválida (AAAA-MM-DD)');
      params.push(f);
      cond.push(`a.fecha ${op} $${params.length}::date`);
    }
    const t = texto(filtros.texto).slice(0, 60);
    if (t) {
      params.push(`%${t.replace(/[\\%_]/g, (x) => '\\' + x)}%`);
      cond.push(
        `(a.concepto ILIKE $${params.length} OR a.documento ILIKE $${params.length}
          OR ('AS-' || lpad(a.numero::text, 6, '0')) ILIKE $${params.length})`,
      );
    }
    const origen = texto(filtros.origen);
    if (origen) {
      params.push(origen);
      cond.push(`a.origen = $${params.length}`);
    }
    const pagina = Math.max(
      1,
      Number.parseInt(texto(filtros.pagina) || '1', 10) || 1,
    );
    params.push((pagina - 1) * 50);
    const r = await this.db.query<{ numero: string; total_filas: number }>(
      `SELECT a.id, a.numero, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.concepto, a.origen, a.documento,
              a.estado, a.reverso_de, u.username AS usuario,
              (SELECT sum(debito) FROM asiento_lineas WHERE asiento_id = a.id)::numeric(16,2) AS total,
              count(*) OVER ()::int AS total_filas
       FROM asientos a JOIN usuarios u ON u.id = a.created_by
       ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
       ORDER BY a.fecha DESC, a.numero DESC
       LIMIT 50 OFFSET $${params.length}`,
      params,
    );
    return {
      filas: r.rows.map(({ total_filas: _t, ...x }) => ({
        ...x,
        codigo: numeroAsiento(x.numero),
      })),
      total: r.rows[0]?.total_filas ?? 0,
      pagina,
      porPagina: 50,
    };
  }

  async asiento(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Asiento no encontrado');
    const r = await this.db.query<{
      numero: string;
      reverso_numero: string | null;
      reversado_por: string | null;
    }>(
      `SELECT a.id, a.numero, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.concepto, a.origen, a.documento,
              a.estado, a.motivo_anulacion, a.anulado_en, u.username AS usuario, ua.username AS anulado_por,
              a.reverso_de, o.numero AS reverso_numero,
              (SELECT x.numero FROM asientos x WHERE x.reverso_de = a.id) AS reversado_por, a.created_at
       FROM asientos a JOIN usuarios u ON u.id = a.created_by
       LEFT JOIN usuarios ua ON ua.id = a.anulado_por
       LEFT JOIN asientos o ON o.id = a.reverso_de
       WHERE a.id = $1`,
      [id],
    );
    if (r.rowCount === 0) throw new NotFoundException('Asiento no encontrado');
    const lineas = await this.db.query(
      `SELECT l.id, c.codigo, c.nombre AS cuenta, l.debito, l.credito, l.descripcion,
              t.nombre AS tercero, un.nombre AS unidad_negocio
       FROM asiento_lineas l JOIN cuentas_contables c ON c.id = l.cuenta_id
       LEFT JOIN terceros t ON t.id = l.tercero_id
       LEFT JOIN unidades_negocio un ON un.id = l.unidad_negocio_id
       WHERE l.asiento_id = $1 ORDER BY l.id`,
      [id],
    );
    const x = r.rows[0];
    return {
      ...x,
      codigo: numeroAsiento(x.numero),
      reverso_de_codigo: x.reverso_numero
        ? numeroAsiento(x.reverso_numero)
        : null,
      reversado_por_codigo: x.reversado_por
        ? numeroAsiento(x.reversado_por)
        : null,
      lineas: lineas.rows,
    };
  }

  // ---------- Meses ----------

  async periodos() {
    const inicio = await this.fechaInicio(this.db);
    const r = await this.db.query(
      `SELECT p.anio, p.mes, p.estado, p.cerrado_en, u.username AS cerrado_por
       FROM periodos_contables p LEFT JOIN usuarios u ON u.id = p.cerrado_por
       ORDER BY p.anio DESC, p.mes DESC`,
    );
    return { fechaInicio: inicio, periodos: r.rows };
  }

  private leerMes(datos: { anio?: unknown; mes?: unknown }) {
    const anio = Number(texto(datos.anio));
    const mes = Number(texto(datos.mes));
    if (
      !Number.isInteger(anio) ||
      anio < 2000 ||
      anio > 2100 ||
      !Number.isInteger(mes) ||
      mes < 1 ||
      mes > 12
    )
      throw new BadRequestException('Mes inválido');
    return { anio, mes };
  }

  async cerrarMes(
    actorId: string,
    ip: string | undefined,
    datos: { anio?: unknown; mes?: unknown },
  ) {
    const { anio, mes } = this.leerMes(datos);
    return this.db.transaccion(async (c) => {
      const inicio = await this.fechaInicio(c);
      if (!inicio)
        throw new BadRequestException('Primero indique la fecha de inicio');
      const primero = `${anio}-${String(mes).padStart(2, '0')}-01`;
      if (primero.slice(0, 7) < inicio.slice(0, 7))
        throw new BadRequestException(
          'Ese mes es anterior al inicio de la contabilidad',
        );
      if (primero.slice(0, 7) >= (await hoyLocal(c)).slice(0, 7))
        throw new BadRequestException(
          'Solo se cierran meses que ya terminaron',
        );
      const r = await c.query<{ estado: string }>(
        `INSERT INTO periodos_contables (anio, mes) VALUES ($1, $2)
         ON CONFLICT (anio, mes) DO UPDATE SET anio = EXCLUDED.anio
         RETURNING estado`,
        [anio, mes],
      );
      if (r.rows[0].estado === 'cerrado')
        throw new BadRequestException('Ese mes ya está cerrado');
      await c.query(
        `UPDATE periodos_contables SET estado = 'cerrado', cerrado_por = $3, cerrado_en = now()
         WHERE anio = $1 AND mes = $2`,
        [anio, mes, actorId],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'contabilidad.cerrar_mes',
        entidad: 'periodos_contables',
        nuevo: { anio, mes, estado: 'cerrado' },
        ip,
      });
      return { ok: true };
    });
  }

  async reabrirMes(
    actorId: string,
    ip: string | undefined,
    datos: { anio?: unknown; mes?: unknown; motivo?: unknown },
  ) {
    const { anio, mes } = this.leerMes(datos);
    const motivo = motivoValido(datos.motivo);
    return this.db.transaccion(async (c) => {
      const r = await c.query<{ estado: string }>(
        'SELECT estado FROM periodos_contables WHERE anio = $1 AND mes = $2 FOR UPDATE',
        [anio, mes],
      );
      if (r.rowCount === 0 || r.rows[0].estado !== 'cerrado')
        throw new BadRequestException('Ese mes no está cerrado');
      await c.query(
        `UPDATE periodos_contables SET estado = 'abierto', cerrado_por = NULL, cerrado_en = NULL
         WHERE anio = $1 AND mes = $2`,
        [anio, mes],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'contabilidad.reabrir_mes',
        entidad: 'periodos_contables',
        anterior: { anio, mes, estado: 'cerrado' },
        nuevo: { estado: 'abierto' },
        motivo,
        ip,
      });
      return { ok: true };
    });
  }

  // ---------- Balanza de comprobación ----------

  // Saldos al día "hasta" de las cuentas con movimiento. Suma TODOS los
  // asientos: un anulado y su reverso se cancelan entre sí.
  async balanza(filtros: { hasta?: string }) {
    const hasta = texto(filtros.hasta) || (await hoyLocal(this.db));
    if (!fechaValida(hasta))
      throw new BadRequestException('Fecha inválida (AAAA-MM-DD)');
    const r = await this.db.query<{
      codigo: string;
      nombre: string;
      tipo: string;
      naturaleza: string;
      debitos: string;
      creditos: string;
    }>(
      `SELECT c.codigo, c.nombre, c.tipo, c.naturaleza,
              sum(l.debito)::numeric(16,2) AS debitos, sum(l.credito)::numeric(16,2) AS creditos
       FROM asiento_lineas l JOIN asientos a ON a.id = l.asiento_id
       JOIN cuentas_contables c ON c.id = l.cuenta_id
       WHERE a.fecha <= $1::date
       GROUP BY c.id ORDER BY c.codigo`,
      [hasta],
    );
    let td = 0n;
    let tc = 0n;
    const filas = r.rows.map((x) => {
      const d = centavos(x.debitos);
      const cr = centavos(x.creditos);
      td += d;
      tc += cr;
      const s = d - cr;
      return {
        ...x,
        saldo_deudor: s > 0n ? texto2(s) : '0.00',
        saldo_acreedor: s < 0n ? texto2(-s) : '0.00',
      };
    });
    return {
      hasta,
      filas,
      totales: { debitos: texto2(td), creditos: texto2(tc), cuadra: td === tc },
    };
  }
}
