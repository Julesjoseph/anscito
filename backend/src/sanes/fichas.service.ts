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
  normalizarDocumento,
  telefonoValido,
} from '../terceros/documentos';
import { errorCodigoCliente } from '../terceros/codigo-cliente';
import { cuotaDe, manoDe, porcentaje } from './calendario';
import {
  IDIOMAS,
  MARCADORES,
  NOMBRE_IDIOMA,
  fechaTexto,
  llenarPlantilla,
  pct,
  pesos,
} from './contrato';
import type { Idioma } from './contrato';
import { generarContratoPdf } from './contrato-pdf';
import { faltantesFicha } from './ficha-requisitos';
import { numeroSan } from './sanes.service';

// Ficha del participante del SAN (datos personales, dirección, emergencia),
// referencias y fiador con su confirmación, fotos del documento y contratos.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ARCHIVO = 768000; // 750 KB, igual que en la base

type Consulta = Pick<DatabaseService, 'query'>;

function texto(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
}

function obligatorio(v: unknown, max: number, que: string): string {
  const t = texto(v);
  if (!t) throw new BadRequestException(`${que}: es obligatorio`);
  if (t.length > max)
    throw new BadRequestException(`${que}: máximo ${max} caracteres`);
  return t;
}

function opcional(v: unknown, max: number, que: string): string | null {
  const t = texto(v);
  if (t.length > max)
    throw new BadRequestException(`${que}: máximo ${max} caracteres`);
  return t || null;
}

function telefono(v: unknown, que: string, requerido: boolean) {
  const t = requerido ? obligatorio(v, 30, que) : opcional(v, 30, que);
  if (t && !telefonoValido(t))
    throw new BadRequestException(
      `${que} inválido: use números (ej: 809-555-1234)`,
    );
  return t;
}

function fechaValida(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// Línea para escribir a mano en el contrato lo que falta (ej.: el documento).
const EN_BLANCO = '____________________';

export function numeroContrato(n: number | string) {
  return `C-${String(n).padStart(6, '0')}`;
}

// El documento se valida con el patrón de su tipo (tabla tipos_documento).
async function leerDocumento(
  c: Consulta,
  tipoId: unknown,
  numero: unknown,
  que: string,
): Promise<{ tipoId: string; numero: string; tipo: string }> {
  const id = texto(tipoId).toLowerCase();
  if (!UUID.test(id))
    throw new BadRequestException(`${que}: seleccione el tipo de documento`);
  const n = normalizarDocumento(texto(numero));
  if (!n) throw new BadRequestException(`${que}: escriba el número`);
  const t = await c.query<{ nombre: string; patron: string; ayuda: string }>(
    'SELECT nombre, patron, ayuda FROM tipos_documento WHERE id = $1',
    [id],
  );
  if (t.rowCount === 0)
    throw new BadRequestException(`${que}: tipo de documento inválido`);
  if (!new RegExp(t.rows[0].patron).test(n))
    throw new BadRequestException(`${que}: ${t.rows[0].ayuda}`);
  return { tipoId: id, numero: n, tipo: t.rows[0].nombre };
}

type DatosFicha = {
  fecha_nacimiento: string | null;
  ocupacion: string;
  lugar_trabajo: string | null;
  sector: string;
  municipio: string;
  provincia: string;
  referencia_direccion: string;
  emergencia_nombre: string | null;
  emergencia_telefono: string | null;
  emergencia_relacion: string | null;
  idioma: Idioma;
};

function leerFicha(d: Record<string, unknown>): DatosFicha {
  // Opcional: si se escribe, tiene que ser una fecha válida.
  const nacimiento = texto(d.fechaNacimiento) || null;
  if (nacimiento && (!fechaValida(nacimiento) || nacimiento < '1900-01-02'))
    throw new BadRequestException('Fecha de nacimiento inválida');
  const idioma = (texto(d.idioma) || 'es') as Idioma;
  if (!IDIOMAS.includes(idioma))
    throw new BadRequestException('Idioma del contrato: es, fr o ht');
  const emergenciaNombre = opcional(
    d.emergenciaNombre,
    150,
    'Contacto de emergencia',
  );
  const emergenciaTelefono = telefono(
    d.emergenciaTelefono,
    'Teléfono de emergencia',
    !!emergenciaNombre,
  );
  if (emergenciaTelefono && !emergenciaNombre)
    throw new BadRequestException(
      'Escriba el nombre del contacto de emergencia',
    );
  return {
    fecha_nacimiento: nacimiento,
    ocupacion: obligatorio(d.ocupacion, 100, 'Ocupación'),
    lugar_trabajo: opcional(d.lugarTrabajo, 150, 'Lugar de trabajo'),
    sector: obligatorio(d.sector, 100, 'Sector'),
    municipio: obligatorio(d.municipio, 100, 'Ciudad o municipio'),
    provincia: obligatorio(d.provincia, 100, 'Provincia'),
    referencia_direccion: obligatorio(
      d.referenciaDireccion,
      200,
      'Referencia de la dirección',
    ),
    emergencia_nombre: emergenciaNombre,
    emergencia_telefono: emergenciaTelefono,
    emergencia_relacion: opcional(
      d.emergenciaRelacion,
      60,
      'Relación del contacto de emergencia',
    ),
    idioma,
  };
}

// Tipo real del archivo por sus primeros bytes (no se confía en lo que dice el navegador).
function tipoReal(b: Buffer): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return 'image/jpeg';
  if (
    b
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  if (
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

function leerArchivo(
  datos: unknown,
  permitirPdf: boolean,
): { buf: Buffer; mime: string } {
  const t = texto(datos).replace(/^data:[^;]+;base64,/, '');
  if (!t || !/^[A-Za-z0-9+/=\s]+$/.test(t))
    throw new BadRequestException('Archivo inválido');
  const buf = Buffer.from(t, 'base64');
  if (buf.length === 0) throw new BadRequestException('Archivo vacío');
  if (buf.length > MAX_ARCHIVO)
    throw new BadRequestException(
      'El archivo pesa más de 750 KB: tome la foto otra vez o redúzcala',
    );
  const mime = tipoReal(buf);
  if (!mime || (mime === 'application/pdf' && !permitirPdf))
    throw new BadRequestException(
      permitirPdf
        ? 'Solo fotos (JPG, PNG, WEBP) o PDF'
        : 'Solo fotos (JPG, PNG o WEBP)',
    );
  return { buf, mime };
}

@Injectable()
export class FichasService {
  constructor(private readonly db: DatabaseService) {}

  private async cliente(c: Consulta, terceroId: string, bloquear = false) {
    if (!UUID.test(terceroId))
      throw new NotFoundException('Cliente no encontrado');
    const r = await c.query<{ id: string; nombre: string }>(
      `SELECT id, nombre FROM terceros WHERE id = $1 AND rol = 'cliente' ${bloquear ? 'FOR UPDATE' : ''}`,
      [terceroId],
    );
    if (r.rowCount === 0) throw new NotFoundException('Cliente no encontrado');
    return r.rows[0];
  }

  // ---------- Consultar ----------

  async ver(terceroId: string) {
    await this.cliente(this.db, terceroId);
    const [cli, ficha, garantes, archivos, contratos, falta] =
      await Promise.all([
        this.db.query(
          `SELECT t.id, t.codigo, t.nombre, t.tipo_documento_id, td.nombre AS tipo_documento, t.numero_documento,
                t.telefono, t.whatsapp, t.direccion, t.correo
         FROM terceros t LEFT JOIN tipos_documento td ON td.id = t.tipo_documento_id WHERE t.id = $1`,
          [terceroId],
        ),
        this.db.query(
          `SELECT to_char(fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento, ocupacion, lugar_trabajo,
                sector, municipio, provincia, referencia_direccion, emergencia_nombre,
                emergencia_telefono, emergencia_relacion, idioma, updated_at
         FROM san_fichas WHERE tercero_id = $1`,
          [terceroId],
        ),
        this.db.query(
          `SELECT g.id, g.tipo, g.nombre, g.telefono, g.relacion, g.tipo_documento_id,
                td.nombre AS tipo_documento, g.numero_documento, g.direccion, g.ocupacion,
                g.confirmado, g.confirmado_en, u.username AS confirmado_por_usuario, g.nota_confirmacion
         FROM san_garantes g
         LEFT JOIN tipos_documento td ON td.id = g.tipo_documento_id
         LEFT JOIN usuarios u ON u.id = g.confirmado_por
         WHERE g.tercero_id = $1 AND g.is_active ORDER BY g.tipo, g.created_at`,
          [terceroId],
        ),
        this.db.query(
          `SELECT id, tipo, mime, octet_length(datos) AS bytes, created_at, contrato_id
         FROM san_archivos WHERE tercero_id = $1 AND is_active ORDER BY created_at`,
          [terceroId],
        ),
        this.db.query<{ numero: string }>(
          `SELECT ct.id, ct.numero, ct.idioma, ct.estado, ct.created_at, ct.firmado_en,
                s.numero AS san_numero, s.nombre AS san_nombre, p.numero AS numero_san, p.parte
         FROM san_contratos ct
         JOIN san_participaciones p ON p.id = ct.participacion_id
         JOIN sanes s ON s.id = p.san_id
         WHERE p.tercero_id = $1 ORDER BY ct.created_at DESC`,
          [terceroId],
        ),
        faltantesFicha(this.db, terceroId),
      ]);
    return {
      cliente: cli.rows[0],
      ficha: ficha.rows[0] ?? null,
      garantes: garantes.rows,
      archivos: archivos.rows,
      contratos: contratos.rows.map(
        (x: { numero: string; san_numero?: string }) => ({
          ...x,
          codigo: numeroContrato(x.numero),
          san_codigo: numeroSan(x.san_numero ?? ''),
        }),
      ),
      falta,
    };
  }

  // ---------- Persona nueva desde el SAN ----------

  async crearPersona(
    actorId: string,
    ip: string | undefined,
    datos: Record<string, unknown>,
  ) {
    const nombre = obligatorio(datos.nombre, 150, 'Nombre completo');
    const tel = telefono(datos.telefono, 'Teléfono', false);
    const whatsapp = telefono(datos.whatsapp, 'WhatsApp', false);
    if (!tel && !whatsapp)
      throw new BadRequestException('Escriba el teléfono o el WhatsApp');
    const direccion = obligatorio(
      datos.direccion,
      300,
      'Dirección (calle y número)',
    );
    const correo = opcional(datos.correo, 150, 'Correo')?.toLowerCase() ?? null;
    if (correo && !correoValido(correo))
      throw new BadRequestException('Correo inválido');
    const ficha = leerFicha(datos);
    const referencias = Array.isArray(datos.referencias)
      ? datos.referencias
      : [];
    if (referencias.length > 2)
      throw new BadRequestException('Máximo dos referencias');
    try {
      return await this.db.transaccion(async (c) => {
        // Documento opcional: si no se escribe número, queda sin documento.
        const doc =
          texto(datos.numeroDocumento) === ''
            ? null
            : await leerDocumento(
                c,
                datos.tipoDocumentoId,
                datos.numeroDocumento,
                'Documento',
              );
        const r = await c.query<{ id: string; codigo: string }>(
          `INSERT INTO terceros (rol, tipo_documento_id, numero_documento, nombre, es_contribuyente,
                                 direccion, telefono, whatsapp, correo, puede_credito, notas, created_by)
           VALUES ('cliente', $1, $2, $3, false, $4, $5, $6, $7, false, 'Registrado desde SOL CASH', $8)
           RETURNING id, codigo`,
          [
            doc?.tipoId ?? null,
            doc?.numero ?? null,
            nombre,
            direccion,
            tel,
            whatsapp,
            correo,
            actorId,
          ],
        );
        const { id, codigo } = r.rows[0];
        await this.insertarFicha(c, id, ficha, actorId);
        for (const ref of referencias)
          await this.insertarGarante(
            c,
            id,
            'referencia',
            ref as Record<string, unknown>,
            actorId,
          );
        if (datos.fiador && typeof datos.fiador === 'object')
          await this.insertarGarante(
            c,
            id,
            'fiador',
            datos.fiador as Record<string, unknown>,
            actorId,
          );
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'san.persona_crear',
          entidad: 'terceros',
          entidadId: id,
          nuevo: {
            nombre,
            codigo,
            documento: doc ? `${doc.tipo} ${doc.numero}` : null,
            referencias: referencias.length,
            fiador: !!datos.fiador,
          },
          ip,
        });
        return { id, codigo };
      });
    } catch (e) {
      const sinCodigo = errorCodigoCliente(e);
      if (sinCodigo) throw sinCodigo;
      if ((e as { code?: string }).code === '23505')
        throw new ConflictException(
          'Ya existe un cliente con ese documento: búsquelo y complete su ficha',
        );
      throw e;
    }
  }

  private async insertarFicha(
    c: PoolClient,
    terceroId: string,
    f: DatosFicha,
    actorId: string,
  ) {
    await c.query(
      `INSERT INTO san_fichas (tercero_id, fecha_nacimiento, ocupacion, lugar_trabajo, sector, municipio,
                               provincia, referencia_direccion, emergencia_nombre, emergencia_telefono,
                               emergencia_relacion, idioma, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        terceroId,
        f.fecha_nacimiento,
        f.ocupacion,
        f.lugar_trabajo,
        f.sector,
        f.municipio,
        f.provincia,
        f.referencia_direccion,
        f.emergencia_nombre,
        f.emergencia_telefono,
        f.emergencia_relacion,
        f.idioma,
        actorId,
      ],
    );
  }

  private async insertarGarante(
    c: PoolClient,
    terceroId: string,
    tipo: 'referencia' | 'fiador',
    d: Record<string, unknown>,
    actorId: string,
  ) {
    const que = tipo === 'fiador' ? 'Fiador' : 'Referencia';
    const nombre = obligatorio(d.nombre, 150, `${que}: nombre`);
    const tel = telefono(d.telefono, `${que}: teléfono`, true);
    const relacion = obligatorio(d.relacion, 60, `${que}: relación`);
    let doc: { tipoId: string; numero: string } | null = null;
    let direccion: string | null = null;
    if (tipo === 'fiador') {
      doc = await leerDocumento(
        c,
        d.tipoDocumentoId,
        d.numeroDocumento,
        'Fiador',
      );
      direccion = obligatorio(d.direccion, 250, 'Fiador: dirección');
    }
    const r = await c.query<{ id: string }>(
      `INSERT INTO san_garantes (tercero_id, tipo, nombre, telefono, relacion, tipo_documento_id,
                                 numero_documento, direccion, ocupacion, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        terceroId,
        tipo,
        nombre,
        tel,
        relacion,
        doc?.tipoId ?? null,
        doc?.numero ?? null,
        direccion,
        opcional(d.ocupacion, 100, `${que}: ocupación`),
        actorId,
      ],
    );
    return r.rows[0].id;
  }

  // ---------- Ficha de un cliente que ya existe ----------

  async guardarFicha(
    actorId: string,
    terceroId: string,
    ip: string | undefined,
    datos: Record<string, unknown>,
  ) {
    const f = leerFicha(datos);
    const tel = telefono(datos.telefono, 'Teléfono', false);
    const whatsapp = telefono(datos.whatsapp, 'WhatsApp', false);
    if (!tel && !whatsapp)
      throw new BadRequestException('Escriba el teléfono o el WhatsApp');
    const direccion = obligatorio(
      datos.direccion,
      300,
      'Dirección (calle y número)',
    );
    return this.db.transaccion(async (c) => {
      const cli = await this.cliente(c, terceroId, true);
      const antes = await c.query(
        'SELECT * FROM san_fichas WHERE tercero_id = $1 FOR UPDATE',
        [terceroId],
      );
      const contacto = await c.query(
        'SELECT telefono, whatsapp, direccion FROM terceros WHERE id = $1',
        [terceroId],
      );
      if (antes.rowCount === 0)
        await this.insertarFicha(c, terceroId, f, actorId);
      else
        await c.query(
          `UPDATE san_fichas SET fecha_nacimiento = $2, ocupacion = $3, lugar_trabajo = $4, sector = $5,
                  municipio = $6, provincia = $7, referencia_direccion = $8, emergencia_nombre = $9,
                  emergencia_telefono = $10, emergencia_relacion = $11, idioma = $12,
                  updated_by = $13, updated_at = now()
           WHERE tercero_id = $1`,
          [
            terceroId,
            f.fecha_nacimiento,
            f.ocupacion,
            f.lugar_trabajo,
            f.sector,
            f.municipio,
            f.provincia,
            f.referencia_direccion,
            f.emergencia_nombre,
            f.emergencia_telefono,
            f.emergencia_relacion,
            f.idioma,
            actorId,
          ],
        );
      await c.query(
        'UPDATE terceros SET telefono = $2, whatsapp = $3, direccion = $4, updated_at = now() WHERE id = $1',
        [terceroId, tel, whatsapp, direccion],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'san.ficha',
        entidad: 'san_fichas',
        entidadId: terceroId,
        anterior: antes.rows[0]
          ? { ...antes.rows[0], ...contacto.rows[0] }
          : undefined,
        nuevo: {
          cliente: cli.nombre,
          ...f,
          telefono: tel,
          whatsapp,
          direccion,
        },
        ip,
      });
      return { ok: true };
    });
  }

  // ---------- Referencias y fiador ----------

  async agregarGarante(
    actorId: string,
    terceroId: string,
    ip: string | undefined,
    datos: Record<string, unknown>,
  ) {
    const tipo = texto(datos.tipo);
    if (tipo !== 'referencia' && tipo !== 'fiador')
      throw new BadRequestException('Tipo inválido: referencia o fiador');
    return this.db.transaccion(async (c) => {
      const cli = await this.cliente(c, terceroId, true);
      if (tipo === 'referencia') {
        const n = await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM san_garantes WHERE tercero_id = $1 AND tipo = 'referencia' AND is_active`,
          [terceroId],
        );
        if (n.rows[0].n >= 2)
          throw new BadRequestException(
            'Ya tiene dos referencias: quite una para agregar otra',
          );
      } else {
        // El fiador nuevo reemplaza al anterior.
        await c.query(
          `UPDATE san_garantes SET is_active = false, updated_at = now()
           WHERE tercero_id = $1 AND tipo = 'fiador' AND is_active`,
          [terceroId],
        );
      }
      const id = await this.insertarGarante(c, terceroId, tipo, datos, actorId);
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: `san.${tipo}_agregar`,
        entidad: 'san_garantes',
        entidadId: id,
        nuevo: { cliente: cli.nombre, nombre: texto(datos.nombre), tipo },
        ip,
      });
      return { id };
    });
  }

  private async garante(c: Consulta, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('No encontrado');
    const r = await c.query<{
      id: string;
      tipo: string;
      nombre: string;
      confirmado: boolean;
      is_active: boolean;
      cliente: string;
    }>(
      `SELECT g.id, g.tipo, g.nombre, g.confirmado, g.is_active, t.nombre AS cliente
       FROM san_garantes g JOIN terceros t ON t.id = g.tercero_id WHERE g.id = $1 FOR UPDATE OF g`,
      [id],
    );
    if (r.rowCount === 0 || !r.rows[0].is_active)
      throw new NotFoundException('Referencia o fiador no encontrado');
    return r.rows[0];
  }

  async confirmarGarante(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: { nota?: unknown },
  ) {
    const nota = obligatorio(datos.nota, 300, 'Nota de la confirmación');
    if (nota.length < 5)
      throw new BadRequestException(
        'Escriba qué se verificó (mínimo 5 caracteres)',
      );
    return this.db.transaccion(async (c) => {
      const g = await this.garante(c, id);
      if (g.confirmado) throw new BadRequestException('Ya estaba confirmado');
      await c.query(
        `UPDATE san_garantes SET confirmado = true, confirmado_por = $2, confirmado_en = now(),
                nota_confirmacion = $3, updated_at = now() WHERE id = $1`,
        [id, actorId, nota],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: `san.${g.tipo}_confirmar`,
        entidad: 'san_garantes',
        entidadId: id,
        nuevo: { cliente: g.cliente, nombre: g.nombre, nota },
        ip,
      });
      return { ok: true };
    });
  }

  async quitarGarante(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: { motivo?: unknown },
  ) {
    const motivo = obligatorio(datos.motivo, 300, 'Motivo');
    return this.db.transaccion(async (c) => {
      const g = await this.garante(c, id);
      await c.query(
        'UPDATE san_garantes SET is_active = false, updated_at = now() WHERE id = $1',
        [id],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: `san.${g.tipo}_quitar`,
        entidad: 'san_garantes',
        entidadId: id,
        anterior: { cliente: g.cliente, nombre: g.nombre },
        motivo,
        ip,
      });
      return { ok: true };
    });
  }

  // ---------- Fotos del documento ----------

  async subirFoto(
    actorId: string,
    terceroId: string,
    ip: string | undefined,
    datos: { tipo?: unknown; datos?: unknown },
  ) {
    const tipo = texto(datos.tipo);
    if (tipo !== 'documento_frente' && tipo !== 'documento_dorso')
      throw new BadRequestException('Indique si es el frente o el dorso');
    const a = leerArchivo(datos.datos, true);
    return this.db.transaccion(async (c) => {
      const cli = await this.cliente(c, terceroId, true);
      await c.query(
        `UPDATE san_archivos SET is_active = false WHERE tercero_id = $1 AND tipo = $2 AND is_active`,
        [terceroId, tipo],
      );
      const r = await c.query<{ id: string }>(
        `INSERT INTO san_archivos (tercero_id, tipo, mime, datos, subido_por)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [terceroId, tipo, a.mime, a.buf, actorId],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'san.foto_documento',
        entidad: 'san_archivos',
        entidadId: r.rows[0].id,
        nuevo: { cliente: cli.nombre, tipo, mime: a.mime, bytes: a.buf.length },
        ip,
      });
      return { id: r.rows[0].id };
    });
  }

  async archivo(id: string): Promise<{ datos: Buffer; mime: string }> {
    if (!UUID.test(id)) throw new NotFoundException('Archivo no encontrado');
    const r = await this.db.query<{ datos: Buffer; mime: string }>(
      'SELECT datos, mime FROM san_archivos WHERE id = $1',
      [id],
    );
    if (r.rowCount === 0) throw new NotFoundException('Archivo no encontrado');
    return r.rows[0];
  }

  // ---------- Plantillas ----------

  async plantillas() {
    const r = await this.db.query(
      `SELECT DISTINCT ON (p.idioma) p.id, p.idioma, p.version, p.titulo, p.texto, p.created_at,
              u.username AS creada_por
       FROM san_contrato_plantillas p LEFT JOIN usuarios u ON u.id = p.created_by
       ORDER BY p.idioma, p.version DESC`,
    );
    return {
      plantillas: r.rows.map((p: { idioma: Idioma }) => ({
        ...p,
        nombre_idioma: NOMBRE_IDIOMA[p.idioma],
      })),
      marcadores: MARCADORES,
    };
  }

  async nuevaPlantilla(
    actorId: string,
    ip: string | undefined,
    datos: { idioma?: unknown; titulo?: unknown; texto?: unknown },
  ) {
    const idioma = texto(datos.idioma) as Idioma;
    if (!IDIOMAS.includes(idioma))
      throw new BadRequestException('Idioma: es, fr o ht');
    const titulo = obligatorio(datos.titulo, 150, 'Título');
    const cuerpo = typeof datos.texto === 'string' ? datos.texto.trim() : '';
    if (cuerpo.length < 50 || cuerpo.length > 30000)
      throw new BadRequestException(
        'El texto debe tener entre 50 y 30,000 caracteres',
      );
    return this.db.transaccion(async (c) => {
      const v = await c.query<{ v: number }>(
        'SELECT COALESCE(max(version), 0)::int + 1 AS v FROM san_contrato_plantillas WHERE idioma = $1',
        [idioma],
      );
      const r = await c.query<{ id: string }>(
        `INSERT INTO san_contrato_plantillas (idioma, version, titulo, texto, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [idioma, v.rows[0].v, titulo, cuerpo, actorId],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'san.plantilla',
        entidad: 'san_contrato_plantillas',
        entidadId: r.rows[0].id,
        nuevo: { idioma, version: v.rows[0].v, titulo },
        ip,
      });
      return { id: r.rows[0].id, version: v.rows[0].v };
    });
  }

  // ---------- Contratos ----------

  async generarContrato(
    actorId: string,
    ip: string | undefined,
    datos: { participacionId?: unknown; idioma?: unknown; lugar?: unknown },
  ) {
    const pid = texto(datos.participacionId).toLowerCase();
    if (!UUID.test(pid))
      throw new BadRequestException('Elija el número del SOL CASH');
    const idioma = texto(datos.idioma) as Idioma;
    if (!IDIOMAS.includes(idioma))
      throw new BadRequestException('Idioma: español, francés o criollo');
    const lugar = obligatorio(datos.lugar, 100, 'Lugar donde se firma');
    try {
      return await this.db.transaccion(async (c) => {
        const p = await c.query<{
          id: string;
          numero: number;
          parte: string;
          tercero_id: string;
          san_numero: string;
          san_nombre: string;
          estado: string;
          frecuencia: string;
          cuota: string;
          cantidad_numeros: number;
          comision_pct: string;
          mora_pct: string;
          dias_gracia: number;
          fecha_mano: string;
          fecha_inicio: string;
        }>(
          `SELECT p.id, p.numero, p.parte, p.tercero_id, s.numero AS san_numero, s.nombre AS san_nombre,
                  s.estado, s.frecuencia, s.cuota, s.cantidad_numeros, s.comision_pct, s.mora_pct, s.dias_gracia,
                  (SELECT to_char(fecha, 'YYYY-MM-DD') FROM san_turnos WHERE san_id = s.id AND turno = p.numero) AS fecha_mano,
                  (SELECT to_char(fecha, 'YYYY-MM-DD') FROM san_turnos WHERE san_id = s.id AND turno = 1) AS fecha_inicio
           FROM san_participaciones p JOIN sanes s ON s.id = p.san_id
           WHERE p.id = $1 FOR UPDATE OF p`,
          [pid],
        );
        if (p.rowCount === 0)
          throw new NotFoundException('Número del SOL CASH no encontrado');
        const x = p.rows[0];
        if (x.estado !== 'preparacion' && x.estado !== 'activo')
          throw new BadRequestException(`El SOL CASH está ${x.estado}`);
        const falta = await faltantesFicha(c, x.tercero_id);
        if (falta.length)
          throw new BadRequestException(
            `Antes del contrato falta: ${falta.join(', ')}`,
          );
        const persona = await c.query<{
          nombre: string;
          documento: string | null;
          tipo: string | null;
          direccion: string | null;
          sector: string;
          municipio: string;
          provincia: string;
        }>(
          `SELECT t.nombre, t.numero_documento AS documento, td.nombre AS tipo, t.direccion,
                  f.sector, f.municipio, f.provincia
           FROM terceros t LEFT JOIN tipos_documento td ON td.id = t.tipo_documento_id
           JOIN san_fichas f ON f.tercero_id = t.id WHERE t.id = $1`,
          [x.tercero_id],
        );
        const fiador = await c.query<{
          nombre: string;
          documento: string;
          tipo: string;
          direccion: string;
        }>(
          `SELECT g.nombre, g.numero_documento AS documento, td.nombre AS tipo, g.direccion
           FROM san_garantes g JOIN tipos_documento td ON td.id = g.tipo_documento_id
           WHERE g.tercero_id = $1 AND g.tipo = 'fiador' AND g.is_active AND g.confirmado`,
          [x.tercero_id],
        );
        const empresa = await c.query<{
          nombre: string;
          rnc: string | null;
          direccion: string | null;
        }>(
          'SELECT COALESCE(razon_social, nombre_comercial) AS nombre, rnc, direccion FROM empresa WHERE id = 1',
        );
        const plantilla = await c.query<{
          id: string;
          titulo: string;
          texto: string;
        }>(
          `SELECT id, titulo, texto FROM san_contrato_plantillas WHERE idioma = $1
           ORDER BY version DESC LIMIT 1`,
          [idioma],
        );
        const zona =
          (
            await c.query<{ valor: string }>(
              `SELECT valor FROM configuracion WHERE clave = 'empresa.zona_horaria'`,
            )
          ).rows[0]?.valor ?? 'America/Santo_Domingo';
        const hoy = (
          await c.query<{ hoy: string }>(
            `SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS hoy`,
            [zona],
          )
        ).rows[0].hoy;
        const per = persona.rows[0];
        const fi = fiador.rows[0];
        const em = empresa.rows[0];
        const mano = manoDe(
          x.cuota,
          x.cantidad_numeros,
          x.parte as 'completo' | 'medio',
        );
        const texto2 = llenarPlantilla(plantilla.rows[0].texto, idioma, {
          empresa: em.nombre,
          empresa_rnc: em.rnc ?? '—',
          empresa_direccion: em.direccion ?? '—',
          participante: per.nombre,
          documento_tipo: per.tipo ?? EN_BLANCO,
          documento: per.documento ?? EN_BLANCO,
          direccion: [per.direccion, per.sector, per.municipio, per.provincia]
            .filter(Boolean)
            .join(', '),
          san_codigo: numeroSan(x.san_numero),
          san_nombre: x.san_nombre,
          numero: String(x.numero),
          parte: x.parte,
          cuota: pesos(cuotaDe(x.cuota, x.parte as 'completo' | 'medio')),
          frecuencia: x.frecuencia,
          cantidad_turnos: String(x.cantidad_numeros),
          fecha_inicio: fechaTexto(x.fecha_inicio),
          mano: pesos(mano),
          fecha_mano: fechaTexto(x.fecha_mano),
          comision_pct: pct(x.comision_pct),
          comision: pesos(porcentaje(mano, x.comision_pct)),
          dias_gracia: String(x.dias_gracia),
          mora_pct: pct(x.mora_pct),
          fiador: fi.nombre,
          fiador_documento: `${fi.tipo} ${fi.documento}`,
          fiador_direccion: fi.direccion,
          ciudad: lugar,
          fecha: fechaTexto(hoy),
        });
        const n = (
          await c.query<{ valor: string }>(
            `UPDATE contadores SET valor = valor + 1 WHERE clave = 'san_contratos' RETURNING valor`,
          )
        ).rows[0].valor;
        const r = await c.query<{ id: string }>(
          `INSERT INTO san_contratos (numero, participacion_id, plantilla_id, idioma, titulo, texto, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            n,
            pid,
            plantilla.rows[0].id,
            idioma,
            plantilla.rows[0].titulo,
            texto2,
            actorId,
          ],
        );
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'san.contrato_generar',
          entidad: 'san_contratos',
          entidadId: r.rows[0].id,
          nuevo: {
            contrato: numeroContrato(n),
            san: numeroSan(x.san_numero),
            numero: x.numero,
            participante: per.nombre,
            idioma,
          },
          ip,
        });
        return { id: r.rows[0].id, codigo: numeroContrato(n) };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw new ConflictException(
          'Ese número ya tiene un contrato vigente: anúlelo para generar otro',
        );
      throw e;
    }
  }

  async contratoPdf(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Contrato no encontrado');
    const r = await this.db.query<{
      numero: string;
      titulo: string;
      texto: string;
      estado: string;
    }>(
      'SELECT numero, titulo, texto, estado FROM san_contratos WHERE id = $1',
      [id],
    );
    if (r.rowCount === 0) throw new NotFoundException('Contrato no encontrado');
    const x = r.rows[0];
    const e = (
      await this.db.query<{
        nombre: string;
        logo: Buffer | null;
        logo_tipo: string | null;
      }>(
        'SELECT nombre_comercial AS nombre, logo, logo_tipo FROM empresa WHERE id = 1',
      )
    ).rows[0];
    const codigo = numeroContrato(x.numero);
    const pdf = await generarContratoPdf({
      empresa: e.nombre,
      logo: e.logo,
      logoTipo: e.logo_tipo,
      numero: codigo,
      titulo: x.estado === 'anulado' ? `${x.titulo} (ANULADO)` : x.titulo,
      texto: x.texto,
      pie: 'ANSCITO',
    });
    return { pdf, nombre: `${codigo}.pdf` };
  }

  private async contrato(c: Consulta, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Contrato no encontrado');
    const r = await c.query<{
      id: string;
      numero: string;
      estado: string;
      tercero_id: string;
    }>(
      `SELECT ct.id, ct.numero, ct.estado, p.tercero_id FROM san_contratos ct
       JOIN san_participaciones p ON p.id = ct.participacion_id WHERE ct.id = $1 FOR UPDATE OF ct`,
      [id],
    );
    if (r.rowCount === 0) throw new NotFoundException('Contrato no encontrado');
    return r.rows[0];
  }

  // Foto o PDF del contrato firmado (una página por llamada).
  async subirFirmado(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: { datos?: unknown },
  ) {
    const a = leerArchivo(datos.datos, true);
    return this.db.transaccion(async (c) => {
      const ct = await this.contrato(c, id);
      if (ct.estado === 'anulado')
        throw new BadRequestException('El contrato está anulado');
      const r = await c.query<{ id: string }>(
        `INSERT INTO san_archivos (tercero_id, tipo, contrato_id, mime, datos, subido_por)
         VALUES ($1, 'contrato_firmado', $2, $3, $4, $5) RETURNING id`,
        [ct.tercero_id, id, a.mime, a.buf, actorId],
      );
      if (ct.estado === 'generado')
        await c.query(
          `UPDATE san_contratos SET estado = 'firmado', firmado_en = now(), firmado_registrado_por = $2
           WHERE id = $1`,
          [id, actorId],
        );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'san.contrato_firmado',
        entidad: 'san_contratos',
        entidadId: id,
        nuevo: {
          contrato: numeroContrato(ct.numero),
          archivo: a.mime,
          bytes: a.buf.length,
        },
        ip,
      });
      return { id: r.rows[0].id };
    });
  }

  async anularContrato(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: { motivo?: unknown },
  ) {
    const motivo = obligatorio(datos.motivo, 300, 'Motivo');
    if (motivo.length < 5)
      throw new BadRequestException('Escriba el motivo (mínimo 5 caracteres)');
    return this.db.transaccion(async (c) => {
      const ct = await this.contrato(c, id);
      if (ct.estado === 'anulado')
        throw new BadRequestException('Ya estaba anulado');
      await c.query(
        `UPDATE san_contratos SET estado = 'anulado', motivo_anulacion = $2 WHERE id = $1`,
        [id, motivo],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'san.contrato_anular',
        entidad: 'san_contratos',
        entidadId: id,
        anterior: { contrato: numeroContrato(ct.numero), estado: ct.estado },
        motivo,
        ip,
      });
      return { ok: true };
    });
  }
}
