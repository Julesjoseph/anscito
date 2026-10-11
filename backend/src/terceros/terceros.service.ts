import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { registrarAuditoria } from '../auditoria/auditoria';
import { DatabaseService } from '../database/database.service';
import {
  correoValido,
  enmascarar,
  normalizarDocumento,
  telefonoValido,
} from './documentos';

// Clientes y proveedores: una tabla (terceros) con dos listas separadas
// según el "rol". Los datos personales (documento, teléfono, WhatsApp,
// correo, dirección) se protegen: el documento sale enmascarado sin el
// permiso terceros.ver_documento, y la auditoría guarda el documento
// enmascarado y solo QUÉ datos de contacto cambiaron, no sus valores.

export type Rol = 'cliente' | 'proveedor';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOMBRE_ROL: Record<Rol, string> = {
  cliente: 'cliente',
  proveedor: 'proveedor',
};
const CAMPOS_PERSONALES = [
  'direccion',
  'telefono',
  'whatsapp',
  'correo',
] as const;

export type DatosTercero = {
  tipoDocumentoId?: unknown;
  numeroDocumento?: unknown;
  nombre?: unknown;
  nombreComercial?: unknown;
  esContribuyente?: unknown;
  direccion?: unknown;
  telefono?: unknown;
  whatsapp?: unknown;
  correo?: unknown;
  notas?: unknown;
  puedeCredito?: unknown;
  personaContacto?: unknown;
  diasCredito?: unknown;
};

export type FiltrosTerceros = {
  texto?: string;
  estado?: string;
  contribuyente?: string;
  pagina?: string;
  porPagina?: string;
};

type Limpio = {
  tipo_documento_id: string | null;
  numero_documento: string | null;
  nombre: string;
  nombre_comercial: string | null;
  es_contribuyente: boolean;
  direccion: string | null;
  telefono: string | null;
  whatsapp: string | null;
  correo: string | null;
  notas: string | null;
  puede_credito: boolean;
  persona_contacto: string | null;
  dias_credito: number | null;
};

function texto(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
}

function opcional(v: unknown, max: number, que: string): string | null {
  const t = texto(v);
  if (t.length > max) {
    throw new BadRequestException(`${que}: máximo ${max} caracteres`);
  }
  return t || null;
}

@Injectable()
export class TercerosService {
  constructor(private readonly db: DatabaseService) {}

  async tienePermiso(usuarioId: string, codigo: string): Promise<boolean> {
    const r = await this.db.query(
      `SELECT 1
       FROM usuario_roles ur
       JOIN roles ro ON ro.id = ur.rol_id AND ro.is_active = true
       JOIN rol_permisos rp ON rp.rol_id = ro.id
       JOIN permisos p ON p.id = rp.permiso_id
       WHERE ur.usuario_id = $1 AND p.codigo = $2
       LIMIT 1`,
      [usuarioId, codigo],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async tiposDocumento() {
    const r = await this.db.query(
      `SELECT id, codigo, nombre, ayuda FROM tipos_documento
       WHERE is_active = true ORDER BY orden, nombre`,
    );
    return r.rows;
  }

  // Validación sin base de datos (el formato del documento se revisa luego
  // contra el patrón de su tipo).
  validar(rol: Rol, datos: DatosTercero): Limpio {
    const nombre = texto(datos.nombre);
    if (!nombre || nombre.length > 150) {
      throw new BadRequestException(
        'El nombre o razón social es obligatorio (máximo 150 caracteres)',
      );
    }

    const tipo = texto(datos.tipoDocumentoId).toLowerCase();
    const numero = normalizarDocumento(texto(datos.numeroDocumento));
    if ((tipo === '') !== (numero === '')) {
      throw new BadRequestException(
        tipo
          ? 'Escriba el número de documento'
          : 'Seleccione el tipo de documento',
      );
    }
    if (tipo && !UUID.test(tipo)) {
      throw new BadRequestException('Tipo de documento inválido');
    }

    if (typeof datos.esContribuyente !== 'boolean') {
      throw new BadRequestException('Indique si es contribuyente (sí o no)');
    }
    if (datos.esContribuyente && !numero) {
      throw new BadRequestException(
        'Un contribuyente debe tener su RNC, cédula u otro documento',
      );
    }

    const telefono = opcional(datos.telefono, 30, 'Teléfono');
    if (telefono && !telefonoValido(telefono)) {
      throw new BadRequestException(
        'Teléfono inválido: use números (ej: 809-555-1234)',
      );
    }
    const whatsapp = opcional(datos.whatsapp, 30, 'WhatsApp');
    if (whatsapp && !telefonoValido(whatsapp)) {
      throw new BadRequestException(
        'WhatsApp inválido: use números (ej: 829-555-1234)',
      );
    }
    const correo = opcional(datos.correo, 150, 'Correo')?.toLowerCase() ?? null;
    if (correo && !correoValido(correo)) {
      throw new BadRequestException('Correo inválido (ej: ventas@empresa.com)');
    }

    let puede_credito = false;
    let dias_credito: number | null = null;
    if (rol === 'cliente') {
      if (typeof datos.puedeCredito !== 'boolean') {
        throw new BadRequestException(
          'Indique si puede comprar a crédito (sí o no)',
        );
      }
      puede_credito = datos.puedeCredito;
    } else {
      const dias = texto(datos.diasCredito);
      if (dias) {
        if (!/^\d{1,3}$/.test(dias) || Number(dias) > 365) {
          throw new BadRequestException(
            'Días de plazo inválidos: un número entero de 0 a 365 (vacío = al contado)',
          );
        }
        dias_credito = Number(dias);
      }
    }

    return {
      tipo_documento_id: tipo || null,
      numero_documento: numero || null,
      nombre,
      nombre_comercial: opcional(
        datos.nombreComercial,
        150,
        'Nombre comercial',
      ),
      es_contribuyente: datos.esContribuyente,
      direccion: opcional(datos.direccion, 300, 'Dirección'),
      telefono,
      whatsapp,
      correo,
      notas: opcional(datos.notas, 1000, 'Notas'),
      puede_credito,
      persona_contacto: opcional(
        datos.personaContacto,
        150,
        'Persona de contacto',
      ),
      dias_credito,
    };
  }

  // Revisa el formato del documento contra su tipo y que no esté repetido
  // en la misma lista.
  private async verificarDocumento(
    c: PoolClient,
    rol: Rol,
    d: Limpio,
    excluirId: string | null,
  ) {
    if (!d.tipo_documento_id || !d.numero_documento) return;
    const t = await c.query<{ nombre: string; patron: string; ayuda: string }>(
      'SELECT nombre, patron, ayuda FROM tipos_documento WHERE id = $1 AND is_active = true',
      [d.tipo_documento_id],
    );
    if (t.rowCount === 0) {
      throw new BadRequestException('El tipo de documento no existe');
    }
    if (!new RegExp(t.rows[0].patron).test(d.numero_documento)) {
      throw new BadRequestException(
        `Documento inválido. ${t.rows[0].ayuda} (se aceptan guiones y espacios)`,
      );
    }
    const dup = await c.query<{ nombre: string; is_active: boolean }>(
      `SELECT nombre, is_active FROM terceros
       WHERE rol = $1 AND tipo_documento_id = $2 AND numero_documento = $3
         AND ($4::uuid IS NULL OR id <> $4::uuid)`,
      [rol, d.tipo_documento_id, d.numero_documento, excluirId],
    );
    if ((dup.rowCount ?? 0) > 0) {
      const otro = dup.rows[0];
      throw new ConflictException(
        `Ya existe un ${NOMBRE_ROL[rol]} con ese documento (${t.rows[0].nombre}): "${otro.nombre}"${
          otro.is_active ? '' : ' (desactivado; puede reactivarlo)'
        }`,
      );
    }
  }

  async listar(rol: Rol, actorId: string, filtros: FiltrosTerceros) {
    const params: unknown[] = [rol];
    const condiciones = ['t.rol = $1'];

    const buscar = texto(filtros.texto);
    if (buscar) {
      params.push(`%${buscar.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
      const n = params.length;
      // También por documento o teléfono escritos con guiones o espacios.
      params.push(`%${normalizarDocumento(buscar)}%`);
      params.push(`%${buscar.replace(/\D/g, '') || '§'}%`);
      condiciones.push(
        `(t.nombre ILIKE $${n} OR t.nombre_comercial ILIKE $${n}
          OR t.numero_documento LIKE $${n + 1}
          OR regexp_replace(coalesce(t.telefono, ''), '\\D', '', 'g') LIKE $${n + 2}
          OR regexp_replace(coalesce(t.whatsapp, ''), '\\D', '', 'g') LIKE $${n + 2})`,
      );
    }
    const estado = texto(filtros.estado) || 'activos';
    if (estado === 'activos') condiciones.push('t.is_active = true');
    else if (estado === 'inactivos') condiciones.push('t.is_active = false');
    else if (estado !== 'todos')
      throw new BadRequestException('Estado inválido');
    if (texto(filtros.contribuyente) === 'si')
      condiciones.push('t.es_contribuyente = true');

    const pagina = Math.max(
      1,
      Number.parseInt(texto(filtros.pagina) || '1', 10) || 1,
    );
    const porPagina = Math.min(
      200,
      Math.max(1, Number.parseInt(texto(filtros.porPagina) || '50', 10) || 50),
    );
    const n = params.length;

    const r = await this.db.query<
      Limpio & {
        id: string;
        tipo_documento: string | null;
        es_protegido: boolean;
        is_active: boolean;
        total: number;
      }
    >(
      `SELECT t.id, t.tipo_documento_id, td.nombre AS tipo_documento,
              t.numero_documento, t.nombre, t.nombre_comercial,
              t.es_contribuyente, t.direccion, t.telefono, t.whatsapp, t.correo,
              t.notas, t.puede_credito, t.persona_contacto, t.dias_credito,
              t.es_protegido, t.is_active,
              count(*) OVER ()::int AS total
       FROM terceros t
       LEFT JOIN tipos_documento td ON td.id = t.tipo_documento_id
       WHERE ${condiciones.join(' AND ')}
       ORDER BY t.es_protegido DESC, lower(t.nombre)
       LIMIT $${n + 1} OFFSET $${n + 2}`,
      [...params, porPagina, (pagina - 1) * porPagina],
    );

    const verDocumento = await this.tienePermiso(
      actorId,
      'terceros.ver_documento',
    );
    const filas = r.rows.map(({ total: _t, ...f }) => ({
      ...f,
      numero_documento: verDocumento
        ? f.numero_documento
        : enmascarar(f.numero_documento),
    }));
    return {
      filas,
      total: r.rows[0]?.total ?? 0,
      pagina,
      porPagina,
      verDocumento,
    };
  }

  // Datos para la auditoría: sin valores personales, documento enmascarado.
  private paraAuditoria(d: Partial<Limpio>) {
    const resto: Record<string, unknown> = { ...d };
    for (const k of CAMPOS_PERSONALES) delete resto[k];
    // El documento solo aparece si viene en los datos, y siempre enmascarado.
    if ('numero_documento' in d) {
      resto.numero_documento = enmascarar(d.numero_documento ?? null);
    }
    return resto;
  }

  async crear(
    rol: Rol,
    actorId: string,
    ip: string | undefined,
    datos: DatosTercero,
  ) {
    const d = this.validar(rol, datos);
    try {
      return await this.db.transaccion(async (c) => {
        await this.verificarDocumento(c, rol, d, null);
        const r = await c.query<{ id: string }>(
          `INSERT INTO terceros
             (rol, tipo_documento_id, numero_documento, nombre, nombre_comercial,
              es_contribuyente, direccion, telefono, whatsapp, correo, notas,
              puede_credito, persona_contacto, dias_credito, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           RETURNING id`,
          [
            rol,
            d.tipo_documento_id,
            d.numero_documento,
            d.nombre,
            d.nombre_comercial,
            d.es_contribuyente,
            d.direccion,
            d.telefono,
            d.whatsapp,
            d.correo,
            d.notas,
            d.puede_credito,
            d.persona_contacto,
            d.dias_credito,
            actorId,
          ],
        );
        const id = r.rows[0].id;
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: `${rol}.crear`,
          entidad: 'terceros',
          entidadId: id,
          nuevo: {
            rol,
            ...this.paraAuditoria(d),
            datos_contacto_registrados: CAMPOS_PERSONALES.filter(
              (k) => d[k] !== null,
            ),
          },
          ip,
        });
        return { id };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException(
          `Ya existe un ${NOMBRE_ROL[rol]} con ese documento`,
        );
      }
      throw e;
    }
  }

  private async bloquear(c: PoolClient, rol: Rol, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Registro no encontrado');
    const r = await c.query<
      Limpio & { es_protegido: boolean; is_active: boolean }
    >(
      `SELECT tipo_documento_id, numero_documento, nombre, nombre_comercial,
              es_contribuyente, direccion, telefono, whatsapp, correo, notas,
              puede_credito, persona_contacto, dias_credito, es_protegido, is_active
       FROM terceros WHERE id = $1 AND rol = $2 FOR UPDATE`,
      [id, rol],
    );
    if (r.rowCount === 0) {
      throw new NotFoundException(
        rol === 'cliente' ? 'Cliente no encontrado' : 'Proveedor no encontrado',
      );
    }
    const t = r.rows[0];
    if (t.es_protegido) {
      throw new BadRequestException(
        `"${t.nombre}" es un registro del sistema: no se edita ni se desactiva`,
      );
    }
    return t;
  }

  async editar(
    rol: Rol,
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: DatosTercero,
  ) {
    const d = this.validar(rol, datos);
    const verDocumento = await this.tienePermiso(
      actorId,
      'terceros.ver_documento',
    );

    try {
      return await this.db.transaccion(async (c) => {
        const antes = await this.bloquear(c, rol, id);
        // Quien no ve el documento completo tampoco puede cambiarlo.
        if (!verDocumento) {
          d.tipo_documento_id = antes.tipo_documento_id;
          d.numero_documento = antes.numero_documento;
          if (d.es_contribuyente && !d.numero_documento) {
            throw new BadRequestException(
              'Un contribuyente debe tener su RNC, cédula u otro documento',
            );
          }
        }
        await this.verificarDocumento(c, rol, d, id);

        const campos = Object.keys(d) as (keyof Limpio)[];
        const cambiados = campos.filter((k) => antes[k] !== d[k]);
        if (cambiados.length === 0) return { ok: true };

        await c.query(
          `UPDATE terceros
           SET tipo_documento_id = $2, numero_documento = $3, nombre = $4,
               nombre_comercial = $5, es_contribuyente = $6, direccion = $7,
               telefono = $8, whatsapp = $9, correo = $10, notas = $11,
               puede_credito = $12, persona_contacto = $13, dias_credito = $14,
               updated_at = now()
           WHERE id = $1`,
          [
            id,
            d.tipo_documento_id,
            d.numero_documento,
            d.nombre,
            d.nombre_comercial,
            d.es_contribuyente,
            d.direccion,
            d.telefono,
            d.whatsapp,
            d.correo,
            d.notas,
            d.puede_credito,
            d.persona_contacto,
            d.dias_credito,
          ],
        );

        const personales = cambiados.filter((k) =>
          (CAMPOS_PERSONALES as readonly string[]).includes(k),
        );
        const otros = cambiados.filter((k) => !personales.includes(k));
        const pick = (o: Limpio) =>
          this.paraAuditoria(Object.fromEntries(otros.map((k) => [k, o[k]])));
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: `${rol}.editar`,
          entidad: 'terceros',
          entidadId: id,
          anterior: { nombre: antes.nombre, ...pick(antes) },
          nuevo: {
            nombre: d.nombre,
            ...pick(d),
            ...(personales.length
              ? { datos_contacto_cambiados: personales }
              : {}),
          },
          ip,
        });
        return { ok: true };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException(
          `Ya existe un ${NOMBRE_ROL[rol]} con ese documento`,
        );
      }
      throw e;
    }
  }

  async cambiarEstado(
    rol: Rol,
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
      const antes = await this.bloquear(c, rol, id);
      if (antes.is_active === activo) return { ok: true };
      await c.query(
        'UPDATE terceros SET is_active = $2, updated_at = now() WHERE id = $1',
        [id, activo],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: `${rol}.${activo ? 'activar' : 'desactivar'}`,
        entidad: 'terceros',
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
