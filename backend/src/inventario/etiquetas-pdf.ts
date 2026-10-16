import PDFDocument from 'pdfkit';
import { barras, modulosTotales } from './code128';

// Etiquetas de productos en PDF: nombre, código de barras Code 128 del código
// interno (legible debajo) y precio final con ITBIS.
// Medidas en puntos (1 pulgada = 72 pt; 1 mm = 2.8346 pt).

export type Etiqueta = { codigo: string; nombre: string; precio: string };

export type Formato = 'carta' | 'rollo';

const MM = 72 / 25.4;

// Hoja carta adhesiva de 30 etiquetas (3 × 10), tipo Avery 5160:
// etiqueta de 2⅝ × 1 pulgada, margen arriba ½", margen izquierdo 3⁄16",
// 1⁄8" entre columnas y ninguno entre filas.
export const CARTA = {
  pagina: [612, 792] as [number, number], // 8½ × 11 pulgadas
  ancho: 189, // 2⅝"
  alto: 72, // 1"
  margenIzq: 13.5, // 3⁄16"
  margenSup: 36, // ½"
  pasoX: 198, // 2¾" (ancho + 1⁄8")
  pasoY: 72,
  columnas: 3,
  filas: 10,
};

// Rollo de impresora térmica: una etiqueta por página, 50 × 25 mm (medida
// por defecto; si el rollo es de otra medida, se cambia aquí).
export const ROLLO = { ancho: 50 * MM, alto: 25 * MM };

// El lector necesita barras de al menos 0.25 mm de ancho (módulo).
export const MODULO_MINIMO = 0.25 * MM;
const MODULO_MAXIMO = 0.5 * MM;

// "1234.5" → "RD$ 1,234.50"
export function precioTexto(v: string): string {
  const [e, d = '00'] = v.split('.');
  return `RD$ ${e.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${d.padEnd(2, '0').slice(0, 2)}`;
}

// Ancho del módulo que cabe en "ancho" pt (null si es menor que el mínimo).
export function moduloPara(codigo: string, ancho: number): number | null {
  const m = Math.min(ancho / modulosTotales(codigo), MODULO_MAXIMO);
  return m >= MODULO_MINIMO ? m : null;
}

function recortar(
  doc: PDFKit.PDFDocument,
  texto: string,
  ancho: number,
): string {
  if (doc.widthOfString(texto) <= ancho) return texto;
  let t = texto;
  while (t.length > 1 && doc.widthOfString(`${t}…`) > ancho) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function dibujar(
  doc: PDFKit.PDFDocument,
  e: Etiqueta,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const pad = 4;
  const util = w - 2 * pad;
  // Nombre (una línea).
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('black');
  doc.text(recortar(doc, e.nombre, util), x + pad, y + pad, {
    width: util,
    align: 'center',
    lineBreak: false,
  });
  // Código de barras centrado, con su zona en blanco incluida en el ancho.
  const m = moduloPara(e.codigo, util);
  if (m === null)
    throw new Error(`El código ${e.codigo} es muy largo para esta etiqueta`);
  const anchoBarras = modulosTotales(e.codigo) * m;
  const x0 = x + pad + (util - anchoBarras) / 2;
  const yBarras = y + pad + 10;
  const altoBarras = h * 0.4;
  for (const [inicio, ancho] of barras(e.codigo))
    doc.rect(x0 + inicio * m, yBarras, ancho * m, altoBarras).fill('black');
  // Código legible debajo.
  doc.font('Helvetica').fontSize(6.5);
  doc.text(e.codigo, x + pad, yBarras + altoBarras + 1.5, {
    width: util,
    align: 'center',
    lineBreak: false,
  });
  // Precio final.
  doc.font('Helvetica-Bold').fontSize(10.5);
  doc.text(precioTexto(e.precio), x + pad, y + h - pad - 11, {
    width: util,
    align: 'center',
    lineBreak: false,
  });
}

// PDF con las etiquetas. En carta, "inicio" (1 a 30) es la primera posición
// libre de la primera hoja (para aprovechar una hoja usada a medias).
export function generarEtiquetas(
  etiquetas: Etiqueta[],
  formato: Formato,
  inicio = 1,
): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
    const partes: Buffer[] = [];
    doc.on('data', (b: Buffer) => partes.push(b));
    doc.on('end', () => resolver(Buffer.concat(partes)));
    doc.on('error', rechazar);
    try {
      if (formato === 'rollo') {
        for (const e of etiquetas) {
          doc.addPage({ size: [ROLLO.ancho, ROLLO.alto], margin: 0 });
          dibujar(doc, e, 0, 0, ROLLO.ancho, ROLLO.alto);
        }
      } else {
        const porHoja = CARTA.columnas * CARTA.filas;
        let pos = Math.min(Math.max(inicio, 1), porHoja) - 1;
        doc.addPage({ size: CARTA.pagina, margin: 0 });
        for (const e of etiquetas) {
          if (pos === porHoja) {
            doc.addPage({ size: CARTA.pagina, margin: 0 });
            pos = 0;
          }
          const col = pos % CARTA.columnas;
          const fila = Math.floor(pos / CARTA.columnas);
          dibujar(
            doc,
            e,
            CARTA.margenIzq + col * CARTA.pasoX,
            CARTA.margenSup + fila * CARTA.pasoY,
            CARTA.ancho,
            CARTA.alto,
          );
          pos++;
        }
      }
      doc.end();
    } catch (err) {
      rechazar(err);
    }
  });
}
