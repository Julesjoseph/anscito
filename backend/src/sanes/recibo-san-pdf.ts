import PDFDocument from 'pdfkit';
import { dinero } from '../ventas/recibo-pdf';
import type { Formato } from '../ventas/recibo-pdf';

// Recibos del SAN (rollo de 80 o 58 mm, u hoja carta): cobro de cuotas y
// entrega de la mano. Se arman como una lista de filas.

export type FilaRecibo =
  | { tipo: 'linea' }
  | { tipo: 'titulo'; texto: string }
  | {
      tipo: 'fila';
      izq: string;
      der: string;
      negrita?: boolean;
      grande?: boolean;
    }
  | { tipo: 'nota'; texto: string }
  | { tipo: 'firma'; texto: string };

export type DatosReciboSan = {
  empresa: {
    nombre_comercial: string;
    rnc: string | null;
    telefono: string | null;
  };
  filas: FilaRecibo[];
};

const MM = 72 / 25.4;
const MEDIDAS: Record<
  Formato,
  { ancho: number; margen: number; letra: number }
> = {
  '80': { ancho: 80 * MM, margen: 4 * MM, letra: 8 },
  '58': { ancho: 58 * MM, margen: 3 * MM, letra: 7 },
  carta: { ancho: 612, margen: 48, letra: 10 },
};

export { dinero };

function dibujar(
  doc: PDFKit.PDFDocument,
  d: DatosReciboSan,
  f: Formato,
): number {
  const m = MEDIDAS[f];
  const util = m.ancho - m.margen * 2;
  const centro = { width: util, align: 'center' as const };
  const anchoFilas = f === 'carta' ? 320 : util;
  const xFilas = f === 'carta' ? m.margen + (util - 320) / 2 : m.margen;
  const linea = () => {
    doc.moveDown(0.3);
    doc
      .moveTo(m.margen, doc.y)
      .lineTo(m.margen + util, doc.y)
      .dash(1.5, { space: 1.5 })
      .lineWidth(0.5)
      .stroke()
      .undash();
    doc.moveDown(0.4);
  };

  doc.y = m.margen;
  doc
    .font('Helvetica-Bold')
    .fontSize(m.letra + 3)
    .text(d.empresa.nombre_comercial, m.margen, doc.y, centro);
  doc.font('Helvetica').fontSize(m.letra);
  if (d.empresa.rnc) doc.text(`RNC: ${d.empresa.rnc}`, m.margen, doc.y, centro);
  if (d.empresa.telefono)
    doc.text(`Tel: ${d.empresa.telefono}`, m.margen, doc.y, centro);
  linea();
  for (const x of d.filas) {
    if (x.tipo === 'linea') linea();
    else if (x.tipo === 'titulo') {
      doc
        .font('Helvetica-Bold')
        .fontSize(m.letra + 1)
        .text(x.texto, m.margen, doc.y, centro);
      doc.moveDown(0.2);
    } else if (x.tipo === 'nota') {
      doc
        .font('Helvetica')
        .fontSize(m.letra - 0.5)
        .text(x.texto, m.margen, doc.y, centro);
    } else if (x.tipo === 'firma') {
      doc.moveDown(1.6);
      doc
        .font('Helvetica')
        .fontSize(m.letra)
        .text('_______________________', m.margen, doc.y, centro);
      doc.text(x.texto, m.margen, doc.y, centro);
    } else {
      const tam = m.letra + (x.grande ? 2 : 0);
      const y = doc.y;
      doc.font(x.negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(tam);
      const w = Math.min(doc.widthOfString(x.der), anchoFilas * 0.6);
      doc.text(x.izq, xFilas, y, { width: anchoFilas - w - 4 });
      const fin = doc.y;
      doc.text(x.der, xFilas + anchoFilas - w, y, { width: w, align: 'right' });
      doc.y = Math.max(fin, doc.y);
    }
  }
  return doc.y + m.margen;
}

function crear(tamano: [number, number], f: Formato, titulo: string) {
  const m = MEDIDAS[f].margen;
  return new PDFDocument({
    size: tamano,
    margins: { top: m, bottom: m, left: m, right: m },
    info: { Title: titulo, Producer: 'ANSCITO' },
  });
}

function aBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((ok, mal) => {
    const partes: Buffer[] = [];
    doc.on('data', (b: Buffer) => partes.push(b));
    doc.on('end', () => ok(Buffer.concat(partes)));
    doc.on('error', mal);
    doc.end();
  });
}

export async function generarReciboSan(
  d: DatosReciboSan,
  f: Formato,
  titulo: string,
): Promise<Buffer> {
  if (f === 'carta') {
    const doc = crear([612, 792], f, titulo);
    dibujar(doc, d, f);
    return aBuffer(doc);
  }
  const prueba = crear([MEDIDAS[f].ancho, 14400], f, titulo);
  const largo = dibujar(prueba, d, f);
  void aBuffer(prueba);
  const doc = crear([MEDIDAS[f].ancho, Math.ceil(largo)], f, titulo);
  dibujar(doc, d, f);
  return aBuffer(doc);
}
