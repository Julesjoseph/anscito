import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { registrarAuditoria } from '../auditoria/auditoria';
import { numeroSesion, SQL_ESPERADO } from '../caja/sql';
import { DatabaseService } from '../database/database.service';
import { normalizarMonto } from '../servicios/calculo-itbis';
import {
  numeroTransferencia,
  SQL_DISPONIBLE,
  SQL_MOVS_CON_ESTADO,
  SQL_NO_LLEGO_PENDIENTE,
  SQL_SALDOS,
} from './sql';

// Bancos y billeteras (MonCash, NatCash): cuentas en RD$, US$ o HTG,
// movimientos que solo se agregan (los errores se corrigen con un reverso),
// confirmación contra el estado de cuenta y transferencias entre cuentas y caja.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIPOS_MANUALES = ['pago', 'cargo', 'interes', 'ingreso'] as const;
type TipoManual = (typeof TIPOS_MANUALES)[number];
const SIGNO: Record<TipoManual, 1 | -1> = {
  pago: -1,
  cargo: -1,
  interes: 1,
  ingreso: 1,
};
const CAMBIADO_POR = ['casa_cambio', 'agente', 'banco', 'otro'];

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

// Monto mayor que 0 con hasta 2 decimales.
function montoPositivo(v: unknown, que = 'Monto'): string {
  const m = normalizarMonto(v);
  if (m === null || m === '0.00') {
    throw new BadRequestException(
      `${que} inválido: mayor que 0, con hasta 2 decimales`,
    );
  }
  return m;
}

// Tasa: cuántos RD$ vale 1 unidad de la otra moneda (hasta 8 decimales).
export function normalizarTasa(v: unknown): string | null {
  const t = texto(v);
  if (!/^\d{1,10}(\.\d{1,8})?$/.test(t)) return null;
  if (/^0+(\.0+)?$/.test(t)) return null;
  return t;
}

function motivoObligatorio(v: unknown): string {
  const m = texto(v);
  if (m.length < 5 || m.length > 500) {
    throw new BadRequestException(
      'Escriba el motivo (entre 5 y 500 caracteres)',
    );
  }
  return m;
}

type CuentaBloqueada = {
  id: string;
  nombre: string;
  moneda: string;
  simbolo: string;
  is_active: boolean;
};

// Un lado de una transferencia: una cuenta o la caja abierta.
type Lado =
  | { tipo: 'cuenta'; cuenta: CuentaBloqueada }
  | {
      tipo: 'caja';
      sesionId: string;
      caja: string;
      numero: string;
    };

export type DatosTransferencia = {
  origenCuentaId?: unknown;
  origenCajaId?: unknown;
  destinoCuentaId?: unknown;
  destinoCajaId?: unknown;
  montoSale?: unknown;
  montoEntra?: unknown;
  tasa?: unknown;
  cambiadoPor?: unknown;
  referencia?: unknown;
  motivo?: unknown;
  fecha?: unknown;
};

@Injectable()
export class BancosService {
  constructor(private readonly db: DatabaseService) {}

  private async config(c: Pick<PoolClient, 'query'>, clave: string) {
    const r = await c.query<{ valor: string }>(
      'SELECT valor FROM configuracion WHERE clave = $1',
      [clave],
    );
    if (r.rowCount === 0) throw new Error(`Falta la configuración ${clave}`);
    return r.rows[0].valor;
  }

  // Fecha del banco: hoy si no se indica; nunca en el futuro.
  private async fecha(c: Pick<PoolClient, 'query'>, v: unknown) {
    const zona = await this.config(c, 'empresa.zona_horaria');
    const hoy = (
      await c.query<{ hoy: string }>(
        `SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS hoy`,
        [zona],
      )
    ).rows[0].hoy;
    const f = texto(v);
    if (!f) return hoy;
    if (!fechaValida(f))
      throw new BadRequestException('Fecha inválida (use AAAA-MM-DD)');
    if (f > hoy)
      throw new BadRequestException('La fecha no puede ser en el futuro');
    return f;
  }

  private async bloquearCuenta(c: PoolClient, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Cuenta no encontrada');
    const r = await c.query<CuentaBloqueada>(
      `SELECT ct.id, ct.nombre, ct.moneda, mo.simbolo, ct.is_active
       FROM cuentas ct JOIN monedas mo ON mo.codigo = ct.moneda
       WHERE ct.id = $1 FOR UPDATE OF ct`,
      [id],
    );
    if (r.rowCount === 0) throw new NotFoundException('Cuenta no encontrada');
    return r.rows[0];
  }

  private async disponible(c: Pick<PoolClient, 'query'>, cuentaId: string) {
    return (await c.query<{ disponible: string }>(SQL_DISPONIBLE, [cuentaId]))
      .rows[0].disponible;
  }

  private async mayorOIgual(
    c: Pick<PoolClient, 'query'>,
    a: string,
    b: string,
  ) {
    return (
      await c.query<{ ok: boolean }>(
        'SELECT $1::numeric >= $2::numeric AS ok',
        [a, b],
      )
    ).rows[0].ok;
  }

  // ---------- Datos para las pantallas ----------

  async preparar() {
    const [monedas, categorias, cuentas, cajas] = await Promise.all([
      this.db.query(
        'SELECT codigo, nombre, simbolo FROM monedas WHERE is_active ORDER BY orden',
      ),
      this.db.query(
        'SELECT id, codigo, nombre FROM categorias_gasto WHERE is_active ORDER BY orden, nombre',
      ),
      this.db.query(
        `SELECT ct.id, ct.nombre, ct.tipo, ct.moneda, mo.simbolo, ct.recibe_ventas
         FROM cuentas ct JOIN monedas mo ON mo.codigo = ct.moneda
         WHERE ct.is_active ORDER BY ct.tipo, lower(ct.nombre)`,
      ),
      this.db.query(
        `SELECT c.id, c.nombre, s.id AS sesion_id
         FROM cajas c
         LEFT JOIN caja_sesiones s ON s.caja_id = c.id AND s.estado = 'abierta'
         WHERE c.is_active ORDER BY lower(c.nombre)`,
      ),
    ]);
    return {
      monedas: monedas.rows,
      categoriasGasto: categorias.rows,
      cuentas: cuentas.rows,
      cajas: cajas.rows,
    };
  }

  // ---------- Cuentas ----------

  async cuentas() {
    const r = await this.db.query(
      `SELECT ct.id, ct.codigo, ct.tipo, ct.entidad, ct.nombre, ct.tipo_cuenta,
              ct.moneda, mo.simbolo, ct.ultimos_digitos, ct.recibe_ventas, ct.is_active,
              COALESCE(s.confirmado, 0)::numeric(14,2) AS confirmado,
              COALESCE(s.por_confirmar, 0)::numeric(14,2) AS por_confirmar,
              COALESCE(s.disponible, 0)::numeric(14,2) AS disponible,
              COALESCE(s.disponible_dop, 0)::numeric(14,2) AS disponible_dop,
              COALESCE(s.pendientes, 0) AS pendientes,
              COALESCE(s.no_llegaron, 0) AS no_llegaron,
              EXISTS (SELECT 1 FROM cuenta_movimientos m
                      WHERE m.cuenta_id = ct.id AND m.tipo = 'saldo_inicial') AS tiene_saldo_inicial
       FROM cuentas ct
       JOIN monedas mo ON mo.codigo = ct.moneda
       LEFT JOIN (${SQL_SALDOS}) s ON s.cuenta_id = ct.id
       ORDER BY ct.is_active DESC, ct.tipo, lower(ct.nombre)`,
    );
    return r.rows;
  }

  private datosCuenta(datos: Record<string, unknown>, nueva: boolean) {
    const entidad = texto(datos.entidad);
    if (!entidad || entidad.length > 60)
      throw new BadRequestException(
        'Escriba el banco o servicio (máximo 60), ej: Banco Popular o MonCash',
      );
    const nombre = texto(datos.nombre);
    if (!nombre || nombre.length > 60)
      throw new BadRequestException(
        'Escriba el nombre de la cuenta (máximo 60), ej: Popular corriente',
      );
    const digitos = texto(datos.ultimosDigitos) || null;
    if (digitos !== null && !/^\d{4}$/.test(digitos)) {
      throw new BadRequestException(
        'Escriba solo los últimos 4 dígitos del número de cuenta',
      );
    }
    const recibeVentas = datos.recibeVentas === true;
    const tipoCuenta = texto(datos.tipoCuenta) || null;
    const r = { entidad, nombre, digitos, recibeVentas, tipoCuenta };
    if (!nueva) return { ...r, codigo: '', tipo: '', moneda: '' };
    const codigo = texto(datos.codigo).toUpperCase();
    if (!/^[A-Z0-9_-]{2,20}$/.test(codigo)) {
      throw new BadRequestException(
        'Código inválido: 2 a 20 letras, números o guiones (ej: POPULAR-CTE)',
      );
    }
    const tipo = texto(datos.tipo);
    if (tipo !== 'banco' && tipo !== 'billetera')
      throw new BadRequestException('Tipo inválido: banco o billetera');
    const moneda = texto(datos.moneda).toUpperCase();
    return { ...r, codigo, tipo, moneda };
  }

  private validarTipoCuenta(
    tipo: string,
    tipoCuenta: string | null,
    moneda: string,
    recibeVentas: boolean,
  ) {
    if (
      tipo === 'banco' &&
      tipoCuenta !== 'corriente' &&
      tipoCuenta !== 'ahorro'
    )
      throw new BadRequestException(
        'Indique si la cuenta es corriente o de ahorro',
      );
    if (tipo === 'billetera' && tipoCuenta !== null)
      throw new BadRequestException(
        'Una billetera (MonCash, NatCash) no es corriente ni de ahorro',
      );
    if (recibeVentas && moneda !== 'DOP')
      throw new BadRequestException(
        'Solo las cuentas en pesos (RD$) pueden recibir ventas',
      );
  }

  async crearCuenta(
    actorId: string,
    ip: string | undefined,
    datos: Record<string, unknown>,
  ) {
    const d = this.datosCuenta(datos, true);
    this.validarTipoCuenta(d.tipo, d.tipoCuenta, d.moneda, d.recibeVentas);
    try {
      return await this.db.transaccion(async (c) => {
        const mo = await c.query(
          'SELECT 1 FROM monedas WHERE codigo = $1 AND is_active',
          [d.moneda],
        );
        if (mo.rowCount === 0)
          throw new BadRequestException('Moneda inválida: DOP, USD o HTG');
        const r = await c.query<{ id: string }>(
          `INSERT INTO cuentas (codigo, tipo, entidad, nombre, tipo_cuenta, moneda,
                                ultimos_digitos, recibe_ventas, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            d.codigo,
            d.tipo,
            d.entidad,
            d.nombre,
            d.tipoCuenta,
            d.moneda,
            d.digitos,
            d.recibeVentas,
            actorId,
          ],
        );
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'cuenta.crear',
          entidad: 'cuentas',
          entidadId: r.rows[0].id,
          nuevo: {
            codigo: d.codigo,
            tipo: d.tipo,
            entidad: d.entidad,
            nombre: d.nombre,
            tipo_cuenta: d.tipoCuenta,
            moneda: d.moneda,
            ultimos_digitos: d.digitos,
            recibe_ventas: d.recibeVentas,
          },
          ip,
        });
        return { id: r.rows[0].id };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw new ConflictException(
          'Ya existe una cuenta con ese código o nombre',
        );
      throw e;
    }
  }

  // El código, el tipo y la moneda no se cambian (ya tiene movimientos).
  async editarCuenta(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: Record<string, unknown>,
  ) {
    const d = this.datosCuenta(datos, false);
    try {
      return await this.db.transaccion(async (c) => {
        if (!UUID.test(id)) throw new NotFoundException('Cuenta no encontrada');
        const r = await c.query<{
          tipo: string;
          moneda: string;
          entidad: string;
          nombre: string;
          tipo_cuenta: string | null;
          ultimos_digitos: string | null;
          recibe_ventas: boolean;
        }>(
          `SELECT tipo, moneda, entidad, nombre, tipo_cuenta, ultimos_digitos, recibe_ventas
           FROM cuentas WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (r.rowCount === 0)
          throw new NotFoundException('Cuenta no encontrada');
        const a = r.rows[0];
        this.validarTipoCuenta(a.tipo, d.tipoCuenta, a.moneda, d.recibeVentas);
        await c.query(
          `UPDATE cuentas SET entidad = $2, nombre = $3, tipo_cuenta = $4,
                  ultimos_digitos = $5, recibe_ventas = $6, updated_at = now()
           WHERE id = $1`,
          [id, d.entidad, d.nombre, d.tipoCuenta, d.digitos, d.recibeVentas],
        );
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'cuenta.editar',
          entidad: 'cuentas',
          entidadId: id,
          anterior: {
            entidad: a.entidad,
            nombre: a.nombre,
            tipo_cuenta: a.tipo_cuenta,
            ultimos_digitos: a.ultimos_digitos,
            recibe_ventas: a.recibe_ventas,
          },
          nuevo: {
            entidad: d.entidad,
            nombre: d.nombre,
            tipo_cuenta: d.tipoCuenta,
            ultimos_digitos: d.digitos,
            recibe_ventas: d.recibeVentas,
          },
          ip,
        });
        return { ok: true };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw new ConflictException('Ya existe una cuenta con ese nombre');
      throw e;
    }
  }

  async estadoCuenta(
    actorId: string,
    id: string,
    activo: unknown,
    motivo: unknown,
    ip: string | undefined,
  ) {
    if (typeof activo !== 'boolean')
      throw new BadRequestException('Estado inválido');
    const textoMotivo = texto(motivo);
    if (!activo && textoMotivo.length < 5) {
      throw new BadRequestException(
        'Escriba el motivo de la desactivación (mínimo 5 caracteres)',
      );
    }
    return this.db.transaccion(async (c) => {
      const ct = await this.bloquearCuenta(c, id);
      if (ct.is_active === activo) return { ok: true };
      if (!activo) {
        // Solo se desactiva una cuenta vacía y sin nada por confirmar.
        const s = await c.query<{ disponible: string; pendientes: number }>(
          `SELECT COALESCE(sum(signo * monto) FILTER (WHERE estado <> 'no_llego'), 0)::numeric(14,2) AS disponible,
                  count(*) FILTER (WHERE estado = 'por_confirmar')::int AS pendientes
           FROM ${SQL_MOVS_CON_ESTADO} x WHERE x.cuenta_id = $1`,
          [id],
        );
        if (s.rows[0].disponible !== '0.00' || s.rows[0].pendientes > 0) {
          throw new BadRequestException(
            `No se puede desactivar: ${ct.nombre} tiene saldo (${ct.simbolo}${s.rows[0].disponible}) o movimientos por confirmar`,
          );
        }
      }
      await c.query(
        'UPDATE cuentas SET is_active = $2, updated_at = now() WHERE id = $1',
        [id, activo],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: activo ? 'cuenta.activar' : 'cuenta.desactivar',
        entidad: 'cuentas',
        entidadId: id,
        anterior: { nombre: ct.nombre, is_active: ct.is_active },
        nuevo: { nombre: ct.nombre, is_active: activo },
        motivo: textoMotivo || undefined,
        ip,
      });
      return { ok: true };
    });
  }

  // La tasa del movimiento: 1 en pesos; obligatoria en otra moneda.
  private tasaDe(moneda: string, v: unknown): string {
    if (moneda === 'DOP') return '1';
    const t = normalizarTasa(v);
    if (t === null) {
      throw new BadRequestException(
        `Escriba la tasa del día: cuántos RD$ vale 1 ${moneda}`,
      );
    }
    return t;
  }

  async saldoInicial(
    actorId: string,
    cuentaId: string,
    ip: string | undefined,
    datos: { monto?: unknown; tasa?: unknown; fecha?: unknown },
  ) {
    const monto = montoPositivo(datos.monto, 'Saldo inicial');
    try {
      return await this.db.transaccion(async (c) => {
        const ct = await this.bloquearCuenta(c, cuentaId);
        if (!ct.is_active)
          throw new BadRequestException('La cuenta está desactivada');
        const tasa = this.tasaDe(ct.moneda, datos.tasa);
        const fecha = await this.fecha(c, datos.fecha);
        const r = await c.query<{ id: string; monto_dop: string }>(
          `INSERT INTO cuenta_movimientos
             (cuenta_id, tipo, signo, monto, tasa, monto_dop, fecha, motivo, usuario_id)
           VALUES ($1, 'saldo_inicial', 1, $2, $3, round($2::numeric * $3::numeric, 2),
                   $4, 'Saldo al empezar a usar el sistema', $5)
           RETURNING id, monto_dop`,
          [cuentaId, monto, tasa, fecha, actorId],
        );
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'cuenta.saldo_inicial',
          entidad: 'cuentas',
          entidadId: cuentaId,
          nuevo: { cuenta: ct.nombre, monto, moneda: ct.moneda, tasa, fecha },
          ip,
        });
        return { id: r.rows[0].id };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException(
          'La cuenta ya tiene saldo inicial. Si estaba mal, revérselo y regístrelo como ingreso o pago.',
        );
      }
      throw e;
    }
  }

  // ---------- Pagos, cargos, intereses e ingresos ----------

  async movimiento(
    actorId: string,
    cuentaId: string,
    ip: string | undefined,
    datos: {
      tipo?: unknown;
      monto?: unknown;
      tasa?: unknown;
      fecha?: unknown;
      categoriaGastoId?: unknown;
      beneficiario?: unknown;
      comprobante?: unknown;
      referencia?: unknown;
      motivo?: unknown;
    },
  ) {
    const tipo = texto(datos.tipo) as TipoManual;
    if (!TIPOS_MANUALES.includes(tipo)) {
      throw new BadRequestException(
        'Tipo inválido: pago, cargo, interes o ingreso',
      );
    }
    const monto = montoPositivo(datos.monto);
    const motivo = motivoObligatorio(datos.motivo);
    const beneficiario = opcional(datos.beneficiario, 120, 'Beneficiario');
    const comprobante =
      opcional(datos.comprobante, 30, 'Comprobante')?.toUpperCase() ?? null;
    const referencia = opcional(datos.referencia, 60, 'Referencia');
    let categoria: string | null = null;
    if (tipo === 'pago') {
      categoria = texto(datos.categoriaGastoId).toLowerCase();
      if (!UUID.test(categoria))
        throw new BadRequestException('Seleccione la categoría del pago');
    }

    return this.db.transaccion(async (c) => {
      const ct = await this.bloquearCuenta(c, cuentaId);
      if (!ct.is_active)
        throw new BadRequestException('La cuenta está desactivada');
      const tasa = this.tasaDe(ct.moneda, datos.tasa);
      const fecha = await this.fecha(c, datos.fecha);
      let categoriaNombre: string | null = null;
      if (categoria) {
        const cat = await c.query<{ nombre: string }>(
          'SELECT nombre FROM categorias_gasto WHERE id = $1 AND is_active',
          [categoria],
        );
        if (cat.rowCount === 0)
          throw new BadRequestException('La categoría no existe');
        categoriaNombre = cat.rows[0].nombre;
      }
      const signo = SIGNO[tipo];
      if (signo < 0) {
        const hay = await this.disponible(c, cuentaId);
        if (!(await this.mayorOIgual(c, hay, monto))) {
          throw new BadRequestException(
            `No hay suficiente dinero en ${ct.nombre}: hay ${ct.simbolo}${hay}. ¿Registró el saldo inicial?`,
          );
        }
      }
      const r = await c.query<{ id: string; monto_dop: string }>(
        `INSERT INTO cuenta_movimientos
           (cuenta_id, tipo, signo, monto, tasa, monto_dop, fecha, categoria_gasto_id,
            beneficiario, comprobante, referencia, motivo, usuario_id)
         VALUES ($1, $2, $3, $4, $5, round($4::numeric * $5::numeric, 2), $6, $7,
                 $8, $9, $10, $11, $12)
         RETURNING id, monto_dop`,
        [
          cuentaId,
          tipo,
          signo,
          monto,
          tasa,
          fecha,
          categoria,
          beneficiario,
          comprobante,
          referencia,
          motivo,
          actorId,
        ],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: `cuenta.${tipo}`,
        entidad: 'cuentas',
        entidadId: cuentaId,
        nuevo: {
          cuenta: ct.nombre,
          tipo,
          monto,
          moneda: ct.moneda,
          tasa,
          monto_dop: r.rows[0].monto_dop,
          fecha,
          categoria: categoriaNombre,
          beneficiario,
          comprobante,
          referencia,
        },
        motivo,
        ip,
      });
      return {
        id: r.rows[0].id,
        disponible: await this.disponible(c, cuentaId),
      };
    });
  }

  // ---------- Reverso ----------

  async reversar(
    actorId: string,
    movimientoId: string,
    ip: string | undefined,
    motivoTexto: unknown,
  ) {
    if (!/^\d{1,18}$/.test(movimientoId))
      throw new NotFoundException('Movimiento no encontrado');
    const motivo = motivoObligatorio(motivoTexto);
    return this.db.transaccion(async (c) => {
      const m0 = await c.query<{ cuenta_id: string }>(
        'SELECT cuenta_id FROM cuenta_movimientos WHERE id = $1',
        [movimientoId],
      );
      if (m0.rowCount === 0)
        throw new NotFoundException('Movimiento no encontrado');
      const ct = await this.bloquearCuenta(c, m0.rows[0].cuenta_id);
      const r = await c.query<{
        tipo: string;
        signo: number;
        monto: string;
        tasa: string;
        monto_dop: string;
        estado: string;
        reversado: boolean;
        de_envios: boolean;
      }>(
        `SELECT x.tipo, x.signo, x.monto, x.tasa, x.monto_dop, x.estado,
                EXISTS (SELECT 1 FROM cuenta_movimientos r WHERE r.reverso_de = x.id) AS reversado,
                (x.remesa_id IS NOT NULL OR x.remesa_entrega_id IS NOT NULL
                  OR x.remesa_pago_id IS NOT NULL OR x.san_recibo_id IS NOT NULL
                  OR x.san_entrega_id IS NOT NULL OR x.compra_pago_id IS NOT NULL) AS de_envios
         FROM ${SQL_MOVS_CON_ESTADO} x WHERE x.id = $1`,
        [movimientoId],
      );
      const m = r.rows[0];
      if (m.de_envios)
        throw new BadRequestException(
          'Este movimiento viene de otro módulo (SCITO TRANSFER, SOL CASH o Compras) y no se reversa desde Bancos',
        );
      if (m.tipo === 'reverso')
        throw new BadRequestException('Un reverso no se puede reversar');
      if (m.reversado)
        throw new BadRequestException('Ese movimiento ya fue reversado');
      if (m.tipo === 'venta' || m.tipo === 'devolucion')
        throw new BadRequestException(
          'Los cobros de ventas se corrigen anulando la venta',
        );
      if (
        m.tipo === 'transferencia_entrada' ||
        m.tipo === 'transferencia_salida'
      )
        throw new BadRequestException(
          'Una transferencia se corrige con otra transferencia de regreso',
        );
      if (m.estado !== 'confirmado')
        throw new BadRequestException(
          'Solo se reversan movimientos confirmados',
        );
      const signo = -m.signo;
      if (signo < 0) {
        const hay = await this.disponible(c, ct.id);
        if (!(await this.mayorOIgual(c, hay, m.monto))) {
          throw new BadRequestException(
            `No se puede reversar: en ${ct.nombre} hay ${ct.simbolo}${hay}`,
          );
        }
      }
      const fecha = await this.fecha(c, '');
      const n = await c.query<{ id: string }>(
        `INSERT INTO cuenta_movimientos
           (cuenta_id, tipo, signo, monto, tasa, monto_dop, fecha, reverso_de, motivo, usuario_id)
         VALUES ($1, 'reverso', $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          ct.id,
          signo,
          m.monto,
          m.tasa,
          m.monto_dop,
          fecha,
          movimientoId,
          motivo,
          actorId,
        ],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'cuenta.reversar',
        entidad: 'cuentas',
        entidadId: ct.id,
        anterior: { movimiento: movimientoId, tipo: m.tipo, monto: m.monto },
        nuevo: { reverso: n.rows[0].id, signo, monto: m.monto },
        motivo,
        ip,
      });
      return { id: n.rows[0].id };
    });
  }

  // ---------- Confirmar contra el estado de cuenta ----------

  async confirmar(
    actorId: string,
    movimientoId: string,
    ip: string | undefined,
    datos: { resultado?: unknown; fechaBanco?: unknown; motivo?: unknown },
  ) {
    if (!/^\d{1,18}$/.test(movimientoId))
      throw new NotFoundException('Movimiento no encontrado');
    const resultado = texto(datos.resultado);
    if (resultado !== 'confirmado' && resultado !== 'no_llego')
      throw new BadRequestException(
        'Resultado inválido: confirmado o no_llego',
      );
    const motivo =
      resultado === 'no_llego'
        ? motivoObligatorio(datos.motivo)
        : opcional(datos.motivo, 500, 'Nota');
    return this.db.transaccion(async (c) => {
      const m0 = await c.query<{ cuenta_id: string }>(
        'SELECT cuenta_id FROM cuenta_movimientos WHERE id = $1',
        [movimientoId],
      );
      if (m0.rowCount === 0)
        throw new NotFoundException('Movimiento no encontrado');
      const ct = await this.bloquearCuenta(c, m0.rows[0].cuenta_id);
      const r = await c.query<{
        tipo: string;
        monto: string;
        estado: string;
        venta: string | null;
      }>(
        `SELECT x.tipo, x.monto, x.estado,
                CASE WHEN v.numero IS NOT NULL
                     THEN 'V-' || lpad(v.numero::text, 6, '0') END AS venta
         FROM ${SQL_MOVS_CON_ESTADO} x
         LEFT JOIN ventas v ON v.id = x.venta_id
         WHERE x.id = $1`,
        [movimientoId],
      );
      const m = r.rows[0];
      if (m.estado !== 'por_confirmar')
        throw new BadRequestException(
          'Ese movimiento no está pendiente de confirmar',
        );
      const fechaBanco =
        resultado === 'confirmado'
          ? await this.fecha(c, datos.fechaBanco)
          : null;
      await c.query(
        `INSERT INTO cuenta_confirmaciones (movimiento_id, resultado, fecha_banco, motivo, usuario_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [movimientoId, resultado, fechaBanco, motivo, actorId],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion:
          resultado === 'confirmado' ? 'cuenta.confirmar' : 'cuenta.no_llego',
        entidad: 'cuentas',
        entidadId: ct.id,
        nuevo: {
          cuenta: ct.nombre,
          movimiento: movimientoId,
          tipo: m.tipo,
          monto: m.monto,
          venta: m.venta,
          fecha_banco: fechaBanco,
        },
        motivo: motivo ?? undefined,
        ip,
      });
      return { ok: true };
    });
  }

  // ---------- Consultas ----------

  private readonly SQL_LISTA = `SELECT x.id, x.cuenta_id, ct.nombre AS cuenta, ct.moneda, mo.simbolo,
      x.tipo, x.signo, x.monto, x.tasa, x.monto_dop, x.fecha, x.created_at,
      x.estado, x.fecha_banco, x.motivo_confirmacion,
      x.beneficiario, x.comprobante, x.referencia, x.motivo, x.reverso_de,
      cg.nombre AS categoria, u.username AS usuario,
      CASE WHEN v.numero IS NOT NULL THEN 'V-' || lpad(v.numero::text, 6, '0') END AS venta,
      CASE WHEN t.numero IS NOT NULL THEN 'T-' || lpad(t.numero::text, 6, '0') END AS transferencia,
      -- La otra punta de la transferencia (cuenta o caja).
      CASE WHEN x.tipo = 'transferencia_salida'
           THEN COALESCE(cd.nombre, cjd.nombre) ELSE COALESCE(co.nombre, cjo.nombre) END AS contraparte,
      t.monto_sale, t.monto_entra, t.cambiado_por,
      EXISTS (SELECT 1 FROM cuenta_movimientos r WHERE r.reverso_de = x.id) AS reversado,
      CASE WHEN rm.numero IS NOT NULL THEN 'E-' || lpad(rm.numero::text, 6, '0') END AS envio,
      (x.remesa_id IS NOT NULL OR x.remesa_entrega_id IS NOT NULL
        OR x.remesa_pago_id IS NOT NULL OR x.san_recibo_id IS NOT NULL
        OR x.san_entrega_id IS NOT NULL OR x.compra_pago_id IS NOT NULL) AS de_envios
    FROM ${SQL_MOVS_CON_ESTADO} x
    JOIN cuentas ct ON ct.id = x.cuenta_id
    JOIN monedas mo ON mo.codigo = ct.moneda
    JOIN usuarios u ON u.id = x.usuario_id
    LEFT JOIN categorias_gasto cg ON cg.id = x.categoria_gasto_id
    LEFT JOIN ventas v ON v.id = x.venta_id
    LEFT JOIN transferencias t ON t.id = x.transferencia_id
    LEFT JOIN cuentas cd ON cd.id = t.destino_cuenta_id
    LEFT JOIN cuentas co ON co.id = t.origen_cuenta_id
    LEFT JOIN caja_sesiones sd ON sd.id = t.destino_sesion_id
    LEFT JOIN cajas cjd ON cjd.id = sd.caja_id
    LEFT JOIN caja_sesiones so ON so.id = t.origen_sesion_id
    LEFT JOIN cajas cjo ON cjo.id = so.caja_id
    LEFT JOIN remesas rm ON rm.id = x.remesa_id`;

  async movimientos(
    cuentaId: string,
    filtros: {
      desde?: string;
      hasta?: string;
      estado?: string;
      pagina?: string;
    },
  ) {
    if (!UUID.test(cuentaId))
      throw new NotFoundException('Cuenta no encontrada');
    const params: unknown[] = [cuentaId];
    const cond = ['x.cuenta_id = $1'];
    for (const [clave, op] of [
      ['desde', '>='],
      ['hasta', '<='],
    ] as const) {
      const f = texto(filtros[clave]);
      if (!f) continue;
      if (!fechaValida(f))
        throw new BadRequestException('Fecha inválida (use AAAA-MM-DD)');
      params.push(f);
      cond.push(`x.fecha ${op} $${params.length}::date`);
    }
    const estado = texto(filtros.estado) || 'todos';
    if (['confirmado', 'por_confirmar', 'no_llego'].includes(estado)) {
      params.push(estado);
      cond.push(`x.estado = $${params.length}`);
    } else if (estado !== 'todos') {
      throw new BadRequestException('Estado inválido');
    }
    const pagina = Math.max(
      1,
      Number.parseInt(texto(filtros.pagina) || '1', 10) || 1,
    );
    const [filas, total, cuenta] = await Promise.all([
      this.db.query(
        `${this.SQL_LISTA} WHERE ${cond.join(' AND ')}
         ORDER BY x.fecha DESC, x.id DESC
         LIMIT 50 OFFSET $${params.length + 1}`,
        [...params, (pagina - 1) * 50],
      ),
      this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${SQL_MOVS_CON_ESTADO} x WHERE ${cond.join(' AND ')}`,
        params,
      ),
      this.db.query(
        `SELECT ct.id, ct.nombre, ct.entidad, ct.moneda, mo.simbolo, ct.is_active,
                COALESCE(s.confirmado, 0)::numeric(14,2) AS confirmado,
                COALESCE(s.por_confirmar, 0)::numeric(14,2) AS por_confirmar,
                COALESCE(s.disponible, 0)::numeric(14,2) AS disponible
         FROM cuentas ct JOIN monedas mo ON mo.codigo = ct.moneda
         LEFT JOIN (${SQL_SALDOS}) s ON s.cuenta_id = ct.id
         WHERE ct.id = $1`,
        [cuentaId],
      ),
    ]);
    if (cuenta.rowCount === 0)
      throw new NotFoundException('Cuenta no encontrada');
    return {
      cuenta: cuenta.rows[0],
      filas: filas.rows,
      total: total.rows[0].n,
      pagina,
      porPagina: 50,
    };
  }

  // Lo que falta confirmar y lo que "no llegó" y todavía hay que atender
  // (el historial completo queda en los movimientos de cada cuenta).
  async pendientes() {
    const [pend, nollego] = await Promise.all([
      this.db.query(
        `${this.SQL_LISTA} WHERE x.estado = 'por_confirmar' ORDER BY x.fecha, x.id LIMIT 300`,
      ),
      this.db.query(
        `${this.SQL_LISTA} WHERE ${SQL_NO_LLEGO_PENDIENTE} ORDER BY x.confirmado_en DESC LIMIT 100`,
      ),
    ]);
    return { porConfirmar: pend.rows, noLlegaron: nollego.rows };
  }

  // ---------- Transferencias (cuentas, caja, recargas MonCash) ----------

  // Resuelve un lado: una cuenta (bloqueada) o la sesión abierta de una caja.
  private async lado(
    c: PoolClient,
    cuentaId: string,
    cajaId: string,
    que: 'origen' | 'destino',
  ): Promise<Lado> {
    if (cuentaId && cajaId)
      throw new BadRequestException(`Indique un solo ${que}: cuenta o caja`);
    if (cuentaId) {
      const cuenta = await this.bloquearCuenta(c, cuentaId);
      if (!cuenta.is_active)
        throw new BadRequestException(`${cuenta.nombre} está desactivada`);
      return { tipo: 'cuenta', cuenta };
    }
    if (!UUID.test(cajaId))
      throw new BadRequestException(`Indique el ${que}: una cuenta o una caja`);
    const s = await c.query<{ id: string; caja: string; numero: string }>(
      `SELECT s.id, c.nombre AS caja, s.numero
       FROM caja_sesiones s JOIN cajas c ON c.id = s.caja_id
       WHERE s.caja_id = $1 AND s.estado = 'abierta'
       FOR UPDATE OF s`,
      [cajaId],
    );
    if (s.rowCount === 0)
      throw new BadRequestException(
        'La caja no está abierta: ábrala en Caja para mover efectivo',
      );
    return {
      tipo: 'caja',
      sesionId: s.rows[0].id,
      caja: s.rows[0].caja,
      numero: s.rows[0].numero,
    };
  }

  async transferir(
    actorId: string,
    ip: string | undefined,
    datos: DatosTransferencia,
  ) {
    const oCuenta = texto(datos.origenCuentaId).toLowerCase();
    const oCaja = texto(datos.origenCajaId).toLowerCase();
    const dCuenta = texto(datos.destinoCuentaId).toLowerCase();
    const dCaja = texto(datos.destinoCajaId).toLowerCase();
    if (oCaja && dCaja)
      throw new BadRequestException(
        'De caja a caja no es una transferencia de banco',
      );
    if (oCuenta && oCuenta === dCuenta)
      throw new BadRequestException(
        'El origen y el destino son la misma cuenta',
      );
    const montoSale = montoPositivo(datos.montoSale, 'Monto que sale');
    const referencia = opcional(datos.referencia, 60, 'Referencia');
    const motivo = opcional(datos.motivo, 500, 'Motivo');

    return this.db.transaccion(async (c) => {
      // Las cuentas se bloquean siempre en el mismo orden (evita bloqueos cruzados).
      let origen: Lado;
      let destino: Lado;
      if (oCuenta && dCuenta && dCuenta < oCuenta) {
        destino = await this.lado(c, dCuenta, dCaja, 'destino');
        origen = await this.lado(c, oCuenta, oCaja, 'origen');
      } else {
        origen = await this.lado(c, oCuenta, oCaja, 'origen');
        destino = await this.lado(c, dCuenta, dCaja, 'destino');
      }
      const mOrigen = origen.tipo === 'cuenta' ? origen.cuenta.moneda : 'DOP';
      const mDestino =
        destino.tipo === 'cuenta' ? destino.cuenta.moneda : 'DOP';
      const mismaMoneda = mOrigen === mDestino;

      let montoEntra = montoSale;
      let cambiadoPor: string | null = null;
      if (mismaMoneda) {
        const e = texto(datos.montoEntra);
        if (e && normalizarMonto(e) !== montoSale) {
          throw new BadRequestException(
            'En la misma moneda entra lo mismo que sale; registre la comisión como cargo aparte',
          );
        }
      } else {
        montoEntra = montoPositivo(datos.montoEntra, 'Monto que entra');
        cambiadoPor = texto(datos.cambiadoPor);
        if (!CAMBIADO_POR.includes(cambiadoPor)) {
          throw new BadRequestException(
            'Indique quién hizo el cambio de moneda: casa de cambio, agente, banco u otro',
          );
        }
      }
      // Valor en RD$: el lado en pesos manda; si ninguno es en pesos, la tasa.
      let montoDop: string;
      if (mOrigen === 'DOP') montoDop = montoSale;
      else if (mDestino === 'DOP') montoDop = montoEntra;
      else {
        const tasa = normalizarTasa(datos.tasa);
        if (tasa === null) {
          throw new BadRequestException(
            `Escriba la tasa del día: cuántos RD$ vale 1 ${mOrigen}`,
          );
        }
        montoDop = (
          await c.query<{ v: string }>(
            'SELECT round($1::numeric * $2::numeric, 2)::text AS v',
            [montoSale, tasa],
          )
        ).rows[0].v;
      }

      // No sale más de lo que hay.
      if (origen.tipo === 'cuenta') {
        const hay = await this.disponible(c, origen.cuenta.id);
        if (!(await this.mayorOIgual(c, hay, montoSale))) {
          throw new BadRequestException(
            `No hay suficiente dinero en ${origen.cuenta.nombre}: hay ${origen.cuenta.simbolo}${hay}`,
          );
        }
      } else {
        const hay = (
          await c.query<{ esperado: string }>(SQL_ESPERADO, [origen.sesionId])
        ).rows[0].esperado;
        if (!(await this.mayorOIgual(c, hay, montoSale))) {
          throw new BadRequestException(
            `No hay suficiente efectivo en ${origen.caja}: hay RD$${hay}`,
          );
        }
      }

      const fecha = await this.fecha(c, datos.fecha);
      const n = (
        await c.query<{ valor: string }>(
          `UPDATE contadores SET valor = valor + 1 WHERE clave = 'transferencias' RETURNING valor`,
        )
      ).rows[0].valor;
      const t = await c.query<{ id: string }>(
        `INSERT INTO transferencias
           (numero, origen_cuenta_id, origen_sesion_id, destino_cuenta_id, destino_sesion_id,
            monto_sale, monto_entra, monto_dop, cambiado_por, referencia, motivo, usuario_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          n,
          origen.tipo === 'cuenta' ? origen.cuenta.id : null,
          origen.tipo === 'caja' ? origen.sesionId : null,
          destino.tipo === 'cuenta' ? destino.cuenta.id : null,
          destino.tipo === 'caja' ? destino.sesionId : null,
          montoSale,
          montoEntra,
          montoDop,
          cambiadoPor,
          referencia,
          motivo,
          actorId,
        ],
      );
      const tId = t.rows[0].id;

      // Salida.
      if (origen.tipo === 'cuenta') {
        await c.query(
          `INSERT INTO cuenta_movimientos
             (cuenta_id, tipo, signo, monto, tasa, monto_dop, fecha, transferencia_id,
              referencia, motivo, usuario_id)
           VALUES ($1, 'transferencia_salida', -1, $2, round($3::numeric / $2::numeric, 8),
                   $3, $4, $5, $6, $7, $8)`,
          [
            origen.cuenta.id,
            montoSale,
            montoDop,
            fecha,
            tId,
            referencia,
            motivo,
            actorId,
          ],
        );
      } else {
        await c.query(
          `INSERT INTO caja_movimientos (sesion_id, tipo, monto, transferencia_id, motivo, usuario_id)
           VALUES ($1, 'deposito', $2, $3, $4, $5)`,
          [origen.sesionId, montoSale, tId, motivo, actorId],
        );
      }
      // Entrada. El efectivo depositado y lo cambiado de moneda se confirman
      // al verlo en el estado de cuenta.
      if (destino.tipo === 'cuenta') {
        const porConfirmar = origen.tipo === 'caja' || !mismaMoneda;
        await c.query(
          `INSERT INTO cuenta_movimientos
             (cuenta_id, tipo, signo, monto, tasa, monto_dop, fecha, por_confirmar,
              transferencia_id, referencia, motivo, usuario_id)
           VALUES ($1, 'transferencia_entrada', 1, $2, round($3::numeric / $2::numeric, 8),
                   $3, $4, $5, $6, $7, $8, $9)`,
          [
            destino.cuenta.id,
            montoEntra,
            montoDop,
            fecha,
            porConfirmar,
            tId,
            referencia,
            motivo,
            actorId,
          ],
        );
      } else {
        await c.query(
          `INSERT INTO caja_movimientos (sesion_id, tipo, monto, transferencia_id, motivo, usuario_id)
           VALUES ($1, 'desde_cuenta', $2, $3, $4, $5)`,
          [destino.sesionId, montoEntra, tId, motivo, actorId],
        );
      }

      const nombre = (l: Lado) =>
        l.tipo === 'cuenta'
          ? l.cuenta.nombre
          : `${l.caja} (${numeroSesion(l.numero)})`;
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion:
          origen.tipo === 'caja'
            ? 'caja.deposito'
            : destino.tipo === 'caja'
              ? 'caja.desde_cuenta'
              : 'cuenta.transferir',
        entidad: 'transferencias',
        entidadId: tId,
        nuevo: {
          numero: numeroTransferencia(n),
          origen: nombre(origen),
          destino: nombre(destino),
          monto_sale: `${mOrigen} ${montoSale}`,
          monto_entra: `${mDestino} ${montoEntra}`,
          monto_dop: montoDop,
          cambiado_por: cambiadoPor,
          referencia,
          fecha,
        },
        motivo: motivo ?? undefined,
        ip,
      });
      return { id: tId, numero: numeroTransferencia(n), montoDop };
    });
  }
}
