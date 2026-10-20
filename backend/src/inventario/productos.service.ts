import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { registrarAuditoria } from '../auditoria/auditoria';
import { siguienteCodigo } from '../comun/codigos';
import { normalizarBusqueda } from '../comun/busqueda';
import { DatabaseService } from '../database/database.service';
import { calcularItbis, normalizarMonto } from '../servicios/calculo-itbis';
import { margenTotal, rentabilidad, restar } from './rentabilidad';
import {
  SQL_TASA_VIGENTE,
  SQL_TOTALES_PRODUCTO,
  STOCK_MINIMO_POR_DEFECTO,
} from './sql';
import { esCero, esEntera, normalizarCantidad } from './cantidades';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Origen común de la lista y de los totales: existencia calculada con los
// movimientos, mínimo efectivo, alerta y precio sin ITBIS. $1 = mínimo por
// defecto.
const SQL_DESDE = `FROM productos p
  JOIN categorias c ON c.id = p.categoria_id
  JOIN unidades_negocio un ON un.id = c.unidad_negocio_id
  JOIN unidades_medida um ON um.id = p.unidad_id
  JOIN impuestos i ON i.id = p.impuesto_id
  ${SQL_TOTALES_PRODUCTO}
  CROSS JOIN LATERAL (SELECT ${SQL_TASA_VIGENTE} AS tasa) tv
  CROSS JOIN LATERAL (
    SELECT COALESCE(p.stock_minimo, $1::numeric)::numeric(14,3) AS minimo) mn
  CROSS JOIN LATERAL (
    SELECT CASE WHEN mv.existencia <= 0 THEN 'agotado'
                WHEN mv.existencia <= mn.minimo THEN 'bajo' END AS alerta) al
  CROSS JOIN LATERAL (
    SELECT CASE WHEN p.precio_venta IS NULL OR tv.tasa IS NULL THEN NULL
                WHEN p.precio_incluye_itbis
                  THEN round(p.precio_venta * 100 / (100 + tv.tasa), 2)
                ELSE p.precio_venta END AS precio_base) pb`;

export type DatosProducto = {
  nombre?: unknown;
  categoriaId?: unknown;
  unidadId?: unknown;
  costo?: unknown;
  impuestoId?: unknown;
  precioVenta?: unknown;
  precioIncluyeItbis?: unknown;
  stockMinimo?: unknown;
  existenciaInicial?: unknown;
};

export type FiltrosProductos = {
  texto?: string;
  categoriaId?: string;
  estado?: string;
  alerta?: string;
  pagina?: string;
  porPagina?: string;
};

type Limpio = {
  nombre: string;
  categoria_id: string;
  unidad_id: string;
  costo: string;
  impuesto_id: string;
  precio_venta: string | null;
  precio_incluye_itbis: boolean;
  stock_minimo: string | null;
};

type FilaProducto = Limpio & {
  id: string;
  codigo: string;
  categoria: string;
  unidad_negocio: string;
  unidad: string;
  permite_decimales: boolean;
  impuesto: string;
  tasa: string | null;
  is_active: boolean;
  existencia_inicial: string;
  entradas: string;
  salidas: string;
  existencia: string;
  minimo: string;
  alerta: 'bajo' | 'agotado' | null;
  precio_base: string | null;
  costo_total: string;
  venta_total: string | null;
  total: number;
};

function texto(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
}

function uuid(v: unknown, mensaje: string): string {
  const t = texto(v).toLowerCase();
  if (!UUID.test(t)) throw new BadRequestException(mensaje);
  return t;
}

// Cantidad opcional: vacío -> null.
function cantidadOpcional(v: unknown, que: string): string | null {
  if (texto(v) === '') return null;
  const c = normalizarCantidad(v);
  if (c === null) {
    throw new BadRequestException(
      `${que} inválido(a): debe ser un número no negativo con hasta 3 decimales`,
    );
  }
  return c;
}

@Injectable()
export class ProductosService {
  constructor(private readonly db: DatabaseService) {}

  // Valida y normaliza lo que llega de la pantalla (sin tocar la base).
  validar(datos: DatosProducto): Limpio {
    const nombre = texto(datos.nombre);
    if (!nombre || nombre.length > 150) {
      throw new BadRequestException(
        'El nombre del producto es obligatorio (máximo 150 caracteres)',
      );
    }
    const categoria_id = uuid(datos.categoriaId, 'Seleccione la categoría');
    const unidad_id = uuid(datos.unidadId, 'Seleccione la unidad');
    const impuesto_id = uuid(datos.impuestoId, 'Seleccione el ITBIS');

    const costo = normalizarMonto(datos.costo);
    if (costo === null) {
      throw new BadRequestException(
        'Costo inválido: debe ser un número no negativo con hasta 2 decimales',
      );
    }

    let precio_venta: string | null = null;
    if (texto(datos.precioVenta) !== '') {
      precio_venta = normalizarMonto(datos.precioVenta);
      if (precio_venta === null) {
        throw new BadRequestException(
          'Precio de venta inválido: debe ser un número no negativo con hasta 2 decimales',
        );
      }
    }

    if (typeof datos.precioIncluyeItbis !== 'boolean') {
      throw new BadRequestException(
        'Indique si el precio de venta incluye ITBIS (sí o no)',
      );
    }

    return {
      nombre,
      categoria_id,
      unidad_id,
      costo,
      impuesto_id,
      precio_venta,
      precio_incluye_itbis: datos.precioIncluyeItbis,
      stock_minimo: cantidadOpcional(datos.stockMinimo, 'Stock mínimo'),
    };
  }

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

  async listar(actorId: string, filtros: FiltrosProductos) {
    // $1 siempre es el stock mínimo por defecto.
    const params: unknown[] = [STOCK_MINIMO_POR_DEFECTO];
    const condiciones: string[] = [];

    const buscar = normalizarBusqueda(texto(filtros.texto));
    if (buscar) {
      params.push(`%${buscar.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
      condiciones.push(
        `(p.codigo ILIKE $${params.length} OR p.nombre ILIKE $${params.length})`,
      );
    }
    const categoria = texto(filtros.categoriaId);
    if (categoria) {
      params.push(uuid(categoria, 'Categoría inválida'));
      condiciones.push(`p.categoria_id = $${params.length}`);
    }
    const estado = texto(filtros.estado) || 'activos';
    if (estado === 'activos') condiciones.push('p.is_active = true');
    else if (estado === 'inactivos') condiciones.push('p.is_active = false');
    else if (estado !== 'todos')
      throw new BadRequestException('Estado inválido');
    if (texto(filtros.alerta) === 'si')
      condiciones.push('al.alerta IS NOT NULL');

    const donde = condiciones.length
      ? 'WHERE ' + condiciones.join(' AND ')
      : '';

    const pagina = Math.max(
      1,
      Number.parseInt(texto(filtros.pagina) || '1', 10) || 1,
    );
    const porPagina = Math.min(
      200,
      Math.max(1, Number.parseInt(texto(filtros.porPagina) || '50', 10) || 50),
    );
    const n = params.length;

    const [r, t, a] = await Promise.all([
      this.db.query<FilaProducto>(
        `SELECT p.id, p.codigo, p.nombre,
                p.categoria_id, c.nombre AS categoria, un.nombre AS unidad_negocio,
                p.unidad_id, um.nombre AS unidad, um.permite_decimales,
                p.costo, p.impuesto_id, i.nombre AS impuesto, tv.tasa,
                p.precio_venta, p.precio_incluye_itbis, p.stock_minimo,
                p.is_active, mv.existencia_inicial, mv.entradas, mv.salidas,
                mv.existencia,
                mn.minimo, al.alerta, pb.precio_base,
                round(mv.existencia * p.costo, 2) AS costo_total,
                round(mv.existencia * pb.precio_base, 2) AS venta_total,
                count(*) OVER ()::int AS total
         ${SQL_DESDE}
         ${donde}
         ORDER BY p.codigo
         LIMIT $${n + 1} OFFSET $${n + 2}`,
        [...params, porPagina, (pagina - 1) * porPagina],
      ),
      // Totales de TODO el filtro, no solo de la página.
      this.db.query<{
        costo_total: string;
        venta_total: string;
        costo_con_precio: string;
      }>(
        `SELECT COALESCE(sum(round(mv.existencia * p.costo, 2)), 0)::numeric(16,2)
                  AS costo_total,
                COALESCE(sum(round(mv.existencia * pb.precio_base, 2)), 0)::numeric(16,2)
                  AS venta_total,
                COALESCE(sum(round(mv.existencia * p.costo, 2))
                  FILTER (WHERE pb.precio_base IS NOT NULL), 0)::numeric(16,2)
                  AS costo_con_precio
         ${SQL_DESDE}
         ${donde}`,
        params,
      ),
      // Alertas de todos los productos activos (para el aviso de arriba).
      this.db.query<{ bajo: number; agotado: number }>(
        `SELECT count(*) FILTER (WHERE al.alerta = 'bajo')::int AS bajo,
                count(*) FILTER (WHERE al.alerta = 'agotado')::int AS agotado
         ${SQL_DESDE}
         WHERE p.is_active = true`,
        [STOCK_MINIMO_POR_DEFECTO],
      ),
    ]);

    // Sin el permiso inventario.ver_costos, el costo (y la ganancia, que
    // lo revela) no sale del servidor.
    const verCostos = await this.tienePermiso(actorId, 'inventario.ver_costos');

    const filas = r.rows.map(
      ({ total: _total, costo, costo_total, precio_base, ...f }) => {
        const precio =
          f.precio_venta !== null && f.tasa !== null
            ? calcularItbis(f.precio_venta, f.tasa, f.precio_incluye_itbis)
            : null;
        if (!verCostos) return { ...f, calculo_precio: precio };
        return {
          ...f,
          costo,
          costo_total,
          // El costo se guarda sin ITBIS; se muestra como una factura.
          calculo_costo:
            f.tasa !== null ? calcularItbis(costo, f.tasa, false) : null,
          calculo_precio: precio,
          rentabilidad:
            precio_base !== null ? rentabilidad(costo, precio_base) : null,
        };
      },
    );

    const tot = t.rows[0];
    const ganancia = restar(tot.venta_total, tot.costo_con_precio);
    const totales = verCostos
      ? {
          costo_total: tot.costo_total,
          venta_total: tot.venta_total,
          ganancia_total: ganancia,
          margen_total: margenTotal(ganancia, tot.venta_total),
        }
      : { venta_total: tot.venta_total };

    return {
      filas,
      total: r.rows[0]?.total ?? 0,
      pagina,
      porPagina,
      verCostos,
      totales,
      alertas: a.rows[0],
      stockMinimoPorDefecto: STOCK_MINIMO_POR_DEFECTO,
    };
  }

  async catalogos() {
    const [categorias, unidades, impuestos] = await Promise.all([
      this.db.query(
        `SELECT c.id, c.nombre, c.prefijo, c.impuesto_id, un.nombre AS unidad_negocio,
                CASE WHEN c.prefijo IS NULL THEN NULL
                     ELSE c.prefijo || '-' || lpad((c.ultimo_numero + 1)::text, 4, '0')
                END AS proximo
         FROM categorias c
         JOIN unidades_negocio un ON un.id = c.unidad_negocio_id
           AND un.is_active = true
         WHERE c.is_active = true
         ORDER BY lower(un.nombre), lower(c.nombre)`,
      ),
      this.db.query(
        `SELECT id, codigo, nombre, permite_decimales FROM unidades_medida
         WHERE is_active = true ORDER BY nombre`,
      ),
      this.db.query(
        `SELECT i.id, i.codigo, i.nombre, ${SQL_TASA_VIGENTE} AS tasa
         FROM impuestos i WHERE i.is_active = true ORDER BY i.nombre`,
      ),
    ]);
    return {
      categorias: categorias.rows,
      unidades: unidades.rows,
      impuestos: impuestos.rows.filter(
        (i: { tasa: string | null }) => i.tasa !== null,
      ),
    };
  }

  // Para que la pantalla verifique su vista previa con el servidor.
  async calcular(datos: {
    monto?: unknown;
    impuestoId?: unknown;
    incluyeItbis?: unknown;
  }) {
    const monto = normalizarMonto(datos.monto);
    if (monto === null) throw new BadRequestException('Monto inválido');
    const impuestoId = uuid(datos.impuestoId, 'Seleccione el ITBIS');
    if (typeof datos.incluyeItbis !== 'boolean') {
      throw new BadRequestException('Indique si el monto incluye ITBIS');
    }
    const tasa = await this.tasaVigente(this.db, impuestoId);
    return { tasa, ...calcularItbis(monto, tasa, datos.incluyeItbis) };
  }

  private async tasaVigente(
    c: Pick<DatabaseService, 'query'>,
    impuestoId: string,
  ): Promise<string> {
    const r = await c.query<{ tasa: string | null }>(
      `SELECT ${SQL_TASA_VIGENTE} AS tasa
       FROM impuestos i WHERE i.id = $1 AND i.is_active = true`,
      [impuestoId],
    );
    if (r.rowCount === 0) {
      throw new BadRequestException('El impuesto no existe o está inactivo');
    }
    if (r.rows[0].tasa === null) {
      throw new BadRequestException(
        'El impuesto no tiene una tasa vigente hoy',
      );
    }
    return r.rows[0].tasa;
  }

  private async categoriaActiva(c: PoolClient, categoriaId: string) {
    const r = await c.query<{ nombre: string; prefijo: string | null }>(
      `SELECT c.nombre, c.prefijo
       FROM categorias c
       JOIN unidades_negocio un ON un.id = c.unidad_negocio_id
         AND un.is_active = true
       WHERE c.id = $1 AND c.is_active = true`,
      [categoriaId],
    );
    if (r.rowCount === 0) {
      throw new BadRequestException('La categoría no existe o está inactiva');
    }
    return r.rows[0];
  }

  // Devuelve si la unidad admite decimales y revisa las cantidades.
  private async verificarUnidad(
    c: PoolClient,
    unidadId: string,
    cantidades: (string | null)[],
  ) {
    const r = await c.query<{ nombre: string; permite_decimales: boolean }>(
      `SELECT nombre, permite_decimales FROM unidades_medida
       WHERE id = $1 AND is_active = true`,
      [unidadId],
    );
    if (r.rowCount === 0) {
      throw new BadRequestException('La unidad no existe o está inactiva');
    }
    const u = r.rows[0];
    if (
      !u.permite_decimales &&
      cantidades.some((q) => q !== null && !esEntera(q))
    ) {
      throw new BadRequestException(
        `La unidad "${u.nombre}" no admite decimales: use números enteros`,
      );
    }
  }

  private errorDuplicado(e: unknown): never {
    if (
      (e as { constraint?: string }).constraint ===
      'productos_nombre_categoria_uq'
    ) {
      throw new ConflictException(
        'Ya existe un producto con ese nombre en esa categoría',
      );
    }
    throw new ConflictException(
      'No se pudo asignar el código; intente guardar de nuevo',
    );
  }

  async crear(actorId: string, ip: string | undefined, datos: DatosProducto) {
    const d = this.validar(datos);
    const existencia = cantidadOpcional(
      datos.existenciaInicial,
      'Existencia inicial',
    );

    try {
      return await this.db.transaccion(async (c) => {
        const cat = await this.categoriaActiva(c, d.categoria_id);
        if (!cat.prefijo) {
          throw new BadRequestException(
            `La categoría "${cat.nombre}" no tiene prefijo. Asígnele uno en Categorías antes de registrar productos.`,
          );
        }
        await this.verificarUnidad(c, d.unidad_id, [
          d.stock_minimo,
          existencia,
        ]);
        await this.tasaVigente(c, d.impuesto_id);

        // Siguiente código de la categoría (comun/codigos.ts).
        const codigo = await siguienteCodigo(c, d.categoria_id);

        const r = await c.query<{ id: string }>(
          `INSERT INTO productos
             (codigo, nombre, categoria_id, unidad_id, costo, impuesto_id,
              precio_venta, precio_incluye_itbis, stock_minimo, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id`,
          [
            codigo,
            d.nombre,
            d.categoria_id,
            d.unidad_id,
            d.costo,
            d.impuesto_id,
            d.precio_venta,
            d.precio_incluye_itbis,
            d.stock_minimo,
            actorId,
          ],
        );
        const id = r.rows[0].id;

        if (existencia !== null && !esCero(existencia)) {
          const suc = await c.query<{ id: string }>(
            `SELECT id FROM sucursales WHERE is_active = true
             ORDER BY created_at LIMIT 1`,
          );
          if (suc.rowCount === 0) {
            throw new BadRequestException('No hay ninguna sucursal activa');
          }
          await c.query(
            `INSERT INTO movimientos_inventario
               (producto_id, sucursal_id, tipo, cantidad, costo_unitario,
                referencia, usuario_id)
             VALUES ($1, $2, 'inicial', $3, $4, $5, $6)`,
            [
              id,
              suc.rows[0].id,
              existencia,
              d.costo,
              'Existencia inicial',
              actorId,
            ],
          );
        }

        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'producto.crear',
          entidad: 'productos',
          entidadId: id,
          nuevo: { codigo, ...d, existencia_inicial: existencia ?? '0.000' },
          ip,
        });
        return { id, codigo };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') this.errorDuplicado(e);
      throw e;
    }
  }

  // El código y la existencia inicial nunca se editan.
  async editar(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: DatosProducto,
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Producto no encontrado');
    const d = this.validar(datos);
    const verCostos = await this.tienePermiso(actorId, 'inventario.ver_costos');

    try {
      return await this.db.transaccion(async (c) => {
        const r = await c.query<Limpio & { codigo: string }>(
          `SELECT codigo, nombre, categoria_id, unidad_id, costo, impuesto_id,
                  precio_venta, precio_incluye_itbis, stock_minimo
           FROM productos WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (r.rowCount === 0)
          throw new NotFoundException('Producto no encontrado');
        const antes = r.rows[0];

        // Quien no puede ver el costo tampoco puede cambiarlo.
        if (!verCostos) d.costo = antes.costo;

        // Con movimientos, el costo lo calculan las entradas; un error se
        // corrige con "Corregir costo", que exige motivo.
        if (d.costo !== antes.costo) {
          const movs = await c.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM movimientos_inventario WHERE producto_id = $1',
            [id],
          );
          if (movs.rows[0].n > 0) {
            throw new BadRequestException(
              'El costo de un producto con movimientos no se edita aquí: use "Corregir costo" e indique el motivo',
            );
          }
        }

        if (antes.categoria_id !== d.categoria_id) {
          await this.categoriaActiva(c, d.categoria_id);
        }
        if (antes.unidad_id !== d.unidad_id) {
          const movs = await c.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM movimientos_inventario WHERE producto_id = $1',
            [id],
          );
          if (movs.rows[0].n > 0) {
            throw new BadRequestException(
              'No se puede cambiar la unidad: el producto ya tiene movimientos de inventario registrados en la unidad actual',
            );
          }
        }
        await this.verificarUnidad(c, d.unidad_id, [d.stock_minimo]);
        await this.tasaVigente(c, d.impuesto_id);

        await c.query(
          `UPDATE productos
           SET nombre = $2, categoria_id = $3, unidad_id = $4, costo = $5,
               impuesto_id = $6, precio_venta = $7, precio_incluye_itbis = $8,
               stock_minimo = $9, updated_at = now()
           WHERE id = $1`,
          [
            id,
            d.nombre,
            d.categoria_id,
            d.unidad_id,
            d.costo,
            d.impuesto_id,
            d.precio_venta,
            d.precio_incluye_itbis,
            d.stock_minimo,
          ],
        );

        // Cada tipo de cambio es un registro de auditoría distinto.
        const grupos: { accion: string; campos: (keyof Limpio)[] }[] = [
          { accion: 'producto.cambiar_costo', campos: ['costo'] },
          {
            accion: 'producto.cambiar_precio',
            campos: ['precio_venta', 'precio_incluye_itbis'],
          },
          { accion: 'producto.cambiar_impuesto', campos: ['impuesto_id'] },
          { accion: 'producto.cambiar_categoria', campos: ['categoria_id'] },
          {
            accion: 'producto.editar',
            campos: ['nombre', 'unidad_id', 'stock_minimo'],
          },
        ];
        for (const g of grupos) {
          const cambiados = g.campos.filter((k) => antes[k] !== d[k]);
          if (cambiados.length === 0) continue;
          await registrarAuditoria(c, {
            usuarioId: actorId,
            accion: g.accion,
            entidad: 'productos',
            entidadId: id,
            anterior: {
              codigo: antes.codigo,
              ...Object.fromEntries(cambiados.map((k) => [k, antes[k]])),
            },
            nuevo: {
              codigo: antes.codigo,
              ...Object.fromEntries(cambiados.map((k) => [k, d[k]])),
            },
            ip,
          });
        }
        return { ok: true };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') this.errorDuplicado(e);
      throw e;
    }
  }

  async cambiarEstado(
    actorId: string,
    id: string,
    activo: unknown,
    motivo: unknown,
    ip: string | undefined,
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Producto no encontrado');
    if (typeof activo !== 'boolean')
      throw new BadRequestException('Estado inválido');
    const textoMotivo = texto(motivo);
    if (!activo && textoMotivo.length < 5) {
      throw new BadRequestException(
        'Escriba el motivo de la desactivación (mínimo 5 caracteres)',
      );
    }

    return this.db.transaccion(async (c) => {
      const r = await c.query<{
        codigo: string;
        is_active: boolean;
        categoria_id: string;
      }>(
        'SELECT codigo, is_active, categoria_id FROM productos WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (r.rowCount === 0)
        throw new NotFoundException('Producto no encontrado');
      const antes = r.rows[0];
      if (antes.is_active === activo) return { ok: true };
      if (activo) await this.categoriaActiva(c, antes.categoria_id);

      await c.query(
        'UPDATE productos SET is_active = $2, updated_at = now() WHERE id = $1',
        [id, activo],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: activo ? 'producto.activar' : 'producto.desactivar',
        entidad: 'productos',
        entidadId: id,
        anterior: { codigo: antes.codigo, is_active: antes.is_active },
        nuevo: { codigo: antes.codigo, is_active: activo },
        motivo: textoMotivo || undefined,
        ip,
      });
      return { ok: true };
    });
  }
}
