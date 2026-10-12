import PDFDocument from 'pdfkit';

// Contrato del SAN en hoja carta: encabezado con la empresa, título y el
// texto ya llenado (los párrafos se separan con una línea en blanco).

export type DatosContratoPdf = {
  empresa: string;
  logo: Buffer | null;
  logoTipo: string | null;
  numero: string;
  titulo: string;
  texto: string;
  pie: string;
};

export function generarContratoPdf(d: DatosContratoPdf): Promise<Buffer> {
  return new Promise((ok, mal) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 54, bottom: 54, left: 64, right: 64 },
      info: { Title: `${d.titulo} ${d.numero}`, Producer: 'ANSCITO' },
      bufferPages: true,
    });
    const partes: Buffer[] = [];
    doc.on('data', (b: Buffer) => partes.push(b));
    doc.on('end', () => ok(Buffer.concat(partes)));
    doc.on('error', mal);

    const ancho = doc.page.width - 128;
    let y = 54;
    // pdfkit dibuja PNG y JPEG (no WEBP).
    if (d.logo && (d.logoTipo === 'image/png' || d.logoTipo === 'image/jpeg')) {
      try {
        doc.image(d.logo, 64, y, { fit: [90, 40] });
      } catch {
        // Si el logo no se puede leer, el contrato sale sin logo.
      }
    }
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(d.empresa, 64, y, { width: ancho, align: 'right' });
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(d.numero, 64, doc.y, { width: ancho, align: 'right' });
    y = Math.max(doc.y, 100) + 16;
    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(d.titulo, 64, y, { width: ancho, align: 'center' });
    doc.moveDown(1.2);

    doc.font('Helvetica').fontSize(10.5);
    const parrafos = d.texto
      .split(/\n\s*\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    // Alto de todas las firmas juntas: no se separan entre dos páginas.
    const altoFirmas = parrafos
      .filter((x) => x.startsWith('____'))
      .reduce(
        (a, x) => a + doc.heightOfString(x, { width: ancho, lineGap: 2 }) + 24,
        0,
      );
    let primeraFirma = true;
    for (const t of parrafos) {
      // Líneas de firma y avisos: sin justificar.
      const firma = t.startsWith('____');
      const aviso = /^(BORRADOR|BROUILLON|BOUYON)\b/.test(t);
      if (firma && primeraFirma) {
        primeraFirma = false;
        if (doc.y + altoFirmas > doc.page.height - 70) doc.addPage();
      }
      doc.font(aviso ? 'Helvetica-Bold' : 'Helvetica').text(t, 64, doc.y, {
        width: ancho,
        align: firma ? 'left' : 'justify',
        lineGap: 2,
      });
      doc.moveDown(firma ? 1.6 : 0.8);
    }

    // Pie con el número de página.
    const rango = doc.bufferedPageRange();
    for (let i = rango.start; i < rango.start + rango.count; i++) {
      doc.switchToPage(i);
      // Sin margen de abajo, para que el pie no abra otra página.
      doc.page.margins.bottom = 0;
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#666666')
        .text(
          `${d.pie} · ${d.numero} · ${i + 1}/${rango.count}`,
          64,
          doc.page.height - 40,
          { width: ancho, align: 'center', lineBreak: false },
        );
    }
    doc.end();
  });
}
