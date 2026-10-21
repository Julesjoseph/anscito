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
import { contabilizar, revertir } from '../contabilidad/motor';
import { hoyLocal } from '../cxc/estado';
import { DatabaseService } from '../database/database.service';
import { normalizarMonto } from '../servicios/calculo-itbis';
import {
  CLAVES_PARAMETROS,
  aCentavos,
  aTexto,
  diasVacaciones,
  montoDias,
  montoExtra,
  regalia,
  sueldoPeriodo,
  valorHora,
} from './calculo';
import type { Frecuencia, Parametros } from './calculo';
import { generarVolantes } from './volante-pdf';

// Nómina (primera parte, sin TSS ni ISR: decisión del dueño, todavía ningún
// empleado está inscrito). Empleados con sueldo mensual y su frecuencia de
// pago; nóminas regulares, de regalía y de vacaciones que se preparan en
// borrador y se pagan desde la caja o una cuenta en pesos; adelantos y
// préstamos que se descuentan por cuotas. Lo pagado se anula, no se borra.

type Consulta = Pick<DatabaseService, 'query'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FRECUENCIAS: Frecuencia[] = ['semanal', 'quincenal', 'mensual'];
const TIPOS = ['regular', 'regalia', 'vacaciones'] as const;
type TipoNomina = (typeof TIPOS)[number];
const NOMBRE_TIPO: Record<TipoNomina, string> = {
  regular: 'Nómina',
  regalia: 'Regalía pascual',
  vacaciones: 'Vacaciones',
};

export const numeroEmpleado = (n: string | number) =>
  `EMP-${String(n).padStart(4, '0')}`;
export const numeroNomina = (n: string | number) =>
  `NOM-${String(n).padStart(6, '0')}`;
export const numeroAdelanto = (n: string | number) =>
  `ADL-${String(n).padStart(6, '0')}`;

function texto(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
}

function opcional(v: unknown, max: number, que: string): string | null {
  const t = texto(v);
  if (!t) return null;
  if (t.length > max)
    throw new BadRequestException(`${que}: máximo ${max} caracteres`);
  return t;
}

function motivoValido(v: unknown, max = 500): string {
  const t = texto(v);
  if (t.length < 5 || t.length > max)
    throw new BadRequestException(`Escriba el motivo (5 a ${max} caracteres)`);
  return t;
}

function fechaValida(v: unknown, que: string): string {
  const t = texto(v);
  const d = new Date(`${t}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(t) ||
    isNaN(d.getTime()) ||
    d.toISOString().slice(0, 10) !== t
  )
    throw new BadRequestException(`${que}: fecha inválida (AAAA-MM-DD)`);
  return t;
}

// Monto con hasta 2 decimales (cero permitido si "cero").
function montoValido(v: unknown, que: string, cero = true): string {
  const t = texto(v) === '' ? '0' : v;
  const m = normalizarMonto(t);
  if (m === null || (!cero && m === '0.00'))
    throw new BadRequestException(
      `${que}: monto inválido${cero ? '' : ', mayor que 0'} (hasta 2 decimales)`,
    );
  return m;
}

function horasValidas(v: unknown, que: string): string {
  const t = texto(v) === '' ? '0' : texto(v);
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t))
    throw new BadRequestException(
      `${que}: número de horas inválido (hasta 999, con 2 decimales)`,
    );
  return t;
}

const SQL_SALDO_ADELANTO = `(a.monto - COALESCE((
    SELECT sum(d.monto) FROM adelanto_descuentos d
    JOIN nomina_lineas l ON l.id = d.nomina_linea_id
    JOIN nominas n ON n.id = l.nomina_id
    WHERE d.adelanto_id = a.id AND n.estado = 'pagada'), 0))::numeric(14,2)`;

type Linea = {
  id: string;
  empleado_id: string;
  sueldo_mensual: string;
  forma_pago: string;
  dias: string | null;
  sueldo: string;
  horas_extra: string;
  horas_extra_alto: string;
  monto_extra: string;
  comisiones: string;
  bonos: string;
  adelantos: string;
  otros_descuentos: string;
  motivo_descuento: string | null;
  neto: string;
  notas: string | null;
};

type Cabecera = {
  id: string;
  numero: string;
  tipo: TipoNomina;
  frecuencia: Frecuencia | null;
  desde: string;
  hasta: string;
  estado: string;
  total: string;
};

@Injectable()
export class NominaService {
  constructor(private readonly db: DatabaseService) {}

  // ---------- Valores de ley ----------

  // Valores vigentes a la fecha (el último con vigencia ≤ fecha).
  private async parametros(c: Consulta, fecha: string): Promise<Parametros> {
    const r = await c.query<{ clave: keyof Parametros; valor: string }>(
      `SELECT DISTINCT ON (clave) clave, valor::text AS valor FROM nomina_parametros
       WHERE vigente_desde <= $1 ORDER BY clave, vigente_desde DESC`,
      [fecha],
    );
    const p = Object.fromEntries(r.rows.map((x) => [x.clave, x.valor]));
    const falta = CLAVES_PARAMETROS.find((k) => !p[k]);
    if (falta)
      throw new BadRequestException(
        `Falta el valor de ley "${falta}" vigente al ${fecha}`,
      );
    return p as Parametros;
  }

  async listarParametros() {
    const hoy = await hoyLocal(this.db);
    const [vigentes, historial] = await Promise.all([
      this.parametros(this.db, hoy),
      this.db.query(
        `SELECT p.clave, p.valor::text AS valor, to_char(p.vigente_desde, 'YYYY-MM-DD') AS vigente_desde,
                p.motivo, u.nombre AS usuario, p.created_at
         FROM nomina_parametros p LEFT JOIN usuarios u ON u.id = p.created_by
         ORDER BY p.clave, p.vigente_desde DESC`,
      ),
    ]);
    return { hoy, vigentes, historial: historial.rows };
  }

  async nuevoParametro(
    actorId: string,
    ip: string | undefined,
    datos: Record<string, unknown>,
  ) {
    const clave = texto(datos.clave) as keyof Parametros;
    if (!CLAVES_PARAMETROS.includes(clave))
      throw new BadRequestException('Valor de ley desconocido');
    const valor = texto(datos.valor);
    if (!/^\d{1,6}(\.\d{1,4})?$/.test(valor) || Number(valor) <= 0)
      throw new BadRequestException(
        'Valor inválido: mayor que 0, hasta 4 decimales',
      );
    const desde = fechaValida(datos.vigenteDesde, 'Vigente desde');
    const motivo = motivoValido(datos.motivo, 300);
    return this.db.transaccion(async (c) => {
      const antes = await this.parametros(c, desde).catch(() => null);
      try {
        await c.query(
          `INSERT INTO nomina_parametros (clave, valor, vigente_desde, motivo, created_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [clave, valor, desde, motivo, actorId],
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          throw new ConflictException(
            'Ya hay un valor para esa fecha: use otra fecha de vigencia',
          );
        throw e;
      }
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'nomina.parametro',
        entidad: 'nomina_parametros',
        entidadId: clave,
        anterior: antes ? { valor: antes[clave] } : undefined,
        nuevo: { valor, vigente_desde: desde },
        motivo,
        ip,
      });
      return { clave, valor, vigenteDesde: desde };
    });
  }

  // ---------- Lo que necesita la pantalla ----------

  async preparar() {
    const hoy = await hoyLocal(this.db);
    const [cajas, cuentas, frecuencias, parametros] = await Promise.all([
      this.db.query(
        `SELECT c.id, c.nombre, s.id AS sesion_id FROM cajas c
         LEFT JOIN caja_sesiones s ON s.caja_id = c.id AND s.estado = 'abierta'
         WHERE c.is_active ORDER BY lower(c.nombre)`,
      ),
      this.db.query(
        `SELECT id, nombre FROM cuentas WHERE is_active AND moneda = 'DOP' ORDER BY lower(nombre)`,
      ),
      this.db.query(
        `SELECT frecuencia, count(*)::int AS empleados FROM empleados WHERE is_active GROUP BY frecuencia`,
      ),
      this.parametros(this.db, hoy),
    ]);
    return {
      hoy,
      cajas: cajas.rows,
      cuentas: cuentas.rows,
      empleadosPorFrecuencia: frecuencias.rows,
      parametros,
    };
  }

  // ---------- Empleados ----------

  async listarEmpleados(f: { texto?: unknown; estado?: unknown }) {
    const params: unknown[] = [];
    const cond: string[] = [];
    const estado = texto(f.estado) || 'activos';
    if (estado === 'activos') cond.push('e.is_active');
    else if (estado === 'inactivos') cond.push('NOT e.is_active');
    else if (estado !== 'todos')
      throw new BadRequestException('Estado inválido');
    const buscar = texto(f.texto);
    if (buscar) {
      params.push(`%${buscar.replace(/[%_\\]/g, '')}%`);
      const digitos = buscar.replace(/\D/g, '');
      params.push(digitos ? `%${digitos}%` : '');
      cond.push(
        `(e.nombre ILIKE $1 OR e.cargo ILIKE $1 OR 'EMP-' || lpad(e.numero::text, 4, '0') ILIKE $1
          OR ($2 <> '' AND (regexp_replace(coalesce(e.telefono, ''), '\\D', '', 'g') LIKE $2
                            OR regexp_replace(coalesce(e.documento, ''), '\\D', '', 'g') LIKE $2)))`,
      );
    }
    const r = await this.db.query(
      `SELECT e.id, e.numero, e.nombre, e.documento, e.telefono, e.direccion, e.cargo,
              to_char(e.fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso, e.frecuencia, e.sueldo_mensual,
              e.forma_pago, e.cuenta_empleado, e.en_tss, e.notas, e.is_active,
              to_char(e.fecha_salida, 'YYYY-MM-DD') AS fecha_salida,
              COALESCE((SELECT sum(${SQL_SALDO_ADELANTO}) FROM empleado_adelantos a
                        WHERE a.empleado_id = e.id AND a.estado = 'activo'), 0)::numeric(14,2) AS debe
       FROM empleados e
       ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
       ORDER BY e.is_active DESC, lower(e.nombre)`,
      params,
    );
    return r.rows.map((x: { numero: string }) => ({
      ...x,
      codigo: numeroEmpleado(x.numero),
    }));
  }

  private datosEmpleado(d: Record<string, unknown>) {
    const nombre = texto(d.nombre).replace(/\s+/g, ' ');
    if (nombre.length < 3 || nombre.length > 120)
      throw new BadRequestException('Nombre: de 3 a 120 caracteres');
    const frecuencia = texto(d.frecuencia) as Frecuencia;
    if (!FRECUENCIAS.includes(frecuencia))
      throw new BadRequestException(
        'Frecuencia de pago: semanal, quincenal o mensual',
      );
    const forma = texto(d.formaPago) || 'efectivo';
    if (forma !== 'efectivo' && forma !== 'banco')
      throw new BadRequestException('Forma de pago: efectivo o banco');
    const cuenta = opcional(d.cuentaEmpleado, 120, 'Cuenta del empleado');
    if (forma === 'banco' && !cuenta)
      throw new BadRequestException(
        'Escriba el banco y la cuenta del empleado para transferirle',
      );
    return {
      nombre,
      documento: opcional(d.documento, 30, 'Documento'),
      telefono: opcional(d.telefono, 30, 'Teléfono'),
      direccion: opcional(d.direccion, 300, 'Dirección'),
      cargo: opcional(d.cargo, 80, 'Cargo'),
      fecha_ingreso: fechaValida(d.fechaIngreso, 'Fecha de ingreso'),
      frecuencia,
      sueldo_mensual: montoValido(d.sueldoMensual, 'Sueldo mensual', false),
      forma_pago: forma,
      cuenta_empleado: cuenta,
      notas: opcional(d.notas, 500, 'Notas'),
    };
  }

  // Para la auditoría: sin los datos personales (solo si cambiaron).
  private paraAuditoria(x: Record<string, unknown>) {
    const r: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) {
      if (['documento', 'telefono', 'direccion', 'cuenta_empleado'].includes(k))
        r[k] = v ? '(dato personal)' : null;
      else r[k] = v;
    }
    return r;
  }

  private duplicado(e: unknown): never {
    if ((e as { code?: string }).code === '23505')
      throw new ConflictException('Ya hay un empleado con ese documento');
    throw e;
  }

  async crearEmpleado(
    actorId: string,
    ip: string | undefined,
    datos: Record<string, unknown>,
  ) {
    const d = this.datosEmpleado(datos);
    return this.db.transaccion(async (c) => {
      const n = (
        await c.query<{ valor: string }>(
          `UPDATE contadores SET valor = valor + 1 WHERE clave = 'empleados' RETURNING valor`,
        )
      ).rows[0].valor;
      const r = await c
        .query<{ id: string }>(
          `INSERT INTO empleados (numero, nombre, documento, telefono, direccion, cargo, fecha_ingreso,
                                  frecuencia, sueldo_mensual, forma_pago, cuenta_empleado, notas, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
          [
            n,
            d.nombre,
            d.documento,
            d.telefono,
            d.direccion,
            d.cargo,
            d.fecha_ingreso,
            d.frecuencia,
            d.sueldo_mensual,
            d.forma_pago,
            d.cuenta_empleado,
            d.notas,
            actorId,
          ],
        )
        .catch((e) => this.duplicado(e));
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'empleado.crear',
        entidad: 'empleados',
        entidadId: r.rows[0].id,
        nuevo: { codigo: numeroEmpleado(n), ...this.paraAuditoria(d) },
        ip,
      });
      return { id: r.rows[0].id, codigo: numeroEmpleado(n) };
    });
  }

  async editarEmpleado(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: Record<string, unknown>,
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Empleado no encontrado');
    const d = this.datosEmpleado(datos);
    return this.db.transaccion(async (c) => {
      const r = await c.query<Record<string, unknown>>(
        `SELECT nombre, documento, telefono, direccion, cargo,
                to_char(fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso, frecuencia,
                sueldo_mensual, forma_pago, cuenta_empleado, notas
         FROM empleados WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (r.rowCount === 0)
        throw new NotFoundException('Empleado no encontrado');
      const antes = r.rows[0];
      const cambios = Object.keys(d).filter(
        (k) => String(antes[k] ?? '') !== String(d[k as keyof typeof d] ?? ''),
      );
      if (cambios.length === 0) return { id, cambios: 0 };
      await c
        .query(
          `UPDATE empleados SET nombre = $2, documento = $3, telefono = $4, direccion = $5, cargo = $6,
                  fecha_ingreso = $7, frecuencia = $8, sueldo_mensual = $9, forma_pago = $10,
                  cuenta_empleado = $11, notas = $12, updated_at = now()
           WHERE id = $1`,
          [
            id,
            d.nombre,
            d.documento,
            d.telefono,
            d.direccion,
            d.cargo,
            d.fecha_ingreso,
            d.frecuencia,
            d.sueldo_mensual,
            d.forma_pago,
            d.cuenta_empleado,
            d.notas,
          ],
        )
        .catch((e) => this.duplicado(e));
      const elegir = (x: Record<string, unknown>) =>
        Object.fromEntries(cambios.map((k) => [k, x[k]]));
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'empleado.editar',
        entidad: 'empleados',
        entidadId: id,
        anterior: this.paraAuditoria(elegir(antes)),
        nuevo: this.paraAuditoria(elegir(d)),
        ip,
      });
      return { id, cambios: cambios.length };
    });
  }

  async estadoEmpleado(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: Record<string, unknown>,
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Empleado no encontrado');
    const activar = datos.activo === true;
    const motivo = motivoValido(datos.motivo);
    return this.db.transaccion(async (c) => {
      const r = await c.query<{
        nombre: string;
        is_active: boolean;
        fecha_ingreso: string;
      }>(
        `SELECT nombre, is_active, to_char(fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso
         FROM empleados WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (r.rowCount === 0)
        throw new NotFoundException('Empleado no encontrado');
      const e = r.rows[0];
      if (e.is_active === activar)
        throw new BadRequestException(
          activar
            ? 'El empleado ya está activo'
            : 'El empleado ya está inactivo',
        );
      let salida: string | null = null;
      if (!activar) {
        salida = fechaValida(datos.fechaSalida, 'Fecha de salida');
        if (salida < e.fecha_ingreso)
          throw new BadRequestException(
            'La fecha de salida es anterior a la de ingreso',
          );
        const borrador = await c.query<{ numero: string }>(
          `SELECT n.numero FROM nomina_lineas l JOIN nominas n ON n.id = l.nomina_id
           WHERE l.empleado_id = $1 AND n.estado = 'borrador' LIMIT 1`,
          [id],
        );
        if (borrador.rowCount)
          throw new BadRequestException(
            `Está en la nómina ${numeroNomina(borrador.rows[0].numero)} sin pagar: páguela o quítelo de ella primero`,
          );
      }
      await c.query(
        `UPDATE empleados SET is_active = $2, fecha_salida = $3, updated_at = now() WHERE id = $1`,
        [id, activar, salida],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: activar ? 'empleado.activar' : 'empleado.desactivar',
        entidad: 'empleados',
        entidadId: id,
        anterior: { activo: e.is_active },
        nuevo: { activo: activar, fecha_salida: salida },
        motivo,
        ip,
      });
      return { id, activo: activar };
    });
  }

  // ---------- Origen del dinero ----------

  private async desdeCaja(c: PoolClient, cajaId: unknown, monto: bigint) {
    const id = texto(cajaId).toLowerCase();
    if (!UUID.test(id))
      throw new BadRequestException('Seleccione la caja (debe estar abierta)');
    const s = await c.query<{ id: string; caja: string }>(
      `SELECT s.id, c.nombre AS caja FROM caja_sesiones s JOIN cajas c ON c.id = s.caja_id
       WHERE s.caja_id = $1 AND s.estado = 'abierta' FOR UPDATE OF s`,
      [id],
    );
    if (s.rowCount === 0)
      throw new BadRequestException('La caja no está abierta: ábrala en Caja');
    if (monto > 0n) {
      const hay = (
        await c.query<{ esperado: string }>(SQL_ESPERADO, [s.rows[0].id])
      ).rows[0].esperado;
      if (aCentavos(hay) < monto)
        throw new BadRequestException(
          `No hay suficiente efectivo en ${s.rows[0].caja}: hay RD$${hay} y se necesitan RD$${aTexto(monto)}`,
        );
    }
    return { sesionId: s.rows[0].id, nombre: s.rows[0].caja };
  }

  private async desdeCuenta(c: PoolClient, cuentaId: unknown, monto: bigint) {
    const id = texto(cuentaId).toLowerCase();
    if (!UUID.test(id)) throw new BadRequestException('Seleccione la cuenta');
    const ct = await c.query<{ nombre: string }>(
      `SELECT nombre FROM cuentas WHERE id = $1 AND is_active AND moneda = 'DOP' FOR UPDATE`,
      [id],
    );
    if (ct.rowCount === 0)
      throw new BadRequestException(
        'La cuenta no existe, está desactivada o no es en pesos',
      );
    const hay = (await c.query<{ disponible: string }>(SQL_DISPONIBLE, [id]))
      .rows[0].disponible;
    if (aCentavos(hay) < monto)
      throw new BadRequestException(
        `No hay suficiente dinero en ${ct.rows[0].nombre}: hay RD$${hay} y se necesitan RD$${aTexto(monto)}`,
      );
    return { cuentaId: id, nombre: ct.rows[0].nombre };
  }

  // ---------- Adelantos y préstamos ----------

  async listarAdelantos(f: { empleadoId?: unknown; estado?: unknown }) {
    const params: unknown[] = [];
    const cond: string[] = [];
    const emp = texto(f.empleadoId).toLowerCase();
    if (emp) {
      if (!UUID.test(emp)) throw new BadRequestException('Empleado inválido');
      params.push(emp);
      cond.push(`a.empleado_id = $${params.length}`);
    }
    const estado = texto(f.estado) || 'pendientes';
    if (estado === 'pendientes')
      cond.push(`a.estado = 'activo' AND ${SQL_SALDO_ADELANTO} > 0`);
    else if (estado !== 'todos')
      throw new BadRequestException('Estado inválido');
    const r = await this.db.query(
      `SELECT a.id, a.numero, a.empleado_id, e.nombre AS empleado, e.numero AS numero_empleado,
              to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.monto, a.cuota, a.forma, a.motivo, a.estado,
              a.motivo_anulacion, ${SQL_SALDO_ADELANTO} AS saldo, u.nombre AS usuario
       FROM empleado_adelantos a JOIN empleados e ON e.id = a.empleado_id
       JOIN usuarios u ON u.id = a.created_by
       ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
       ORDER BY a.fecha DESC, a.numero DESC LIMIT 500`,
      params,
    );
    return r.rows.map((x: { numero: string; numero_empleado: string }) => ({
      ...x,
      codigo: numeroAdelanto(x.numero),
      codigo_empleado: numeroEmpleado(x.numero_empleado),
    }));
  }

  async darAdelanto(
    actorId: string,
    ip: string | undefined,
    datos: Record<string, unknown>,
  ) {
    const empleadoId = texto(datos.empleadoId).toLowerCase();
    if (!UUID.test(empleadoId))
      throw new BadRequestException('Seleccione el empleado');
    const monto = montoValido(datos.monto, 'Monto', false);
    const cuota = montoValido(datos.cuota, 'Cuota', false);
    if (aCentavos(cuota) > aCentavos(monto))
      throw new BadRequestException('La cuota no puede pasar del monto');
    const forma = texto(datos.forma);
    if (forma !== 'efectivo' && forma !== 'banco')
      throw new BadRequestException('Forma de pago: efectivo o banco');
    const motivo = motivoValido(datos.motivo, 300);
    return this.db.transaccion(async (c) => {
      const e = await c.query<{ nombre: string; numero: string }>(
        `SELECT nombre, numero FROM empleados WHERE id = $1 AND is_active FOR UPDATE`,
        [empleadoId],
      );
      if (e.rowCount === 0)
        throw new BadRequestException('El empleado no existe o está inactivo');
      const emp = e.rows[0];
      const origen =
        forma === 'efectivo'
          ? await this.desdeCaja(c, datos.cajaId, aCentavos(monto))
          : await this.desdeCuenta(c, datos.cuentaId, aCentavos(monto));
      const hoy = await hoyLocal(c);
      const n = (
        await c.query<{ valor: string }>(
          `UPDATE contadores SET valor = valor + 1 WHERE clave = 'adelantos' RETURNING valor`,
        )
      ).rows[0].valor;
      const codigo = numeroAdelanto(n);
      const a = await c.query<{ id: string }>(
        `INSERT INTO empleado_adelantos (numero, empleado_id, fecha, monto, cuota, forma, motivo, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [n, empleadoId, hoy, monto, cuota, forma, motivo, actorId],
      );
      const id = a.rows[0].id;
      const detalle = `${codigo} ${emp.nombre}: ${motivo}`.slice(0, 300);
      if ('sesionId' in origen)
        await c.query(
          `INSERT INTO caja_movimientos (sesion_id, tipo, monto, adelanto_id, motivo, usuario_id)
           VALUES ($1, 'nomina', $2, $3, $4, $5)`,
          [origen.sesionId, monto, id, detalle, actorId],
        );
      else
        await c.query(
          `INSERT INTO cuenta_movimientos
             (cuenta_id, tipo, signo, monto, tasa, monto_dop, fecha, beneficiario, comprobante, motivo,
              adelanto_id, usuario_id)
           VALUES ($1, 'nomina', -1, $2, 1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            origen.cuentaId,
            monto,
            hoy,
            emp.nombre.slice(0, 120),
            codigo,
            detalle,
            id,
            actorId,
          ],
        );
      await contabilizar(c, 'adelanto', id, actorId);
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'adelanto.dar',
        entidad: 'empleado_adelantos',
        entidadId: id,
        nuevo: {
          adelanto: codigo,
          empleado: emp.nombre,
          monto,
          cuota,
          forma,
          origen: origen.nombre,
        },
        motivo,
        ip,
      });
      return { id, codigo };
    });
  }

  async cambiarCuota(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: Record<string, unknown>,
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Adelanto no encontrado');
    const cuota = montoValido(datos.cuota, 'Cuota', false);
    return this.db.transaccion(async (c) => {
      const r = await c.query<{
        numero: string;
        monto: string;
        cuota: string;
        estado: string;
      }>(
        'SELECT numero, monto, cuota, estado FROM empleado_adelantos WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (r.rowCount === 0)
        throw new NotFoundException('Adelanto no encontrado');
      const a = r.rows[0];
      if (a.estado !== 'activo')
        throw new BadRequestException('El adelanto está anulado');
      if (aCentavos(cuota) > aCentavos(a.monto))
        throw new BadRequestException('La cuota no puede pasar del monto');
      await c.query('UPDATE empleado_adelantos SET cuota = $2 WHERE id = $1', [
        id,
        cuota,
      ]);
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'adelanto.cuota',
        entidad: 'empleado_adelantos',
        entidadId: id,
        anterior: { cuota: a.cuota },
        nuevo: { adelanto: numeroAdelanto(a.numero), cuota },
        ip,
      });
      return { id, cuota };
    });
  }

  async anularAdelanto(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: Record<string, unknown>,
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Adelanto no encontrado');
    const motivo = motivoValido(datos.motivo);
    return this.db.transaccion(async (c) => {
      const r = await c.query<{
        numero: string;
        monto: string;
        forma: string;
        estado: string;
        empleado: string;
      }>(
        `SELECT a.numero, a.monto, a.forma, a.estado, e.nombre AS empleado
         FROM empleado_adelantos a JOIN empleados e ON e.id = a.empleado_id
         WHERE a.id = $1 FOR UPDATE OF a`,
        [id],
      );
      if (r.rowCount === 0)
        throw new NotFoundException('Adelanto no encontrado');
      const a = r.rows[0];
      const codigo = numeroAdelanto(a.numero);
      if (a.estado !== 'activo')
        throw new BadRequestException('El adelanto ya está anulado');
      const descontado = await c.query<{ numero: string }>(
        `SELECT n.numero FROM adelanto_descuentos d JOIN nomina_lineas l ON l.id = d.nomina_linea_id
         JOIN nominas n ON n.id = l.nomina_id WHERE d.adelanto_id = $1 AND n.estado = 'pagada' LIMIT 1`,
        [id],
      );
      if (descontado.rowCount)
        throw new BadRequestException(
          `Ya se descontó en la nómina ${numeroNomina(descontado.rows[0].numero)}: no se puede anular`,
        );
      const hoy = await hoyLocal(c);
      const detalle = `Anulación de ${codigo}: ${motivo}`.slice(0, 300);
      let destino: string;
      if (a.forma === 'efectivo') {
        const caja = await this.desdeCaja(c, datos.cajaId, 0n);
        destino = caja.nombre;
        await c.query(
          `INSERT INTO caja_movimientos (sesion_id, tipo, monto, adelanto_id, motivo, usuario_id)
           VALUES ($1, 'nomina_reverso', $2, $3, $4, $5)`,
          [caja.sesionId, a.monto, id, detalle, actorId],
        );
      } else {
        const m = await c.query<{
          id: string;
          cuenta_id: string;
          nombre: string;
        }>(
          `SELECT m.id::text AS id, m.cuenta_id, ct.nombre FROM cuenta_movimientos m
           JOIN cuentas ct ON ct.id = m.cuenta_id
           WHERE m.adelanto_id = $1 AND m.tipo = 'nomina'`,
          [id],
        );
        if (m.rowCount === 0)
          throw new BadRequestException(
            'No se encontró el movimiento de la cuenta de este adelanto',
          );
        const x = m.rows[0];
        destino = x.nombre;
        await c.query('SELECT id FROM cuentas WHERE id = $1 FOR UPDATE', [
          x.cuenta_id,
        ]);
        await c.query(
          `INSERT INTO cuenta_movimientos
             (cuenta_id, tipo, signo, monto, tasa, monto_dop, fecha, motivo, reverso_de, adelanto_id, usuario_id)
           VALUES ($1, 'reverso', 1, $2, 1, $2, $3, $4, $5, $6, $7)`,
          [x.cuenta_id, a.monto, hoy, detalle, x.id, id, actorId],
        );
      }
      await c.query(
        `UPDATE empleado_adelantos SET estado = 'anulado', anulado_por = $2, anulado_en = now(),
                motivo_anulacion = $3 WHERE id = $1`,
        [id, actorId, motivo],
      );
      await revertir(c, 'adelanto', id, motivo, actorId);
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'adelanto.anular',
        entidad: 'empleado_adelantos',
        entidadId: id,
        anterior: { adelanto: codigo, empleado: a.empleado, estado: 'activo' },
        nuevo: { estado: 'anulado', devuelto_a: destino, monto: a.monto },
        motivo,
        ip,
      });
      return { id, codigo };
    });
  }

  // ---------- Nóminas ----------

  async listarNominas(f: { estado?: unknown; pagina?: unknown }) {
    const estado = texto(f.estado);
    const params: unknown[] = [];
    let cond = '';
    if (estado) {
      if (!['borrador', 'pagada', 'anulada', 'descartada'].includes(estado))
        throw new BadRequestException('Estado inválido');
      params.push(estado);
      cond = 'WHERE n.estado = $1';
    }
    const pagina = Math.max(
      1,
      Number.parseInt(texto(f.pagina) || '1', 10) || 1,
    );
    const r = await this.db.query(
      `SELECT n.id, n.numero, n.tipo, n.frecuencia, to_char(n.desde, 'YYYY-MM-DD') AS desde,
              to_char(n.hasta, 'YYYY-MM-DD') AS hasta, n.estado, n.total,
              to_char(n.fecha_pago, 'YYYY-MM-DD') AS fecha_pago, n.notas,
              (SELECT count(*)::int FROM nomina_lineas l WHERE l.nomina_id = n.id) AS empleados,
              count(*) OVER ()::int AS total_filas
       FROM nominas n ${cond}
       ORDER BY n.numero DESC LIMIT 30 OFFSET $${params.length + 1}`,
      [...params, (pagina - 1) * 30],
    );
    return {
      filas: r.rows.map(
        ({ total_filas: _t, ...x }: Record<string, unknown>) => ({
          ...x,
          codigo: numeroNomina(x.numero as string),
        }),
      ),
      total: (r.rows[0]?.total_filas as number | undefined) ?? 0,
      pagina,
      porPagina: 30,
    };
  }

  async detalleNomina(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Nómina no encontrada');
    const n = await this.db.query(
      `SELECT n.id, n.numero, n.tipo, n.frecuencia, to_char(n.desde, 'YYYY-MM-DD') AS desde,
              to_char(n.hasta, 'YYYY-MM-DD') AS hasta, n.estado, n.total, n.notas,
              to_char(n.fecha_pago, 'YYYY-MM-DD') AS fecha_pago, n.motivo_anulacion,
              uc.nombre AS creada_por, up.nombre AS pagada_por, ua.nombre AS anulada_por,
              n.created_at, n.pagada_en, n.anulada_en
       FROM nominas n JOIN usuarios uc ON uc.id = n.created_by
       LEFT JOIN usuarios up ON up.id = n.pagada_por
       LEFT JOIN usuarios ua ON ua.id = n.anulada_por
       WHERE n.id = $1`,
      [id],
    );
    if (n.rowCount === 0) throw new NotFoundException('Nómina no encontrada');
    const cab = n.rows[0] as Cabecera & Record<string, unknown>;
    const p = await this.parametros(this.db, cab.hasta);
    const l = await this.db.query<
      Linea & {
        nombre: string;
        numero: string;
        cargo: string | null;
        debe: string;
      }
    >(
      `SELECT l.*, e.nombre, e.numero, e.cargo,
              COALESCE((SELECT sum(${SQL_SALDO_ADELANTO}) FROM empleado_adelantos a
                        WHERE a.empleado_id = e.id AND a.estado = 'activo'), 0)::numeric(14,2) AS debe
       FROM nomina_lineas l JOIN empleados e ON e.id = l.empleado_id
       WHERE l.nomina_id = $1 ORDER BY lower(e.nombre)`,
      [id],
    );
    const lineas = l.rows.map((x) => ({
      id: x.id,
      empleadoId: x.empleado_id,
      codigo: numeroEmpleado(x.numero),
      nombre: x.nombre,
      cargo: x.cargo,
      sueldoMensual: x.sueldo_mensual,
      valorHora: valorHora(x.sueldo_mensual, p),
      formaPago: x.forma_pago,
      dias: x.dias,
      sueldo: x.sueldo,
      horasExtra: x.horas_extra,
      horasExtraAlto: x.horas_extra_alto,
      montoExtra: x.monto_extra,
      comisiones: x.comisiones,
      bonos: x.bonos,
      adelantos: x.adelantos,
      otrosDescuentos: x.otros_descuentos,
      motivoDescuento: x.motivo_descuento,
      neto: x.neto,
      notas: x.notas,
      debe: x.debe,
    }));
    const suma = (f: (x: (typeof lineas)[number]) => string) =>
      aTexto(lineas.reduce((a, x) => a + aCentavos(f(x)), 0n));
    return {
      ...cab,
      codigo: numeroNomina(cab.numero),
      nombreTipo: NOMBRE_TIPO[cab.tipo],
      lineas,
      totales: {
        sueldo: suma((x) => x.sueldo),
        extra: suma((x) => x.montoExtra),
        comisiones: suma((x) => x.comisiones),
        bonos: suma((x) => x.bonos),
        adelantos: suma((x) => x.adelantos),
        otrosDescuentos: suma((x) => x.otrosDescuentos),
        neto: suma((x) => x.neto),
        efectivo: suma((x) => (x.formaPago === 'efectivo' ? x.neto : '0')),
        banco: suma((x) => (x.formaPago === 'banco' ? x.neto : '0')),
      },
    };
  }

  // Lo que el empleado debe de adelantos y la suma de sus cuotas.
  private async deudaAdelantos(c: Consulta, empleadoId: string) {
    const r = await c.query<{ debe: string; cuotas: string }>(
      `SELECT COALESCE(sum(x.saldo), 0)::numeric(14,2) AS debe,
              COALESCE(sum(LEAST(x.cuota, x.saldo)), 0)::numeric(14,2) AS cuotas
       FROM (SELECT a.cuota, ${SQL_SALDO_ADELANTO} AS saldo FROM empleado_adelantos a
             WHERE a.empleado_id = $1 AND a.estado = 'activo') x
       WHERE x.saldo > 0`,
      [empleadoId],
    );
    return {
      debe: aCentavos(r.rows[0].debe),
      cuotas: aCentavos(r.rows[0].cuotas),
    };
  }

  // Línea nueva de un empleado en un borrador, con lo calculado.
  private async lineaNueva(
    c: PoolClient,
    cab: { id: string; tipo: TipoNomina; desde: string; hasta: string },
    e: {
      id: string;
      sueldo_mensual: string;
      frecuencia: Frecuencia;
      forma_pago: string;
      fecha_ingreso: string;
    },
    p: Parametros,
    actorId: string,
  ) {
    let sueldo: string;
    let dias: string | null = null;
    if (cab.tipo === 'regular')
      sueldo = sueldoPeriodo(e.sueldo_mensual, e.frecuencia, p);
    else if (cab.tipo === 'regalia')
      sueldo = regalia(
        e.sueldo_mensual,
        e.fecha_ingreso,
        Number(cab.hasta.slice(0, 4)),
        // Todo el año (se paga antes del 20 de diciembre por el año completo).
        `${cab.hasta.slice(0, 4)}-12-31`,
      );
    else {
      dias = diasVacaciones(e.fecha_ingreso, cab.desde, p);
      sueldo = montoDias(e.sueldo_mensual, dias, p);
    }
    // En la nómina regular se propone descontar las cuotas de sus adelantos
    // (sin pasar de lo que gana). La regalía y las vacaciones van completas.
    let adelantos = 0n;
    if (cab.tipo === 'regular') {
      const d = await this.deudaAdelantos(c, e.id);
      adelantos = d.cuotas < aCentavos(sueldo) ? d.cuotas : aCentavos(sueldo);
    }
    const neto = aCentavos(sueldo) - adelantos;
    await c.query(
      `INSERT INTO nomina_lineas (nomina_id, empleado_id, sueldo_mensual, forma_pago, dias, sueldo,
                                  adelantos, neto, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        cab.id,
        e.id,
        e.sueldo_mensual,
        e.forma_pago,
        dias,
        sueldo,
        aTexto(adelantos),
        aTexto(neto),
        actorId,
      ],
    );
  }

  // Un empleado no puede estar en dos nóminas regulares del mismo período,
  // ni en dos de regalía del mismo año.
  private async revisarCruces(
    c: PoolClient,
    tipo: TipoNomina,
    desde: string,
    hasta: string,
    empleadoIds: string[],
    sinNomina?: string,
  ) {
    if (tipo === 'vacaciones' || !empleadoIds.length) return;
    const r = await c.query<{ nombre: string; numero: string }>(
      `SELECT e.nombre, n.numero FROM nomina_lineas l
       JOIN nominas n ON n.id = l.nomina_id JOIN empleados e ON e.id = l.empleado_id
       WHERE l.empleado_id = ANY($1::uuid[]) AND n.tipo = $2
         AND n.estado IN ('borrador', 'pagada') AND n.id IS DISTINCT FROM $5::uuid
         AND (CASE WHEN $2 = 'regalia'
                   THEN extract(year FROM n.hasta) = extract(year FROM $4::date)
                   ELSE n.desde <= $4::date AND n.hasta >= $3::date END)
       ORDER BY lower(e.nombre) LIMIT 5`,
      [empleadoIds, tipo, desde, hasta, sinNomina ?? null],
    );
    if (r.rowCount)
      throw new ConflictException(
        `Ya ${r.rowCount === 1 ? 'está' : 'están'} en otra nómina de ${tipo === 'regalia' ? 'regalía de ese año' : 'ese período'}: ${r.rows
          .map((x) => `${x.nombre} (${numeroNomina(x.numero)})`)
          .join(', ')}`,
      );
  }

  async crearNomina(
    actorId: string,
    ip: string | undefined,
    datos: Record<string, unknown>,
  ) {
    const tipo = texto(datos.tipo) as TipoNomina;
    if (!TIPOS.includes(tipo))
      throw new BadRequestException(
        'Tipo de nómina: regular, regalía o vacaciones',
      );
    let frecuencia: Frecuencia | null = null;
    if (tipo === 'regular') {
      frecuencia = texto(datos.frecuencia) as Frecuencia;
      if (!FRECUENCIAS.includes(frecuencia))
        throw new BadRequestException(
          'Frecuencia: semanal, quincenal o mensual',
        );
    }
    const desde = fechaValida(datos.desde, 'Desde');
    const hasta = fechaValida(datos.hasta, 'Hasta');
    if (desde > hasta)
      throw new BadRequestException('"Desde" es posterior a "hasta"');
    if (tipo === 'regalia' && desde.slice(0, 4) !== hasta.slice(0, 4))
      throw new BadRequestException('La regalía es de un solo año');
    const notas = opcional(datos.notas, 500, 'Notas');
    const elegidos = Array.isArray(datos.empleadoIds)
      ? datos.empleadoIds.map((x) => texto(x).toLowerCase())
      : [];
    if (elegidos.some((x) => !UUID.test(x)))
      throw new BadRequestException('Empleado inválido');
    if (tipo === 'vacaciones' && elegidos.length === 0)
      throw new BadRequestException(
        'Marque los empleados que salen de vacaciones',
      );
    return this.db.transaccion(async (c) => {
      const p = await this.parametros(c, hasta);
      const params: unknown[] = [hasta];
      let cond = 'e.is_active AND e.fecha_ingreso <= $1';
      if (elegidos.length) {
        params.push(elegidos);
        cond += ` AND e.id = ANY($${params.length}::uuid[])`;
      }
      if (frecuencia) {
        params.push(frecuencia);
        cond += ` AND e.frecuencia = $${params.length}`;
      }
      const emps = await c.query<{
        id: string;
        nombre: string;
        sueldo_mensual: string;
        frecuencia: Frecuencia;
        forma_pago: string;
        fecha_ingreso: string;
      }>(
        `SELECT e.id, e.nombre, e.sueldo_mensual, e.frecuencia, e.forma_pago,
                to_char(e.fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso
         FROM empleados e WHERE ${cond} ORDER BY e.id FOR UPDATE`,
        params,
      );
      if (emps.rowCount === 0)
        throw new BadRequestException(
          frecuencia
            ? `No hay empleados activos que cobren por ${frecuencia === 'semanal' ? 'semana' : frecuencia === 'quincenal' ? 'quincena' : 'mes'} (y que ya hubieran entrado al ${hasta})`
            : 'No hay empleados activos para esta nómina',
        );
      if (elegidos.length && emps.rowCount !== elegidos.length)
        throw new BadRequestException(
          'Algún empleado marcado está inactivo, no había entrado todavía o no cobra con esa frecuencia',
        );
      await this.revisarCruces(
        c,
        tipo,
        desde,
        hasta,
        emps.rows.map((x) => x.id),
      );
      const n = (
        await c.query<{ valor: string }>(
          `UPDATE contadores SET valor = valor + 1 WHERE clave = 'nominas' RETURNING valor`,
        )
      ).rows[0].valor;
      const r = await c.query<{ id: string }>(
        `INSERT INTO nominas (numero, tipo, frecuencia, desde, hasta, notas, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [n, tipo, frecuencia, desde, hasta, notas, actorId],
      );
      const cab = { id: r.rows[0].id, tipo, desde, hasta };
      for (const e of emps.rows) await this.lineaNueva(c, cab, e, p, actorId);
      const total = await this.recalcularTotal(c, cab.id);
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'nomina.crear',
        entidad: 'nominas',
        entidadId: cab.id,
        nuevo: {
          nomina: numeroNomina(n),
          tipo,
          frecuencia,
          desde,
          hasta,
          empleados: emps.rowCount,
          total,
        },
        ip,
      });
      return { id: cab.id, codigo: numeroNomina(n) };
    });
  }

  private async recalcularTotal(c: PoolClient, id: string): Promise<string> {
    const r = await c.query<{ total: string }>(
      `UPDATE nominas SET total = COALESCE((SELECT sum(neto) FROM nomina_lineas WHERE nomina_id = $1), 0),
              updated_at = now()
       WHERE id = $1 RETURNING total`,
      [id],
    );
    return r.rows[0].total;
  }

  private async borrador(c: PoolClient, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Nómina no encontrada');
    const r = await c.query<Cabecera>(
      `SELECT id, numero, tipo, frecuencia, to_char(desde, 'YYYY-MM-DD') AS desde,
              to_char(hasta, 'YYYY-MM-DD') AS hasta, estado, total
       FROM nominas WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (r.rowCount === 0) throw new NotFoundException('Nómina no encontrada');
    if (r.rows[0].estado !== 'borrador')
      throw new BadRequestException('La nómina ya no está en borrador');
    return r.rows[0];
  }

  async agregarEmpleado(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: Record<string, unknown>,
  ) {
    const empleadoId = texto(datos.empleadoId).toLowerCase();
    if (!UUID.test(empleadoId))
      throw new BadRequestException('Seleccione el empleado');
    return this.db.transaccion(async (c) => {
      const cab = await this.borrador(c, id);
      const e = await c.query<{
        id: string;
        nombre: string;
        sueldo_mensual: string;
        frecuencia: Frecuencia;
        forma_pago: string;
        fecha_ingreso: string;
      }>(
        `SELECT id, nombre, sueldo_mensual, frecuencia, forma_pago,
                to_char(fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso
         FROM empleados WHERE id = $1 AND is_active FOR UPDATE`,
        [empleadoId],
      );
      if (e.rowCount === 0)
        throw new BadRequestException('El empleado no existe o está inactivo');
      const emp = e.rows[0];
      if (cab.frecuencia && emp.frecuencia !== cab.frecuencia)
        throw new BadRequestException(
          `${emp.nombre} no cobra ${cab.frecuencia === 'semanal' ? 'por semana' : cab.frecuencia === 'quincenal' ? 'por quincena' : 'por mes'}`,
        );
      if (emp.fecha_ingreso > cab.hasta)
        throw new BadRequestException(
          `${emp.nombre} entró después de este período`,
        );
      const ya = await c.query(
        'SELECT 1 FROM nomina_lineas WHERE nomina_id = $1 AND empleado_id = $2',
        [id, empleadoId],
      );
      if (ya.rowCount)
        throw new ConflictException(`${emp.nombre} ya está en esta nómina`);
      await this.revisarCruces(c, cab.tipo, cab.desde, cab.hasta, [empleadoId]);
      const p = await this.parametros(c, cab.hasta);
      await this.lineaNueva(c, cab, emp, p, actorId);
      const total = await this.recalcularTotal(c, id);
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'nomina.agregar_empleado',
        entidad: 'nominas',
        entidadId: id,
        nuevo: {
          nomina: numeroNomina(cab.numero),
          empleado: emp.nombre,
          total,
        },
        ip,
      });
      return { id, total };
    });
  }

  async quitarLinea(
    actorId: string,
    id: string,
    lineaId: string,
    ip: string | undefined,
  ) {
    if (!UUID.test(lineaId)) throw new NotFoundException('Línea no encontrada');
    return this.db.transaccion(async (c) => {
      const cab = await this.borrador(c, id);
      const r = await c.query<{ nombre: string; neto: string }>(
        `DELETE FROM nomina_lineas l USING empleados e
         WHERE l.id = $1 AND l.nomina_id = $2 AND e.id = l.empleado_id
         RETURNING e.nombre, l.neto`,
        [lineaId, id],
      );
      if (r.rowCount === 0) throw new NotFoundException('Línea no encontrada');
      const total = await this.recalcularTotal(c, id);
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'nomina.quitar_empleado',
        entidad: 'nominas',
        entidadId: id,
        anterior: { empleado: r.rows[0].nombre, neto: r.rows[0].neto },
        nuevo: { nomina: numeroNomina(cab.numero), total },
        ip,
      });
      return { id, total };
    });
  }

  // Cambia lo que se anota a mano en el borrador; el pago de las horas extra
  // y el neto los calcula el servidor.
  async editarLinea(
    actorId: string,
    id: string,
    lineaId: string,
    ip: string | undefined,
    d: Record<string, unknown>,
  ) {
    if (!UUID.test(lineaId)) throw new NotFoundException('Línea no encontrada');
    return this.db.transaccion(async (c) => {
      const cab = await this.borrador(c, id);
      const r = await c.query<Linea & { nombre: string }>(
        `SELECT l.*, e.nombre FROM nomina_lineas l JOIN empleados e ON e.id = l.empleado_id
         WHERE l.id = $1 AND l.nomina_id = $2 FOR UPDATE OF l`,
        [lineaId, id],
      );
      if (r.rowCount === 0) throw new NotFoundException('Línea no encontrada');
      const l = r.rows[0];
      const p = await this.parametros(c, cab.hasta);
      const tiene = (k: string) => k in d && d[k] !== undefined;
      const horas = tiene('horasExtra')
        ? horasValidas(d.horasExtra, 'Horas extra')
        : l.horas_extra;
      const horasAlto = tiene('horasExtraAlto')
        ? horasValidas(d.horasExtraAlto, 'Horas extra (más de 68)')
        : l.horas_extra_alto;
      let dias = l.dias;
      let sueldo = l.sueldo;
      if (cab.tipo === 'vacaciones' && tiene('dias')) {
        const t = horasValidas(d.dias, 'Días');
        dias = t;
        sueldo = montoDias(l.sueldo_mensual, t, p);
      }
      if (tiene('sueldo')) sueldo = montoValido(d.sueldo, 'Sueldo');
      const comisiones = tiene('comisiones')
        ? montoValido(d.comisiones, 'Comisiones')
        : l.comisiones;
      const bonos = tiene('bonos') ? montoValido(d.bonos, 'Bonos') : l.bonos;
      const adelantos = tiene('adelantos')
        ? montoValido(d.adelantos, 'Descuento de adelantos')
        : l.adelantos;
      const otros = tiene('otrosDescuentos')
        ? montoValido(d.otrosDescuentos, 'Otros descuentos')
        : l.otros_descuentos;
      const motivoDesc = tiene('motivoDescuento')
        ? opcional(d.motivoDescuento, 200, 'Motivo del descuento')
        : l.motivo_descuento;
      if (aCentavos(otros) > 0n && !motivoDesc)
        throw new BadRequestException(
          'Escriba el motivo de los otros descuentos',
        );
      const forma = tiene('formaPago') ? texto(d.formaPago) : l.forma_pago;
      if (forma !== 'efectivo' && forma !== 'banco')
        throw new BadRequestException('Forma de pago: efectivo o banco');
      const notas = tiene('notas') ? opcional(d.notas, 300, 'Notas') : l.notas;
      const deuda = await this.deudaAdelantos(c, l.empleado_id);
      if (aCentavos(adelantos) > deuda.debe)
        throw new BadRequestException(
          `${l.nombre} debe RD$${aTexto(deuda.debe)} de adelantos: no se puede descontar más`,
        );
      const extra = montoExtra(l.sueldo_mensual, horas, horasAlto, p);
      const neto =
        aCentavos(sueldo) +
        aCentavos(extra) +
        aCentavos(comisiones) +
        aCentavos(bonos) -
        aCentavos(adelantos) -
        aCentavos(otros);
      if (neto < 0n)
        throw new BadRequestException(
          `Los descuentos de ${l.nombre} pasan de lo que gana (faltan RD$${aTexto(-neto)})`,
        );
      const nuevo = {
        dias,
        sueldo,
        horas_extra: horas,
        horas_extra_alto: horasAlto,
        monto_extra: extra,
        comisiones,
        bonos,
        adelantos,
        otros_descuentos: otros,
        motivo_descuento: aCentavos(otros) > 0n ? motivoDesc : null,
        forma_pago: forma,
        notas,
        neto: aTexto(neto),
      };
      await c.query(
        `UPDATE nomina_lineas SET dias = $2, sueldo = $3, horas_extra = $4, horas_extra_alto = $5,
                monto_extra = $6, comisiones = $7, bonos = $8, adelantos = $9, otros_descuentos = $10,
                motivo_descuento = $11, forma_pago = $12, notas = $13, neto = $14,
                updated_by = $15, updated_at = now()
         WHERE id = $1`,
        [
          lineaId,
          nuevo.dias,
          nuevo.sueldo,
          nuevo.horas_extra,
          nuevo.horas_extra_alto,
          nuevo.monto_extra,
          nuevo.comisiones,
          nuevo.bonos,
          nuevo.adelantos,
          nuevo.otros_descuentos,
          nuevo.motivo_descuento,
          nuevo.forma_pago,
          nuevo.notas,
          nuevo.neto,
          actorId,
        ],
      );
      const total = await this.recalcularTotal(c, id);
      const cambiado = Object.fromEntries(
        Object.entries(nuevo).filter(
          ([k, v]) =>
            String(v ?? '') !== String((l as Record<string, unknown>)[k] ?? ''),
        ),
      );
      if (Object.keys(cambiado).length)
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'nomina.editar_linea',
          entidad: 'nominas',
          entidadId: id,
          anterior: Object.fromEntries(
            Object.keys(cambiado).map((k) => [
              k,
              (l as Record<string, unknown>)[k],
            ]),
          ),
          nuevo: {
            nomina: numeroNomina(cab.numero),
            empleado: l.nombre,
            ...cambiado,
          },
          ip,
        });
      return { id, lineaId, neto: nuevo.neto, montoExtra: extra, total };
    });
  }

  async descartar(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: Record<string, unknown>,
  ) {
    const motivo = motivoValido(datos.motivo);
    return this.db.transaccion(async (c) => {
      const cab = await this.borrador(c, id);
      await c.query(
        `UPDATE nominas SET estado = 'descartada', anulada_por = $2, anulada_en = now(),
                motivo_anulacion = $3, updated_at = now() WHERE id = $1`,
        [id, actorId, motivo],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'nomina.descartar',
        entidad: 'nominas',
        entidadId: id,
        anterior: { nomina: numeroNomina(cab.numero), estado: 'borrador' },
        nuevo: { estado: 'descartada' },
        motivo,
        ip,
      });
      return { id };
    });
  }

  // Paga la nómina: el efectivo sale de la caja y lo de banco de la cuenta
  // (un movimiento por empleado); los descuentos de adelantos se aplican al
  // adelanto más viejo primero.
  async pagar(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: Record<string, unknown>,
  ) {
    return this.db.transaccion(async (c) => {
      const cab = await this.borrador(c, id);
      const codigo = numeroNomina(cab.numero);
      const lineas = await c.query<Linea & { nombre: string }>(
        `SELECT l.*, e.nombre FROM nomina_lineas l JOIN empleados e ON e.id = l.empleado_id
         WHERE l.nomina_id = $1 ORDER BY lower(e.nombre)`,
        [id],
      );
      if (lineas.rowCount === 0)
        throw new BadRequestException('La nómina no tiene empleados');
      let efectivo = 0n;
      let banco = 0n;
      for (const l of lineas.rows) {
        if (l.forma_pago === 'efectivo') efectivo += aCentavos(l.neto);
        else banco += aCentavos(l.neto);
      }
      if (efectivo + banco === 0n)
        throw new BadRequestException('La nómina no tiene nada que pagar');
      const caja =
        efectivo > 0n ? await this.desdeCaja(c, datos.cajaId, efectivo) : null;
      const cuenta =
        banco > 0n ? await this.desdeCuenta(c, datos.cuentaId, banco) : null;
      const hoy = await hoyLocal(c);
      if (hoy < cab.desde)
        throw new BadRequestException(
          'El período de la nómina todavía no ha empezado',
        );

      // Descuentos de adelantos: del más viejo al más nuevo.
      for (const l of lineas.rows) {
        let resto = aCentavos(l.adelantos);
        if (resto === 0n) continue;
        const ads = await c.query<{ id: string; saldo: string }>(
          `SELECT a.id, ${SQL_SALDO_ADELANTO} AS saldo FROM empleado_adelantos a
           WHERE a.empleado_id = $1 AND a.estado = 'activo'
           ORDER BY a.fecha, a.numero FOR UPDATE OF a`,
          [l.empleado_id],
        );
        for (const a of ads.rows) {
          if (resto === 0n) break;
          const saldo = aCentavos(a.saldo);
          if (saldo <= 0n) continue;
          const m = resto < saldo ? resto : saldo;
          await c.query(
            `INSERT INTO adelanto_descuentos (adelanto_id, nomina_linea_id, monto) VALUES ($1, $2, $3)`,
            [a.id, l.id, aTexto(m)],
          );
          resto -= m;
        }
        if (resto > 0n)
          throw new BadRequestException(
            `A ${l.nombre} se le descuentan RD$${l.adelantos} de adelantos, pero debe menos: corrija el descuento`,
          );
      }

      // El dinero: un movimiento por empleado.
      for (const l of lineas.rows) {
        if (aCentavos(l.neto) === 0n) continue;
        const detalle = `${codigo} ${NOMBRE_TIPO[cab.tipo]}: ${l.nombre}`.slice(
          0,
          300,
        );
        if (l.forma_pago === 'efectivo')
          await c.query(
            `INSERT INTO caja_movimientos (sesion_id, tipo, monto, nomina_id, motivo, usuario_id)
             VALUES ($1, 'nomina', $2, $3, $4, $5)`,
            [caja!.sesionId, l.neto, id, detalle, actorId],
          );
        else
          await c.query(
            `INSERT INTO cuenta_movimientos
               (cuenta_id, tipo, signo, monto, tasa, monto_dop, fecha, beneficiario, comprobante, motivo,
                nomina_id, usuario_id)
             VALUES ($1, 'nomina', -1, $2, 1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              cuenta!.cuentaId,
              l.neto,
              hoy,
              l.nombre.slice(0, 120),
              codigo,
              detalle,
              id,
              actorId,
            ],
          );
      }
      const total = await this.recalcularTotal(c, id);
      await c.query(
        `UPDATE nominas SET estado = 'pagada', fecha_pago = $2, pagada_por = $3, pagada_en = now(),
                updated_at = now() WHERE id = $1`,
        [id, hoy, actorId],
      );
      await contabilizar(c, 'nomina', id, actorId);
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'nomina.pagar',
        entidad: 'nominas',
        entidadId: id,
        anterior: { estado: 'borrador' },
        nuevo: {
          nomina: codigo,
          estado: 'pagada',
          total,
          empleados: lineas.rowCount,
          efectivo: aTexto(efectivo),
          banco: aTexto(banco),
          caja: caja?.nombre ?? null,
          cuenta: cuenta?.nombre ?? null,
        },
        ip,
      });
      return {
        id,
        codigo,
        total,
        efectivo: aTexto(efectivo),
        banco: aTexto(banco),
      };
    });
  }

  // Anula una nómina pagada: el efectivo vuelve a una caja abierta, los
  // pagos por banco se reversan y los descuentos de adelantos dejan de contar.
  async anular(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: Record<string, unknown>,
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Nómina no encontrada');
    const motivo = motivoValido(datos.motivo);
    return this.db.transaccion(async (c) => {
      const r = await c.query<Cabecera>(
        `SELECT id, numero, tipo, estado, total FROM nominas WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (r.rowCount === 0) throw new NotFoundException('Nómina no encontrada');
      const cab = r.rows[0];
      if (cab.estado !== 'pagada')
        throw new BadRequestException('Solo se anula una nómina pagada');
      const codigo = numeroNomina(cab.numero);
      const detalle = `Anulación de ${codigo}: ${motivo}`.slice(0, 300);
      const enCaja = await c.query<{ monto: string }>(
        `SELECT monto FROM caja_movimientos WHERE nomina_id = $1 AND tipo = 'nomina'`,
        [id],
      );
      let caja: { sesionId: string; nombre: string } | null = null;
      if (enCaja.rowCount) {
        caja = await this.desdeCaja(c, datos.cajaId, 0n);
        for (const m of enCaja.rows)
          await c.query(
            `INSERT INTO caja_movimientos (sesion_id, tipo, monto, nomina_id, motivo, usuario_id)
             VALUES ($1, 'nomina_reverso', $2, $3, $4, $5)`,
            [caja.sesionId, m.monto, id, detalle, actorId],
          );
      }
      const enBanco = await c.query<{
        id: string;
        cuenta_id: string;
        monto: string;
      }>(
        `SELECT id::text AS id, cuenta_id, monto FROM cuenta_movimientos
         WHERE nomina_id = $1 AND tipo = 'nomina' ORDER BY id`,
        [id],
      );
      const hoy = await hoyLocal(c);
      for (const m of enBanco.rows) {
        await c.query('SELECT id FROM cuentas WHERE id = $1 FOR UPDATE', [
          m.cuenta_id,
        ]);
        await c.query(
          `INSERT INTO cuenta_movimientos
             (cuenta_id, tipo, signo, monto, tasa, monto_dop, fecha, motivo, reverso_de, nomina_id, usuario_id)
           VALUES ($1, 'reverso', 1, $2, 1, $2, $3, $4, $5, $6, $7)`,
          [m.cuenta_id, m.monto, hoy, detalle, m.id, id, actorId],
        );
      }
      await c.query(
        `UPDATE nominas SET estado = 'anulada', anulada_por = $2, anulada_en = now(),
                motivo_anulacion = $3, updated_at = now() WHERE id = $1`,
        [id, actorId, motivo],
      );
      await revertir(c, 'nomina', id, motivo, actorId);
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'nomina.anular',
        entidad: 'nominas',
        entidadId: id,
        anterior: { nomina: codigo, estado: 'pagada', total: cab.total },
        nuevo: {
          estado: 'anulada',
          devuelto_a_caja: caja?.nombre ?? null,
          reversos_banco: enBanco.rowCount,
        },
        motivo,
        ip,
      });
      return { id, codigo };
    });
  }

  // ---------- Volantes de pago ----------

  // PDF con el volante de cada empleado de una nómina pagada (o anulada,
  // marcado). Con lineaId, solo el de ese empleado.
  async volantesPdf(id: string, lineaId?: string) {
    if (!UUID.test(id)) throw new NotFoundException('Nómina no encontrada');
    const linea = texto(lineaId).toLowerCase();
    if (linea && !UUID.test(linea))
      throw new NotFoundException('Empleado no encontrado en la nómina');
    const n = await this.db.query<{
      numero: string;
      tipo: TipoNomina;
      frecuencia: Frecuencia | null;
      desde: string;
      hasta: string;
      estado: string;
      fecha_pago: string | null;
    }>(
      `SELECT numero, tipo, frecuencia, to_char(desde, 'DD/MM/YYYY') AS desde,
              to_char(hasta, 'DD/MM/YYYY') AS hasta, estado,
              to_char(fecha_pago, 'DD/MM/YYYY') AS fecha_pago
       FROM nominas WHERE id = $1`,
      [id],
    );
    if (n.rowCount === 0) throw new NotFoundException('Nómina no encontrada');
    const cab = n.rows[0];
    if (cab.estado !== 'pagada' && cab.estado !== 'anulada')
      throw new BadRequestException(
        'El volante se imprime cuando la nómina está pagada',
      );
    const l = await this.db.query<
      Linea & {
        nombre: string;
        numero: string;
        documento: string | null;
        cargo: string | null;
        debe: string;
      }
    >(
      `SELECT l.*, e.nombre, e.numero, e.documento, e.cargo,
              COALESCE((SELECT sum(${SQL_SALDO_ADELANTO}) FROM empleado_adelantos a
                        WHERE a.empleado_id = e.id AND a.estado = 'activo'), 0)::numeric(14,2) AS debe
       FROM nomina_lineas l JOIN empleados e ON e.id = l.empleado_id
       WHERE l.nomina_id = $1 AND ($2 = '' OR l.id::text = $2)
       ORDER BY lower(e.nombre)`,
      [id, linea],
    );
    if (l.rowCount === 0)
      throw new NotFoundException('Empleado no encontrado en la nómina');
    const empresa = (
      await this.db.query<{
        nombre_comercial: string;
        razon_social: string | null;
        rnc: string | null;
        direccion: string | null;
        telefono: string | null;
        logo: Buffer | null;
        logo_tipo: string | null;
      }>(
        `SELECT nombre_comercial, razon_social, rnc, direccion, telefono, logo, logo_tipo
         FROM empresa WHERE id = 1`,
      )
    ).rows[0];
    const codigo = numeroNomina(cab.numero);
    const pdf = await generarVolantes({
      empresa,
      nomina: {
        codigo,
        tipo: NOMBRE_TIPO[cab.tipo],
        frecuencia: cab.frecuencia
          ? { semanal: 'Semanal', quincenal: 'Quincenal', mensual: 'Mensual' }[
              cab.frecuencia
            ]
          : null,
        desde: cab.desde,
        hasta: cab.hasta,
        estado: cab.estado,
        fechaPago: cab.fecha_pago,
      },
      volantes: l.rows.map((x) => ({
        codigo: numeroEmpleado(x.numero),
        nombre: x.nombre,
        documento: x.documento,
        cargo: x.cargo,
        sueldoMensual: x.sueldo_mensual,
        formaPago: x.forma_pago,
        dias: x.dias,
        sueldo: x.sueldo,
        horasExtra: x.horas_extra,
        horasExtraAlto: x.horas_extra_alto,
        montoExtra: x.monto_extra,
        comisiones: x.comisiones,
        bonos: x.bonos,
        adelantos: x.adelantos,
        otrosDescuentos: x.otros_descuentos,
        motivoDescuento: x.motivo_descuento,
        neto: x.neto,
        debeAdelantos: x.debe,
      })),
    });
    const nombre =
      l.rowCount === 1 && linea
        ? `volante-${codigo}-${numeroEmpleado(l.rows[0].numero)}.pdf`
        : `volantes-${codigo}.pdf`;
    return { pdf, nombre };
  }
}
