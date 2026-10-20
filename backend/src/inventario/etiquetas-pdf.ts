import PDFDocument from 'pdfkit';
import { ZONA_BLANCA, barras, modulosTotales } from './code128';

// Etiquetas de productos en PDF: nombre, código de barras Code 128 del código
// interno (legible debajo) y precio final con ITBIS.
// Medidas en puntos (1 pulgada = 72 pt; 1 mm = 2.8346 pt).

export type Etiqueta = { codigo: string; nombre: string; precio: string };

export type Formato = 'carta' | 'rollo';

const MM = 72 / 25.4;

// Medidas y letras de cada papel. Para cambiar de hoja o de rollo, se
// cambian solo estas constantes.
type Diseno = {
  ancho: number; // de la etiqueta
  alto: number;
  pad: number; // margen interior
  letraNombre: number;
  letraCodigo: number;
  letraPrecio: number;
  separacion: number; // entre el nombre, las barras y la línea de abajo
  altoBarras: number; // al menos ~5 mm para que el lector lo lea
  moduloMaximo?: number; // barra más fina permitida más ancha (pt)
};

// Hoja carta adhesiva de 80 etiquetas (4 × 20), tipo Avery 5167 (decisión
// del dueño, para imprimir en la Epson): etiqueta de 1¾ × ½ pulgada, margen
// arriba ½", margen izquierdo 0.3", 0.3" entre columnas y ninguno entre filas.
// El dibujo va más chico que la etiqueta (unos 3.7 × 1 cm, pedido del dueño),
// centrado, con borde blanco alrededor.
export const CARTA = {
  pagina: [612, 792] as [number, number], // 8½ × 11 pulgadas
  ancho: 126, // 1¾"
  alto: 36, // ½"
  margenIzq: 21.6, // 0.3"
  margenSup: 36, // ½"
  pasoX: 147.6, // 2.05" (ancho + 0.3")
  pasoY: 36,
  columnas: 4,
  filas: 20,
  pad: 3,
  letraNombre: 5,
  letraCodigo: 5,
  letraPrecio: 6.5,
  separacion: 0.8,
  altoBarras: 14.2, // 5 mm
  moduloMaximo: 0.26 * MM, // cerca del mínimo que lee el lector (0.25 mm)
};

// Rollo de impresora de etiquetas: una por página, 50 × 25 mm (si el rollo
// es de otra medida, se cambia aquí).
export const ROLLO: Diseno = {
  ancho: 50 * MM,
  alto: 25 * MM,
  pad: 4,
  letraNombre: 7.5,
  letraCodigo: 7.5,
  letraPrecio: 10.5,
  separacion: 2,
  altoBarras: 34, // 12 mm
};

export function disenoDe(formato: Formato): Diseno {
  return formato === 'carta' ? CARTA : ROLLO;
}

// Ancho donde va el código de barras (con su zona en blanco).
export function anchoUtil(formato: Formato): number {
  const d = disenoDe(formato);
  return d.ancho - 2 * d.pad;
}

// El lector necesita barras de al menos 0.25 mm de ancho (módulo).
export const MODULO_MINIMO = 0.25 * MM;
const MODULO_MAXIMO = 0.5 * MM;

// "1234.5" → "RD$ 1,234.50"
export function precioTexto(v: string): string {
  const [e, d = '00'] = v.split('.');
  return `RD$ ${e.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${d.padEnd(2, '0').slice(0, 2)}`;
}

// Ancho del módulo que cabe en "ancho" pt (null si es menor que el mínimo).
export function moduloPara(
  codigo: string,
  ancho: number,
  maximo = MODULO_MAXIMO,
): number | null {
  const m = Math.min(ancho / modulosTotales(codigo), maximo);
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

// Etiqueta: nombre arriba (una línea), código de barras en el medio y, en
// la línea de abajo, el código a la izquierda y el precio a la derecha.
function dibujar(
  doc: PDFKit.PDFDocument,
  e: Etiqueta,
  x: number,
  y: number,
  d: Diseno,
) {
  const util = d.ancho - 2 * d.pad;
  const m = moduloPara(e.codigo, util, d.moduloMaximo);
  if (m === null)
    throw new Error(`El código ${e.codigo} es muy largo para esta etiqueta`);
  // Todo el bloque (nombre, barras y línea de abajo) va centrado en la altura.
  const altoNombre = d.letraNombre * 1.15;
  const altoAbajo = d.letraPrecio * 1.15;
  const bloque =
    altoNombre + d.separacion + d.altoBarras + d.separacion + altoAbajo;
  const arriba = y + Math.max(d.pad - 1, (d.alto - bloque) / 2);
  // Código de barras centrado, con su zona en blanco incluida en el ancho.
  const anchoBarras = modulosTotales(e.codigo) * m;
  const x0 = x + d.pad + (util - anchoBarras) / 2;
  // El nombre no pasa del ancho de las barras.
  const anchoNombre = anchoBarras - ZONA_BLANCA * m;
  doc.font('Helvetica-Bold').fontSize(d.letraNombre).fillColor('black');
  doc.text(
    recortar(doc, e.nombre, anchoNombre),
    x0 + (ZONA_BLANCA * m) / 2,
    arriba,
    { width: anchoNombre, align: 'center', lineBreak: false },
  );
  const yBarras = arriba + altoNombre + d.separacion;
  for (const [inicio, ancho] of barras(e.codigo))
    doc.rect(x0 + inicio * m, yBarras, ancho * m, d.altoBarras).fill('black');
  // Línea de abajo, pegada a las barras: el código empieza donde empiezan las
  // barras y el precio termina donde terminan. Si no cabe, usa todo el ancho.
  const yAbajo = yBarras + d.altoBarras + d.separacion;
  const precio = precioTexto(e.precio);
  doc.font('Helvetica-Bold').fontSize(d.letraPrecio);
  const anchoPrecio = doc.widthOfString(precio);
  doc.font('Helvetica').fontSize(d.letraCodigo);
  const anchoCodigo = doc.widthOfString(e.codigo);
  let izq = x0 + ZONA_BLANCA * m;
  let der = x0 + anchoBarras - ZONA_BLANCA * m;
  if (anchoCodigo + anchoPrecio + 3 > der - izq) {
    izq = x + d.pad;
    der = x + d.pad + util;
  }
  doc.font('Helvetica-Bold').fontSize(d.letraPrecio);
  doc.text(precio, izq, yAbajo, {
    width: der - izq,
    align: 'right',
    lineBreak: false,
  });
  doc.font('Helvetica').fontSize(d.letraCodigo);
  doc.text(
    recortar(doc, e.codigo, der - izq - anchoPrecio - 3),
    izq,
    yAbajo + (d.letraPrecio - d.letraCodigo) * 0.75,
    { width: der - izq - anchoPrecio - 3, align: 'left', lineBreak: false },
  );
}

// PDF con las etiquetas. En carta, "inicio" (1 a 80) es la primera posición
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
          dibujar(doc, e, 0, 0, ROLLO);
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
            CARTA,
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
