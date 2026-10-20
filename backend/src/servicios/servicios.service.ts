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
import { calcularItbis, normalizarMonto } from './calculo-itbis';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Tasa vigente hoy de un impuesto (subconsulta reutilizable).
const SQL_TASA_VIGENTE = `(SELECT t.tasa FROM impuesto_tasas t
   WHERE t.impuesto_id = i.id
     AND t.vigente_desde <= current_date
     AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= current_date)
   ORDER BY t.vigente_desde DESC LIMIT 1)`;

export type DatosServicio = {
  codigo?: unknown;
  nombre?: unknown;
  descripcion?: unknown;
  unidadNegocioId?: unknown;
  categoriaId?: unknown;
  unidadMedidaId?: unknown;
  precio?: unknown;
  moneda?: unknown;
  costo?: unknown;
  impuestoId?: unknown;
  precioIncluyeItbis?: unknown;
  gananciaTipo?: unknown;
  comisionPct?: unknown;
  porCuentaTercero?: unknown;
};

export type Filtros = {
  texto?: string;
  unidadNegocioId?: string;
  categoriaId?: string;
  estado?: string;
};

type Limpio = {
  codigo: string;
  nombre: string;
  descripcion: string | null;
  unidad_negocio_id: string;
  categoria_id: string | null;
  unidad_medida_id: string;
  precio: string;
  moneda: 'DOP' | 'USD'; // del precio y del costo
  costo: string | null;
  impuesto_id: string;
  precio_incluye_itbis: boolean;
  ganancia_tipo: 'costo' | 'comision';
  comision_pct: string | null;
  // Con comisión: el resto del cobro es de un tercero (no es ingreso).
  por_cuenta_tercero: boolean;
};

type FilaServicio = Limpio & {
  id: string;
  unidad_negocio: string;
  categoria: string | null;
  unidad_medida: string;
  impuesto: string;
  is_active: boolean;
};

function texto(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
}

@Injectable()
export class ServiciosService {
  constructor(private readonly db: DatabaseService) {}

  // Valida y normaliza lo que llega de la pantalla.
  // El código no viene de la pantalla: se crea solo al guardar (prefijo de
  // la categoría + número) y no se cambia después (está en ventas e informes).
  validar(datos: DatosServicio): Limpio {
    const nombre = texto(datos.nombre);
    const descripcion = texto(datos.descripcion);
    const unidadNegocioId = texto(datos.unidadNegocioId).toLowerCase();
    const categoriaId = texto(datos.categoriaId).toLowerCase();
    const unidadMedidaId = texto(datos.unidadMedidaId).toLowerCase();
    const impuestoId = texto(datos.impuestoId).toLowerCase();

    if (!nombre || nombre.length > 150) {
      throw new BadRequestException(
        'El nombre es obligatorio (máximo 150 caracteres)',
      );
    }
    if (descripcion.length > 1000) {
      throw new BadRequestException(
        'La descripción no puede pasar de 1000 caracteres',
      );
    }
    if (!UUID.test(unidadNegocioId)) {
      throw new BadRequestException('Seleccione la unidad de negocio');
    }
    // La categoría es obligatoria (ordena los servicios y la ganancia por línea).
    if (!UUID.test(categoriaId)) {
      throw new BadRequestException('Seleccione la categoría del servicio');
    }
    if (!UUID.test(unidadMedidaId)) {
      throw new BadRequestException('Seleccione la unidad de medida');
    }
    if (!UUID.test(impuestoId)) {
      throw new BadRequestException('Seleccione el impuesto');
    }

    const precio = normalizarMonto(datos.precio);
    if (precio === null) {
      throw new BadRequestException(
        'Precio inválido: debe ser un número no negativo con hasta 2 decimales',
      );
    }

    // Moneda del precio (y del costo): RD$ o US$. En US$ se convierte a RD$
    // con la tasa del día al vender.
    const moneda = texto(datos.moneda) || 'DOP';
    if (moneda !== 'DOP' && moneda !== 'USD') {
      throw new BadRequestException('Moneda del precio: RD$ (DOP) o US$ (USD)');
    }

    let costo: string | null = null;
    if (texto(datos.costo) !== '') {
      costo = normalizarMonto(datos.costo);
      if (costo === null) {
        throw new BadRequestException(
          'Costo inválido: debe ser un número no negativo con hasta 2 decimales',
        );
      }
    }

    if (typeof datos.precioIncluyeItbis !== 'boolean') {
      throw new BadRequestException(
        'Indique si el precio incluye ITBIS (sí o no)',
      );
    }

    // Cómo se calcula la ganancia: por costo (precio − costo) o por
    // comisión (precio × %). Sin indicarlo, es por costo.
    const gananciaTipo = texto(datos.gananciaTipo) || 'costo';
    if (gananciaTipo !== 'costo' && gananciaTipo !== 'comision') {
      throw new BadRequestException('Forma de ganancia inválida');
    }
    let comisionPct: string | null = null;
    if (gananciaTipo === 'comision') {
      const pct = texto(datos.comisionPct);
      if (
        !/^\d{1,3}(\.\d{1,2})?$/.test(pct) ||
        Number(pct) <= 0 ||
        Number(pct) > 100
      ) {
        throw new BadRequestException(
          'Comisión inválida: un porcentaje mayor que 0 y hasta 100, con hasta 2 decimales',
        );
      }
      const [e, d = ''] = pct.split('.');
      comisionPct = `${Number(e)}.${d.padEnd(2, '0')}`;
      // Con comisión, el costo no se usa.
      costo = null;
    }

    return {
      codigo: '',
      nombre,
      descripcion: descripcion || null,
      unidad_negocio_id: unidadNegocioId,
      categoria_id: categoriaId || null,
      unidad_medida_id: unidadMedidaId,
      precio,
      moneda,
      costo,
      impuesto_id: impuestoId,
      precio_incluye_itbis: datos.precioIncluyeItbis,
      ganancia_tipo: gananciaTipo,
      comision_pct: comisionPct,
      por_cuenta_tercero:
        gananciaTipo === 'comision' && datos.porCuentaTercero === true,
    };
  }

  async listar(filtros: Filtros) {
    const condiciones: string[] = [];
    const params: unknown[] = [];

    const buscar = normalizarBusqueda(texto(filtros.texto));
    if (buscar) {
      params.push(`%${buscar.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
      condiciones.push(
        `(s.codigo ILIKE $${params.length} OR s.nombre ILIKE $${params.length})`,
      );
    }
    const unidad = texto(filtros.unidadNegocioId);
    if (unidad) {
      if (!UUID.test(unidad)) {
        throw new BadRequestException('Unidad de negocio inválida');
      }
      params.push(unidad);
      condiciones.push(`s.unidad_negocio_id = $${params.length}`);
    }
    const categoria = texto(filtros.categoriaId);
    if (categoria) {
      if (!UUID.test(categoria)) {
        throw new BadRequestException('Categoría inválida');
      }
      params.push(categoria);
      condiciones.push(`s.categoria_id = $${params.length}`);
    }
    const estado = texto(filtros.estado) || 'activos';
    if (estado === 'activos') condiciones.push('s.is_active = true');
    else if (estado === 'inactivos') condiciones.push('s.is_active = false');
    else if (estado !== 'todos') {
      throw new BadRequestException('Estado inválido');
    }

    const r = await this.db.query<FilaServicio & { tasa: string | null }>(
      `SELECT s.id, s.codigo, s.nombre, s.descripcion,
              s.unidad_negocio_id, un.nombre AS unidad_negocio,
              s.categoria_id, cat.nombre AS categoria,
              s.unidad_medida_id, um.nombre AS unidad_medida,
              s.precio, s.moneda, s.costo, s.impuesto_id, i.nombre AS impuesto,
              s.ganancia_tipo, s.comision_pct, s.por_cuenta_tercero,
              ${SQL_TASA_VIGENTE} AS tasa,
              s.precio_incluye_itbis, s.is_active
       FROM servicios s
       JOIN unidades_negocio un ON un.id = s.unidad_negocio_id
       LEFT JOIN categorias cat ON cat.id = s.categoria_id
       JOIN unidades_medida um ON um.id = s.unidad_medida_id
       JOIN impuestos i ON i.id = s.impuesto_id
       ${condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : ''}
       ORDER BY s.codigo`,
      params,
    );

    // El servidor calcula base, ITBIS y total; nunca la pantalla.
    return r.rows.map((f) => ({
      ...f,
      calculo:
        f.tasa === null
          ? null
          : calcularItbis(f.precio, f.tasa, f.precio_incluye_itbis),
    }));
  }

  async catalogos() {
    const [unidadesNegocio, categorias, unidadesMedida, impuestos] =
      await Promise.all([
        this.db.query(
          `SELECT id, codigo, nombre FROM unidades_negocio
         WHERE is_active = true ORDER BY nombre`,
        ),
        this.db.query(
          `SELECT c.id, c.nombre, c.unidad_negocio_id, c.impuesto_id,
                CASE WHEN c.prefijo IS NULL THEN NULL
                     ELSE c.prefijo || '-' || lpad((c.ultimo_numero + 1)::text, 4, '0')
                END AS proximo
         FROM categorias c
         JOIN unidades_negocio un ON un.id = c.unidad_negocio_id
           AND un.is_active = true
         WHERE c.is_active = true
         ORDER BY lower(c.nombre)`,
        ),
        this.db.query(
          `SELECT id, codigo, nombre FROM unidades_medida
         WHERE is_active = true ORDER BY nombre`,
        ),
        this.db.query(
          `SELECT i.id, i.codigo, i.nombre, ${SQL_TASA_VIGENTE} AS tasa
         FROM impuestos i
         WHERE i.is_active = true
         ORDER BY i.nombre`,
        ),
      ]);
    return {
      unidadesNegocio: unidadesNegocio.rows,
      categorias: categorias.rows,
      unidadesMedida: unidadesMedida.rows,
      impuestos: impuestos.rows.filter(
        (i: { tasa: string | null }) => i.tasa !== null,
      ),
    };
  }

  // Para que la pantalla verifique su vista previa contra el servidor.
  async calcular(datos: {
    precio?: unknown;
    impuestoId?: unknown;
    precioIncluyeItbis?: unknown;
  }) {
    const precio = normalizarMonto(datos.precio);
    if (precio === null) throw new BadRequestException('Precio inválido');
    const impuestoId = texto(datos.impuestoId);
    if (!UUID.test(impuestoId)) {
      throw new BadRequestException('Seleccione el impuesto');
    }
    if (typeof datos.precioIncluyeItbis !== 'boolean') {
      throw new BadRequestException('Indique si el precio incluye ITBIS');
    }
    const tasa = await this.tasaVigente(this.db, impuestoId);
    return { tasa, ...calcularItbis(precio, tasa, datos.precioIncluyeItbis) };
  }

  // Comprueba que las listas y el impuesto existan, estén activos y vigentes.
  private async verificarReferencias(c: PoolClient, d: Limpio) {
    const un = await c.query(
      'SELECT 1 FROM unidades_negocio WHERE id = $1 AND is_active = true',
      [d.unidad_negocio_id],
    );
    if (un.rowCount === 0) {
      throw new BadRequestException('La unidad de negocio no existe');
    }
    if (d.categoria_id) {
      const cat = await c.query(
        `SELECT 1 FROM categorias
         WHERE id = $1 AND unidad_negocio_id = $2 AND is_active = true`,
        [d.categoria_id, d.unidad_negocio_id],
      );
      if (cat.rowCount === 0) {
        throw new BadRequestException(
          'La categoría no existe, está inactiva o no pertenece a esa unidad de negocio',
        );
      }
    }
    const um = await c.query(
      'SELECT 1 FROM unidades_medida WHERE id = $1 AND is_active = true',
      [d.unidad_medida_id],
    );
    if (um.rowCount === 0) {
      throw new BadRequestException('La unidad de medida no existe');
    }
    await this.tasaVigente(c, d.impuesto_id);
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
    const tasa = r.rows[0].tasa;
    if (tasa === null) {
      throw new BadRequestException(
        'El impuesto no tiene una tasa vigente hoy',
      );
    }
    return tasa;
  }

  async crear(actorId: string, ip: string | undefined, datos: DatosServicio) {
    const d = this.validar(datos);
    try {
      return await this.db.transaccion(async (c) => {
        await this.verificarReferencias(c, d);
        d.codigo = await siguienteCodigo(c, d.categoria_id as string);
        const r = await c.query<{ id: string }>(
          `INSERT INTO servicios
             (codigo, nombre, descripcion, unidad_negocio_id, unidad_medida_id,
              precio, costo, impuesto_id, precio_incluye_itbis, created_by,
              categoria_id, ganancia_tipo, comision_pct, moneda, por_cuenta_tercero)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           RETURNING id`,
          [
            d.codigo,
            d.nombre,
            d.descripcion,
            d.unidad_negocio_id,
            d.unidad_medida_id,
            d.precio,
            d.costo,
            d.impuesto_id,
            d.precio_incluye_itbis,
            actorId,
            d.categoria_id,
            d.ganancia_tipo,
            d.comision_pct,
            d.moneda,
            d.por_cuenta_tercero,
          ],
        );
        const id = r.rows[0].id;
        await registrarAuditoria(c, {
          usuarioId: actorId,
          accion: 'servicio.crear',
          entidad: 'servicios',
          entidadId: id,
          nuevo: d,
          ip,
        });
        return { id, codigo: d.codigo };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException('Ese código de servicio ya existe');
      }
      throw e;
    }
  }

  async editar(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: DatosServicio,
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Servicio no encontrado');
    const d = this.validar(datos);

    try {
      return await this.db.transaccion(async (c) => {
        const r = await c.query<Limpio>(
          `SELECT codigo, nombre, descripcion, unidad_negocio_id,
                  categoria_id, unidad_medida_id, precio, costo, impuesto_id,
                  precio_incluye_itbis, ganancia_tipo, comision_pct, moneda, por_cuenta_tercero
           FROM servicios WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (r.rowCount === 0) {
          throw new NotFoundException('Servicio no encontrado');
        }
        const antes = r.rows[0];
        d.codigo = antes.codigo; // el código no cambia
        await this.verificarReferencias(c, d);

        await c.query(
          `UPDATE servicios
           SET codigo = $2, nombre = $3, descripcion = $4,
               unidad_negocio_id = $5, unidad_medida_id = $6,
               precio = $7, costo = $8, impuesto_id = $9,
               precio_incluye_itbis = $10, categoria_id = $11,
               ganancia_tipo = $12, comision_pct = $13, moneda = $14,
               por_cuenta_tercero = $15, updated_at = now()
           WHERE id = $1`,
          [
            id,
            d.codigo,
            d.nombre,
            d.descripcion,
            d.unidad_negocio_id,
            d.unidad_medida_id,
            d.precio,
            d.costo,
            d.impuesto_id,
            d.precio_incluye_itbis,
            d.categoria_id,
            d.ganancia_tipo,
            d.comision_pct,
            d.moneda,
            d.por_cuenta_tercero,
          ],
        );

        // Cada tipo de cambio queda como un registro de auditoría distinto,
        // para que los cambios de precio, costo e impuesto se vean claros.
        const grupos: { accion: string; campos: (keyof Limpio)[] }[] = [
          { accion: 'servicio.cambiar_precio', campos: ['precio', 'moneda'] },
          { accion: 'servicio.cambiar_costo', campos: ['costo'] },
          {
            accion: 'servicio.cambiar_ganancia',
            campos: ['ganancia_tipo', 'comision_pct', 'por_cuenta_tercero'],
          },
          {
            accion: 'servicio.cambiar_impuesto',
            campos: ['impuesto_id', 'precio_incluye_itbis'],
          },
          {
            accion: 'servicio.editar',
            campos: [
              'codigo',
              'nombre',
              'descripcion',
              'unidad_negocio_id',
              'categoria_id',
              'unidad_medida_id',
            ],
          },
        ];

        for (const g of grupos) {
          const cambiados = g.campos.filter((k) => antes[k] !== d[k]);
          if (cambiados.length === 0) continue;
          await registrarAuditoria(c, {
            usuarioId: actorId,
            accion: g.accion,
            entidad: 'servicios',
            entidadId: id,
            anterior: Object.fromEntries(cambiados.map((k) => [k, antes[k]])),
            nuevo: Object.fromEntries(cambiados.map((k) => [k, d[k]])),
            ip,
          });
        }

        return { ok: true };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException('Ese código de servicio ya existe');
      }
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
    if (!UUID.test(id)) throw new NotFoundException('Servicio no encontrado');
    if (typeof activo !== 'boolean') {
      throw new BadRequestException('Estado inválido');
    }
    const textoMotivo = texto(motivo);
    if (!activo && textoMotivo.length < 5) {
      throw new BadRequestException(
        'Escriba el motivo de la desactivación (mínimo 5 caracteres)',
      );
    }

    return this.db.transaccion(async (c) => {
      const r = await c.query<{ codigo: string; is_active: boolean }>(
        'SELECT codigo, is_active FROM servicios WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (r.rowCount === 0)
        throw new NotFoundException('Servicio no encontrado');
      const antes = r.rows[0];
      if (antes.is_active === activo) return { ok: true };

      await c.query(
        'UPDATE servicios SET is_active = $2, updated_at = now() WHERE id = $1',
        [id, activo],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: activo ? 'servicio.activar' : 'servicio.desactivar',
        entidad: 'servicios',
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
