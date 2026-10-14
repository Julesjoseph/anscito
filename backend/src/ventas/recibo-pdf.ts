import PDFDocument from 'pdfkit';

// Comprobante interno de venta en PDF para impresoras térmicas (80 y 58 mm)
// y hoja carta. NO es un comprobante fiscal: el NCF/e-CF lo emite el sistema
// fiscal del dueño y aquí solo se muestra como referencia.

export type Formato = '80' | '58' | 'carta';

export type DatosRecibo = {
  empresa: {
    nombre_comercial: string;
    razon_social: string | null;
    rnc: string | null;
    direccion: string | null;
    telefono: string | null;
    whatsapp: string | null;
    correo: string | null;
    logo: Buffer | null;
    logo_tipo: string | null;
  };
  venta: {
    numero_texto: string;
    fecha: string;
    estado: string;
    cliente: string;
    cliente_codigo?: string | null;
    cliente_documento: string | null;
    vendedor: string;
    sucursal: string;
    subtotal: string;
    descuento: string;
    base_imponible: string;
    itbis: string;
    total: string;
    comprobante_fiscal: string | null;
    motivo_anulacion: string | null;
    lineas: {
      descripcion: string;
      codigo: string;
      unidad: string;
      cantidad: string;
      precio_unitario: string;
      descuento: string;
      tasa: string;
      itbis: string;
      total: string;
    }[];
    pagos: {
      forma_pago: string;
      monto: string;
      recibido: string | null;
      devuelta: string | null;
      referencia: string | null;
    }[];
  };
  zonaHoraria: string;
};

const MM = 72 / 25.4; // puntos por milímetro

// "1234.5" -> "RD$1,234.50" (sin decimales flotantes).
export function dinero(monto: string): string {
  const neg = monto.startsWith('-');
  const [e, d = '00'] = (neg ? monto.slice(1) : monto).split('.');
  return `${neg ? '-' : ''}RD$${e.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${d.padEnd(2, '0')}`;
}

function cantidad(v: string): string {
  return v.includes('.') ? v.replace(/\.?0+$/, '') : v;
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

type Medidas = { ancho: number; margen: number; letra: number };

const MEDIDAS: Record<Formato, Medidas> = {
  // El rollo de 80 mm imprime unos 72 mm y el de 58 mm unos 48 mm: el resto
  // es margen para que no se corte nada en ninguna impresora.
  '80': { ancho: 80 * MM, margen: 4 * MM, letra: 8 },
  '58': { ancho: 58 * MM, margen: 5 * MM, letra: 7 },
  carta: { ancho: 612, margen: 48, letra: 10 },
};

// Dibuja todo el comprobante y devuelve dónde terminó (para medir el largo).
function dibujar(
  doc: PDFKit.PDFDocument,
  d: DatosRecibo,
  m: Medidas,
  carta: boolean,
): number {
  const { margen, letra } = m;
  const util = m.ancho - margen * 2;
  const v = d.venta;
  const e = d.empresa;
  const centro = { width: util, align: 'center' as const };

  const linea = () => {
    doc.moveDown(0.3);
    doc
      .moveTo(margen, doc.y)
      .lineTo(margen + util, doc.y)
      .dash(1.5, { space: 1.5 })
      .lineWidth(0.5)
      .stroke()
      .undash();
    doc.moveDown(0.4);
  };

  // Texto a la izquierda y a la derecha en la misma fila (por defecto a lo
  // ancho; en hoja carta los totales usan solo la columna derecha).
  const fila = (
    izq: string,
    der: string,
    negrita = false,
    tam = letra,
    x = margen,
    ancho = util,
  ) => {
    const y = doc.y;
    doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(tam);
    const anchoDer = doc.widthOfString(der);
    doc.text(izq, x, y, { width: ancho - anchoDer - 4 });
    const fin = doc.y;
    doc.text(der, x, y, { width: ancho, align: 'right' });
    doc.y = Math.max(fin, doc.y);
  };

  doc.y = margen;

  // Logo (PDFKit admite PNG y JPG; un logo WebP se omite).
  if (e.logo && (e.logo_tipo === 'image/png' || e.logo_tipo === 'image/jpeg')) {
    const alto = carta ? 60 : 40;
    const ancho = carta ? 160 : util * 0.6;
    doc.image(e.logo, margen + (util - ancho) / 2, doc.y, {
      fit: [ancho, alto],
      align: 'center',
    });
    doc.y += alto + 4;
  }

  doc
    .font('Helvetica-Bold')
    .fontSize(letra + 4)
    .text(e.nombre_comercial, margen, doc.y, centro);
  doc.font('Helvetica').fontSize(letra);
  for (const t of [
    e.razon_social,
    e.rnc ? `RNC: ${e.rnc}` : null,
    e.direccion,
    [
      e.telefono && `Tel: ${e.telefono}`,
      e.whatsapp && `WhatsApp: ${e.whatsapp}`,
    ]
      .filter(Boolean)
      .join('  '),
    e.correo,
  ]) {
    if (t) doc.text(t, margen, doc.y, centro);
  }

  linea();
  doc
    .font('Helvetica-Bold')
    .fontSize(letra + 1)
    .text('COMPROBANTE INTERNO DE VENTA', margen, doc.y, centro);
  if (v.estado === 'anulada') {
    doc
      .font('Helvetica-Bold')
      .fontSize(letra + 3)
      .text('*** ANULADA ***', margen, doc.y, centro);
    if (v.motivo_anulacion) {
      doc
        .font('Helvetica')
        .fontSize(letra)
        .text(`Motivo: ${v.motivo_anulacion}`, margen, doc.y, centro);
    }
  }
  doc.moveDown(0.3);
  fila('No.:', v.numero_texto, true);
  fila('Fecha:', fecha(v.fecha, d.zonaHoraria));
  fila('Atendió:', v.vendedor);
  fila('Sucursal:', v.sucursal);
  fila('Cliente:', v.cliente);
  if (v.cliente_codigo) fila('Código:', v.cliente_codigo);
  if (v.cliente_documento) fila('Documento:', v.cliente_documento);

  linea();

  if (carta) {
    // Tabla con columnas.
    const cols = [
      { t: 'Descripción', w: 0.4, a: 'left' as const },
      { t: 'Cant.', w: 0.1, a: 'right' as const },
      { t: 'Precio', w: 0.14, a: 'right' as const },
      { t: 'Desc.', w: 0.11, a: 'right' as const },
      { t: 'ITBIS', w: 0.11, a: 'right' as const },
      { t: 'Total', w: 0.14, a: 'right' as const },
    ];
    const celdas = (valores: string[], negrita: boolean) => {
      const y = doc.y;
      let x = margen;
      let fin = y;
      doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(letra);
      valores.forEach((val, i) => {
        const w = util * cols[i].w;
        doc.text(val, x, y, { width: w - 4, align: cols[i].a });
        fin = Math.max(fin, doc.y);
        x += w;
      });
      doc.y = fin + 2;
    };
    celdas(
      cols.map((c) => c.t),
      true,
    );
    for (const l of v.lineas) {
      celdas(
        [
          `${l.descripcion} (${l.codigo})${
            l.unidad.toLowerCase() === 'unidad'
              ? ''
              : ` · por ${l.unidad.toLowerCase()}`
          }`,
          cantidad(l.cantidad),
          dinero(l.precio_unitario),
          l.descuento === '0.00' ? '-' : `-${dinero(l.descuento)}`,
          Number(l.tasa) === 0
            ? 'Exento'
            : `${dinero(l.itbis)} (${cantidad(l.tasa)}%)`,
          dinero(l.total),
        ],
        false,
      );
    }
  } else {
    // Rollo: cada artículo en dos filas.
    for (const l of v.lineas) {
      doc
        .font('Helvetica-Bold')
        .fontSize(letra)
        .text(l.descripcion, margen, doc.y, { width: util });
      fila(
        `${cantidad(l.cantidad)} x ${dinero(l.precio_unitario)}${
          Number(l.tasa) === 0 ? '  Exento' : `  ITBIS ${cantidad(l.tasa)}%`
        }`,
        dinero(l.total),
      );
      if (l.descuento !== '0.00')
        fila('  Descuento', `-${dinero(l.descuento)}`);
    }
  }

  linea();
  // En hoja carta los totales van en la columna derecha.
  const x = carta ? margen + util * 0.55 : margen;
  const ancho = carta ? util * 0.45 : util;
  const total = (izq: string, der: string, negrita = false, tam = letra) =>
    fila(izq, der, negrita, tam, x, ancho);
  total('Subtotal', dinero(v.subtotal));
  if (v.descuento !== '0.00') total('Descuento', `-${dinero(v.descuento)}`);
  total('Base imponible', dinero(v.base_imponible));
  total('ITBIS', dinero(v.itbis));
  doc.moveDown(0.2);
  total('TOTAL', dinero(v.total), true, letra + 3);
  doc.moveDown(0.3);
  for (const p of v.pagos) {
    total(p.forma_pago, dinero(p.monto));
    if (p.recibido) total('Recibido', dinero(p.recibido));
    if (p.devuelta) total('Devuelta', dinero(p.devuelta), true);
    if (p.referencia) total('Referencia', p.referencia);
  }

  linea();
  doc.font('Helvetica').fontSize(letra - 1);
  if (v.comprobante_fiscal) {
    doc.text(
      `Comprobante fiscal (NCF/e-CF): ${v.comprobante_fiscal}`,
      margen,
      doc.y,
      centro,
    );
  }
  doc.text(
    'Este documento es un comprobante interno de venta y no sustituye el comprobante fiscal.',
    margen,
    doc.y,
    centro,
  );
  doc.moveDown(0.4);
  doc
    .font('Helvetica-Bold')
    .fontSize(letra)
    .text('¡Gracias por su compra!', margen, doc.y, centro);
  return doc.y + margen;
}

function crear(tamano: [number, number], m: Medidas): PDFKit.PDFDocument {
  return new PDFDocument({
    size: tamano,
    margins: {
      top: m.margen,
      bottom: m.margen,
      left: m.margen,
      right: m.margen,
    },
    info: { Title: 'Comprobante interno de venta', Producer: 'ANSCITO' },
  });
}

function aBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    const partes: Buffer[] = [];
    doc.on('data', (b: Buffer) => partes.push(b));
    doc.on('end', () => resolver(Buffer.concat(partes)));
    doc.on('error', rechazar);
    doc.end();
  });
}

export async function generarRecibo(
  d: DatosRecibo,
  formato: Formato,
): Promise<Buffer> {
  const m = MEDIDAS[formato];
  if (formato === 'carta') {
    const doc = crear([612, 792], m);
    dibujar(doc, d, m, true);
    return aBuffer(doc);
  }
  // Rollo: primero se mide el largo y luego se dibuja en un papel justo.
  const prueba = crear([m.ancho, 14400], m);
  const largo = dibujar(prueba, d, m, false);
  void aBuffer(prueba);
  const doc = crear([m.ancho, Math.ceil(largo)], m);
  dibujar(doc, d, m, false);
  return aBuffer(doc);
}
