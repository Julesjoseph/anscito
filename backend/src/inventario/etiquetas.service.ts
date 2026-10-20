import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { calcularItbis } from '../servicios/calculo-itbis';
import {
  CARTA,
  anchoUtil,
  generarEtiquetas,
  moduloPara,
} from './etiquetas-pdf';
import type { Etiqueta, Formato } from './etiquetas-pdf';
import { SQL_TASA_VIGENTE } from './sql';

// Etiquetas de precio de los productos: el usuario marca productos y cuántas
// etiquetas de cada uno. El precio es el FINAL con ITBIS (tasa vigente), con
// el mismo cálculo de la venta. Sin precio de venta, no se imprime.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ETIQUETAS = 3000;

export type DatosEtiquetas = {
  formato?: unknown;
  inicio?: unknown;
  productos?: unknown; // [{ productoId, cantidad }]
};

type Pedido = {
  formato: Formato;
  inicio: number;
  productos: { productoId: string; cantidad: number }[];
};

function entero(v: unknown): number | null {
  const t =
    typeof v === 'number' || typeof v === 'string' ? String(v).trim() : '';
  return /^\d{1,4}$/.test(t) ? Number(t) : null;
}

@Injectable()
export class EtiquetasService {
  constructor(private readonly db: DatabaseService) {}

  private leer(datos: DatosEtiquetas): Pedido {
    const formato = datos.formato;
    if (formato !== 'carta' && formato !== 'rollo')
      throw new BadRequestException('Escoja el papel: hoja carta o rollo');
    const inicio = formato === 'carta' ? (entero(datos.inicio ?? 1) ?? 0) : 1;
    if (inicio < 1 || inicio > CARTA.columnas * CARTA.filas)
      throw new BadRequestException(
        `Posición inicial: de 1 a ${CARTA.columnas * CARTA.filas}`,
      );
    if (!Array.isArray(datos.productos) || datos.productos.length === 0)
      throw new BadRequestException('Marque al menos un producto');
    if (datos.productos.length > 300)
      throw new BadRequestException('Máximo 300 productos a la vez');
    const vistos = new Set<string>();
    const productos = (datos.productos as Record<string, unknown>[]).map(
      (p) => {
        const productoId = (
          typeof p?.productoId === 'string' ? p.productoId : ''
        ).toLowerCase();
        if (!UUID.test(productoId))
          throw new BadRequestException('Producto inválido');
        if (vistos.has(productoId))
          throw new BadRequestException('Un producto está repetido');
        vistos.add(productoId);
        const cantidad = entero(p?.cantidad);
        if (cantidad === null || cantidad < 1 || cantidad > 500)
          throw new BadRequestException(
            'Cantidad de etiquetas: de 1 a 500 por producto',
          );
        return { productoId, cantidad };
      },
    );
    const total = productos.reduce((a, p) => a + p.cantidad, 0);
    if (total > MAX_ETIQUETAS)
      throw new BadRequestException(
        `Máximo ${MAX_ETIQUETAS} etiquetas a la vez`,
      );
    return { formato, inicio, productos };
  }

  // Qué se puede imprimir y qué no (sin precio, sin tasa o código muy largo).
  async revisar(datos: DatosEtiquetas) {
    const p = this.leer(datos);
    const r = await this.db.query<{
      id: string;
      codigo: string;
      nombre: string;
      precio_venta: string | null;
      precio_incluye_itbis: boolean;
      tasa: string | null;
    }>(
      `SELECT p.id, p.codigo, p.nombre, p.precio_venta, p.precio_incluye_itbis,
              ${SQL_TASA_VIGENTE} AS tasa
       FROM productos p JOIN impuestos i ON i.id = p.impuesto_id
       WHERE p.id = ANY($1::uuid[]) AND p.is_active`,
      [p.productos.map((x) => x.productoId)],
    );
    const porId = new Map(r.rows.map((x) => [x.id, x]));
    const ancho = anchoUtil(p.formato);
    const listos: (Etiqueta & { id: string; cantidad: number })[] = [];
    const noSeImprimen: {
      id: string;
      codigo: string;
      nombre: string;
      motivo: string;
    }[] = [];
    for (const pedido of p.productos) {
      const x = porId.get(pedido.productoId);
      if (!x) {
        noSeImprimen.push({
          id: pedido.productoId,
          codigo: '',
          nombre: '',
          motivo: 'No existe o está desactivado',
        });
        continue;
      }
      const falla =
        x.precio_venta === null
          ? 'No tiene precio de venta'
          : x.tasa === null
            ? 'Su impuesto no tiene tasa vigente'
            : moduloPara(x.codigo, ancho) === null
              ? 'El código es muy largo para esta etiqueta'
              : null;
      if (falla) {
        noSeImprimen.push({
          id: x.id,
          codigo: x.codigo,
          nombre: x.nombre,
          motivo: falla,
        });
        continue;
      }
      const precio = calcularItbis(
        x.precio_venta as string,
        x.tasa as string,
        x.precio_incluye_itbis,
      ).total;
      listos.push({
        id: x.id,
        codigo: x.codigo,
        nombre: x.nombre,
        precio,
        cantidad: pedido.cantidad,
      });
    }
    return {
      formato: p.formato,
      inicio: p.inicio,
      listos,
      noSeImprimen,
      etiquetas: listos.reduce((a, x) => a + x.cantidad, 0),
    };
  }

  async pdf(
    datos: DatosEtiquetas,
  ): Promise<{ archivo: Buffer; nombre: string }> {
    const r = await this.revisar(datos);
    if (r.listos.length === 0)
      throw new BadRequestException(
        'Ningún producto marcado se puede imprimir (revise el precio de venta)',
      );
    const etiquetas = r.listos.flatMap((x) =>
      Array.from({ length: x.cantidad }, () => ({
        codigo: x.codigo,
        nombre: x.nombre,
        precio: x.precio,
      })),
    );
    const archivo = await generarEtiquetas(etiquetas, r.formato, r.inicio);
    return { archivo, nombre: `etiquetas-${r.formato}.pdf` };
  }
}
