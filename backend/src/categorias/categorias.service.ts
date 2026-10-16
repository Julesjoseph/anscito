import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { registrarAuditoria } from '../auditoria/auditoria';
import { DatabaseService } from '../database/database.service';

// Unidades de negocio y categorías: listas universales que comparten
// servicios y (más adelante) productos de inventario. No se borran: se
// desactivan, y no se pueden desactivar mientras algo activo las use.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIJO = /^[A-Z0-9]{2,5}$/;

function texto(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
}

function validarNombre(v: unknown, que: string): string {
  const nombre = texto(v);
  if (!nombre || nombre.length > 100) {
    throw new BadRequestException(
      `El nombre de la ${que} es obligatorio (máximo 100 caracteres)`,
    );
  }
  return nombre;
}

function validarMotivo(activo: unknown, motivo: unknown): string {
  if (typeof activo !== 'boolean') {
    throw new BadRequestException('Estado inválido');
  }
  const m = texto(motivo);
  if (!activo && m.length < 5) {
    throw new BadRequestException(
      'Escriba el motivo de la desactivación (mínimo 5 caracteres)',
    );
  }
  return m;
}

// "Diseño Gráfico" -> "diseno_grafico" (código interno, no se muestra).
export function codigoDesdeNombre(nombre: string): string {
  const base = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 26);
  return base || 'unidad';
}

function esDuplicado(e: unknown): boolean {
  return (e as { code?: string }).code === '23505';
}

function errorCategoriaDuplicada(e: unknown) {
  return (e as { constraint?: string }).constraint === 'categorias_prefijo_uq'
    ? new ConflictException('Ese prefijo ya lo usa otra categoría')
    : new ConflictException('Ya existe esa categoría en esa unidad de negocio');
}

// Lista "A, B, C y 2 más" para los mensajes de error.
function listaCorta(codigos: string[], total: number): string {
  const resto = total - codigos.length;
  return codigos.join(', ') + (resto > 0 ? ` y ${resto} más` : '');
}

@Injectable()
export class CategoriasService {
  constructor(private readonly db: DatabaseService) {}

  // Todas las unidades con sus categorías (activas e inactivas).
  async arbol() {
    const r = await this.db.query(
      `SELECT un.id, un.codigo, un.nombre, un.is_active,
              (SELECT count(*)::int FROM servicios s
                WHERE s.unidad_negocio_id = un.id AND s.is_active = true)
                AS servicios_activos,
              (SELECT count(*)::int FROM productos p
                 JOIN categorias c ON c.id = p.categoria_id
                WHERE c.unidad_negocio_id = un.id AND p.is_active = true)
                AS productos_activos,
              COALESCE(
                (SELECT json_agg(json_build_object(
                          'id', c.id,
                          'nombre', c.nombre,
                          'descripcion', c.descripcion,
                          'is_active', c.is_active,
                          'prefijo', c.prefijo,
                          'impuesto_id', c.impuesto_id,
                          -- Vista previa del próximo código de producto.
                          'proximo', CASE WHEN c.prefijo IS NULL THEN NULL
                            ELSE c.prefijo || '-' ||
                                 lpad((c.ultimo_numero + 1)::text, 4, '0') END,
                          'servicios_activos',
                            (SELECT count(*) FROM servicios s
                              WHERE s.categoria_id = c.id AND s.is_active = true),
                          'productos_activos',
                            (SELECT count(*) FROM productos p
                              WHERE p.categoria_id = c.id AND p.is_active = true),
                          'productos', (SELECT count(*) FROM productos p
                              WHERE p.categoria_id = c.id))
                        ORDER BY lower(c.nombre))
                 FROM categorias c WHERE c.unidad_negocio_id = un.id),
                '[]'::json) AS categorias
       FROM unidades_negocio un
       ORDER BY lower(un.nombre)`,
    );
    return r.rows;
  }

  async impuestos() {
    const r = await this.db.query(
      'SELECT id, codigo, nombre FROM impuestos WHERE is_active = true ORDER BY nombre',
    );
    return r.rows;
  }

  // Servicios y productos activos que usan una unidad o categoría.
  private async registrosActivos(
    c: PoolClient,
    columna: 'unidad_negocio_id' | 'categoria_id',
    id: string,
  ): Promise<{ total: number; codigos: string[] }> {
    const productos =
      columna === 'categoria_id'
        ? `SELECT codigo FROM productos
           WHERE categoria_id = $1 AND is_active = true`
        : `SELECT p.codigo FROM productos p
           JOIN categorias c ON c.id = p.categoria_id
           WHERE c.unidad_negocio_id = $1 AND p.is_active = true`;
    const r = await c.query<{ codigo: string; total: number }>(
      `SELECT codigo, count(*) OVER ()::int AS total
       FROM (SELECT codigo FROM servicios
             WHERE ${columna} = $1 AND is_active = true
             UNION ALL ${productos}) x
       ORDER BY codigo LIMIT 5`,
      [id],
    );
    return {
      total: r.rows[0]?.total ?? 0,
      codigos: r.rows.map((f) => f.codigo),
    };
  }

  // ---------- Unidades de negocio ----------

  async crearUnidad(
    actorId: string,
    ip: string | undefined,
    datos: { nombre?: unknown },
  ) {
    const nombre = validarNombre(datos.nombre, 'unidad de negocio');
    try {
      return await this.db.transaccion(async (c) => {
        // Código interno único a partir del nombre.
        const base = codigoDesdeNombre(nombre);
        const usados = await c.query<{ codigo: string }>(
          'SELECT codigo FROM unidades_negocio WHERE codigo LIKE $1',
          [`${base}%`],
        );
        const ocupados = new Set(usados.rows.map((f) => f.codigo));
        let codigo = base;
        for (let n = 2; ocupados.has(codigo); n++) codigo = `${base}_${n}`;

        const r = await c.query<{ id: string }>(
          `INSERT INTO unidades_negocio (codigo, nombre, created_by)
           VALUES ($1, $2, $3) RETURNING id`,
          [codigo, nombre, actorId],
        );
        const id = r.rows[0].id;
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'unidad_negocio.crear',
          entidad: 'unidades_negocio',
          entidadId: id,
          nuevo: { codigo, nombre },
          ip,
        });
        return { id };
      });
    } catch (e) {
      if (esDuplicado(e)) {
        throw new ConflictException(
          'Ya existe una unidad de negocio con ese nombre',
        );
      }
      throw e;
    }
  }

  async editarUnidad(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: { nombre?: unknown },
  ) {
    if (!UUID.test(id))
      throw new NotFoundException('Unidad de negocio no encontrada');
    const nombre = validarNombre(datos.nombre, 'unidad de negocio');
    try {
      return await this.db.transaccion(async (c) => {
        const r = await c.query<{ nombre: string }>(
          'SELECT nombre FROM unidades_negocio WHERE id = $1 FOR UPDATE',
          [id],
        );
        if (r.rowCount === 0) {
          throw new NotFoundException('Unidad de negocio no encontrada');
        }
        const antes = r.rows[0].nombre;
        if (antes === nombre) return { ok: true };
        await c.query(
          'UPDATE unidades_negocio SET nombre = $2, updated_at = now() WHERE id = $1',
          [id, nombre],
        );
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'unidad_negocio.editar',
          entidad: 'unidades_negocio',
          entidadId: id,
          anterior: { nombre: antes },
          nuevo: { nombre },
          ip,
        });
        return { ok: true };
      });
    } catch (e) {
      if (esDuplicado(e)) {
        throw new ConflictException(
          'Ya existe una unidad de negocio con ese nombre',
        );
      }
      throw e;
    }
  }

  async estadoUnidad(
    actorId: string,
    id: string,
    activo: unknown,
    motivo: unknown,
    ip: string | undefined,
  ) {
    if (!UUID.test(id))
      throw new NotFoundException('Unidad de negocio no encontrada');
    const textoMotivo = validarMotivo(activo, motivo);

    return this.db.transaccion(async (c) => {
      const r = await c.query<{ nombre: string; is_active: boolean }>(
        'SELECT nombre, is_active FROM unidades_negocio WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (r.rowCount === 0) {
        throw new NotFoundException('Unidad de negocio no encontrada');
      }
      const antes = r.rows[0];
      if (antes.is_active === activo) return { ok: true };

      if (!activo) {
        const uso = await this.registrosActivos(c, 'unidad_negocio_id', id);
        if (uso.total > 0) {
          throw new BadRequestException(
            `No se puede desactivar: la usan ${uso.total} servicio(s) o producto(s) activo(s): ${listaCorta(uso.codigos, uso.total)}. Desactívelos o cámbielos de unidad primero.`,
          );
        }
      }

      await c.query(
        'UPDATE unidades_negocio SET is_active = $2, updated_at = now() WHERE id = $1',
        [id, activo],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: activo ? 'unidad_negocio.activar' : 'unidad_negocio.desactivar',
        entidad: 'unidades_negocio',
        entidadId: id,
        anterior: { nombre: antes.nombre, is_active: antes.is_active },
        nuevo: { nombre: antes.nombre, is_active: activo },
        motivo: textoMotivo || undefined,
        ip,
      });
      return { ok: true };
    });
  }

  // ---------- Categorías ----------

  private validarCategoria(datos: {
    unidadNegocioId?: unknown;
    prefijo?: unknown;
    nombre?: unknown;
    descripcion?: unknown;
    impuestoId?: unknown;
  }) {
    const unidadId = texto(datos.unidadNegocioId).toLowerCase();
    if (!UUID.test(unidadId)) {
      throw new BadRequestException('Seleccione la unidad de negocio');
    }
    const nombre = validarNombre(datos.nombre, 'categoría');
    const descripcion = texto(datos.descripcion);
    if (descripcion.length > 500) {
      throw new BadRequestException(
        'La descripción no puede pasar de 500 caracteres',
      );
    }
    const prefijo = texto(datos.prefijo).toUpperCase();
    if (prefijo && !PREFIJO.test(prefijo)) {
      throw new BadRequestException(
        'Prefijo inválido: 2 a 5 letras o números, sin espacios (ej: CUA)',
      );
    }
    // Impuesto sugerido para sus productos y servicios (vacío = sin sugerencia).
    const impuestoId = texto(datos.impuestoId).toLowerCase();
    if (impuestoId && !UUID.test(impuestoId)) {
      throw new BadRequestException('Impuesto inválido');
    }
    return {
      unidadId,
      nombre,
      descripcion: descripcion || null,
      prefijo: prefijo || null,
      impuesto_id: impuestoId || null,
    };
  }

  private async impuestoActivo(c: PoolClient, impuestoId: string | null) {
    if (!impuestoId) return;
    const r = await c.query(
      'SELECT 1 FROM impuestos WHERE id = $1 AND is_active = true',
      [impuestoId],
    );
    if (r.rowCount === 0) {
      throw new BadRequestException('El impuesto no existe o está inactivo');
    }
  }

  private async unidadActiva(c: PoolClient, unidadId: string) {
    const r = await c.query(
      'SELECT 1 FROM unidades_negocio WHERE id = $1 AND is_active = true',
      [unidadId],
    );
    if (r.rowCount === 0) {
      throw new BadRequestException(
        'La unidad de negocio no existe o está inactiva',
      );
    }
  }

  async crearCategoria(
    actorId: string,
    ip: string | undefined,
    datos: {
      unidadNegocioId?: unknown;
      nombre?: unknown;
      descripcion?: unknown;
      prefijo?: unknown;
      impuestoId?: unknown;
    },
  ) {
    const d = this.validarCategoria(datos);
    try {
      return await this.db.transaccion(async (c) => {
        await this.unidadActiva(c, d.unidadId);
        await this.impuestoActivo(c, d.impuesto_id);
        const r = await c.query<{ id: string }>(
          `INSERT INTO categorias
             (unidad_negocio_id, nombre, descripcion, prefijo, impuesto_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [
            d.unidadId,
            d.nombre,
            d.descripcion,
            d.prefijo,
            d.impuesto_id,
            actorId,
          ],
        );
        const id = r.rows[0].id;
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'categoria.crear',
          entidad: 'categorias',
          entidadId: id,
          nuevo: {
            unidad_negocio_id: d.unidadId,
            nombre: d.nombre,
            descripcion: d.descripcion,
            prefijo: d.prefijo,
            impuesto_id: d.impuesto_id,
          },
          ip,
        });
        return { id };
      });
    } catch (e) {
      if (esDuplicado(e)) throw errorCategoriaDuplicada(e);
      throw e;
    }
  }

  async editarCategoria(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: {
      unidadNegocioId?: unknown;
      nombre?: unknown;
      descripcion?: unknown;
      prefijo?: unknown;
      impuestoId?: unknown;
    },
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Categoría no encontrada');
    const d = this.validarCategoria(datos);
    try {
      return await this.db.transaccion(async (c) => {
        const r = await c.query<{
          unidad_negocio_id: string;
          nombre: string;
          descripcion: string | null;
          prefijo: string | null;
          impuesto_id: string | null;
        }>(
          `SELECT unidad_negocio_id, nombre, descripcion, prefijo, impuesto_id
           FROM categorias WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (r.rowCount === 0)
          throw new NotFoundException('Categoría no encontrada');
        const antes = r.rows[0];

        if (antes.unidad_negocio_id !== d.unidadId) {
          await this.unidadActiva(c, d.unidadId);
          // Un servicio siempre queda en la misma unidad que su categoría.
          const usados = await c.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM servicios WHERE categoria_id = $1',
            [id],
          );
          if (usados.rows[0].n > 0) {
            throw new BadRequestException(
              `No se puede mover a otra unidad: la usan ${usados.rows[0].n} servicio(s). Cree una categoría nueva en la otra unidad.`,
            );
          }
        }

        // El prefijo arma los códigos: no cambia si ya hay productos.
        if (antes.prefijo !== d.prefijo) {
          const prods = await c.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM productos WHERE categoria_id = $1',
            [id],
          );
          if (prods.rows[0].n > 0) {
            throw new BadRequestException(
              `No se puede cambiar el prefijo: la categoría ya tiene ${prods.rows[0].n} producto(s) con códigos ${antes.prefijo}-…`,
            );
          }
        }

        if (antes.impuesto_id !== d.impuesto_id)
          await this.impuestoActivo(c, d.impuesto_id);

        const cambios = (
          [
            'unidad_negocio_id',
            'nombre',
            'descripcion',
            'prefijo',
            'impuesto_id',
          ] as const
        ).filter((k) => {
          const nuevo = k === 'unidad_negocio_id' ? d.unidadId : d[k];
          return antes[k] !== nuevo;
        });
        if (cambios.length === 0) return { ok: true };

        await c.query(
          `UPDATE categorias
           SET unidad_negocio_id = $2, nombre = $3, descripcion = $4,
               prefijo = $5, impuesto_id = $6, updated_at = now()
           WHERE id = $1`,
          [id, d.unidadId, d.nombre, d.descripcion, d.prefijo, d.impuesto_id],
        );
        const nuevo = {
          unidad_negocio_id: d.unidadId,
          nombre: d.nombre,
          descripcion: d.descripcion,
          prefijo: d.prefijo,
          impuesto_id: d.impuesto_id,
        };
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'categoria.editar',
          entidad: 'categorias',
          entidadId: id,
          anterior: Object.fromEntries(cambios.map((k) => [k, antes[k]])),
          nuevo: Object.fromEntries(cambios.map((k) => [k, nuevo[k]])),
          ip,
        });
        return { ok: true };
      });
    } catch (e) {
      if (esDuplicado(e)) throw errorCategoriaDuplicada(e);
      throw e;
    }
  }

  async estadoCategoria(
    actorId: string,
    id: string,
    activo: unknown,
    motivo: unknown,
    ip: string | undefined,
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Categoría no encontrada');
    const textoMotivo = validarMotivo(activo, motivo);

    return this.db.transaccion(async (c) => {
      const r = await c.query<{
        nombre: string;
        is_active: boolean;
        unidad_negocio_id: string;
      }>(
        'SELECT nombre, is_active, unidad_negocio_id FROM categorias WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (r.rowCount === 0)
        throw new NotFoundException('Categoría no encontrada');
      const antes = r.rows[0];
      if (antes.is_active === activo) return { ok: true };

      if (activo) {
        await this.unidadActiva(c, antes.unidad_negocio_id);
      } else {
        const uso = await this.registrosActivos(c, 'categoria_id', id);
        if (uso.total > 0) {
          throw new BadRequestException(
            `No se puede desactivar: la usan ${uso.total} servicio(s) o producto(s) activo(s): ${listaCorta(uso.codigos, uso.total)}. Desactívelos o cámbielos de categoría primero.`,
          );
        }
      }

      await c.query(
        'UPDATE categorias SET is_active = $2, updated_at = now() WHERE id = $1',
        [id, activo],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: activo ? 'categoria.activar' : 'categoria.desactivar',
        entidad: 'categorias',
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
