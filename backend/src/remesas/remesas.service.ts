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
import { contabilizar } from '../contabilidad/motor';
import { DatabaseService } from '../database/database.service';
import { normalizarMonto } from '../servicios/calculo-itbis';
import { enmascarar } from '../terceros/documentos';
import {
  calcularEnvio,
  calcularEnvioDesdeHtg,
  esEntero,
  numeroEnvio,
  telefonoHaiti,
} from './calculo';
import type { CalculoEnvio } from './calculo';
import { generarReciboEnvio, ticketEnvio } from './recibo-envio-pdf';
import type { DatosReciboEnvio } from './recibo-envio-pdf';
import type { Formato } from '../ventas/recibo-pdf';
import type { Tarifa } from './calculo';

// Envíos de dinero a Haití por NatCash / MonCash. El operador de RD los
// registra (pendientes); el operador de Haití los confirma con el código de
// la transacción (salen las gourdes de la billetera) o los rechaza. Cada
// agente entrega cada día lo cobrado y cobra su comisión por períodos.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FRECUENCIAS = ['semanal', 'quincenal', 'mensual'];

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

function montoPositivo(v: unknown, que = 'Monto'): string {
  const m = normalizarMonto(v);
  if (m === null || m === '0.00') {
    throw new BadRequestException(
      `${que} inválido: mayor que 0, con hasta 2 decimales`,
    );
  }
  return m;
}

// Los envíos se hacen en pesos enteros (decisión del dueño).
function montoEntero(v: unknown): string {
  const m = montoPositivo(v, 'Monto enviado');
  if (!esEntero(m))
    throw new BadRequestException(
      'El monto enviado va en pesos enteros, sin centavos (ej: 1500)',
    );
  return m;
}

// Monto del envío: en pesos (montoEnviado) o, si viene, en gourdes que
// recibe el beneficiario (montoRecibir). Siempre enteros.
type MontoEnvio = { en: 'DOP' | 'HTG'; valor: string };

function leerMonto(datos: {
  montoEnviado?: unknown;
  montoRecibir?: unknown;
}): MontoEnvio {
  if (texto(datos.montoRecibir)) {
    const m = montoPositivo(datos.montoRecibir, 'Monto que recibe (HTG)');
    if (!esEntero(m))
      throw new BadRequestException(
        'Las gourdes van enteras, sin centavos (ej: 1000)',
      );
    return { en: 'HTG', valor: m };
  }
  return { en: 'DOP', valor: montoEntero(datos.montoEnviado) };
}

function calcularMonto(
  m: MontoEnvio,
  tarifa: Tarifa,
  propio: boolean,
): CalculoEnvio {
  return m.en === 'HTG'
    ? calcularEnvioDesdeHtg(m.valor, tarifa, propio)
    : calcularEnvio(m.valor, tarifa, propio);
}

function motivoObligatorio(v: unknown, que = 'el motivo'): string {
  const m = texto(v);
  if (m.length < 5 || m.length > 500) {
    throw new BadRequestException(`Escriba ${que} (entre 5 y 500 caracteres)`);
  }
  return m;
}

function porcentaje(v: unknown, que: string): string {
  const t = texto(v);
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t) || Number(t) > 100) {
    throw new BadRequestException(`${que}: un porcentaje de 0 a 100`);
  }
  return t;
}

type Agente = {
  id: string;
  codigo: string;
  nombre: string;
  tipo: 'propio' | 'autorizado';
  is_active: boolean;
};

// Fila de envío para listas y detalle.
const SQL_ENVIO = `SELECT r.id, r.numero, r.fecha, r.origen, r.estado,
    'E-' || lpad(r.numero::text, 6, '0') AS numero_texto,
    r.agente_id, a.codigo AS agente_codigo, a.nombre AS agente, a.tipo AS agente_tipo,
    r.remitente_id, r.remitente_nombre, t.telefono AS remitente_telefono,
    t.numero_documento AS remitente_documento, td.nombre AS remitente_tipo_documento,
    r.beneficiario_id, r.beneficiario_nombre, r.beneficiario_telefono, r.parentesco,
    me.nombre AS motivo_envio, r.cuenta_id, ct.nombre AS billetera,
    r.monto_enviado, r.tasa, r.monto_recibir, r.comision_pct, r.comision, r.total_pagar,
    r.comision_agente_pct, r.comision_agente, r.codigo_externo, r.motivo_rechazo,
    r.resuelto_en, ur.username AS resuelto_por, ug.username AS registrado_por,
    r.pago_comision_id, r.notas
  FROM remesas r
  JOIN remesa_agentes a ON a.id = r.agente_id
  JOIN usuarios ug ON ug.id = r.registrado_por
  LEFT JOIN usuarios ur ON ur.id = r.resuelto_por
  LEFT JOIN terceros t ON t.id = r.remitente_id
  LEFT JOIN tipos_documento td ON td.id = t.tipo_documento_id
  LEFT JOIN motivos_envio me ON me.id = r.motivo_envio_id
  LEFT JOIN cuentas ct ON ct.id = r.cuenta_id`;

@Injectable()
export class RemesasService {
  constructor(private readonly db: DatabaseService) {}

  private async config(c: Pick<DatabaseService, 'query'>, clave: string) {
    const r = await c.query<{ valor: string }>(
      'SELECT valor FROM configuracion WHERE clave = $1',
      [clave],
    );
    if (r.rowCount === 0) throw new Error(`Falta la configuración ${clave}`);
    return r.rows[0].valor;
  }

  private async hoy(c: Pick<DatabaseService, 'query'>) {
    const zona = await this.config(c, 'empresa.zona_horaria');
    const r = await c.query<{ hoy: string }>(
      `SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS hoy`,
      [zona],
    );
    return { hoy: r.rows[0].hoy, zona };
  }

  private async permisos(usuarioId: string): Promise<Set<string>> {
    const r = await this.db.query<{ codigo: string }>(
      `SELECT DISTINCT p.codigo
       FROM usuario_roles ur
       JOIN roles ro ON ro.id = ur.rol_id AND ro.is_active
       JOIN rol_permisos rp ON rp.rol_id = ro.id
       JOIN permisos p ON p.id = rp.permiso_id
       WHERE ur.usuario_id = $1`,
      [usuarioId],
    );
    return new Set(r.rows.map((f) => f.codigo));
  }

  // Tarifa vigente ahora (la última que ya empezó).
  private async tarifa(c: Pick<DatabaseService, 'query'>): Promise<Tarifa> {
    const r = await c.query<Tarifa>(
      `SELECT tasa, comision_pct, comision_agente_pct FROM remesas_tarifas
       WHERE vigente_desde <= now() ORDER BY vigente_desde DESC LIMIT 1`,
    );
    if (r.rowCount === 0)
      throw new BadRequestException('No hay tasa configurada para los envíos');
    return r.rows[0];
  }

  // ---------- Datos para las pantallas ----------

  async preparar(actorId: string) {
    const [tarifa, motivos, agentes, billeteras, desde, cajas, cuentas, p] =
      await Promise.all([
        this.tarifa(this.db),
        this.db.query(
          'SELECT id, codigo, nombre FROM motivos_envio WHERE is_active ORDER BY orden',
        ),
        this.db.query(
          `SELECT id, codigo, nombre, tipo FROM remesa_agentes
           WHERE is_active ORDER BY codigo`,
        ),
        // Billeteras en gourdes de donde salen los envíos.
        this.db.query(
          `SELECT id, nombre, entidad FROM cuentas
           WHERE is_active AND moneda = 'HTG' ORDER BY lower(nombre)`,
        ),
        this.config(this.db, 'remesas.documento_desde'),
        this.db.query(
          `SELECT c.id, c.nombre, s.id AS sesion_id FROM cajas c
           LEFT JOIN caja_sesiones s ON s.caja_id = c.id AND s.estado = 'abierta'
           WHERE c.is_active ORDER BY lower(c.nombre)`,
        ),
        // Cuentas en pesos para depósitos de los agentes y pago de comisiones.
        this.db.query(
          `SELECT id, nombre FROM cuentas
           WHERE is_active AND moneda = 'DOP' ORDER BY lower(nombre)`,
        ),
        this.permisos(actorId),
      ]);
    return {
      tarifa,
      motivos: motivos.rows,
      agentes: agentes.rows,
      billeteras: billeteras.rows,
      documentoDesde: desde,
      cajas: cajas.rows,
      cuentasPesos: cuentas.rows,
      verDocumento: p.has('terceros.ver_documento'),
    };
  }

  // Vista previa de los montos con la tarifa vigente.
  async calcular(datos: {
    agenteId?: unknown;
    montoEnviado?: unknown;
    montoRecibir?: unknown;
  }) {
    const monto = leerMonto(datos);
    const agenteId = texto(datos.agenteId).toLowerCase();
    let propio = false;
    if (UUID.test(agenteId)) {
      const a = await this.db.query<{ tipo: string }>(
        'SELECT tipo FROM remesa_agentes WHERE id = $1',
        [agenteId],
      );
      propio = a.rows[0]?.tipo === 'propio';
    }
    return calcularMonto(monto, await this.tarifa(this.db), propio);
  }

  // ---------- Tarifas (tasa y comisiones) ----------

  async tarifas() {
    const r = await this.db.query(
      `SELECT t.id, t.tasa, t.comision_pct, t.comision_agente_pct, t.vigente_desde,
              t.motivo, u.username AS usuario
       FROM remesas_tarifas t LEFT JOIN usuarios u ON u.id = t.created_by
       ORDER BY t.vigente_desde DESC LIMIT 100`,
    );
    return r.rows;
  }

  async nuevaTarifa(
    actorId: string,
    ip: string | undefined,
    datos: {
      tasa?: unknown;
      comisionPct?: unknown;
      comisionAgentePct?: unknown;
      motivo?: unknown;
    },
  ) {
    const tasa = texto(datos.tasa);
    if (!/^\d{1,6}(\.\d{1,6})?$/.test(tasa) || /^0+(\.0+)?$/.test(tasa)) {
      throw new BadRequestException(
        'Tasa inválida: cuántas gourdes recibe el beneficiario por 1 RD$ (ej: 2.05)',
      );
    }
    const pct = porcentaje(datos.comisionPct, 'Comisión');
    const pctAgente = porcentaje(datos.comisionAgentePct, 'Parte del agente');
    const motivo = motivoObligatorio(datos.motivo, 'el motivo del cambio');
    return this.db.transaccion(async (c) => {
      const antes = await this.tarifa(c);
      const r = await c.query<{ id: string }>(
        `INSERT INTO remesas_tarifas (tasa, comision_pct, comision_agente_pct, motivo, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [tasa, pct, pctAgente, motivo, actorId],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'remesa.tarifa',
        entidad: 'remesas_tarifas',
        entidadId: r.rows[0].id,
        anterior: antes,
        nuevo: { tasa, comision_pct: pct, comision_agente_pct: pctAgente },
        motivo,
        ip,
      });
      return { id: r.rows[0].id };
    });
  }

  // ---------- Agentes ----------

  async agentes() {
    const r = await this.db.query(
      `SELECT id, codigo, nombre, telefono, tipo, frecuencia_pago, grupo_whatsapp,
              notas, is_active
       FROM remesa_agentes ORDER BY is_active DESC, codigo`,
    );
    return r.rows;
  }

  private datosAgente(datos: Record<string, unknown>) {
    const nombre = texto(datos.nombre);
    if (!nombre || nombre.length > 120)
      throw new BadRequestException('El nombre es obligatorio (máximo 120)');
    const tipo = texto(datos.tipo);
    if (tipo !== 'propio' && tipo !== 'autorizado')
      throw new BadRequestException('Tipo inválido: propio o autorizado');
    const frecuencia = tipo === 'propio' ? null : texto(datos.frecuenciaPago);
    if (frecuencia !== null && !FRECUENCIAS.includes(frecuencia)) {
      throw new BadRequestException(
        'Indique cada cuánto se le paga la comisión: semanal, quincenal o mensual',
      );
    }
    return {
      nombre,
      tipo,
      frecuencia,
      telefono: opcional(datos.telefono, 30, 'Teléfono'),
      grupo: opcional(datos.grupoWhatsapp, 80, 'Grupo de WhatsApp'),
      notas: opcional(datos.notas, 500, 'Notas'),
    };
  }

  async crearAgente(
    actorId: string,
    ip: string | undefined,
    datos: Record<string, unknown>,
  ) {
    const codigo = texto(datos.codigo).toUpperCase();
    if (!/^[A-Z0-9_-]{2,20}$/.test(codigo))
      throw new BadRequestException(
        'Código inválido: 2 a 20 letras, números o guiones (ej: SC-014)',
      );
    const d = this.datosAgente(datos);
    try {
      return await this.db.transaccion(async (c) => {
        const r = await c.query<{ id: string }>(
          `INSERT INTO remesa_agentes
             (codigo, nombre, telefono, tipo, frecuencia_pago, grupo_whatsapp, notas, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            codigo,
            d.nombre,
            d.telefono,
            d.tipo,
            d.frecuencia,
            d.grupo,
            d.notas,
            actorId,
          ],
        );
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'remesa_agente.crear',
          entidad: 'remesa_agentes',
          entidadId: r.rows[0].id,
          nuevo: {
            codigo,
            nombre: d.nombre,
            tipo: d.tipo,
            frecuencia_pago: d.frecuencia,
          },
          ip,
        });
        return { id: r.rows[0].id };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw new ConflictException(
          'Ya existe un agente con ese código o nombre',
        );
      throw e;
    }
  }

  async editarAgente(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: Record<string, unknown>,
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Agente no encontrado');
    const d = this.datosAgente(datos);
    try {
      return await this.db.transaccion(async (c) => {
        const r = await c.query<Record<string, unknown>>(
          `SELECT nombre, telefono, tipo, frecuencia_pago, grupo_whatsapp
           FROM remesa_agentes WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (r.rowCount === 0)
          throw new NotFoundException('Agente no encontrado');
        const antes = r.rows[0];
        if (antes.tipo !== d.tipo) {
          // Cambiar de tipo cambia quién cobra comisión: solo sin comisiones pendientes.
          const p = await c.query(
            `SELECT 1 FROM remesas WHERE agente_id = $1 AND estado <> 'rechazado'
               AND pago_comision_id IS NULL AND comision_agente > 0 LIMIT 1`,
            [id],
          );
          if ((p.rowCount ?? 0) > 0)
            throw new BadRequestException(
              'No se puede cambiar el tipo: el agente tiene comisiones sin pagar',
            );
        }
        await c.query(
          `UPDATE remesa_agentes SET nombre = $2, telefono = $3, tipo = $4,
                  frecuencia_pago = $5, grupo_whatsapp = $6, notas = $7, updated_at = now()
           WHERE id = $1`,
          [id, d.nombre, d.telefono, d.tipo, d.frecuencia, d.grupo, d.notas],
        );
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'remesa_agente.editar',
          entidad: 'remesa_agentes',
          entidadId: id,
          anterior: antes,
          nuevo: {
            nombre: d.nombre,
            telefono: d.telefono,
            tipo: d.tipo,
            frecuencia_pago: d.frecuencia,
            grupo_whatsapp: d.grupo,
          },
          ip,
        });
        return { ok: true };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw new ConflictException('Ya existe un agente con ese nombre');
      throw e;
    }
  }

  async estadoAgente(
    actorId: string,
    id: string,
    activo: unknown,
    motivo: unknown,
    ip: string | undefined,
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Agente no encontrado');
    if (typeof activo !== 'boolean')
      throw new BadRequestException('Estado inválido');
    const textoMotivo = activo ? texto(motivo) : motivoObligatorio(motivo);
    return this.db.transaccion(async (c) => {
      const r = await c.query<{ nombre: string; is_active: boolean }>(
        'SELECT nombre, is_active FROM remesa_agentes WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (r.rowCount === 0) throw new NotFoundException('Agente no encontrado');
      if (r.rows[0].is_active === activo) return { ok: true };
      if (!activo) {
        const s = (await this.saldos(c, id))[0];
        if (
          s &&
          (s.debe !== '0.00' ||
            s.pendientes > 0 ||
            s.comision_pendiente !== '0.00')
        ) {
          throw new BadRequestException(
            `No se puede desactivar: ${r.rows[0].nombre} tiene envíos pendientes, dinero por entregar o comisiones sin pagar`,
          );
        }
      }
      await c.query(
        'UPDATE remesa_agentes SET is_active = $2, updated_at = now() WHERE id = $1',
        [id, activo],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: activo ? 'remesa_agente.activar' : 'remesa_agente.desactivar',
        entidad: 'remesa_agentes',
        entidadId: id,
        anterior: { is_active: !activo },
        nuevo: { nombre: r.rows[0].nombre, is_active: activo },
        motivo: textoMotivo || undefined,
        ip,
      });
      return { ok: true };
    });
  }

  // ---------- Beneficiarios ----------

  async beneficiarios(textoBuscar: unknown) {
    const t = texto(textoBuscar);
    const tel = telefonoHaiti(t);
    const r = await this.db.query(
      `SELECT b.id, b.nombre, b.telefono,
              (SELECT max(r.fecha) FROM remesas r WHERE r.beneficiario_id = b.id) AS ultimo_envio
       FROM beneficiarios b
       WHERE b.is_active AND ($1 = '' OR b.nombre ILIKE '%' || $1 || '%' OR b.telefono = $2)
       ORDER BY lower(b.nombre) LIMIT 30`,
      [t.replace(/[%_\\]/g, ''), tel ?? ''],
    );
    return r.rows;
  }

  // Crea el beneficiario o devuelve el que ya existe con ese nombre y teléfono.
  private async beneficiarioNuevo(
    c: PoolClient,
    actorId: string,
    datos: { nombre?: unknown; telefono?: unknown },
  ) {
    const nombre = texto(datos.nombre).replace(/\s+/g, ' ');
    if (nombre.length < 2 || nombre.length > 120)
      throw new BadRequestException('Escriba el nombre del beneficiario');
    const telefono = telefonoHaiti(texto(datos.telefono));
    if (!telefono)
      throw new BadRequestException(
        'Teléfono del beneficiario inválido: 8 dígitos de Haití (ej: 509-37-38-2382)',
      );
    const ya = await c.query<{ id: string; nombre: string; telefono: string }>(
      `SELECT id, nombre, telefono FROM beneficiarios
       WHERE lower(nombre) = lower($1) AND telefono = $2`,
      [nombre, telefono],
    );
    if ((ya.rowCount ?? 0) > 0) return ya.rows[0];
    const r = await c.query<{ id: string; nombre: string; telefono: string }>(
      `INSERT INTO beneficiarios (nombre, telefono, created_by) VALUES ($1, $2, $3)
       RETURNING id, nombre, telefono`,
      [nombre, telefono, actorId],
    );
    await registrarAuditoria(c, {
      usuarioId: actorId,
      accion: 'beneficiario.crear',
      entidad: 'beneficiarios',
      entidadId: r.rows[0].id,
      nuevo: { nombre },
    });
    return r.rows[0];
  }

  // ---------- Envíos ----------

  async crear(
    actorId: string,
    ip: string | undefined,
    datos: {
      agenteId?: unknown;
      remitenteId?: unknown;
      beneficiarioId?: unknown;
      beneficiarioNuevo?: { nombre?: unknown; telefono?: unknown };
      parentesco?: unknown;
      motivoEnvioId?: unknown;
      cuentaId?: unknown;
      montoEnviado?: unknown;
      montoRecibir?: unknown; // en vez de montoEnviado: gourdes que recibe
      notas?: unknown;
    },
  ) {
    const agenteId = texto(datos.agenteId).toLowerCase();
    if (!UUID.test(agenteId))
      throw new BadRequestException('Seleccione el agente que pide el envío');
    const remitenteId = texto(datos.remitenteId).toLowerCase();
    if (!UUID.test(remitenteId))
      throw new BadRequestException('Seleccione el remitente (cliente)');
    const cuentaId = texto(datos.cuentaId).toLowerCase();
    if (!UUID.test(cuentaId))
      throw new BadRequestException(
        'Seleccione la billetera (NatCash o MonCash)',
      );
    const motivoId = texto(datos.motivoEnvioId).toLowerCase();
    if (!UUID.test(motivoId))
      throw new BadRequestException('Seleccione el motivo del envío');
    const monto = leerMonto(datos);
    const parentesco = opcional(datos.parentesco, 40, 'Parentesco');
    if (!parentesco)
      throw new BadRequestException(
        'Escriba el parentesco del beneficiario con el remitente (ej: hermana)',
      );
    const notas = opcional(datos.notas, 500, 'Notas');

    return this.db.transaccion(async (c) => {
      const ag = await c.query<Agente>(
        'SELECT id, codigo, nombre, tipo, is_active FROM remesa_agentes WHERE id = $1',
        [agenteId],
      );
      if (ag.rowCount === 0 || !ag.rows[0].is_active)
        throw new BadRequestException('El agente no existe o está desactivado');
      const agente = ag.rows[0];

      const rem = await c.query<{
        nombre: string;
        numero_documento: string | null;
      }>(
        `SELECT nombre, numero_documento FROM terceros
         WHERE id = $1 AND rol = 'cliente' AND is_active`,
        [remitenteId],
      );
      if (rem.rowCount === 0)
        throw new BadRequestException(
          'El remitente no existe o está desactivado',
        );
      // Documento obligatorio a partir del monto configurado (0 = siempre).
      // (Se compara en pesos, aunque el monto se haya escrito en gourdes.)
      const desde = await this.config(c, 'remesas.documento_desde');
      const pesos = calcularMonto(
        monto,
        await this.tarifa(c),
        false,
      ).monto_enviado;
      const exige = await c.query<{ ok: boolean }>(
        'SELECT $1::numeric >= $2::numeric AS ok',
        [pesos, desde],
      );
      if (exige.rows[0].ok && !rem.rows[0].numero_documento) {
        throw new BadRequestException(
          'El remitente no tiene documento (cédula o pasaporte). Agréguelo en Clientes antes de enviar.',
        );
      }

      let beneficiario: { id: string; nombre: string; telefono: string | null };
      const benId = texto(datos.beneficiarioId).toLowerCase();
      if (UUID.test(benId)) {
        const b = await c.query<{
          id: string;
          nombre: string;
          telefono: string | null;
        }>(
          'SELECT id, nombre, telefono FROM beneficiarios WHERE id = $1 AND is_active',
          [benId],
        );
        if (b.rowCount === 0)
          throw new BadRequestException('El beneficiario no existe');
        beneficiario = b.rows[0];
      } else if (datos.beneficiarioNuevo) {
        beneficiario = await this.beneficiarioNuevo(
          c,
          actorId,
          datos.beneficiarioNuevo,
        );
      } else {
        throw new BadRequestException('Seleccione o escriba el beneficiario');
      }

      const mot = await c.query(
        'SELECT 1 FROM motivos_envio WHERE id = $1 AND is_active',
        [motivoId],
      );
      if (mot.rowCount === 0) throw new BadRequestException('Motivo inválido');
      const bil = await c.query<{ nombre: string }>(
        `SELECT nombre FROM cuentas WHERE id = $1 AND is_active AND moneda = 'HTG'`,
        [cuentaId],
      );
      if (bil.rowCount === 0)
        throw new BadRequestException(
          'La billetera no existe, está desactivada o no es en gourdes',
        );

      const k = calcularMonto(
        monto,
        await this.tarifa(c),
        agente.tipo === 'propio',
      );
      const n = (
        await c.query<{ valor: string }>(
          `UPDATE contadores SET valor = valor + 1 WHERE clave = 'remesas' RETURNING valor`,
        )
      ).rows[0].valor;
      const r = await c.query<{ id: string }>(
        `INSERT INTO remesas
           (numero, agente_id, remitente_id, remitente_nombre, beneficiario_id,
            beneficiario_nombre, beneficiario_telefono, parentesco, motivo_envio_id, cuenta_id,
            monto_enviado, tasa, monto_recibir, comision_pct, comision, total_pagar,
            comision_agente_pct, comision_agente, notas, registrado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                 $17, $18, $19, $20)
         RETURNING id`,
        [
          n,
          agenteId,
          remitenteId,
          rem.rows[0].nombre,
          beneficiario.id,
          beneficiario.nombre,
          beneficiario.telefono,
          parentesco,
          motivoId,
          cuentaId,
          k.monto_enviado,
          k.tasa,
          k.monto_recibir,
          k.comision_pct,
          k.comision,
          k.total_pagar,
          k.comision_agente_pct,
          k.comision_agente,
          notas,
          actorId,
        ],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'remesa.registrar',
        entidad: 'remesas',
        entidadId: r.rows[0].id,
        nuevo: {
          numero: numeroEnvio(n),
          agente: agente.codigo,
          remitente: rem.rows[0].nombre,
          beneficiario: beneficiario.nombre,
          billetera: bil.rows[0].nombre,
          ...k,
        },
        ip,
      });
      return { id: r.rows[0].id, numero: numeroEnvio(n), ...k };
    });
  }

  private async conDocumento<T extends { remitente_documento?: string | null }>(
    actorId: string,
    filas: T[],
  ): Promise<T[]> {
    if ((await this.permisos(actorId)).has('terceros.ver_documento'))
      return filas;
    return filas.map((f) => ({
      ...f,
      remitente_documento: enmascarar(f.remitente_documento ?? null),
    }));
  }

  async listar(
    actorId: string,
    filtros: {
      estado?: string;
      agenteId?: string;
      desde?: string;
      hasta?: string;
      texto?: string;
      pagina?: string;
    },
  ) {
    const params: unknown[] = [];
    const cond: string[] = [];
    const estado = texto(filtros.estado) || 'todos';
    if (['pendiente', 'confirmado', 'rechazado'].includes(estado)) {
      params.push(estado);
      cond.push(`r.estado = $${params.length}`);
    } else if (estado !== 'todos')
      throw new BadRequestException('Estado inválido');
    const agente = texto(filtros.agenteId);
    if (agente) {
      if (!UUID.test(agente)) throw new BadRequestException('Agente inválido');
      params.push(agente);
      cond.push(`r.agente_id = $${params.length}`);
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
        params.push(await this.config(this.db, 'empresa.zona_horaria'));
        zonaParam = params.length;
      }
      params.push(f);
      cond.push(
        `(r.fecha AT TIME ZONE $${zonaParam})::date ${op} $${params.length}::date`,
      );
    }
    const t = texto(filtros.texto).replace(/[%_\\]/g, '');
    if (t) {
      params.push(t);
      const i = params.length;
      const num = /^E-?\d{1,9}$/i.test(t) ? t.replace(/\D/g, '') : null;
      cond.push(
        `(r.remitente_nombre ILIKE '%' || $${i} || '%' OR r.beneficiario_nombre ILIKE '%' || $${i} || '%'
          OR r.codigo_externo ILIKE $${i}${num ? ` OR r.numero = ${Number(num)}` : ''})`,
      );
    }
    const pagina = Math.max(
      1,
      Number.parseInt(texto(filtros.pagina) || '1', 10) || 1,
    );
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const [filas, total] = await Promise.all([
      this.db.query(
        `${SQL_ENVIO} ${where}
         ORDER BY CASE WHEN r.estado = 'pendiente' THEN 0 ELSE 1 END, r.fecha DESC
         LIMIT 50 OFFSET $${params.length + 1}`,
        [...params, (pagina - 1) * 50],
      ),
      this.db.query<{
        n: number;
        enviado: string;
        comision: string;
        total: string;
      }>(
        `SELECT count(*)::int AS n,
                COALESCE(sum(r.monto_enviado) FILTER (WHERE r.estado = 'confirmado'), 0)::numeric(16,2) AS enviado,
                COALESCE(sum(r.comision) FILTER (WHERE r.estado = 'confirmado'), 0)::numeric(16,2) AS comision,
                COALESCE(sum(r.total_pagar) FILTER (WHERE r.estado = 'confirmado'), 0)::numeric(16,2) AS total
         FROM remesas r ${where}`,
        params,
      ),
    ]);
    return {
      filas: await this.conDocumento(actorId, filas.rows),
      total: total.rows[0].n,
      resumen: total.rows[0],
      pagina,
      porPagina: 50,
    };
  }

  async detalle(actorId: string, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Envío no encontrado');
    const r = await this.db.query(`${SQL_ENVIO} WHERE r.id = $1`, [id]);
    if (r.rowCount === 0) throw new NotFoundException('Envío no encontrado');
    return (await this.conDocumento(actorId, r.rows))[0];
  }

  private async bloquearEnvio(c: PoolClient, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Envío no encontrado');
    const r = await c.query<{
      numero: string;
      estado: string;
      cuenta_id: string | null;
      monto_enviado: string;
      monto_recibir: string;
      beneficiario_nombre: string;
    }>(
      `SELECT numero, estado, cuenta_id, monto_enviado, monto_recibir, beneficiario_nombre
       FROM remesas WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (r.rowCount === 0) throw new NotFoundException('Envío no encontrado');
    if (r.rows[0].estado !== 'pendiente')
      throw new BadRequestException(`El envío ya está ${r.rows[0].estado}`);
    return r.rows[0];
  }

  // El operador de Haití hizo el envío: salen las gourdes de la billetera.
  async confirmar(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: { codigoExterno?: unknown },
  ) {
    const codigo = texto(datos.codigoExterno).toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9-]{4,30}$/.test(codigo)) {
      throw new BadRequestException(
        'Escriba el código de la transacción de NatCash / MonCash (ej: A3154153)',
      );
    }
    try {
      return await this.db.transaccion(async (c) => {
        const e = await this.bloquearEnvio(c, id);
        const usado = await c.query<{ numero: string }>(
          'SELECT numero FROM remesas WHERE codigo_externo = $1',
          [codigo],
        );
        if ((usado.rowCount ?? 0) > 0)
          throw new ConflictException(
            `Ese código ya se usó en el envío ${numeroEnvio(usado.rows[0].numero)}`,
          );
        const ct = await c.query<{ nombre: string; is_active: boolean }>(
          'SELECT nombre, is_active FROM cuentas WHERE id = $1 FOR UPDATE',
          [e.cuenta_id],
        );
        if (!ct.rows[0]?.is_active)
          throw new BadRequestException(
            'La billetera del envío está desactivada',
          );
        const hay = (
          await c.query<{ disponible: string }>(SQL_DISPONIBLE, [e.cuenta_id])
        ).rows[0].disponible;
        const alcanza = await c.query<{ ok: boolean }>(
          'SELECT $1::numeric >= $2::numeric AS ok',
          [hay, e.monto_recibir],
        );
        if (!alcanza.rows[0].ok) {
          throw new BadRequestException(
            `No hay suficientes gourdes en ${ct.rows[0].nombre}: hay HTG ${hay} y el envío es de HTG ${e.monto_recibir}. Recargue la billetera en Bancos.`,
          );
        }
        const { zona } = await this.hoy(c);
        await c.query(
          `INSERT INTO cuenta_movimientos
             (cuenta_id, tipo, signo, monto, tasa, monto_dop, fecha, referencia, remesa_id, usuario_id)
           VALUES ($1, 'remesa', -1, $2, round($3::numeric / $2::numeric, 8), $3,
                   (now() AT TIME ZONE $4)::date, $5, $6, $7)`,
          [
            e.cuenta_id,
            e.monto_recibir,
            e.monto_enviado,
            zona,
            codigo,
            id,
            actorId,
          ],
        );
        await c.query(
          `UPDATE remesas SET estado = 'confirmado', codigo_externo = $2, resuelto_por = $3,
                  resuelto_en = now(), updated_at = now()
           WHERE id = $1`,
          [id, codigo, actorId],
        );
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'remesa.confirmar',
          entidad: 'remesas',
          entidadId: id,
          anterior: { estado: 'pendiente' },
          nuevo: {
            numero: numeroEnvio(e.numero),
            estado: 'confirmado',
            codigo_externo: codigo,
            billetera: ct.rows[0].nombre,
            monto_recibir: e.monto_recibir,
          },
          ip,
        });
        await contabilizar(c, 'remesa', id, actorId);
        return { ok: true };
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23505')
        throw new ConflictException(
          'Ese código de transacción ya se usó en otro envío',
        );
      throw err;
    }
  }

  // No se pudo hacer: el agente le devuelve todo al cliente y no debe nada.
  async rechazar(
    actorId: string,
    id: string,
    ip: string | undefined,
    motivoTexto: unknown,
  ) {
    const motivo = motivoObligatorio(motivoTexto, 'el motivo del rechazo');
    return this.db.transaccion(async (c) => {
      const e = await this.bloquearEnvio(c, id);
      await c.query(
        `UPDATE remesas SET estado = 'rechazado', motivo_rechazo = $2, resuelto_por = $3,
                resuelto_en = now(), updated_at = now()
         WHERE id = $1`,
        [id, motivo, actorId],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'remesa.rechazar',
        entidad: 'remesas',
        entidadId: id,
        anterior: { estado: 'pendiente' },
        nuevo: { numero: numeroEnvio(e.numero), estado: 'rechazado' },
        motivo,
        ip,
      });
      return { ok: true };
    });
  }

  // ---------- Cuentas de los agentes ----------

  // Por agente: lo que debe entregar (confirmados − entregas), envíos
  // pendientes y comisiones sin pagar. Sin agenteId, todos.
  private async saldos(c: Pick<DatabaseService, 'query'>, agenteId?: string) {
    const r = await c.query<{
      id: string;
      codigo: string;
      nombre: string;
      tipo: string;
      frecuencia_pago: string | null;
      is_active: boolean;
      cobrado: string;
      entregado: string;
      debe: string;
      pendientes: number;
      comision_pendiente: string;
      envios_sin_pagar: number;
      ultimo_pago: string | null;
    }>(
      `SELECT a.id, a.codigo, a.nombre, a.tipo, a.frecuencia_pago, a.is_active,
              COALESCE(rc.cobrado, 0)::numeric(16,2) AS cobrado,
              COALESCE(en.entregado, 0)::numeric(16,2) AS entregado,
              (COALESCE(rc.cobrado, 0) - COALESCE(en.entregado, 0))::numeric(16,2) AS debe,
              COALESCE(rc.pendientes, 0)::int AS pendientes,
              COALESCE(rc.comision_pendiente, 0)::numeric(16,2) AS comision_pendiente,
              COALESCE(rc.envios_sin_pagar, 0)::int AS envios_sin_pagar,
              (SELECT to_char(max(p.hasta), 'YYYY-MM-DD') FROM remesa_pagos_comision p WHERE p.agente_id = a.id) AS ultimo_pago
       FROM remesa_agentes a
       LEFT JOIN (
         SELECT agente_id,
                sum(total_pagar) FILTER (WHERE estado = 'confirmado' AND origen = 'sistema') AS cobrado,
                count(*) FILTER (WHERE estado = 'pendiente') AS pendientes,
                sum(comision_agente) FILTER (WHERE estado = 'confirmado' AND origen = 'sistema'
                  AND pago_comision_id IS NULL) AS comision_pendiente,
                count(*) FILTER (WHERE estado = 'confirmado' AND origen = 'sistema'
                  AND pago_comision_id IS NULL AND comision_agente > 0) AS envios_sin_pagar
         FROM remesas GROUP BY agente_id
       ) rc ON rc.agente_id = a.id
       LEFT JOIN (
         SELECT agente_id, sum(monto) AS entregado FROM remesa_entregas GROUP BY agente_id
       ) en ON en.agente_id = a.id
       ${agenteId ? 'WHERE a.id = $1' : ''}
       ORDER BY a.is_active DESC, a.codigo`,
      agenteId ? [agenteId] : [],
    );
    return r.rows;
  }

  async cuentasAgentes() {
    return this.saldos(this.db);
  }

  // Reporte de un día por agente: envíos confirmados, lo que debía entregar
  // ese día, lo que entregó y el saldo acumulado.
  async reporteDia(diaTexto: unknown) {
    const { hoy, zona } = await this.hoy(this.db);
    const dia = texto(diaTexto) || hoy;
    if (!fechaValida(dia))
      throw new BadRequestException('Fecha inválida (use AAAA-MM-DD)');
    const r = await this.db.query(
      `SELECT a.id, a.codigo, a.nombre, a.tipo,
              COALESCE(d.confirmados, 0)::int AS confirmados,
              COALESCE(d.pendientes, 0)::int AS pendientes,
              COALESCE(d.rechazados, 0)::int AS rechazados,
              COALESCE(d.enviado, 0)::numeric(16,2) AS enviado,
              COALESCE(d.comision, 0)::numeric(16,2) AS comision,
              COALESCE(d.comision_agente, 0)::numeric(16,2) AS comision_agente,
              COALESCE(d.total, 0)::numeric(16,2) AS a_entregar,
              COALESCE(e.entregado, 0)::numeric(16,2) AS entregado
       FROM remesa_agentes a
       LEFT JOIN (
         SELECT agente_id,
                count(*) FILTER (WHERE estado = 'confirmado') AS confirmados,
                count(*) FILTER (WHERE estado = 'pendiente') AS pendientes,
                count(*) FILTER (WHERE estado = 'rechazado') AS rechazados,
                sum(monto_enviado) FILTER (WHERE estado = 'confirmado') AS enviado,
                sum(comision) FILTER (WHERE estado = 'confirmado') AS comision,
                sum(comision_agente) FILTER (WHERE estado = 'confirmado') AS comision_agente,
                sum(total_pagar) FILTER (WHERE estado = 'confirmado') AS total
         FROM remesas
         WHERE origen = 'sistema' AND (fecha AT TIME ZONE $2)::date = $1::date
         GROUP BY agente_id
       ) d ON d.agente_id = a.id
       LEFT JOIN (
         SELECT agente_id, sum(monto) AS entregado FROM remesa_entregas
         WHERE dia = $1::date GROUP BY agente_id
       ) e ON e.agente_id = a.id
       WHERE a.is_active OR d.agente_id IS NOT NULL OR e.agente_id IS NOT NULL
       ORDER BY a.codigo`,
      [dia, zona],
    );
    const saldos = new Map(
      (await this.saldos(this.db)).map((s) => [s.id, s.debe]),
    );
    return {
      dia,
      agentes: r.rows.map((f: { id: string }) => ({
        ...f,
        saldo_total: saldos.get(f.id) ?? '0.00',
      })),
    };
  }

  async movimientosAgente(agenteId: string) {
    if (!UUID.test(agenteId))
      throw new NotFoundException('Agente no encontrado');
    const [saldo, entregas, pagos] = await Promise.all([
      this.saldos(this.db, agenteId),
      this.db.query(
        `SELECT e.id, to_char(e.dia, 'YYYY-MM-DD') AS dia, e.monto, e.forma, e.referencia, e.notas, e.created_at,
                u.username AS usuario
         FROM remesa_entregas e JOIN usuarios u ON u.id = e.usuario_id
         WHERE e.agente_id = $1 ORDER BY e.created_at DESC LIMIT 100`,
        [agenteId],
      ),
      this.db.query(
        `SELECT p.id, to_char(p.desde, 'YYYY-MM-DD') AS desde, to_char(p.hasta, 'YYYY-MM-DD') AS hasta, p.cantidad, p.monto, p.forma, p.referencia,
                p.created_at, u.username AS usuario
         FROM remesa_pagos_comision p JOIN usuarios u ON u.id = p.usuario_id
         WHERE p.agente_id = $1 ORDER BY p.created_at DESC LIMIT 100`,
        [agenteId],
      ),
    ]);
    if (saldo.length === 0) throw new NotFoundException('Agente no encontrado');
    return { agente: saldo[0], entregas: entregas.rows, pagos: pagos.rows };
  }

  // Lugar del dinero: caja abierta (efectivo) o cuenta en pesos.
  private async destinoDinero(
    c: PoolClient,
    forma: string,
    cajaIdTexto: unknown,
    cuentaIdTexto: unknown,
  ) {
    if (forma === 'efectivo') {
      const cajaId = texto(cajaIdTexto).toLowerCase();
      if (!UUID.test(cajaId))
        throw new BadRequestException(
          'Seleccione la caja (debe estar abierta)',
        );
      const s = await c.query<{ id: string; caja: string }>(
        `SELECT s.id, c.nombre AS caja FROM caja_sesiones s JOIN cajas c ON c.id = s.caja_id
         WHERE s.caja_id = $1 AND s.estado = 'abierta' FOR UPDATE OF s`,
        [cajaId],
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
    const cuentaId = texto(cuentaIdTexto).toLowerCase();
    if (!UUID.test(cuentaId))
      throw new BadRequestException('Seleccione la cuenta');
    const ct = await c.query<{ id: string; nombre: string }>(
      `SELECT id, nombre FROM cuentas WHERE id = $1 AND is_active AND moneda = 'DOP'
       FOR UPDATE`,
      [cuentaId],
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

  // El agente entrega lo cobrado: a la caja (efectivo) o depósito (por confirmar).
  async registrarEntrega(
    actorId: string,
    ip: string | undefined,
    datos: {
      agenteId?: unknown;
      dia?: unknown;
      monto?: unknown;
      forma?: unknown;
      cajaId?: unknown;
      cuentaId?: unknown;
      referencia?: unknown;
      notas?: unknown;
    },
  ) {
    const agenteId = texto(datos.agenteId).toLowerCase();
    if (!UUID.test(agenteId))
      throw new BadRequestException('Seleccione el agente');
    const monto = montoPositivo(datos.monto);
    const forma = texto(datos.forma);
    if (forma !== 'efectivo' && forma !== 'deposito')
      throw new BadRequestException('Forma inválida: efectivo o deposito');
    const referencia = opcional(datos.referencia, 60, 'Referencia');
    const notas = opcional(datos.notas, 500, 'Notas');

    return this.db.transaccion(async (c) => {
      const ag = await c.query<Agente>(
        'SELECT id, codigo, nombre, tipo, is_active FROM remesa_agentes WHERE id = $1 FOR UPDATE',
        [agenteId],
      );
      if (ag.rowCount === 0)
        throw new NotFoundException('Agente no encontrado');
      const a = ag.rows[0];
      const { hoy } = await this.hoy(c);
      const dia = texto(datos.dia) || hoy;
      if (!fechaValida(dia) || dia > hoy)
        throw new BadRequestException(
          'Día inválido (no puede ser en el futuro)',
        );
      const debe = (await this.saldos(c, agenteId))[0].debe;
      const alcanza = await c.query<{ ok: boolean }>(
        'SELECT $1::numeric <= $2::numeric AS ok',
        [monto, debe],
      );
      if (!alcanza.rows[0].ok) {
        throw new BadRequestException(
          `${a.nombre} solo debe RD$${debe}: no se puede registrar una entrega mayor`,
        );
      }
      const destino = await this.destinoDinero(
        c,
        forma,
        datos.cajaId,
        datos.cuentaId,
      );
      const e = await c.query<{ id: string }>(
        `INSERT INTO remesa_entregas (agente_id, dia, monto, forma, referencia, notas, usuario_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [agenteId, dia, monto, forma, referencia, notas, actorId],
      );
      const motivo = `Entrega de envíos de ${a.codigo} ${a.nombre} (${dia})`;
      if (destino.tipo === 'caja') {
        await c.query(
          `INSERT INTO caja_movimientos (sesion_id, tipo, monto, motivo, remesa_entrega_id, usuario_id)
           VALUES ($1, 'ingreso', $2, $3, $4, $5)`,
          [destino.id, monto, motivo, e.rows[0].id, actorId],
        );
      } else {
        await c.query(
          `INSERT INTO cuenta_movimientos
             (cuenta_id, tipo, signo, monto, tasa, monto_dop, fecha, por_confirmar,
              referencia, motivo, remesa_entrega_id, usuario_id)
           VALUES ($1, 'ingreso', 1, $2, 1, $2, $3, true, $4, $5, $6, $7)`,
          [destino.id, monto, dia, referencia, motivo, e.rows[0].id, actorId],
        );
      }
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'remesa.entrega',
        entidad: 'remesa_agentes',
        entidadId: agenteId,
        nuevo: {
          agente: a.codigo,
          dia,
          monto,
          forma,
          destino: destino.nombre,
          referencia,
        },
        ip,
      });
      await contabilizar(c, 'remesa_entrega', e.rows[0].id, actorId);
      return {
        id: e.rows[0].id,
        debe: (await this.saldos(c, agenteId))[0].debe,
      };
    });
  }

  // Paga la comisión de los envíos confirmados hasta "hasta" que no se han pagado.
  async pagarComisiones(
    actorId: string,
    ip: string | undefined,
    datos: {
      agenteId?: unknown;
      hasta?: unknown;
      forma?: unknown;
      cajaId?: unknown;
      cuentaId?: unknown;
      referencia?: unknown;
    },
  ) {
    const agenteId = texto(datos.agenteId).toLowerCase();
    if (!UUID.test(agenteId))
      throw new BadRequestException('Seleccione el agente');
    const forma = texto(datos.forma);
    if (forma !== 'efectivo' && forma !== 'banco')
      throw new BadRequestException('Forma inválida: efectivo o banco');
    const referencia = opcional(datos.referencia, 60, 'Referencia');

    return this.db.transaccion(async (c) => {
      const ag = await c.query<Agente>(
        'SELECT id, codigo, nombre, tipo, is_active FROM remesa_agentes WHERE id = $1 FOR UPDATE',
        [agenteId],
      );
      if (ag.rowCount === 0)
        throw new NotFoundException('Agente no encontrado');
      const a = ag.rows[0];
      if (a.tipo === 'propio')
        throw new BadRequestException('El punto propio no cobra comisión');
      const { hoy, zona } = await this.hoy(c);
      const hasta = texto(datos.hasta) || hoy;
      if (!fechaValida(hasta) || hasta > hoy)
        throw new BadRequestException(
          'Fecha "hasta" inválida (no puede ser en el futuro)',
        );
      const envios = await c.query<{ id: string }>(
        `SELECT id FROM remesas
         WHERE agente_id = $1 AND estado = 'confirmado' AND origen = 'sistema'
           AND pago_comision_id IS NULL AND comision_agente > 0
           AND (resuelto_en AT TIME ZONE $3)::date <= $2::date
         ORDER BY resuelto_en FOR UPDATE`,
        [agenteId, hasta, zona],
      );
      if (envios.rowCount === 0)
        throw new BadRequestException(
          `${a.nombre} no tiene comisiones pendientes hasta ${hasta}`,
        );
      const ids = envios.rows.map((f) => f.id);
      const t = (
        await c.query<{ monto: string; desde: string }>(
          `SELECT sum(comision_agente)::numeric(14,2) AS monto,
                  to_char(min((resuelto_en AT TIME ZONE $2)::date), 'YYYY-MM-DD') AS desde
           FROM remesas WHERE id = ANY($1::uuid[])`,
          [ids, zona],
        )
      ).rows[0];

      const destino = await this.destinoDinero(
        c,
        forma === 'efectivo' ? 'efectivo' : 'deposito',
        datos.cajaId,
        datos.cuentaId,
      );
      // No sale más dinero del que hay.
      const hay =
        destino.tipo === 'caja'
          ? (await c.query<{ esperado: string }>(SQL_ESPERADO, [destino.id]))
              .rows[0].esperado
          : (
              await c.query<{ disponible: string }>(SQL_DISPONIBLE, [
                destino.id,
              ])
            ).rows[0].disponible;
      const ok = await c.query<{ ok: boolean }>(
        'SELECT $1::numeric >= $2::numeric AS ok',
        [hay, t.monto],
      );
      if (!ok.rows[0].ok)
        throw new BadRequestException(
          `No hay suficiente dinero en ${destino.nombre}: hay RD$${hay} y la comisión es RD$${t.monto}`,
        );

      const p = await c.query<{ id: string }>(
        `INSERT INTO remesa_pagos_comision
           (agente_id, desde, hasta, cantidad, monto, forma, referencia, usuario_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          agenteId,
          t.desde,
          hasta,
          ids.length,
          t.monto,
          forma,
          referencia,
          actorId,
        ],
      );
      const pagoId = p.rows[0].id;
      await c.query(
        'UPDATE remesas SET pago_comision_id = $1, updated_at = now() WHERE id = ANY($2::uuid[])',
        [pagoId, ids],
      );
      const categoria = (
        await c.query<{ id: string }>(
          `SELECT id FROM categorias_gasto WHERE codigo = 'comisiones_agentes'`,
        )
      ).rows[0].id;
      const motivo = `Comisión de envíos de ${a.codigo} ${a.nombre} (${t.desde} a ${hasta}, ${ids.length} envíos)`;
      if (destino.tipo === 'caja') {
        await c.query(
          `INSERT INTO caja_movimientos
             (sesion_id, tipo, monto, categoria_gasto_id, motivo, remesa_pago_id, usuario_id)
           VALUES ($1, 'gasto', $2, $3, $4, $5, $6)`,
          [destino.id, t.monto, categoria, motivo, pagoId, actorId],
        );
      } else {
        await c.query(
          `INSERT INTO cuenta_movimientos
             (cuenta_id, tipo, signo, monto, tasa, monto_dop, fecha, categoria_gasto_id,
              beneficiario, referencia, motivo, remesa_pago_id, usuario_id)
           VALUES ($1, 'pago', -1, $2, 1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            destino.id,
            t.monto,
            hoy,
            categoria,
            a.nombre,
            referencia,
            motivo,
            pagoId,
            actorId,
          ],
        );
      }
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'remesa.pagar_comision',
        entidad: 'remesa_agentes',
        entidadId: agenteId,
        nuevo: {
          agente: a.codigo,
          desde: t.desde,
          hasta,
          envios: ids.length,
          monto: t.monto,
          forma,
          origen: destino.nombre,
        },
        ip,
      });
      await contabilizar(c, 'remesa_pago', pagoId, actorId);
      return {
        id: pagoId,
        monto: t.monto,
        envios: ids.length,
        desde: t.desde,
        hasta,
      };
    });
  }

  // ---------- Recibo ----------

  private async datosRecibo(
    actorId: string,
    id: string,
  ): Promise<DatosReciboEnvio> {
    const envio = (await this.detalle(
      actorId,
      id,
    )) as unknown as DatosReciboEnvio['envio'] & {
      agente_codigo: string;
      billetera: string | null;
    };
    const e = await this.db.query<DatosReciboEnvio['empresa']>(
      'SELECT nombre_comercial, rnc, telefono, correo FROM empresa WHERE id = 1',
    );
    return {
      empresa: e.rows[0],
      envio: { ...envio, agente: `${envio.agente_codigo} ${envio.agente}` },
      zonaHoraria: await this.config(this.db, 'empresa.zona_horaria'),
    };
  }

  async recibo(actorId: string, id: string, formato: unknown) {
    const f = texto(formato) || '80';
    if (f !== '80' && f !== '58' && f !== 'carta')
      throw new BadRequestException('Formato inválido: use 80, 58 o carta');
    const d = await this.datosRecibo(actorId, id);
    const pdf = await generarReciboEnvio(d, f as Formato);
    return { pdf, nombre: `${d.envio.numero_texto}.pdf` };
  }

  // Para imprimir directo (se ajusta al papel de la impresora).
  async reciboTicket(actorId: string, id: string) {
    return ticketEnvio(await this.datosRecibo(actorId, id));
  }
}
