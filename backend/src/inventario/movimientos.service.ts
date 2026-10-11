import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { registrarAuditoria } from '../auditoria/auditoria';
import { DatabaseService } from '../database/database.service';
import { normalizarMonto } from '../servicios/calculo-itbis';
import { esCero, esEntera, normalizarCantidad } from './cantidades';
import { ProductosService } from './productos.service';
import { SQL_EXISTENCIA, SQL_SIGNO } from './sql';

// Entradas, salidas y ajustes por conteo. Cada movimiento se agrega a
// movimientos_inventario (que no se puede modificar ni borrar) dentro de una
// transacción que bloquea el producto: así dos personas no descuadran el
// stock al mismo tiempo.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CAUSAS_SALIDA: Record<string, string> = {
  dano: 'Daño',
  vencido: 'Vencido',
  consumo_interno: 'Consumo interno',
  devolucion_proveedor: 'Devolución a proveedor',
  otro: 'Otro',
};

type Producto = {
  codigo: string;
  nombre: string;
  costo: string;
  unidad: string;
  permite_decimales: boolean;
  existencia: string;
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

function motivoObligatorio(v: unknown): string {
  const m = texto(v);
  if (m.length < 5 || m.length > 500) {
    throw new BadRequestException(
      'Escriba el motivo (entre 5 y 500 caracteres)',
    );
  }
  return m;
}

@Injectable()
export class MovimientosService {
  constructor(
    private readonly db: DatabaseService,
    private readonly productos: ProductosService,
  ) {}

  // Bloquea el producto y devuelve sus datos con la existencia actual.
  private async bloquear(c: PoolClient, id: string): Promise<Producto> {
    if (!UUID.test(id)) throw new NotFoundException('Producto no encontrado');
    const r = await c.query<
      Omit<Producto, 'existencia'> & { is_active: boolean }
    >(
      `SELECT p.codigo, p.nombre, p.costo, p.is_active,
              um.nombre AS unidad, um.permite_decimales
       FROM productos p JOIN unidades_medida um ON um.id = p.unidad_id
       WHERE p.id = $1 FOR UPDATE OF p`,
      [id],
    );
    if (r.rowCount === 0) throw new NotFoundException('Producto no encontrado');
    const { is_active, ...p } = r.rows[0];
    if (!is_active) {
      throw new BadRequestException(
        'El producto está desactivado: actívelo antes de registrar movimientos',
      );
    }
    const e = await c.query<{ existencia: string }>(SQL_EXISTENCIA, [id]);
    return { ...p, existencia: e.rows[0].existencia };
  }

  private cantidad(v: unknown, p: Producto, que: string): string {
    const q = normalizarCantidad(v);
    if (q === null || esCero(q)) {
      throw new BadRequestException(
        `${que}: escriba un número mayor que 0 con hasta 3 decimales`,
      );
    }
    if (!p.permite_decimales && !esEntera(q)) {
      throw new BadRequestException(
        `La unidad "${p.unidad}" no admite decimales: use números enteros`,
      );
    }
    return q;
  }

  private async sucursal(c: PoolClient): Promise<string> {
    const r = await c.query<{ id: string }>(
      'SELECT id FROM sucursales WHERE is_active = true ORDER BY created_at LIMIT 1',
    );
    if (r.rowCount === 0) {
      throw new BadRequestException('No hay ninguna sucursal activa');
    }
    return r.rows[0].id;
  }

  private async existenciaDespues(c: PoolClient, id: string): Promise<string> {
    const e = await c.query<{ existencia: string }>(SQL_EXISTENCIA, [id]);
    return e.rows[0].existencia;
  }

  // ---------- Entrada: mercancía recibida ----------

  async entrada(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: {
      cantidad?: unknown;
      costoUnitario?: unknown;
      proveedor?: unknown;
      referencia?: unknown;
      nota?: unknown;
    },
  ) {
    const costoUnitario = normalizarMonto(datos.costoUnitario);
    if (costoUnitario === null) {
      throw new BadRequestException(
        'Costo inválido: debe ser un número no negativo con hasta 2 decimales (sin ITBIS)',
      );
    }
    const proveedor = opcional(datos.proveedor, 150, 'Proveedor');
    const referencia = opcional(datos.referencia, 100, 'Número de factura');
    const nota = opcional(datos.nota, 500, 'Nota');

    return this.db.transaccion(async (c) => {
      const p = await this.bloquear(c, id);
      const cantidad = this.cantidad(datos.cantidad, p, 'Cantidad');

      // Costo promedio ponderado: lo que había a su costo + lo que entra a
      // su costo, entre el total. Si no había existencia, vale el nuevo.
      const prom = await c.query<{ costo: string }>(
        `SELECT CASE WHEN $1::numeric <= 0 THEN $3::numeric(14,2)
                ELSE round(($1::numeric * $2::numeric + $4::numeric * $3::numeric)
                           / ($1::numeric + $4::numeric), 2)
                END::numeric(14,2) AS costo`,
        [p.existencia, p.costo, costoUnitario, cantidad],
      );
      const costoNuevo = prom.rows[0].costo;

      await c.query(
        `INSERT INTO movimientos_inventario
           (producto_id, sucursal_id, tipo, cantidad, costo_unitario,
            costo_promedio, proveedor, referencia, motivo, usuario_id)
         VALUES ($1, $2, 'entrada', $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          await this.sucursal(c),
          cantidad,
          costoUnitario,
          costoNuevo,
          proveedor,
          referencia,
          nota,
          actorId,
        ],
      );
      if (costoNuevo !== p.costo) {
        await c.query(
          'UPDATE productos SET costo = $2, updated_at = now() WHERE id = $1',
          [id, costoNuevo],
        );
      }
      const existencia = await this.existenciaDespues(c, id);

      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'inventario.entrada',
        entidad: 'productos',
        entidadId: id,
        anterior: {
          codigo: p.codigo,
          existencia: p.existencia,
          costo: p.costo,
        },
        nuevo: {
          codigo: p.codigo,
          cantidad,
          costo_unitario: costoUnitario,
          proveedor,
          referencia,
          existencia,
          costo: costoNuevo,
        },
        motivo: nota ?? undefined,
        ip,
      });
      return { existencia, costo: costoNuevo };
    });
  }

  // ---------- Salida: daño, vencido, consumo, devolución… ----------

  async salida(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: {
      cantidad?: unknown;
      causa?: unknown;
      motivo?: unknown;
      referencia?: unknown;
    },
  ) {
    const causa = texto(datos.causa);
    if (!(causa in CAUSAS_SALIDA)) {
      throw new BadRequestException('Seleccione la causa de la salida');
    }
    const motivo = motivoObligatorio(datos.motivo);
    const referencia = opcional(datos.referencia, 100, 'Referencia');

    return this.db.transaccion(async (c) => {
      const p = await this.bloquear(c, id);
      const cantidad = this.cantidad(datos.cantidad, p, 'Cantidad');
      await this.hayStock(c, p, cantidad);

      // La salida se valora al costo promedio; el promedio no cambia.
      await c.query(
        `INSERT INTO movimientos_inventario
           (producto_id, sucursal_id, tipo, cantidad, costo_unitario,
            costo_promedio, causa, referencia, motivo, usuario_id)
         VALUES ($1, $2, 'salida', $3, $4, $4, $5, $6, $7, $8)`,
        [
          id,
          await this.sucursal(c),
          cantidad,
          p.costo,
          causa,
          referencia,
          motivo,
          actorId,
        ],
      );
      const existencia = await this.existenciaDespues(c, id);

      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'inventario.salida',
        entidad: 'productos',
        entidadId: id,
        anterior: { codigo: p.codigo, existencia: p.existencia },
        nuevo: { codigo: p.codigo, cantidad, causa, referencia, existencia },
        motivo,
        ip,
      });
      return { existencia };
    });
  }

  // Nunca se saca más de lo que hay.
  private async hayStock(c: PoolClient, p: Producto, cantidad: string) {
    const r = await c.query<{ ok: boolean }>(
      'SELECT $1::numeric >= $2::numeric AS ok',
      [p.existencia, cantidad],
    );
    if (!r.rows[0].ok) {
      throw new BadRequestException(
        `Stock insuficiente: hay ${Number(p.existencia)} ${p.unidad.toLowerCase()} de ${p.codigo}`,
      );
    }
  }

  // ---------- Ajuste por conteo físico ----------

  async ajuste(
    actorId: string,
    id: string,
    ip: string | undefined,
    datos: { conteo?: unknown; motivo?: unknown },
  ) {
    const motivo = motivoObligatorio(datos.motivo);
    const conteo = normalizarCantidad(datos.conteo);
    if (conteo === null) {
      throw new BadRequestException(
        'Cantidad contada inválida: escriba un número de 0 en adelante',
      );
    }

    return this.db.transaccion(async (c) => {
      const p = await this.bloquear(c, id);
      if (!p.permite_decimales && !esEntera(conteo)) {
        throw new BadRequestException(
          `La unidad "${p.unidad}" no admite decimales: use números enteros`,
        );
      }
      // Diferencia entre lo contado y lo registrado.
      const d = await c.query<{ diferencia: string; signo: number }>(
        `SELECT abs($1::numeric - $2::numeric)::numeric(14,3) AS diferencia,
                sign($1::numeric - $2::numeric)::int AS signo`,
        [conteo, p.existencia],
      );
      const { diferencia, signo } = d.rows[0];
      if (signo === 0) {
        throw new BadRequestException(
          'El conteo coincide con el stock registrado: no hay nada que ajustar',
        );
      }
      const tipo = signo > 0 ? 'ajuste_entrada' : 'ajuste_salida';

      await c.query(
        `INSERT INTO movimientos_inventario
           (producto_id, sucursal_id, tipo, cantidad, costo_unitario,
            costo_promedio, motivo, usuario_id)
         VALUES ($1, $2, $3, $4, $5, $5, $6, $7)`,
        [
          id,
          await this.sucursal(c),
          tipo,
          diferencia,
          p.costo,
          motivo,
          actorId,
        ],
      );
      const existencia = await this.existenciaDespues(c, id);

      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'inventario.ajuste',
        entidad: 'productos',
        entidadId: id,
        anterior: { codigo: p.codigo, existencia: p.existencia },
        nuevo: { codigo: p.codigo, conteo, tipo, diferencia, existencia },
        motivo,
        ip,
      });
      return { existencia, tipo, diferencia };
    });
  }

  // ---------- Kárdex: historial del producto con su saldo ----------

  async kardex(actorId: string, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Producto no encontrado');
    const prod = await this.db.query<{
      codigo: string;
      nombre: string;
      unidad: string;
    }>(
      `SELECT p.codigo, p.nombre, um.nombre AS unidad
       FROM productos p JOIN unidades_medida um ON um.id = p.unidad_id
       WHERE p.id = $1`,
      [id],
    );
    if (prod.rowCount === 0)
      throw new NotFoundException('Producto no encontrado');

    const r = await this.db.query<{
      id: string;
      fecha: string;
      tipo: string;
      causa: string | null;
      cantidad: string;
      signo: number;
      saldo: string;
      costo_unitario: string;
      costo_promedio: string | null;
      proveedor: string | null;
      referencia: string | null;
      motivo: string | null;
      usuario: string;
    }>(
      `SELECT m.id, m.created_at AS fecha, m.tipo, m.causa, m.cantidad,
              (${SQL_SIGNO})::int AS signo,
              sum(m.cantidad * ${SQL_SIGNO})
                OVER (ORDER BY m.created_at, m.id)::numeric(14,3) AS saldo,
              m.costo_unitario, m.costo_promedio, m.proveedor, m.referencia,
              m.motivo, u.username AS usuario
       FROM movimientos_inventario m
       JOIN usuarios u ON u.id = m.usuario_id
       WHERE m.producto_id = $1
       ORDER BY m.created_at DESC, m.id DESC`,
      [id],
    );

    // Sin el permiso de costos, el kárdex no muestra importes.
    const verCostos = await this.productos.tienePermiso(
      actorId,
      'inventario.ver_costos',
    );
    const movimientos = r.rows.map((m) => {
      const causa = m.causa ? CAUSAS_SALIDA[m.causa] : null;
      if (verCostos) return { ...m, causa };
      const { costo_unitario: _c, costo_promedio: _p, ...resto } = m;
      return { ...resto, causa };
    });
    return { producto: prod.rows[0], movimientos, verCostos };
  }
}
