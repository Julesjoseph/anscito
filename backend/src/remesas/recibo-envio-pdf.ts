import PDFDocument from 'pdfkit';
import { dinero } from '../ventas/recibo-pdf';
import type { Formato } from '../ventas/recibo-pdf';

// Recibo de un envío (rollo de 80 o 58 mm, u hoja carta): provisional
// mientras está pendiente, definitivo al confirmarse.

export type DatosReciboEnvio = {
  empresa: {
    nombre_comercial: string;
    rnc: string | null;
    telefono: string | null;
    correo: string | null;
  };
  envio: {
    numero_texto: string;
    fecha: string;
    estado: 'pendiente' | 'confirmado' | 'rechazado';
    agente: string;
    remitente_nombre: string;
    remitente_telefono: string | null;
    beneficiario_nombre: string;
    beneficiario_telefono: string | null;
    billetera: string | null;
    monto_enviado: string;
    tasa: string;
    monto_recibir: string;
    comision: string;
    total_pagar: string;
    codigo_externo: string | null;
    motivo_rechazo: string | null;
  };
  zonaHoraria: string;
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

// "2050.00" -> "HTG 2,050.00"
function gourdes(monto: string): string {
  return dinero(monto).replace('RD$', 'HTG ');
}

function fecha(iso: string, zona: string): string {
  return new Intl.DateTimeFormat('es-DO', {
    timeZone: zona,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

const TITULO = {
  pendiente: 'RECIBO PROVISIONAL',
  confirmado: 'RECIBO DEFINITIVO',
  rechazado: 'ENVÍO RECHAZADO',
};

function dibujar(
  doc: PDFKit.PDFDocument,
  d: DatosReciboEnvio,
  f: Formato,
): number {
  const m = MEDIDAS[f];
  const util = m.ancho - m.margen * 2;
  const e = d.envio;
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
  const fila = (izq: string, der: string, negrita = false, tam = m.letra) => {
    const y = doc.y;
    doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(tam);
    const w = Math.min(doc.widthOfString(der), anchoFilas * 0.62);
    doc.text(izq, xFilas, y, { width: anchoFilas - w - 4 });
    const fin = doc.y;
    doc.text(der, xFilas + anchoFilas - w, y, { width: w, align: 'right' });
    doc.y = Math.max(fin, doc.y);
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
  if (d.empresa.correo) doc.text(d.empresa.correo, m.margen, doc.y, centro);
  linea();
  doc
    .font('Helvetica-Bold')
    .fontSize(m.letra + 1)
    .text(TITULO[e.estado], m.margen, doc.y, centro);
  doc.moveDown(0.3);
  fila('Envío:', e.numero_texto, true);
  fila('Fecha:', fecha(e.fecha, d.zonaHoraria));
  fila('Agente:', e.agente);
  if (e.billetera) fila('Servicio:', e.billetera);
  if (e.estado === 'confirmado' && e.codigo_externo)
    fila('Código:', e.codigo_externo, true);
  linea();
  fila('Remitente:', e.remitente_nombre, true);
  if (e.remitente_telefono) fila('Tel.:', e.remitente_telefono);
  fila('Beneficiario:', e.beneficiario_nombre, true);
  if (e.beneficiario_telefono) fila('Tel.:', e.beneficiario_telefono);
  linea();
  fila('Monto enviado:', dinero(e.monto_enviado));
  fila('Tasa:', `1 RD$ = ${e.tasa.replace(/\.?0+$/, '')} HTG`);
  fila('Monto a recibir:', gourdes(e.monto_recibir), true, m.letra + 1);
  fila('Comisión:', dinero(e.comision));
  doc.moveDown(0.2);
  fila('TOTAL A PAGAR:', dinero(e.total_pagar), true, m.letra + 2);
  linea();
  doc.font('Helvetica').fontSize(m.letra);
  if (e.estado === 'pendiente') {
    doc.text('Su envío está en proceso.', m.margen, doc.y, centro);
    doc.text(
      'Conserve este recibo hasta recibir el definitivo.',
      m.margen,
      doc.y,
      centro,
    );
  } else if (e.estado === 'confirmado') {
    doc.text(
      'Envío realizado. ¡Gracias por elegirnos!',
      m.margen,
      doc.y,
      centro,
    );
  } else {
    doc.text('Este envío no se realizó.', m.margen, doc.y, centro);
    if (e.motivo_rechazo)
      doc.text(`Motivo: ${e.motivo_rechazo}`, m.margen, doc.y, centro);
    doc.text('El agente le devuelve el total pagado.', m.margen, doc.y, centro);
  }
  return doc.y + m.margen;
}

function crear(tamano: [number, number], f: Formato) {
  const m = MEDIDAS[f].margen;
  return new PDFDocument({
    size: tamano,
    margins: { top: m, bottom: m, left: m, right: m },
    info: { Title: 'Recibo de envío', Producer: 'ANSCITO' },
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

export async function generarReciboEnvio(
  d: DatosReciboEnvio,
  f: Formato,
): Promise<Buffer> {
  if (f === 'carta') {
    const doc = crear([612, 792], f);
    dibujar(doc, d, f);
    return aBuffer(doc);
  }
  const prueba = crear([MEDIDAS[f].ancho, 14400], f);
  const largo = dibujar(prueba, d, f);
  void aBuffer(prueba);
  const doc = crear([MEDIDAS[f].ancho, Math.ceil(largo)], f);
  dibujar(doc, d, f);
  return aBuffer(doc);
}
