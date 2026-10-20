import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { registrarAuditoria } from '../auditoria/auditoria';
import { SQL_DISPONIBLE, SQL_MOVS_CON_ESTADO } from '../bancos/sql';
import { numeroSesion, SQL_ESPERADO } from '../caja/sql';
import { contabilizar, revertir } from '../contabilidad/motor';
import { registrarCredito } from '../cxc/estado';
import { normalizarBusqueda } from '../comun/busqueda';
import { DatabaseService } from '../database/database.service';
import {
  anularEcfDeVenta,
  crearEcfDeVenta,
  facturacionActiva,
} from '../facturacion/ecf';
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
import {
  aDolaresArriba,
  aPesos,
  cobroEnDolares,
  normalizarTasa,
  SQL_ESPERADO_USD,
  tasaVigente,
} from '../comun/dolar';
import type { CobroUsd } from '../comun/dolar';
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
    cuentaId?: unknown;
    // Pago en dólares (solo efectivo): lo que entregó en US$ y en qué moneda
    // se le da la devuelta.
    moneda?: unknown;
    recibidoUsd?: unknown;
    devueltaMoneda?: unknown;
  };
  comprobanteFiscal?: unknown;
  // e-CF: '31' (Crédito Fiscal), '32' (Consumo) o vacío (según el cliente).
  tipoEcf?: unknown;
  // Venta a crédito: el inicial que paga ahora (puede ser 0) y el plazo.
  credito?: {
    inicial?: unknown;
    plazoDias?: unknown;
    autorizarMotivo?: unknown;
  };
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
  moneda: 'DOP' | 'USD';
  por_cuenta_tercero: boolean; // servicio cobrado por cuenta de un tercero
  // Servicio con precio en US$: precio y costo de arriba ya en RD$.
  precio_usd?: string | null;
  tasa_dolar?: string | null;
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
    const [formas, maximo, descontar, factura, vendeCredito, autoriza] =
      await Promise.all([
        this.db.query(
          `SELECT id, codigo, nombre, calcula_devuelta, requiere_referencia, usa_caja, usa_cuenta
         FROM formas_pago WHERE is_active = true AND codigo <> 'credito' ORDER BY orden, nombre`,
        ),
        this.config(this.db, 'ventas.descuento_maximo_pct'),
        this.tienePermiso(actorId, 'ventas.descontar'),
        facturacionActiva(this.db),
        this.tienePermiso(actorId, 'cxc.vender'),
        this.tienePermiso(actorId, 'cxc.autorizar'),
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
    // Cuentas en pesos donde pueden llegar las transferencias de ventas.
    const cuentas = await this.db.query(
      `SELECT id, nombre FROM cuentas
       WHERE is_active AND recibe_ventas ORDER BY lower(nombre)`,
    );
    return {
      formasPago: formas.rows,
      cajas: cajas.rows,
      cuentasVenta: cuentas.rows,
      descuentoMaximoPct: maximo,
      puedeDescontar: descontar,
      consumidorFinal: cf.rows[0] ?? null,
      tasaDolar: await tasaVigente(this.db),
      facturacion: { activa: factura.activa, umbral: factura.umbral },
      credito: { puedeVender: vendeCredito, puedeAutorizar: autoriza },
    };
  }

  // ---------- Tasa del dólar ----------

  // Tasa vigente e historial (las últimas 30).
  async tasasDolar() {
    const [vigente, historial] = await Promise.all([
      tasaVigente(this.db),
      this.db.query(
        `SELECT t.tasa::text AS tasa, t.vigente_desde, t.motivo, u.username AS usuario
         FROM tasas_dolar t JOIN usuarios u ON u.id = t.created_by
         ORDER BY t.vigente_desde DESC, t.created_at DESC LIMIT 30`,
      ),
    ]);
    return { vigente, historial: historial.rows };
  }

  // Tasa nueva: rige desde ahora. Las anteriores quedan en el historial.
  async registrarTasaDolar(
    actorId: string,
    ip: string | undefined,
    datos: { tasa?: unknown; motivo?: unknown },
  ) {
    const tasa = normalizarTasa(datos.tasa);
    if (tasa === null || Number(tasa) >= 1000)
      throw new BadRequestException(
        'Tasa inválida: RD$ por 1 US$, mayor que 0 y con hasta 4 decimales (ej.: 60.50)',
      );
    const motivo = opcional(datos.motivo, 300, 'Motivo');
    return this.db.transaccion(async (c) => {
      const antes = await tasaVigente(c, true);
      const r = await c.query<{ id: string }>(
        `INSERT INTO tasas_dolar (tasa, motivo, created_by, vigente_desde) VALUES ($1, $2, $3, clock_timestamp()) RETURNING id`,
        [tasa, motivo, actorId],
      );
      await registrarAuditoria(c, {
        usuarioId: actorId,
        accion: 'venta.tasa_dolar',
        entidad: 'tasas_dolar',
        entidadId: r.rows[0].id,
        anterior: antes ? { tasa: antes.tasa } : undefined,
        nuevo: { tasa },
        motivo: motivo ?? undefined,
        ip,
      });
      return { id: r.rows[0].id, tasa };
    });
  }

  // Productos y servicios que se pueden vender (activos, con precio y tasa).
  async catalogo(textoBuscar?: string) {
    const buscar = normalizarBusqueda(texto(textoBuscar));
    const patron = `%${buscar.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const r = await this.db.query(
      `SELECT * FROM (
         SELECT 'producto' AS tipo, p.id, p.codigo, p.nombre, um.nombre AS unidad,
                um.permite_decimales, p.precio_venta AS precio,
                p.precio_incluye_itbis, i.nombre AS impuesto,
                ${SQL_TASA_VIGENTE} AS tasa, 'DOP' AS moneda,
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
                s.precio_incluye_itbis, i.nombre, ${SQL_TASA_VIGENTE}, s.moneda, NULL
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
      codigo: string | null;
      nombre: string;
      nombre_comercial: string | null;
      numero_documento: string | null;
      es_protegido: boolean;
    }>(
      `SELECT id, codigo, nombre, nombre_comercial, numero_documento, es_protegido
       FROM terceros
       WHERE rol = 'cliente' AND is_active
         AND ($1 = '' OR nombre ILIKE $2 OR nombre_comercial ILIKE $2 OR codigo ILIKE $2
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
    tasaDolar: string | null,
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
                NULL::numeric AS comision_pct, p.is_active, 'DOP' AS moneda,
                false AS por_cuenta_tercero
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
                s.is_active, s.moneda, s.por_cuenta_tercero
         FROM servicios s
         JOIN unidades_medida um ON um.id = s.unidad_medida_id
         JOIN impuestos i ON i.id = s.impuesto_id
         WHERE s.id = ANY($1::uuid[])`,
        [servIds],
      );
      for (const a of r.rows) {
        // Precio en US$: se convierte a RD$ con la tasa del día (y el costo).
        if (a.moneda === 'USD' && a.precio !== null) {
          if (!tasaDolar)
            throw new BadRequestException(
              `${a.codigo} tiene precio en US$ y no hay tasa del dólar: pídale al administrador que la registre`,
            );
          articulos.set(`servicio:${a.id}`, {
            ...a,
            precio_usd: a.precio,
            tasa_dolar: tasaDolar,
            precio: aPesos(a.precio, tasaDolar),
            costo: a.costo === null ? null : aPesos(a.costo, tasaDolar),
          });
        } else articulos.set(`servicio:${a.id}`, a);
      }
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
    const tasa = (await tasaVigente(this.db))?.tasa ?? null;
    const { lineas, totales } = await this.calcular(
      this.db,
      actorId,
      datos,
      false,
      tasa,
    );
    return {
      lineas: lineas.map(({ articulo, ...l }) => ({
        codigo: articulo.codigo,
        precio_usd: articulo.precio_usd ?? null,
        ...l,
      })),
      totales,
      // Para cobrar en dólares: tasa y total en US$ (subido al centavo).
      dolar: tasa
        ? { tasa, totalUsd: aDolaresArriba(totales.total, tasa) }
        : null,
    };
  }

  // ---------- Registrar ----------

  async crear(actorId: string, ip: string | undefined, datos: DatosVenta) {
    const clienteId = texto(datos.clienteId).toLowerCase();
    if (!UUID.test(clienteId))
      throw new BadRequestException('Seleccione el cliente');
    const formaId = texto(datos.pago?.formaPagoId).toLowerCase();
    // A crédito: se cobra ahora solo el inicial (puede ser 0).
    const aCredito = !!datos.credito;
    const inicial = aCredito
      ? texto(datos.credito?.inicial) === ''
        ? '0.00'
        : normalizarMonto(datos.credito?.inicial)
      : null;
    if (aCredito && inicial === null)
      throw new BadRequestException(
        'Inicial inválido: número no negativo con hasta 2 decimales',
      );
    if ((!aCredito || inicial !== '0.00') && !UUID.test(formaId))
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

      // Tasa del dólar: se lee una sola vez y se usa en las líneas y en el pago.
      const tasaDolar = (await tasaVigente(c, true))?.tasa ?? null;
      const { lineas, totales } = await this.calcular(
        c,
        actorId,
        datos,
        true,
        tasaDolar,
      );
      if (totales.total === '0.00')
        throw new BadRequestException('El total de la venta no puede ser 0');

      // Lo que se cobra ahora y lo que queda a crédito.
      const cobrado = aCredito ? (inicial as string) : totales.total;
      const montoCredito = aCredito ? restar(totales.total, cobrado) : '0.00';
      if (aCredito && !mayorOIgual(restar(montoCredito, '0.01'), '0.00'))
        throw new BadRequestException(
          'El inicial debe ser menor que el total: si paga todo, no es a crédito',
        );
      const cobraAhora = cobrado !== '0.00';

      // Forma de pago de lo que se cobra ahora ("Crédito" no se elige aquí).
      const fp = await c.query<{
        nombre: string;
        calcula_devuelta: boolean;
        requiere_referencia: boolean;
        usa_caja: boolean;
        usa_cuenta: boolean;
      }>(
        `SELECT nombre, calcula_devuelta, requiere_referencia, usa_caja, usa_cuenta
         FROM formas_pago WHERE id = $1 AND is_active AND codigo <> 'credito'`,
        [cobraAhora ? formaId : null],
      );
      if (cobraAhora && fp.rowCount === 0)
        throw new BadRequestException(
          'La forma de pago no existe o está inactiva',
        );
      const forma = cobraAhora
        ? fp.rows[0]
        : {
            nombre: 'Crédito',
            calcula_devuelta: false,
            requiere_referencia: false,
            usa_caja: false,
            usa_cuenta: false,
          };

      // Pago en dólares: solo efectivo; la devuelta en la moneda que escoja el cajero.
      const monedaPago = texto(datos.pago?.moneda) || 'DOP';
      if (monedaPago !== 'DOP' && monedaPago !== 'USD')
        throw new BadRequestException('Moneda del pago: RD$ (DOP) o US$ (USD)');
      let cobroUsd: CobroUsd | null = null;
      if (cobraAhora && monedaPago === 'USD') {
        if (!forma.usa_caja)
          throw new BadRequestException(
            'En dólares solo se cobra en efectivo (los US$ entran a la caja)',
          );
        if (!tasaDolar)
          throw new BadRequestException(
            'No hay tasa del dólar: pídale al administrador que la registre',
          );
        const devueltaMoneda = texto(datos.pago?.devueltaMoneda) || 'DOP';
        if (devueltaMoneda !== 'DOP' && devueltaMoneda !== 'USD')
          throw new BadRequestException(
            'Devuelta: en pesos (DOP) o en dólares (USD)',
          );
        const recibidoUsd = normalizarMonto(datos.pago?.recibidoUsd);
        const debeUsd = aDolaresArriba(cobrado, tasaDolar);
        cobroUsd =
          recibidoUsd === null
            ? null
            : cobroEnDolares(cobrado, tasaDolar, recibidoUsd, devueltaMoneda);
        if (!cobroUsd)
          throw new BadRequestException(
            `Escriba cuántos dólares entregó el cliente (al menos US$${debeUsd} a ${normalizarTasa(tasaDolar)})`,
          );
      }

      // Pago.
      let recibido: string | null = null;
      let devuelta: string | null = null;
      if (forma.calcula_devuelta && !cobroUsd) {
        recibido = normalizarMonto(datos.pago?.recibido);
        if (recibido === null || !mayorOIgual(recibido, cobrado)) {
          throw new BadRequestException(
            `Escriba cuánto entregó el cliente (al menos RD$${cobrado})`,
          );
        }
        devuelta = restar(recibido, cobrado);
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
        if (cobroUsd && cobroUsd.saleDop !== '0.00') {
          const hay = (
            await c.query<{ esperado: string }>(SQL_ESPERADO, [sesionCaja.id])
          ).rows[0].esperado;
          if (!mayorOIgual(hay, cobroUsd.saleDop))
            throw new BadRequestException(
              `No hay suficientes pesos en ${sesionCaja.caja} para la devuelta de RD$${cobroUsd.saleDop} (hay RD$${hay}): dé la devuelta en dólares`,
            );
        }
      }

      // La transferencia llega a la cuenta que diga el cajero; queda
      // "por confirmar" hasta verla en el estado de cuenta del banco.
      let cuentaVenta: { id: string; nombre: string } | null = null;
      if (forma.usa_cuenta) {
        const cuentaId = texto(datos.pago?.cuentaId).toLowerCase();
        if (!UUID.test(cuentaId)) {
          throw new BadRequestException(
            `Elija a qué cuenta llegó la ${forma.nombre.toLowerCase()}`,
          );
        }
        const ct = await c.query<{ id: string; nombre: string }>(
          `SELECT id, nombre FROM cuentas
           WHERE id = $1 AND is_active AND recibe_ventas FOR SHARE`,
          [cuentaId],
        );
        if (ct.rowCount === 0) {
          throw new BadRequestException(
            'Esa cuenta no existe, está desactivada o no recibe ventas',
          );
        }
        cuentaVenta = ct.rows[0];
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
              comision_pct, precio_usd, tasa_dolar, por_cuenta_tercero)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                   $16, $17, $18, $19, $20, $21, $22, $23)`,
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
            a.precio_usd ?? null,
            a.tasa_dolar ?? null,
            a.por_cuenta_tercero === true,
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

      if (cobraAhora)
        await c.query(
          `INSERT INTO venta_pagos (venta_id, forma_pago_id, monto, recibido, devuelta, referencia, cuenta_id,
                                    moneda, tasa, monto_usd, recibido_usd, devuelta_moneda, devuelta_monto)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            ventaId,
            formaId,
            cobrado,
            recibido,
            devuelta,
            referencia,
            cuentaVenta?.id ?? null,
            cobroUsd ? 'USD' : 'DOP',
            cobroUsd ? tasaDolar : null,
            cobroUsd?.montoUsd ?? null,
            cobroUsd?.recibidoUsd ?? null,
            cobroUsd?.devueltaMoneda ?? null,
            cobroUsd?.devueltaMonto ?? null,
          ],
        );
      // La parte a crédito: pago "Crédito" y su cuenta por cobrar.
      let credito: { vencimiento: string; plazo: number } | null = null;
      if (aCredito) {
        await c.query(
          `INSERT INTO venta_pagos (venta_id, forma_pago_id, monto)
           VALUES ($1, (SELECT id FROM formas_pago WHERE codigo = 'credito'), $2)`,
          [ventaId, montoCredito],
        );
        credito = await registrarCredito(c, {
          ventaId,
          ventaTexto: numeroVenta(numero),
          clienteId,
          monto: montoCredito,
          plazoDias: datos.credito?.plazoDias,
          autorizarMotivo: datos.credito?.autorizarMotivo,
          actorId,
          ip,
        });
      }
      if (cuentaVenta) {
        const zona = await this.config(c, 'empresa.zona_horaria');
        await c.query(
          `INSERT INTO cuenta_movimientos
             (cuenta_id, tipo, signo, monto, tasa, monto_dop, fecha, por_confirmar,
              venta_id, referencia, usuario_id)
           VALUES ($1, 'venta', 1, $2, 1, $2, (now() AT TIME ZONE $3)::date, true,
                   $4, $5, $6)`,
          [cuentaVenta.id, cobrado, zona, ventaId, referencia, actorId],
        );
      }
      if (sesionCaja && cobroUsd && tasaDolar) {
        // Entran los dólares (menos la devuelta si fue en US$) y, si la
        // devuelta fue en pesos, salen esos pesos.
        await c.query(
          `INSERT INTO caja_movimientos_usd (sesion_id, tipo, monto, tasa, monto_dop, venta_id, usuario_id)
           VALUES ($1, 'venta', $2, $3, $4, $5, $6)`,
          [
            sesionCaja.id,
            cobroUsd.entraUsd,
            tasaDolar,
            aPesos(cobroUsd.entraUsd, tasaDolar),
            ventaId,
            actorId,
          ],
        );
        if (cobroUsd.saleDop !== '0.00')
          await c.query(
            `INSERT INTO caja_movimientos (sesion_id, tipo, monto, venta_id, usuario_id)
             VALUES ($1, 'cambio', $2, $3, $4)`,
            [sesionCaja.id, cobroUsd.saleDop, ventaId, actorId],
          );
      } else if (sesionCaja) {
        // Entra a la caja lo cobrado (la devuelta ya salió de lo recibido).
        await c.query(
          `INSERT INTO caja_movimientos (sesion_id, tipo, monto, venta_id, usuario_id)
           VALUES ($1, 'venta', $2, $3, $4)`,
          [sesionCaja.id, cobrado, ventaId, actorId],
        );
      }

      // Su asiento (si la contabilidad ya empezó; si no se puede, queda pendiente).
      await contabilizar(c, 'venta', ventaId, actorId);

      // Su e-CF queda por emitir (si la facturación electrónica ya empezó).
      const ecf = await crearEcfDeVenta(
        c,
        ventaId,
        texto(datos.tipoEcf),
        actorId,
      );

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
          pago_dolares: cobroUsd ? { tasa: tasaDolar, ...cobroUsd } : null,
          caja: sesionCaja
            ? `${sesionCaja.caja} (${numeroSesion(sesionCaja.numero)})`
            : null,
          cuenta: cuentaVenta?.nombre ?? null,
          comprobante_fiscal: comprobante,
          ecf: ecf ? `${ecf.tipo} por emitir` : null,
          credito: credito
            ? {
                monto: montoCredito,
                inicial: cobrado,
                vence: credito.vencimiento,
              }
            : null,
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
        dolares: cobroUsd ? { tasa: tasaDolar, ...cobroUsd } : null,
        ecf: ecf?.tipo ?? null,
        credito: credito
          ? { monto: montoCredito, vencimiento: credito.vencimiento }
          : null,
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
      `SELECT v.*, t.nombre AS cliente, t.codigo AS cliente_codigo, t.numero_documento AS cliente_documento,
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
    const [lineas, pagos, verCostos, verDocumento, ecf, credito] =
      await Promise.all([
        this.db.query(
          'SELECT * FROM venta_lineas WHERE venta_id = $1 ORDER BY id',
          [id],
        ),
        this.db.query(
          `SELECT vp.monto, vp.recibido, vp.devuelta, vp.referencia, fp.nombre AS forma_pago,
                vp.moneda, vp.tasa, vp.monto_usd, vp.recibido_usd, vp.devuelta_moneda, vp.devuelta_monto
         FROM venta_pagos vp JOIN formas_pago fp ON fp.id = vp.forma_pago_id
         WHERE vp.venta_id = $1 ORDER BY vp.id`,
          [id],
        ),
        this.tienePermiso(actorId, 'inventario.ver_costos'),
        this.tienePermiso(actorId, 'terceros.ver_documento'),
        this.db.query(
          `SELECT tipo, estado, encf, to_char(fecha_emision, 'YYYY-MM-DD') AS fecha_emision,
                codigo_seguridad
         FROM ecf WHERE venta_id = $1 AND estado <> 'cancelado' ORDER BY created_at`,
          [id],
        ),
        this.db.query(
          `SELECT monto, plazo_dias, to_char(vencimiento, 'YYYY-MM-DD') AS vencimiento, estado
         FROM cuentas_cobrar WHERE venta_id = $1`,
          [id],
        ),
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
      ecf: ecf.rows,
      credito: credito.rows[0] ?? null,
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

  // ---------- Datos del comprobante para imprimir directo (HTML) ----------

  // La pantalla arma el ticket y lo ajusta al ancho del papel de cada impresora.
  async ticket(actorId: string, id: string) {
    const venta = await this.detalle(actorId, id);
    const e = await this.db.query<
      Omit<DatosRecibo['empresa'], 'logo'> & { logo: Buffer | null }
    >(
      `SELECT nombre_comercial, razon_social, rnc, direccion, telefono, whatsapp,
              correo, logo, logo_tipo
       FROM empresa WHERE id = 1`,
    );
    const { logo, logo_tipo, ...empresa } = e.rows[0];
    const zona = await this.config(this.db, 'empresa.zona_horaria');
    return {
      empresa: {
        ...empresa,
        logo:
          logo && logo_tipo
            ? `data:${logo_tipo};base64,${logo.toString('base64')}`
            : null,
      },
      venta,
      zonaHoraria: zona,
    };
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
      const ef = await c.query<{
        monto: string;
        usd: string;
        cambio: string;
        tasa: string | null;
      }>(
        `SELECT COALESCE(sum(vp.monto) FILTER (WHERE vp.moneda = 'DOP'), 0)::numeric(14,2) AS monto,
                COALESCE(sum(CASE WHEN vp.devuelta_moneda = 'USD' THEN vp.monto_usd ELSE vp.recibido_usd END)
                  FILTER (WHERE vp.moneda = 'USD'), 0)::numeric(14,2) AS usd,
                COALESCE(sum(vp.devuelta_monto) FILTER (WHERE vp.moneda = 'USD' AND vp.devuelta_moneda = 'DOP'), 0)::numeric(14,2) AS cambio,
                max(vp.tasa::text) FILTER (WHERE vp.moneda = 'USD') AS tasa
         FROM venta_pagos vp JOIN formas_pago fp ON fp.id = vp.forma_pago_id
         WHERE vp.venta_id = $1 AND fp.usa_caja`,
        [id],
      );
      const efectivo = ef.rows[0].monto;
      const usd = ef.rows[0].usd;
      const cambio = ef.rows[0].cambio;
      let cajaDevolucion: string | null = null;
      if (efectivo !== '0.00' || usd !== '0.00') {
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
        // La devuelta en pesos que se dio en un pago en US$ vuelve a la caja.
        if (cambio !== '0.00')
          await c.query(
            `INSERT INTO caja_movimientos (sesion_id, tipo, monto, venta_id, motivo, usuario_id)
             VALUES ($1, 'cambio_reverso', $2, $3, $4, $5)`,
            [s.rows[0].id, cambio, id, textoMotivo, actorId],
          );
        if (efectivo !== '0.00') {
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
        }
        // Los dólares cobrados vuelven en dólares (con la tasa de esa venta).
        if (usd !== '0.00' && ef.rows[0].tasa) {
          const tasaVenta = normalizarTasa(ef.rows[0].tasa) as string;
          const hayUsd = (
            await c.query<{ esperado_usd: string }>(SQL_ESPERADO_USD, [
              s.rows[0].id,
            ])
          ).rows[0].esperado_usd;
          if (!mayorOIgual(hayUsd, usd))
            throw new BadRequestException(
              `No hay suficientes dólares en ${s.rows[0].caja} para devolver US$${usd} (hay US$${hayUsd})`,
            );
          await c.query(
            `INSERT INTO caja_movimientos_usd (sesion_id, tipo, monto, tasa, monto_dop, venta_id, motivo, usuario_id)
             VALUES ($1, 'devolucion', $2, $3, $4, $5, $6, $7)`,
            [
              s.rows[0].id,
              usd,
              tasaVenta,
              aPesos(usd, tasaVenta),
              id,
              textoMotivo,
              actorId,
            ],
          );
        }
        cajaDevolucion = `${s.rows[0].caja} (${numeroSesion(s.rows[0].numero)})`;
      }

      // Lo cobrado por transferencia se devuelve desde la misma cuenta
      // (por confirmar). Si el cobro "no llegó", no hay nada que devolver.
      const cobros = await c.query<{
        cuenta_id: string;
        monto: string;
        estado: string;
      }>(
        `SELECT x.cuenta_id, x.monto, x.estado
         FROM ${SQL_MOVS_CON_ESTADO} x
         WHERE x.venta_id = $1 AND x.tipo = 'venta'`,
        [id],
      );
      const devueltoCuentas: string[] = [];
      for (const cobro of cobros.rows) {
        if (cobro.estado === 'no_llego') continue;
        const ct = await c.query<{ nombre: string }>(
          'SELECT nombre FROM cuentas WHERE id = $1 FOR UPDATE',
          [cobro.cuenta_id],
        );
        const hay = (
          await c.query<{ disponible: string }>(SQL_DISPONIBLE, [
            cobro.cuenta_id,
          ])
        ).rows[0].disponible;
        const alcanza = await c.query<{ ok: boolean }>(
          'SELECT $1::numeric >= $2::numeric AS ok',
          [hay, cobro.monto],
        );
        if (!alcanza.rows[0].ok) {
          throw new BadRequestException(
            `No hay suficiente dinero en ${ct.rows[0].nombre} para devolver RD$${cobro.monto} (hay RD$${hay})`,
          );
        }
        await c.query(
          `INSERT INTO cuenta_movimientos
             (cuenta_id, tipo, signo, monto, tasa, monto_dop, fecha, por_confirmar,
              venta_id, motivo, usuario_id)
           VALUES ($1, 'devolucion', -1, $2, 1, $2, (now() AT TIME ZONE $3)::date, true,
                   $4, $5, $6)`,
          [cobro.cuenta_id, cobro.monto, zona, id, textoMotivo, actorId],
        );
        devueltoCuentas.push(`${ct.rows[0].nombre}: RD$${cobro.monto}`);
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

      // Venta a crédito: con abonos no se anula; sin abonos, su cuenta también.
      const cxc = await c.query<{ id: string; abonos: number }>(
        `SELECT k.id, (SELECT count(*)::int FROM cxc_aplicaciones a JOIN cxc_abonos b ON b.id = a.abono_id
                       WHERE a.cuenta_id = k.id AND b.estado = 'activo') AS abonos
         FROM cuentas_cobrar k WHERE k.venta_id = $1 AND k.estado = 'activa' FOR UPDATE OF k`,
        [id],
      );
      if ((cxc.rowCount ?? 0) > 0) {
        if (cxc.rows[0].abonos > 0)
          throw new BadRequestException(
            'Esta venta a crédito ya tiene abonos: anule primero los abonos en Cuentas por Cobrar',
          );
        await c.query(
          `UPDATE cuentas_cobrar SET estado = 'anulada', anulada_en = now() WHERE id = $1`,
          [cxc.rows[0].id],
        );
      }

      const ecf = await anularEcfDeVenta(c, id, actorId, textoMotivo, ip);

      await c.query(
        `UPDATE ventas SET estado = 'anulada', anulada_por = $2, anulada_en = now(),
                motivo_anulacion = $3
         WHERE id = $1`,
        [id, actorId, textoMotivo],
      );
      await revertir(c, 'venta', id, textoMotivo, actorId);
      // Si su cobro se había marcado "No llegó", se deshace también eso.
      const noLlegaron = await c.query<{ id: string }>(
        `SELECT cf.id::text AS id FROM cuenta_confirmaciones cf
         JOIN cuenta_movimientos m ON m.id = cf.movimiento_id
         WHERE m.venta_id = $1 AND cf.resultado = 'no_llego'`,
        [id],
      );
      for (const nl of noLlegaron.rows)
        await revertir(c, 'no_llego', nl.id, textoMotivo, actorId);
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
          devuelto_por_cuenta: devueltoCuentas.length ? devueltoCuentas : null,
          ecf,
        },
        motivo: textoMotivo,
        ip,
      });
      return { ok: true, ecf };
    });
  }
}
