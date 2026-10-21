import PDFDocument from 'pdfkit';
import { dinero } from '../ventas/recibo-pdf';

// Volante de pago de la nómina: una hoja carta por empleado con dos copias
// iguales (para el empleado y para la empresa), separadas por una línea para
// cortar. Siempre en español (decisión del dueño: lo impreso no se traduce).

export type DatosVolante = {
  empresa: {
    nombre_comercial: string;
    razon_social: string | null;
    rnc: string | null;
    direccion: string | null;
    telefono: string | null;
    logo: Buffer | null;
    logo_tipo: string | null;
  };
  nomina: {
    codigo: string;
    tipo: string; // nombre: Nómina, Regalía pascual, Vacaciones
    frecuencia: string | null;
    desde: string; // dd/mm/aaaa
    hasta: string;
    estado: string;
    fechaPago: string | null;
  };
  volantes: {
    codigo: string;
    nombre: string;
    documento: string | null;
    cargo: string | null;
    sueldoMensual: string;
    formaPago: string;
    dias: string | null;
    sueldo: string;
    horasExtra: string;
    horasExtraAlto: string;
    montoExtra: string;
    comisiones: string;
    bonos: string;
    adelantos: string;
    otrosDescuentos: string;
    motivoDescuento: string | null;
    neto: string;
    debeAdelantos: string;
  }[];
};

const MARGEN = 40;
const ANCHO = 612 - MARGEN * 2;

const numero = (v: string) => v.replace(/\.?0+$/, '') || '0';
const hayMonto = (v: string) => /[1-9]/.test(v);

function copia(
  doc: PDFKit.PDFDocument,
  d: DatosVolante,
  v: DatosVolante['volantes'][number],
  y0: number,
  para: string,
) {
  const e = d.empresa;
  const n = d.nomina;
  let y = y0;
  // Encabezado: logo a la izquierda, empresa y título.
  let x = MARGEN;
  if (e.logo && (e.logo_tipo === 'image/png' || e.logo_tipo === 'image/jpeg')) {
    doc.image(e.logo, MARGEN, y, { fit: [70, 40] });
    x = MARGEN + 80;
  }
  doc.font('Helvetica-Bold').fontSize(12).fillColor('black');
  doc.text(e.nombre_comercial, x, y, { width: 300 });
  doc.font('Helvetica').fontSize(8);
  const lineas = [
    e.razon_social,
    e.rnc ? `RNC: ${e.rnc}` : null,
    [e.direccion, e.telefono && `Tel: ${e.telefono}`]
      .filter(Boolean)
      .join(' · ') || null,
  ].filter(Boolean) as string[];
  for (const l of lineas) doc.text(l, x, doc.y, { width: 300 });
  doc.font('Helvetica-Bold').fontSize(12);
  doc.text('VOLANTE DE PAGO', MARGEN, y, { width: ANCHO, align: 'right' });
  doc.font('Helvetica').fontSize(8);
  doc.text(`${n.codigo} · ${para}`, MARGEN, y + 15, {
    width: ANCHO,
    align: 'right',
  });
  if (n.estado === 'anulada') {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#C8102E');
    doc.text('ANULADA', MARGEN, y + 27, { width: ANCHO, align: 'right' });
    doc.fillColor('black');
  }
  y = Math.max(doc.y, y + 44) + 6;
  doc
    .moveTo(MARGEN, y)
    .lineTo(MARGEN + ANCHO, y)
    .lineWidth(0.5)
    .stroke();
  y += 6;

  // Datos del empleado y del pago, en dos columnas.
  const fila = (
    etq: string,
    val: string,
    cx: number,
    cy: number,
    w: number,
  ) => {
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#555555')
      .text(etq, cx, cy, { width: w });
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('black')
      .text(val, cx, doc.y, { width: w });
    return doc.y + 3;
  };
  const mitad = ANCHO / 2;
  let yi = fila('Empleado', `${v.nombre} (${v.codigo})`, MARGEN, y, mitad - 10);
  yi = fila('Cédula / documento', v.documento ?? '—', MARGEN, yi, mitad - 10);
  yi = fila('Cargo', v.cargo ?? '—', MARGEN, yi, mitad - 10);
  let yd = fila(
    'Concepto',
    `${n.tipo}${n.frecuencia ? ` ${n.frecuencia.toLowerCase()}` : ''}`,
    MARGEN + mitad,
    y,
    mitad,
  );
  yd = fila(
    'Período',
    `Del ${n.desde} al ${n.hasta}`,
    MARGEN + mitad,
    yd,
    mitad,
  );
  yd = fila(
    'Fecha de pago · forma',
    `${n.fechaPago ?? '—'} · ${v.formaPago === 'banco' ? 'Transferencia' : 'Efectivo'}`,
    MARGEN + mitad,
    yd,
    mitad,
  );
  y = Math.max(yi, yd) + 4;

  // Ingresos y descuentos, lado a lado.
  const tabla = (
    titulo: string,
    filas: [string, string][],
    total: [string, string],
    cx: number,
    cy: number,
    w: number,
  ) => {
    doc.font('Helvetica-Bold').fontSize(9).text(titulo, cx, cy, { width: w });
    let ty = doc.y + 2;
    doc
      .moveTo(cx, ty)
      .lineTo(cx + w, ty)
      .lineWidth(0.3)
      .stroke();
    ty += 3;
    doc.font('Helvetica').fontSize(9);
    for (const [a, b] of filas) {
      doc.text(a, cx, ty, { width: w - 80 });
      const fin = doc.y;
      doc.text(b, cx, ty, { width: w, align: 'right' });
      ty = Math.max(fin, doc.y) + 1;
    }
    doc
      .moveTo(cx, ty)
      .lineTo(cx + w, ty)
      .lineWidth(0.3)
      .stroke();
    ty += 3;
    doc.font('Helvetica-Bold').text(total[0], cx, ty, { width: w - 80 });
    doc.text(total[1], cx, ty, { width: w, align: 'right' });
    return doc.y;
  };
  const etiquetaSueldo =
    n.tipo === 'Nómina'
      ? `Sueldo del período (mensual ${dinero(v.sueldoMensual)})`
      : n.tipo === 'Vacaciones'
        ? `Vacaciones${v.dias ? ` (${numero(v.dias)} días)` : ''}`
        : 'Regalía pascual';
  const ingresos: [string, string][] = [[etiquetaSueldo, dinero(v.sueldo)]];
  if (hayMonto(v.montoExtra)) {
    const horas = [
      hayMonto(v.horasExtra) ? `${numero(v.horasExtra)} h al 35 %` : null,
      hayMonto(v.horasExtraAlto)
        ? `${numero(v.horasExtraAlto)} h al 100 %`
        : null,
    ]
      .filter(Boolean)
      .join(', ');
    ingresos.push([`Horas extra (${horas})`, dinero(v.montoExtra)]);
  }
  if (hayMonto(v.comisiones))
    ingresos.push(['Comisiones', dinero(v.comisiones)]);
  if (hayMonto(v.bonos)) ingresos.push(['Bonos', dinero(v.bonos)]);
  const totalIngresos = [v.sueldo, v.montoExtra, v.comisiones, v.bonos].reduce(
    (a, m) => a + BigInt(m.replace('.', '')),
    0n,
  );
  const descuentos: [string, string][] = [];
  if (hayMonto(v.adelantos))
    descuentos.push(['Adelantos y préstamos', dinero(v.adelantos)]);
  if (hayMonto(v.otrosDescuentos))
    descuentos.push([
      `Otros${v.motivoDescuento ? `: ${v.motivoDescuento}` : ''}`,
      dinero(v.otrosDescuentos),
    ]);
  if (descuentos.length === 0) descuentos.push(['Ninguno', dinero('0.00')]);
  const totalDescuentos =
    BigInt(v.adelantos.replace('.', '')) +
    BigInt(v.otrosDescuentos.replace('.', ''));
  const texto = (c: bigint) =>
    `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
  const ancho = mitad - 10;
  const fi = tabla(
    'Ingresos',
    ingresos,
    ['Total ingresos', dinero(texto(totalIngresos))],
    MARGEN,
    y,
    ancho,
  );
  const fd = tabla(
    'Descuentos',
    descuentos,
    ['Total descuentos', dinero(texto(totalDescuentos))],
    MARGEN + mitad,
    y,
    mitad,
  );
  y = Math.max(fi, fd) + 8;

  // Neto a pagar.
  doc.rect(MARGEN, y, ANCHO, 24).fillAndStroke('#f3f4f6', '#9ca3af');
  doc.fillColor('black').font('Helvetica-Bold').fontSize(12);
  doc.text('NETO A PAGAR', MARGEN + 8, y + 7, { width: ANCHO / 2 });
  doc.text(dinero(v.neto), MARGEN, y + 7, { width: ANCHO - 8, align: 'right' });
  y += 30;
  doc.font('Helvetica').fontSize(7.5).fillColor('#555555');
  const notas = [
    hayMonto(v.debeAdelantos)
      ? `Saldo de adelantos pendiente: ${dinero(v.debeAdelantos)}.`
      : null,
    'Sin descuentos de TSS ni ISR (todavía no aplican).',
  ]
    .filter(Boolean)
    .join(' ');
  doc.text(notas, MARGEN, y, { width: ANCHO });
  doc.fillColor('black');

  // Firmas.
  y = doc.y + 26;
  const w = ANCHO / 2 - 20;
  doc
    .moveTo(MARGEN, y)
    .lineTo(MARGEN + w, y)
    .lineWidth(0.5)
    .stroke();
  doc
    .moveTo(MARGEN + ANCHO - w, y)
    .lineTo(MARGEN + ANCHO, y)
    .stroke();
  doc.font('Helvetica').fontSize(8);
  doc.text(`Recibí conforme: ${v.nombre}`, MARGEN, y + 3, {
    width: w,
    align: 'center',
  });
  doc.text('Entregado por (empresa)', MARGEN + ANCHO - w, y + 3, {
    width: w,
    align: 'center',
  });
}

export function generarVolantes(d: DatosVolante): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: 0,
      info: {
        Title: `Volantes de pago ${d.nomina.codigo}`,
        Producer: 'ANSCITO',
      },
    });
    const partes: Buffer[] = [];
    doc.on('data', (b: Buffer) => partes.push(b));
    doc.on('end', () => resolver(Buffer.concat(partes)));
    doc.on('error', rechazar);
    try {
      d.volantes.forEach((v, i) => {
        if (i > 0) doc.addPage({ size: 'LETTER', margin: 0 });
        copia(doc, d, v, 30, 'Copia del empleado');
        // Línea para cortar a la mitad de la hoja.
        doc
          .moveTo(20, 396)
          .lineTo(592, 396)
          .dash(4, { space: 3 })
          .lineWidth(0.5)
          .strokeColor('#9ca3af')
          .stroke()
          .undash()
          .strokeColor('black');
        doc.font('Helvetica').fontSize(6.5).fillColor('#9ca3af');
        doc.text('cortar aquí', 20, 389, { width: 572, align: 'center' });
        doc.fillColor('black');
        copia(doc, d, v, 412, 'Copia de la empresa');
      });
      doc.end();
    } catch (e) {
      rechazar(e);
    }
  });
}
