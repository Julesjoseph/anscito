import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { registrarAuditoria } from '../auditoria/auditoria';
import { numeroSesion, SQL_ESPERADO } from '../caja/sql';
import { DatabaseService } from '../database/database.service';
import { esEntera, normalizarCantidad } from '../inventario/cantidades';
import { SQL_EXISTENCIA, SQL_SIGNO, SQL_TASA_VIGENTE } from '../inventario/sql';
import { normalizarMonto } from '../servicios/calculo-itbis';
import { enmascarar } from '../terceros/documentos';
import {
  calcularLinea,
  descuentoPermitido,
  mayorOIgual,
  restar,
  sumar,
} from './calculo-venta';
import type { LineaCalculada } from './calculo-venta';
import { generarRecibo } from './recibo-pdf';
import type { DatosRecibo, Formato } from './recibo-pdf';

// Ventas. Cada venta copia precio, costo, impuesto y tasa del día; descuenta
// el inventario de los productos en la misma transacción (sin dejar el stock
// en negativo) y se numera sin huecos (V-000001…). Todavía no genera caja,
// asientos contables, cuentas por cobrar ni e-CF.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAXIMO_LINEAS = 200;

export function numeroVenta(n: number | string): string {
  return `V-${String(n).padStart(6, '0')}`;
}

type LineaEntrada = {
  tipo?: unknown;
  id?: unknown;
  cantidad?: unknown;
  descuento?: unknown;
};

export type DatosVenta = {
  clienteId?: unknown;
  lineas?: unknown;
  motivoDescuento?: unknown;
  pago?: {
    formaPagoId?: unknown;
    recibido?: unknown;
    referencia?: unknown;
    cajaId?: unknown;
  };
  comprobanteFiscal?: unknown;
  notas?: unknown;
};

export type FiltrosVentas = {
  texto?: string;
  desde?: string;
  hasta?: string;
  estado?: string;
  pagina?: string;
};

type Articulo = {
  tipo: 'producto' | 'servicio';
  id: string;
  codigo: string;
  nombre: string;
  unidad: string;
  permite_decimales: boolean;
  precio: string | null;
  precio_incluye_itbis: boolean;
  impuesto_id: string;
  impuesto: string;
  tasa: string | null;
  costo: string | null;
  comision_pct: string | null;
  is_active: boolean;
};

type LineaLista = LineaCalculada & {
  articulo: Articulo;
  cantidad: string;
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

function fechaValida(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

@Injectable()
export class VentasService {
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

  private async config(c: Pick<DatabaseService, 'query'>, clave: string) {
    const r = await c.query<{ valor: string }>(
      'SELECT valor FROM configuracion WHERE clave = $1',
      [clave],
    );
    if (r.rowCount === 0) throw new Error(`Falta la configuración ${clave}`);
    return r.rows[0].valor;
  }

  // ---------- Datos para la pantalla de venta ----------

  async preparar(actorId: string) {
    const [formas, maximo, descontar] = await Promise.all([
      this.db.query(
        `SELECT id, codigo, nombre, calcula_devuelta, requiere_referencia, usa_caja
         FROM formas_pago WHERE is_active = true ORDER BY orden, nombre`,
      ),
      this.config(this.db, 'ventas.descuento_maximo_pct'),
      this.tienePermiso(actorId, 'ventas.descontar'),
    ]);
    const cf = await this.db.query<{ id: string; nombre: string }>(
      `SELECT id, nombre FROM terceros
       WHERE rol = 'cliente' AND es_protegido AND is_active LIMIT 1`,
    );
    // Cajas activas con su sesión abierta (si tienen), para que cada
    // computadora sepa si su caja está abierta.
    const cajas = await this.db.query(
      `SELECT c.id, c.nombre, s.id AS sesion_id
       FROM cajas c
       LEFT JOIN caja_sesiones s ON s.caja_id = c.id AND s.estado = 'abierta'
       WHERE c.is_active
       ORDER BY lower(c.nombre)`,
    );
    return {
      formasPago: formas.rows,
      cajas: cajas.rows,
      descuentoMaximoPct: maximo,
      puedeDescontar: descontar,
      consumidorFinal: cf.rows[0] ?? null,
    };
  }

  // Productos y servicios que se pueden vender (activos, con precio y tasa).
  async catalogo(textoBuscar?: string) {
    const buscar = texto(textoBuscar);
    const patron = `%${buscar.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const r = await this.db.query(
      `SELECT * FROM (
         SELECT 'producto' AS tipo, p.id, p.codigo, p.nombre, um.nombre AS unidad,
                um.permite_decimales, p.precio_venta AS precio,
                p.precio_incluye_itbis, i.nombre AS impuesto,
                ${SQL_TASA_VIGENTE} AS tasa,
                (SELECT COALESCE(sum(m.cantidad * ${SQL_SIGNO}), 0)
                 FROM movimientos_inventario m WHERE m.producto_id = p.id)::numeric(14,3)
                  AS existencia
         FROM productos p
         JOIN unidades_medida um ON um.id = p.unidad_id
         JOIN impuestos i ON i.id = p.impuesto_id
         WHERE p.is_active AND p.precio_venta IS NOT NULL
           AND ($1 = '' OR p.codigo ILIKE $2 OR p.nombre ILIKE $2)
         UNION ALL
         SELECT 'servicio', s.id, s.codigo, s.nombre, um.nombre, true, s.precio,
                s.precio_incluye_itbis, i.nombre, ${SQL_TASA_VIGENTE}, NULL
         FROM servicios s
         JOIN unidades_medida um ON um.id = s.unidad_medida_id
         JOIN impuestos i ON i.id = s.impuesto_id
         WHERE s.is_active
           AND ($1 = '' OR s.codigo ILIKE $2 OR s.nombre ILIKE $2)
       ) x
       WHERE x.tasa IS NOT NULL
       ORDER BY x.nombre
       LIMIT 50`,
      [buscar, patron],
    );
    return r.rows;
  }

  async clientes(actorId: string, textoBuscar?: string) {
    const buscar = texto(textoBuscar);
    const patron = `%${buscar.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const r = await this.db.query<{
      id: string;
      nombre: string;
      nombre_comercial: string | null;
      numero_documento: string | null;
      es_protegido: boolean;
    }>(
      `SELECT id, nombre, nombre_comercial, numero_documento, es_protegido
       FROM terceros
       WHERE rol = 'cliente' AND is_active
         AND ($1 = '' OR nombre ILIKE $2 OR nombre_comercial ILIKE $2
              OR numero_documento LIKE $3)
       ORDER BY es_protegido DESC, lower(nombre)
       LIMIT 30`,
      [buscar, patron, `%${buscar.replace(/[\s.-]/g, '')}%`],
    );
    const ver = await this.tienePermiso(actorId, 'terceros.ver_documento');
    return r.rows.map((f) => ({
      ...f,
      numero_documento: ver
        ? f.numero_documento
        : enmascarar(f.numero_documento),
    }));
  }

  // ---------- Validación y cálculo ----------

  private leerLineas(datos: DatosVenta) {
    if (!Array.isArray(datos.lineas) || datos.lineas.length === 0) {
      throw new BadRequestException('Agregue al menos un producto o servicio');
    }
    if (datos.lineas.length > MAXIMO_LINEAS) {
      throw new BadRequestException(`Máximo ${MAXIMO_LINEAS} líneas por venta`);
    }
    return (datos.lineas as LineaEntrada[]).map((l, i) => {
      const tipo = texto(l?.tipo);
      const id = texto(l?.id).toLowerCase();
      if ((tipo !== 'producto' && tipo !== 'servicio') || !UUID.test(id)) {
        throw new BadRequestException(`Línea ${i + 1}: artículo inválido`);
      }
      const cantidad = normalizarCantidad(l?.cantidad);
      if (cantidad === null || /^0\.000$/.test(cantidad)) {
        throw new BadRequestException(
          `Línea ${i + 1}: la cantidad debe ser mayor que 0 (hasta 3 decimales)`,
        );
      }
      const descuento =
        texto(l?.descuento) === '' ? '0.00' : normalizarMonto(l?.descuento);
      if (descuento === null) {
        throw new BadRequestException(
          `Línea ${i + 1}: descuento inválido (un monto en RD$ con hasta 2 decimales)`,
        );
      }
      return { tipo: tipo as 'producto' | 'servicio', id, cantidad, descuento };
    });
  }

  // Lee los artículos (bloqueando los productos para controlar el stock) y
  // calcula cada línea. Lanza errores claros si algo no se puede vender.
  private async calcular(
    c: Pick<DatabaseService, 'query'>,
    actorId: string,
    datos: DatosVenta,
    bloquear: boolean,
  ) {
    const entrada = this.leerLineas(datos);
    const ids = (t: string) =>
      [...new Set(entrada.filter((l) => l.tipo === t).map((l) => l.id))].sort();

    const articulos = new Map<string, Articulo>();
    const prodIds = ids('producto');
    if (prodIds.length) {
      // Orden fijo de bloqueo para que dos ventas no se traben entre sí.
      const r = await c.query<Articulo>(
        `SELECT 'producto' AS tipo, p.id, p.codigo, p.nombre, um.nombre AS unidad,
                um.permite_decimales, p.precio_venta AS precio,
                p.precio_incluye_itbis, p.impuesto_id, i.nombre AS impuesto,
                ${SQL_TASA_VIGENTE} AS tasa, p.costo,
                NULL::numeric AS comision_pct, p.is_active
         FROM productos p
         JOIN unidades_medida um ON um.id = p.unidad_id
         JOIN impuestos i ON i.id = p.impuesto_id
         WHERE p.id = ANY($1::uuid[])
         ORDER BY p.id
         ${bloquear ? 'FOR UPDATE OF p' : ''}`,
        [prodIds],
      );
      r.rows.forEach((a) => articulos.set(`producto:${a.id}`, a));
    }
    const servIds = ids('servicio');
    if (servIds.length) {
      const r = await c.query<Articulo>(
        `SELECT 'servicio' AS tipo, s.id, s.codigo, s.nombre, um.nombre AS unidad,
                true AS permite_decimales, s.precio, s.precio_incluye_itbis,
                s.impuesto_id, i.nombre AS impuesto, ${SQL_TASA_VIGENTE} AS tasa,
                s.costo,
                CASE WHEN s.ganancia_tipo = 'comision' THEN s.comision_pct END
                  AS comision_pct,
                s.is_active
         FROM servicios s
         JOIN unidades_medida um ON um.id = s.unidad_medida_id
         JOIN impuestos i ON i.id = s.impuesto_id
         WHERE s.id = ANY($1::uuid[])`,
        [servIds],
      );
      r.rows.forEach((a) => articulos.set(`servicio:${a.id}`, a));
    }

    const maximo = await this.config(c, 'ventas.descuento_maximo_pct');
    const lineas: LineaLista[] = entrada.map((l, i) => {
      const a = articulos.get(`${l.tipo}:${l.id}`);
      if (!a || !a.is_active) {
        throw new BadRequestException(
          `Línea ${i + 1}: el artículo no existe o está desactivado`,
        );
      }
      if (a.precio === null) {
        throw new BadRequestException(
          `${a.codigo} no tiene precio de venta: asígnele uno en Inventario`,
        );
      }
      if (a.tasa === null) {
        throw new BadRequestException(
          `${a.codigo}: su impuesto no tiene una tasa vigente hoy`,
        );
      }
      if (!a.permite_decimales && !esEntera(l.cantidad)) {
        throw new BadRequestException(
          `${a.codigo}: la unidad "${a.unidad}" no admite decimales`,
        );
      }
      const calc = calcularLinea(
        a.precio,
        l.cantidad,
        '0.00',
        a.tasa,
        a.precio_incluye_itbis,
      );
      if (!mayorOIgual(calc.bruto, l.descuento)) {
        throw new BadRequestException(
          `${a.codigo}: el descuento es mayor que la línea`,
        );
      }
      if (!descuentoPermitido(calc.bruto, l.descuento, maximo)) {
        throw new BadRequestException(
          `${a.codigo}: el descuento pasa del máximo permitido (${Number(maximo)}%)`,
        );
      }
      return {
        ...calcularLinea(
          a.precio,
          l.cantidad,
          l.descuento,
          a.tasa,
          a.precio_incluye_itbis,
        ),
        articulo: a,
        cantidad: l.cantidad,
      };
    });

    const descuento = sumar(lineas.map((l) => l.descuento));
    if (descuento !== '0.00') {
      if (!(await this.tienePermiso(actorId, 'ventas.descontar'))) {
        throw new ForbiddenException('No tiene permiso para dar descuentos');
      }
      if (texto(datos.motivoDescuento).length < 5) {
        throw new BadRequestException(
          'Escriba el motivo del descuento (mínimo 5 caracteres)',
        );
      }
    }

    // Stock: la suma pedida de cada producto no puede pasar lo que hay.
    const pedido = new Map<string, string[]>();
    for (const l of lineas) {
      if (l.articulo.tipo !== 'producto') continue;
      pedido.set(l.articulo.id, [
        ...(pedido.get(l.articulo.id) ?? []),
        l.cantidad,
      ]);
    }
    for (const [id, cantidades] of pedido) {
      const e = await c.query<{ existencia: string }>(SQL_EXISTENCIA, [id]);
      const hay = e.rows[0].existencia;
      const ok = await c.query<{ ok: boolean }>(
        'SELECT $1::numeric >= (SELECT sum(x) FROM unnest($2::numeric[]) x) AS ok',
        [hay, cantidades],
      );
      if (!ok.rows[0].ok) {
        const a = articulos.get(`producto:${id}`)!;
        throw new BadRequestException(
          `Stock insuficiente de ${a.codigo} ${a.nombre}: hay ${Number(hay)} ${a.unidad.toLowerCase()}`,
        );
      }
    }

    return {
      lineas,
      totales: {
        subtotal: sumar(lineas.map((l) => l.bruto)),
        descuento,
        base_imponible: sumar(lineas.map((l) => l.base)),
        itbis: sumar(lineas.map((l) => l.itbis)),
        total: sumar(lineas.map((l) => l.total)),
      },
    };
  }

  // Vista previa: el servidor calcula sin guardar nada.
  async previsualizar(actorId: string, datos: DatosVenta) {
    const { lineas, totales } = await this.calcular(
      this.db,
      actorId,
      datos,
      false,
    );
    return {
      lineas: lineas.map(({ articulo, ...l }) => ({
        codigo: articulo.codigo,
        ...l,
      })),
      totales,
    };
  }

  // ---------- Registrar ----------

  async crear(actorId: string, ip: string | undefined, datos: DatosVenta) {
    const clienteId = texto(datos.clienteId).toLowerCase();
    if (!UUID.test(clienteId))
      throw new BadRequestException('Seleccione el cliente');
    const formaId = texto(datos.pago?.formaPagoId).toLowerCase();
    if (!UUID.test(formaId))
      throw new BadRequestException('Seleccione la forma de pago');
    const comprobante = opcional(
      datos.comprobanteFiscal,
      30,
      'Comprobante fiscal',
    );
    const notas = opcional(datos.notas, 500, 'Notas');

    return this.db.transaccion(async (c) => {
      const cli = await c.query<{ nombre: string }>(
        `SELECT nombre FROM terceros WHERE id = $1 AND rol = 'cliente' AND is_active`,
        [clienteId],
      );
      if (cli.rowCount === 0)
        throw new BadRequestException(
          'El cliente no existe o está desactivado',
        );

      const fp = await c.query<{
        nombre: string;
        calcula_devuelta: boolean;
        requiere_referencia: boolean;
        usa_caja: boolean;
      }>(
        `SELECT nombre, calcula_devuelta, requiere_referencia, usa_caja
         FROM formas_pago WHERE id = $1 AND is_active`,
        [formaId],
      );
      if (fp.rowCount === 0)
        throw new BadRequestException(
          'La forma de pago no existe o está inactiva',
        );
      const forma = fp.rows[0];

      const { lineas, totales } = await this.calcular(c, actorId, datos, true);
      if (totales.total === '0.00')
        throw new BadRequestException('El total de la venta no puede ser 0');

      // Pago.
      let recibido: string | null = null;
      let devuelta: string | null = null;
      if (forma.calcula_devuelta) {
        recibido = normalizarMonto(datos.pago?.recibido);
        if (recibido === null || !mayorOIgual(recibido, totales.total)) {
          throw new BadRequestException(
            `Escriba cuánto entregó el cliente (al menos RD$${totales.total})`,
          );
        }
        devuelta = restar(recibido, totales.total);
      }
      const referencia = opcional(datos.pago?.referencia, 60, 'Referencia');
      if (forma.requiere_referencia && !referencia) {
        throw new BadRequestException(
          `Escriba la referencia de la ${forma.nombre.toLowerCase()}`,
        );
      }

      // El efectivo entra a la caja de esta computadora, que debe estar
      // abierta. FOR SHARE: varias ventas a la vez, pero nadie la cierra
      // mientras se registra esta.
      let sesionCaja: { id: string; caja: string; numero: string } | null =
        null;
      if (forma.usa_caja) {
        const cajaId = texto(datos.pago?.cajaId).toLowerCase();
        if (!UUID.test(cajaId)) {
          throw new BadRequestException(
            'Esta computadora no tiene una caja asignada: elíjala en la pantalla de Ventas',
          );
        }
        const s = await c.query<{ id: string; caja: string; numero: string }>(
          `SELECT s.id, c.nombre AS caja, s.numero
           FROM caja_sesiones s JOIN cajas c ON c.id = s.caja_id
           WHERE s.caja_id = $1 AND s.estado = 'abierta'
           FOR SHARE OF s`,
          [cajaId],
        );
        if (s.rowCount === 0) {
          throw new BadRequestException(
            'La caja de esta computadora no está abierta. Ábrala en Caja antes de cobrar en efectivo.',
          );
        }
        sesionCaja = s.rows[0];
      }

      // Sucursal del vendedor (o la principal si no tiene).
      const suc = await c.query<{ id: string }>(
        `SELECT COALESCE(
           (SELECT s.id FROM usuarios u JOIN sucursales s ON s.id = u.sucursal_id AND s.is_active
            WHERE u.id = $1),
           (SELECT id FROM sucursales WHERE es_principal)) AS id`,
        [actorId],
      );
      const sucursalId = suc.rows[0].id;

      // Número sin huecos: si algo falla, todo se deshace y no se consume.
      const n = await c.query<{ valor: string }>(
        `UPDATE contadores SET valor = valor + 1 WHERE clave = 'ventas' RETURNING valor`,
      );
      const numero = n.rows[0].valor;

      const v = await c.query<{ id: string }>(
        `INSERT INTO ventas
           (numero, sucursal_id, cliente_id, usuario_id, subtotal, descuento,
            motivo_descuento, base_imponible, itbis, total, comprobante_fiscal, notas)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          numero,
          sucursalId,
          clienteId,
          actorId,
          totales.subtotal,
          totales.descuento,
          totales.descuento === '0.00' ? null : texto(datos.motivoDescuento),
          totales.base_imponible,
          totales.itbis,
          totales.total,
          comprobante,
          notas,
        ],
      );
      const ventaId = v.rows[0].id;

      for (const l of lineas) {
        const a = l.articulo;
        await c.query(
          `INSERT INTO venta_lineas
             (venta_id, tipo, producto_id, servicio_id, codigo, descripcion, unidad,
              cantidad, precio_unitario, precio_incluye_itbis, impuesto_id, impuesto,
              tasa, bruto, descuento, base, itbis, total, costo_unitario,
              comision_pct)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                   $16, $17, $18, $19, $20)`,
          [
            ventaId,
            a.tipo,
            a.tipo === 'producto' ? a.id : null,
            a.tipo === 'servicio' ? a.id : null,
            a.codigo,
            a.nombre,
            a.unidad,
            l.cantidad,
            a.precio,
            a.precio_incluye_itbis,
            a.impuesto_id,
            a.impuesto,
            a.tasa,
            l.bruto,
            l.descuento,
            l.base,
            l.itbis,
            l.total,
            a.costo,
            a.comision_pct,
          ],
        );
        if (a.tipo === 'producto') {
          await c.query(
            `INSERT INTO movimientos_inventario
               (producto_id, sucursal_id, tipo, cantidad, costo_unitario,
                costo_promedio, referencia, venta_id, usuario_id)
             VALUES ($1, $2, 'venta', $3, $4, $4, $5, $6, $7)`,
            [
              a.id,
              sucursalId,
              l.cantidad,
              a.costo,
              numeroVenta(numero),
              ventaId,
              actorId,
            ],
          );
        }
      }

      await c.query(
        `INSERT INTO venta_pagos (venta_id, forma_pago_id, monto, recibido, devuelta, referencia)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [ventaId, formaId, totales.total, recibido, devuelta, referencia],
      );
      if (sesionCaja) {
        // Entra a la caja lo cobrado (la devuelta ya salió de lo recibido).
        await c.query(
          `INSERT INTO caja_movimientos (sesion_id, tipo, monto, venta_id, usuario_id)
           VALUES ($1, 'venta', $2, $3, $4)`,
          [sesionCaja.id, totales.total, ventaId, actorId],
        );
      }

      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'venta.crear',
        entidad: 'ventas',
        entidadId: ventaId,
        nuevo: {
          numero: numeroVenta(numero),
          cliente: cli.rows[0].nombre,
          lineas: lineas.length,
          ...totales,
          forma_pago: forma.nombre,
          caja: sesionCaja
            ? `${sesionCaja.caja} (${numeroSesion(sesionCaja.numero)})`
            : null,
          comprobante_fiscal: comprobante,
        },
        motivo:
          totales.descuento === '0.00'
            ? undefined
            : texto(datos.motivoDescuento),
        ip,
      });

      return {
        id: ventaId,
        numero: numeroVenta(numero),
        total: totales.total,
        devuelta,
      };
    });
  }

  // ---------- Consultar ----------

  async listar(filtros: FiltrosVentas) {
    const params: unknown[] = [];
    const cond: string[] = [];
    let zonaParam = 0;

    const buscar = texto(filtros.texto);
    if (buscar) {
      const num = buscar.replace(/^v-?/i, '');
      params.push(`%${buscar.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
      const p = params.length;
      params.push(/^\d+$/.test(num) ? Number(num) : -1);
      cond.push(
        `(t.nombre ILIKE $${p} OR v.comprobante_fiscal ILIKE $${p} OR v.numero = $${p + 1})`,
      );
    }
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
        `(v.fecha AT TIME ZONE $${zonaParam})::date ${op} $${params.length}::date`,
      );
    }
    const estado = texto(filtros.estado) || 'todas';
    if (estado === 'completadas') cond.push(`v.estado = 'completada'`);
    else if (estado === 'anuladas') cond.push(`v.estado = 'anulada'`);
    else if (estado !== 'todas')
      throw new BadRequestException('Estado inválido');

    const donde = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const pagina = Math.max(
      1,
      Number.parseInt(texto(filtros.pagina) || '1', 10) || 1,
    );
    const porPagina = 50;
    const n = params.length;

    const [r, t] = await Promise.all([
      this.db.query(
        `SELECT v.id, v.numero, v.fecha, v.estado, v.total, v.descuento,
                v.comprobante_fiscal, t.nombre AS cliente, u.username AS vendedor,
                (SELECT string_agg(fp.nombre, ', ') FROM venta_pagos vp
                   JOIN formas_pago fp ON fp.id = vp.forma_pago_id
                  WHERE vp.venta_id = v.id) AS forma_pago,
                count(*) OVER ()::int AS total_filas
         FROM ventas v
         JOIN terceros t ON t.id = v.cliente_id
         JOIN usuarios u ON u.id = v.usuario_id
         ${donde}
         ORDER BY v.numero DESC
         LIMIT $${n + 1} OFFSET $${n + 2}`,
        [...params, porPagina, (pagina - 1) * porPagina],
      ),
      this.db.query<{ cantidad: number; total: string; itbis: string }>(
        `SELECT count(*)::int AS cantidad,
                COALESCE(sum(v.total), 0)::numeric(16,2) AS total,
                COALESCE(sum(v.itbis), 0)::numeric(16,2) AS itbis
         FROM ventas v JOIN terceros t ON t.id = v.cliente_id
         ${donde ? donde + ' AND' : 'WHERE'} v.estado = 'completada'`,
        params,
      ),
    ]);

    return {
      filas: r.rows.map(({ total_filas: _t, ...f }) => ({
        ...f,
        numero_texto: numeroVenta(f.numero),
      })),
      total: r.rows[0]?.total_filas ?? 0,
      pagina,
      porPagina,
      resumen: t.rows[0], // solo ventas completadas del filtro
    };
  }

  async detalle(actorId: string, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Venta no encontrada');
    const v = await this.db.query(
      `SELECT v.*, t.nombre AS cliente, t.numero_documento AS cliente_documento,
              u.username AS vendedor, s.nombre AS sucursal, ua.username AS anulada_por_usuario
       FROM ventas v
       JOIN terceros t ON t.id = v.cliente_id
       JOIN usuarios u ON u.id = v.usuario_id
       JOIN sucursales s ON s.id = v.sucursal_id
       LEFT JOIN usuarios ua ON ua.id = v.anulada_por
       WHERE v.id = $1`,
      [id],
    );
    if (v.rowCount === 0) throw new NotFoundException('Venta no encontrada');
    const [lineas, pagos, verCostos, verDocumento] = await Promise.all([
      this.db.query(
        'SELECT * FROM venta_lineas WHERE venta_id = $1 ORDER BY id',
        [id],
      ),
      this.db.query(
        `SELECT vp.monto, vp.recibido, vp.devuelta, vp.referencia, fp.nombre AS forma_pago
         FROM venta_pagos vp JOIN formas_pago fp ON fp.id = vp.forma_pago_id
         WHERE vp.venta_id = $1 ORDER BY vp.id`,
        [id],
      ),
      this.tienePermiso(actorId, 'inventario.ver_costos'),
      this.tienePermiso(actorId, 'terceros.ver_documento'),
    ]);
    const venta = v.rows[0] as Record<string, unknown>;
    return {
      ...venta,
      numero_texto: numeroVenta(venta.numero as string),
      cliente_documento: verDocumento
        ? venta.cliente_documento
        : enmascarar(venta.cliente_documento as string | null),
      lineas: lineas.rows.map((l: Record<string, unknown>) => {
        if (verCostos) return l;
        const { costo_unitario: _c, ...resto } = l;
        return resto;
      }),
      pagos: pagos.rows,
    };
  }

  // ---------- Comprobante interno en PDF (80 mm, 58 mm o carta) ----------

  async recibo(actorId: string, id: string, formato: unknown) {
    const f = texto(formato) || '80';
    if (f !== '80' && f !== '58' && f !== 'carta') {
      throw new BadRequestException('Formato inválido: use 80, 58 o carta');
    }
    // El detalle ya aplica los permisos (documento oculto si corresponde).
    const venta = (await this.detalle(
      actorId,
      id,
    )) as unknown as DatosRecibo['venta'];
    const e = await this.db.query<DatosRecibo['empresa']>(
      `SELECT nombre_comercial, razon_social, rnc, direccion, telefono, whatsapp,
              correo, logo, logo_tipo
       FROM empresa WHERE id = 1`,
    );
    const zona = await this.config(this.db, 'empresa.zona_horaria');
    const pdf = await generarRecibo(
      { empresa: e.rows[0], venta, zonaHoraria: zona },
      f as Formato,
    );
    return { pdf, nombre: `${venta.numero_texto}.pdf` };
  }

  // ---------- Comprobante fiscal (NCF/e-CF emitido en el sistema actual) ----------

  async comprobante(
    actorId: string,
    id: string,
    ip: string | undefined,
    valor: unknown,
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Venta no encontrada');
    const comprobante =
      opcional(valor, 30, 'Comprobante fiscal')?.toUpperCase() ?? null;
    if (comprobante && !/^[A-Z0-9-]{3,30}$/.test(comprobante)) {
      throw new BadRequestException(
        'Comprobante inválido: solo letras, números y guiones',
      );
    }
    return this.db.transaccion(async (c) => {
      const r = await c.query<{
        numero: string;
        estado: string;
        comprobante_fiscal: string | null;
      }>(
        'SELECT numero, estado, comprobante_fiscal FROM ventas WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (r.rowCount === 0) throw new NotFoundException('Venta no encontrada');
      const antes = r.rows[0];
      if (antes.estado !== 'completada') {
        throw new BadRequestException('La venta está anulada');
      }
      if (antes.comprobante_fiscal === comprobante) return { ok: true };
      await c.query('UPDATE ventas SET comprobante_fiscal = $2 WHERE id = $1', [
        id,
        comprobante,
      ]);
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'venta.comprobante',
        entidad: 'ventas',
        entidadId: id,
        anterior: {
          numero: numeroVenta(antes.numero),
          comprobante_fiscal: antes.comprobante_fiscal,
        },
        nuevo: {
          numero: numeroVenta(antes.numero),
          comprobante_fiscal: comprobante,
        },
        ip,
      });
      return { ok: true };
    });
  }

  // ---------- Anular ----------

  async anular(
    actorId: string,
    id: string,
    ip: string | undefined,
    motivo: unknown,
    cajaIdTexto?: unknown,
  ) {
    if (!UUID.test(id)) throw new NotFoundException('Venta no encontrada');
    const textoMotivo = texto(motivo);
    if (textoMotivo.length < 5 || textoMotivo.length > 500) {
      throw new BadRequestException(
        'Escriba el motivo de la anulación (entre 5 y 500 caracteres)',
      );
    }
    const zona = await this.config(this.db, 'empresa.zona_horaria');

    return this.db.transaccion(async (c) => {
      const r = await c.query<{
        numero: string;
        estado: string;
        total: string;
        sucursal_id: string;
        mismo_dia: boolean;
      }>(
        `SELECT numero, estado, total, sucursal_id,
                (fecha AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date AS mismo_dia
         FROM ventas WHERE id = $1 FOR UPDATE`,
        [id, zona],
      );
      if (r.rowCount === 0) throw new NotFoundException('Venta no encontrada');
      const v = r.rows[0];
      if (v.estado === 'anulada')
        throw new BadRequestException('La venta ya está anulada');
      if (
        !v.mismo_dia &&
        !(await this.tienePermiso(actorId, 'ventas.anular_anteriores'))
      ) {
        throw new ForbiddenException(
          'Solo se pueden anular ventas del mismo día. Para días anteriores hace falta el permiso "Anular ventas de días anteriores".',
        );
      }

      // El efectivo cobrado se le devuelve al cliente desde la caja abierta
      // de esta computadora.
      const ef = await c.query<{ monto: string }>(
        `SELECT COALESCE(sum(vp.monto), 0)::numeric(14,2) AS monto
         FROM venta_pagos vp JOIN formas_pago fp ON fp.id = vp.forma_pago_id
         WHERE vp.venta_id = $1 AND fp.usa_caja`,
        [id],
      );
      const efectivo = ef.rows[0].monto;
      let cajaDevolucion: string | null = null;
      if (efectivo !== '0.00') {
        const cajaId = texto(cajaIdTexto).toLowerCase();
        if (!UUID.test(cajaId)) {
          throw new BadRequestException(
            'La venta se cobró en efectivo: esta computadora necesita una caja asignada para devolver el dinero',
          );
        }
        const s = await c.query<{ id: string; caja: string; numero: string }>(
          `SELECT s.id, c.nombre AS caja, s.numero
           FROM caja_sesiones s JOIN cajas c ON c.id = s.caja_id
           WHERE s.caja_id = $1 AND s.estado = 'abierta'
           FOR UPDATE OF s`,
          [cajaId],
        );
        if (s.rowCount === 0) {
          throw new BadRequestException(
            'La caja de esta computadora no está abierta: ábrala para devolver el efectivo',
          );
        }
        const hay = (
          await c.query<{ esperado: string }>(SQL_ESPERADO, [s.rows[0].id])
        ).rows[0].esperado;
        const ok = await c.query<{ ok: boolean }>(
          'SELECT $1::numeric >= $2::numeric AS ok',
          [hay, efectivo],
        );
        if (!ok.rows[0].ok) {
          throw new BadRequestException(
            `No hay suficiente efectivo en ${s.rows[0].caja} para devolver RD$${efectivo} (hay RD$${hay})`,
          );
        }
        await c.query(
          `INSERT INTO caja_movimientos (sesion_id, tipo, monto, venta_id, motivo, usuario_id)
           VALUES ($1, 'devolucion', $2, $3, $4, $5)`,
          [s.rows[0].id, efectivo, id, textoMotivo, actorId],
        );
        cajaDevolucion = `${s.rows[0].caja} (${numeroSesion(s.rows[0].numero)})`;
      }

      // La mercancía vuelve al inventario.
      const lineas = await c.query<{
        producto_id: string;
        cantidad: string;
        costo_unitario: string;
      }>(
        `SELECT producto_id, cantidad, costo_unitario FROM venta_lineas
         WHERE venta_id = $1 AND tipo = 'producto' ORDER BY producto_id`,
        [id],
      );
      for (const l of lineas.rows) {
        await c.query(
          `INSERT INTO movimientos_inventario
             (producto_id, sucursal_id, tipo, cantidad, costo_unitario,
              costo_promedio, referencia, motivo, venta_id, usuario_id)
           VALUES ($1, $2, 'anulacion_venta', $3, $4, $4, $5, $6, $7, $8)`,
          [
            l.producto_id,
            v.sucursal_id,
            l.cantidad,
            l.costo_unitario,
            numeroVenta(v.numero),
            textoMotivo,
            id,
            actorId,
          ],
        );
      }

      await c.query(
        `UPDATE ventas SET estado = 'anulada', anulada_por = $2, anulada_en = now(),
                motivo_anulacion = $3
         WHERE id = $1`,
        [id, actorId, textoMotivo],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'venta.anular',
        entidad: 'ventas',
        entidadId: id,
        anterior: {
          numero: numeroVenta(v.numero),
          estado: 'completada',
          total: v.total,
        },
        nuevo: {
          numero: numeroVenta(v.numero),
          estado: 'anulada',
          productos_devueltos: lineas.rowCount,
          mismo_dia: v.mismo_dia,
          efectivo_devuelto: efectivo,
          caja: cajaDevolucion,
        },
        motivo: textoMotivo,
        ip,
      });
      return { ok: true };
    });
  }
}
