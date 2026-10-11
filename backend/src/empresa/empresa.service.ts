import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { registrarAuditoria } from '../auditoria/auditoria';
import { DatabaseService } from '../database/database.service';
import { correoValido, telefonoValido } from '../terceros/documentos';

// Datos de la empresa (una sola fila) y sucursales.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOGO_MAXIMO = 512 * 1024;

// Primeros bytes de cada formato de imagen permitido.
const FIRMAS: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) =>
    b
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) =>
    b.subarray(0, 4).toString('ascii') === 'RIFF' &&
    b.subarray(8, 12).toString('ascii') === 'WEBP',
};

export type DatosEmpresa = {
  razonSocial?: unknown;
  nombreComercial?: unknown;
  rnc?: unknown;
  direccion?: unknown;
  telefono?: unknown;
  whatsapp?: unknown;
  correo?: unknown;
  sitioWeb?: unknown;
};

export type DatosSucursal = {
  codigo?: unknown;
  nombre?: unknown;
  direccion?: unknown;
  telefono?: unknown;
  encargado?: unknown;
};

type Empresa = {
  razon_social: string | null;
  nombre_comercial: string;
  rnc: string | null;
  direccion: string | null;
  telefono: string | null;
  whatsapp: string | null;
  correo: string | null;
  sitio_web: string | null;
};

type Sucursal = {
  codigo: string;
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  encargado: string | null;
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

function telefono(v: unknown, que: string): string | null {
  const t = opcional(v, 30, que);
  if (t && !telefonoValido(t)) {
    throw new BadRequestException(
      `${que} inválido: use números (ej: 809-555-1234)`,
    );
  }
  return t;
}

@Injectable()
export class EmpresaService {
  constructor(private readonly db: DatabaseService) {}

  // ---------- Marca (pública: se ve antes de iniciar sesión) ----------

  async marca() {
    const r = await this.db.query<{
      nombre_comercial: string;
      tiene_logo: boolean;
      version: string;
    }>(
      `SELECT nombre_comercial, logo IS NOT NULL AS tiene_logo,
              extract(epoch FROM updated_at)::bigint::text AS version
       FROM empresa WHERE id = 1`,
    );
    return r.rows[0];
  }

  async logo(): Promise<{ datos: Buffer; tipo: string }> {
    const r = await this.db.query<{
      logo: Buffer | null;
      logo_tipo: string | null;
    }>('SELECT logo, logo_tipo FROM empresa WHERE id = 1');
    const f = r.rows[0];
    if (!f?.logo || !f.logo_tipo)
      throw new NotFoundException('La empresa no tiene logo');
    return { datos: f.logo, tipo: f.logo_tipo };
  }

  // ---------- Datos de la empresa ----------

  async ver() {
    const r = await this.db.query(
      `SELECT razon_social, nombre_comercial, rnc, direccion, telefono,
              whatsapp, correo, sitio_web, logo IS NOT NULL AS tiene_logo,
              updated_at
       FROM empresa WHERE id = 1`,
    );
    return r.rows[0];
  }

  validarEmpresa(datos: DatosEmpresa): Empresa {
    const nombre = texto(datos.nombreComercial);
    if (!nombre || nombre.length > 100) {
      throw new BadRequestException(
        'El nombre comercial es obligatorio (máximo 100 caracteres)',
      );
    }
    const rnc = texto(datos.rnc).replace(/[\s.-]/g, '');
    if (rnc && !/^[0-9]{9}$/.test(rnc)) {
      throw new BadRequestException(
        'RNC inválido: debe tener 9 dígitos (se aceptan guiones)',
      );
    }
    const correo = opcional(datos.correo, 150, 'Correo')?.toLowerCase() ?? null;
    if (correo && !correoValido(correo)) {
      throw new BadRequestException('Correo inválido (ej: info@empresa.com)');
    }
    return {
      razon_social: opcional(datos.razonSocial, 150, 'Razón social'),
      nombre_comercial: nombre,
      rnc: rnc || null,
      direccion: opcional(datos.direccion, 300, 'Dirección'),
      telefono: telefono(datos.telefono, 'Teléfono'),
      whatsapp: telefono(datos.whatsapp, 'WhatsApp'),
      correo,
      sitio_web: opcional(datos.sitioWeb, 200, 'Sitio web o redes'),
    };
  }

  async editar(actorId: string, ip: string | undefined, datos: DatosEmpresa) {
    const d = this.validarEmpresa(datos);
    return this.db.transaccion(async (c) => {
      const r = await c.query<Empresa>(
        `SELECT razon_social, nombre_comercial, rnc, direccion, telefono,
                whatsapp, correo, sitio_web
         FROM empresa WHERE id = 1 FOR UPDATE`,
      );
      const antes = r.rows[0];
      const cambios = (Object.keys(d) as (keyof Empresa)[]).filter(
        (k) => antes[k] !== d[k],
      );
      if (cambios.length === 0) return { ok: true };
      await c.query(
        `UPDATE empresa
         SET razon_social = $1, nombre_comercial = $2, rnc = $3, direccion = $4,
             telefono = $5, whatsapp = $6, correo = $7, sitio_web = $8,
             updated_by = $9, updated_at = now()
         WHERE id = 1`,
        [
          d.razon_social,
          d.nombre_comercial,
          d.rnc,
          d.direccion,
          d.telefono,
          d.whatsapp,
          d.correo,
          d.sitio_web,
          actorId,
        ],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'empresa.editar',
        entidad: 'empresa',
        entidadId: '1',
        anterior: Object.fromEntries(cambios.map((k) => [k, antes[k]])),
        nuevo: Object.fromEntries(cambios.map((k) => [k, d[k]])),
        ip,
      });
      return { ok: true };
    });
  }

  // El logo llega como "data:image/png;base64,....".
  async cambiarLogo(actorId: string, ip: string | undefined, imagen: unknown) {
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
      texto(imagen),
    );
    if (!m) {
      throw new BadRequestException('Envíe una imagen PNG, JPG o WebP');
    }
    const tipo = m[1];
    const datos = Buffer.from(m[2], 'base64');
    if (datos.length === 0 || datos.length > LOGO_MAXIMO) {
      throw new BadRequestException('El logo debe pesar como máximo 512 KB');
    }
    if (!FIRMAS[tipo](datos)) {
      throw new BadRequestException(
        'El archivo no es una imagen válida del tipo indicado',
      );
    }
    return this.db.transaccion(async (c) => {
      await c.query(
        `UPDATE empresa SET logo = $1, logo_tipo = $2, updated_by = $3,
                updated_at = now()
         WHERE id = 1`,
        [datos, tipo, actorId],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'empresa.cambiar_logo',
        entidad: 'empresa',
        entidadId: '1',
        nuevo: { tipo, tamano_bytes: datos.length },
        ip,
      });
      return { ok: true };
    });
  }

  async quitarLogo(actorId: string, ip: string | undefined) {
    return this.db.transaccion(async (c) => {
      const r = await c.query(
        `UPDATE empresa SET logo = NULL, logo_tipo = NULL, updated_by = $1,
                updated_at = now()
         WHERE id = 1 AND logo IS NOT NULL`,
        [actorId],
      );
      if (r.rowCount === 0) return { ok: true };
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'empresa.quitar_logo',
        entidad: 'empresa',
        entidadId: '1',
        ip,
      });
      return { ok: true };
    });
  }

  // ---------- Sucursales ----------

  async sucursales() {
    const r = await this.db.query(
      `SELECT s.id, s.codigo, s.nombre, s.direccion, s.telefono, s.encargado,
              s.es_principal, s.is_active,
              (SELECT count(*)::int FROM usuarios u
                WHERE u.sucursal_id = s.id AND u.is_active = true) AS usuarios
       FROM sucursales s
       ORDER BY s.es_principal DESC, lower(s.nombre)`,
    );
    return r.rows;
  }

  validarSucursal(datos: DatosSucursal): Sucursal {
    const codigo = texto(datos.codigo).toUpperCase();
    if (!/^[A-Z0-9_-]{2,20}$/.test(codigo)) {
      throw new BadRequestException(
        'Código inválido: 2 a 20 letras, números, guion o guion bajo (ej: SUC-02)',
      );
    }
    const nombre = texto(datos.nombre);
    if (!nombre || nombre.length > 100) {
      throw new BadRequestException(
        'El nombre es obligatorio (máximo 100 caracteres)',
      );
    }
    return {
      codigo,
      nombre,
      direccion: opcional(datos.direccion, 300, 'Dirección'),
      telefono: telefono(datos.telefono, 'Teléfono'),
      encargado: opcional(datos.encargado, 150, 'Encargado'),
    };
  }

  private duplicado(e: unknown): never {
    const restriccion = (e as { constraint?: string }).constraint;
    throw new ConflictException(
      restriccion === 'sucursales_nombre_uq'
        ? 'Ya existe una sucursal con ese nombre'
        : 'Ya existe una sucursal con ese código',
    );
  }

  async crearSucursal(
    actorId: string,
    ip: string | undefined,
    datos: DatosSucursal,
  ) {
    const d = this.validarSucursal(datos);
    try {
      return await this.db.transaccion(async (c) => {
        const r = await c.query<{ id: string }>(
          `INSERT INTO sucursales (codigo, nombre, direccion, telefono, encargado, created_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [d.codigo, d.nombre, d.direccion, d.telefono, d.encargado, actorId],
        );
        const id = r.rows[0].id;
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'sucursal.crear',
          entidad: 'sucursales',
          entidadId: id,
          nuevo: d,
          ip,
        });
        return { id };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') this.duplicado(e);
      throw e;
    }
  }

  private async bloquearSucursal(c: PoolClient, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Sucursal no encontrada');
    const r = await c.query<
      Sucursal & { es_principal: boolean; is_active: boolean }
    >(
      `SELECT codigo, nombre, direccion, telefono, encargado, es_principal, is_active
       FROM sucursales WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (r.rowCount === 0) throw new NotFoundException('Sucursal no encontrada');
    return r.rows[0];
  }

  async editarSucursal(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: DatosSucursal,
  ) {
    const d = this.validarSucursal(datos);
    try {
      return await this.db.transaccion(async (c) => {
        const antes = await this.bloquearSucursal(c, id);
        const cambios = (Object.keys(d) as (keyof Sucursal)[]).filter(
          (k) => antes[k] !== d[k],
        );
        if (cambios.length === 0) return { ok: true };
        await c.query(
          `UPDATE sucursales
           SET codigo = $2, nombre = $3, direccion = $4, telefono = $5,
               encargado = $6, updated_at = now()
           WHERE id = $1`,
          [id, d.codigo, d.nombre, d.direccion, d.telefono, d.encargado],
        );
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'sucursal.editar',
          entidad: 'sucursales',
          entidadId: id,
          anterior: Object.fromEntries(cambios.map((k) => [k, antes[k]])),
          nuevo: Object.fromEntries(cambios.map((k) => [k, d[k]])),
          ip,
        });
        return { ok: true };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') this.duplicado(e);
      throw e;
    }
  }

  async estadoSucursal(
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
      const antes = await this.bloquearSucursal(c, id);
      if (antes.is_active === activo) return { ok: true };
      if (!activo) {
        if (antes.es_principal) {
          throw new BadRequestException(
            'La sucursal principal no se puede desactivar: ahí está el inventario',
          );
        }
        const u = await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM usuarios
           WHERE sucursal_id = $1 AND is_active = true`,
          [id],
        );
        if (u.rows[0].n > 0) {
          throw new BadRequestException(
            `No se puede desactivar: tiene ${u.rows[0].n} usuario(s) activo(s). Cámbielos de sucursal en Usuarios primero.`,
          );
        }
      }
      await c.query(
        'UPDATE sucursales SET is_active = $2, updated_at = now() WHERE id = $1',
        [id, activo],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: activo ? 'sucursal.activar' : 'sucursal.desactivar',
        entidad: 'sucursales',
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
