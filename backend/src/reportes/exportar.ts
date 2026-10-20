import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { Columna, Fila, Reporte } from './tipos';

// Convierte un reporte a Excel (.xlsx) o PDF, con el nombre de la empresa,
// el período y la fecha en que se generó.

export type Encabezado = {
  empresa: string;
  rnc: string | null;
  generado: string; // fecha y hora ya formateadas
};

function texto(c: Columna, v: Fila[string]): string {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v);
  if (c.tipo === 'dinero') {
    const neg = s.startsWith('-');
    const [e, d = '00'] = (neg ? s.slice(1) : s).split('.');
    return `${neg ? '-' : ''}${e.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${d.padEnd(2, '0')}`;
  }
  if (c.tipo === 'cantidad')
    return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
  if (c.tipo === 'porcentaje') return `${s}%`;
  if (c.tipo === 'fecha' || c.tipo === 'fechahora') {
    const [a, m, d] = s.slice(0, 10).split('-');
    return `${d}/${m}/${a}${c.tipo === 'fechahora' ? ` ${s.slice(11, 16)}` : ''}`;
  }
  return s;
}

// ---------- Excel ----------

export async function aExcel(r: Reporte, enc: Encabezado): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ANSCITO';
  const ws = wb.addWorksheet(r.titulo.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 6 }],
  });
  const n = r.columnas.length;
  const fila = (valores: (string | number | Date | null)[]) =>
    ws.addRow(valores);

  fila([enc.empresa]).font = { bold: true, size: 14 };
  fila([r.titulo]).font = { bold: true, size: 12 };
  fila([[r.periodo, r.detalle].filter(Boolean).join(' · ')]);
  fila([
    `Generado: ${enc.generado}${enc.rnc ? ` · RNC ${enc.rnc}` : ''}`,
  ]).font = {
    color: { argb: 'FF666666' },
    size: 9,
  };
  fila([]);
  const cab = fila(r.columnas.map((c) => c.titulo));
  cab.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cab.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFC8102E' },
    };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });

  const valor = (c: Columna, v: Fila[string]) => {
    if (v === null || v === undefined || v === '') return null;
    if (
      c.tipo === 'dinero' ||
      c.tipo === 'entero' ||
      c.tipo === 'cantidad' ||
      c.tipo === 'porcentaje'
    )
      return Number(v);
    if (c.tipo === 'fecha')
      return new Date(`${String(v).slice(0, 10)}T12:00:00Z`);
    // La hora ya viene en hora local: se guarda tal cual, sin cambiar de zona.
    if (c.tipo === 'fechahora')
      return new Date(`${String(v).replace(' ', 'T')}:00Z`);
    return String(v);
  };
  for (const f of r.filas) fila(r.columnas.map((c) => valor(c, f[c.clave])));
  if (r.totales) {
    const t = fila(
      r.columnas.map((c, i) =>
        i === 0 ? 'TOTAL' : valor(c, r.totales?.[c.clave] ?? null),
      ),
    );
    t.font = { bold: true };
    t.eachCell((cell) => {
      cell.border = { top: { style: 'thin' } };
    });
  }

  r.columnas.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.numFmt =
      c.tipo === 'dinero'
        ? '#,##0.00;[Red]-#,##0.00'
        : c.tipo === 'entero'
          ? '#,##0'
          : c.tipo === 'cantidad'
            ? '#,##0.###'
            : c.tipo === 'porcentaje'
              ? '0.0"%"'
              : c.tipo === 'fecha'
                ? 'dd/mm/yyyy'
                : c.tipo === 'fechahora'
                  ? 'dd/mm/yyyy hh:mm'
                  : '@';
    const largo = Math.max(
      c.titulo.length,
      ...r.filas.slice(0, 200).map((f) => texto(c, f[c.clave]).length),
    );
    col.width = Math.min(45, Math.max(10, largo + 2));
  });
  // Los encabezados (filas 1 a 4) no toman el formato de las columnas.
  for (let i = 1; i <= 4; i++) ws.getRow(i).getCell(1).numFmt = '@';
  if (r.filas.length > 0)
    ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: n } };
  if (r.notas.length) {
    fila([]);
    for (const nota of r.notas)
      fila([nota]).font = {
        italic: true,
        size: 9,
        color: { argb: 'FF666666' },
      };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- PDF (carta horizontal, con páginas) ----------

export function aPdf(r: Reporte, enc: Encabezado): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'LETTER',
    layout: 'landscape',
    margins: { top: 36, bottom: 36, left: 30, right: 30 },
    info: { Title: r.titulo, Producer: 'ANSCITO' },
    bufferPages: true,
  });
  const ancho = doc.page.width - 60;
  const letra =
    r.columnas.length > 11 ? 6.5 : r.columnas.length > 8 ? 7.5 : 8.5;

  const derecha = (c: Columna) =>
    ['dinero', 'entero', 'cantidad', 'porcentaje'].includes(c.tipo);
  // Ancho de cada columna. Los números y fechas usan lo que necesitan (no se
  // cortan); las columnas de texto se reparten el espacio que queda.
  const fijo = (c: Columna) =>
    derecha(c) || c.tipo === 'fecha' || c.tipo === 'fechahora';
  const medir = (c: Columna) => {
    doc.font('Helvetica').fontSize(letra);
    const datos = r.filas
      .slice(0, 300)
      .map((f) => doc.widthOfString(texto(c, f[c.clave])));
    doc.font('Helvetica-Bold');
    const total = r.totales
      ? doc.widthOfString(texto(c, r.totales[c.clave] ?? null))
      : 0;
    // El título puede ir en dos líneas: basta su palabra más larga
    // (o la mitad del título, en las columnas de texto).
    const palabras = c.titulo.split(' ').map((p) => doc.widthOfString(p));
    const titulo = Math.max(
      ...palabras,
      fijo(c) ? 0 : doc.widthOfString(c.titulo) / 2,
    );
    return Math.max(24, titulo, total, ...datos) + 7;
  };
  const medida = r.columnas.map(medir);
  // En las columnas de texto ninguna palabra se corta: su mínimo es la
  // palabra más larga; el espacio que sobra se reparte entre ellas.
  doc.font('Helvetica').fontSize(letra);
  const minimo = r.columnas.map((c, i) => {
    if (fijo(c)) return medida[i];
    const palabras = r.filas
      .slice(0, 300)
      .flatMap((f) => texto(c, f[c.clave]).split(/\s+/))
      .map((p) => doc.widthOfString(p));
    doc.font('Helvetica-Bold');
    const titulo = c.titulo.split(' ').map((p) => doc.widthOfString(p));
    doc.font('Helvetica');
    return Math.min(140, Math.max(24, ...palabras, ...titulo) + 7);
  });
  const deseado = r.columnas.map((c, i) =>
    fijo(c) ? medida[i] : Math.max(minimo[i], Math.min(medida[i], 220)),
  );
  const base = minimo.reduce((a, b) => a + b, 0);
  const extra = deseado.reduce((a, b, i) => a + (b - minimo[i]), 0);
  const sobra = ancho - base;
  let anchos =
    sobra >= extra
      ? deseado
      : minimo.map(
          (m, i) =>
            m +
            (extra > 0 ? ((deseado[i] - m) / extra) * Math.max(sobra, 0) : 0),
        );
  // Si aun así no cabe (o sobra mucho), todo se ajusta en proporción.
  const suma = anchos.reduce((a, b) => a + b, 0);
  if (suma > ancho || suma < ancho * 0.6)
    anchos = anchos.map((a) => (a / suma) * ancho);

  const encabezadoPagina = () => {
    doc.font('Helvetica-Bold').fontSize(13).text(enc.empresa, 30, 30);
    doc.fontSize(11).text(r.titulo);
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor('#444444')
      .text([r.periodo, r.detalle].filter(Boolean).join(' · '))
      .text(`Generado: ${enc.generado}${enc.rnc ? ` · RNC ${enc.rnc}` : ''}`)
      .fillColor('black');
    doc.moveDown(0.6);
    filaTabla(
      r.columnas.map((c) => c.titulo),
      true,
    );
  };

  function filaTabla(valores: string[], cabecera = false, negrita = false) {
    doc
      .font(cabecera || negrita ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(letra);
    const alto =
      Math.max(
        ...valores.map((v, i) =>
          doc.heightOfString(v || ' ', { width: anchos[i] - 4 }),
        ),
      ) + 5;
    if (doc.y + alto > doc.page.height - 50) {
      doc.addPage();
      encabezadoPagina();
      doc
        .font(cabecera || negrita ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(letra);
    }
    const y = doc.y;
    if (cabecera)
      doc
        .rect(30, y - 1, ancho, alto)
        .fill('#C8102E')
        .fillColor('white');
    let x = 30;
    valores.forEach((v, i) => {
      doc.text(v, x + 2, y + 2, {
        width: anchos[i] - 4,
        align: derecha(r.columnas[i]) && !cabecera ? 'right' : 'left',
      });
      x += anchos[i];
    });
    doc.fillColor('black');
    doc.y = y + alto;
    if (negrita) {
      doc
        .moveTo(30, y - 1)
        .lineTo(30 + ancho, y - 1)
        .lineWidth(0.6)
        .stroke();
    } else if (!cabecera) {
      doc
        .moveTo(30, doc.y - 1)
        .lineTo(30 + ancho, doc.y - 1)
        .lineWidth(0.2)
        .strokeColor('#dddddd')
        .stroke()
        .strokeColor('black');
    }
  }

  encabezadoPagina();
  if (r.filas.length === 0) {
    doc
      .font('Helvetica-Oblique')
      .fontSize(9)
      .text('No hay datos en este período.', 30, doc.y + 6);
  }
  for (const f of r.filas)
    filaTabla(r.columnas.map((c) => texto(c, f[c.clave])));
  if (r.totales) {
    filaTabla(
      r.columnas.map((c, i) =>
        i === 0 ? 'TOTAL' : texto(c, r.totales?.[c.clave] ?? null),
      ),
      false,
      true,
    );
  }
  if (r.notas.length) {
    doc
      .moveDown(0.5)
      .font('Helvetica-Oblique')
      .fontSize(7.5)
      .fillColor('#555555');
    for (const nota of r.notas) doc.text(nota, 30, doc.y, { width: ancho });
    doc.fillColor('black');
  }

  // Número de página al pie.
  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(i);
    // Sin margen inferior mientras se escribe el pie (si no, crea otra página).
    const margen = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#777777')
      .text(`Página ${i + 1} de ${paginas.count}`, 30, doc.page.height - 30, {
        width: ancho,
        align: 'right',
        lineBreak: false,
      });
    doc.page.margins.bottom = margen;
  }

  return new Promise((ok, mal) => {
    const partes: Buffer[] = [];
    doc.on('data', (b: Buffer) => partes.push(b));
    doc.on('end', () => ok(Buffer.concat(partes)));
    doc.on('error', mal);
    doc.end();
  });
}

// ---------- Listas (clientes, proveedores, agentes) ----------

type Consulta = {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
};

// Nombre y RNC de la empresa y la fecha y hora de hoy, para el encabezado.
export async function encabezadoEmpresa(
  db: Consulta,
): Promise<Encabezado & { hoy: string }> {
  const e = (
    await db.query<{ nombre_comercial: string; rnc: string | null }>(
      'SELECT nombre_comercial, rnc FROM empresa WHERE id = 1',
    )
  ).rows[0];
  const zona = (
    await db.query<{ valor: string }>(
      `SELECT valor FROM configuracion WHERE clave = 'empresa.zona_horaria'`,
    )
  ).rows[0].valor;
  const ahora = new Date();
  return {
    empresa: e.nombre_comercial,
    rnc: e.rnc,
    generado: new Intl.DateTimeFormat('es-DO', {
      timeZone: zona,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(ahora),
    hoy: new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(ahora),
  };
}

// Una lista ya armada como reporte, en Excel o PDF, con su nombre de archivo
// (por ejemplo "clientes_2026-10-20.xlsx").
export async function exportarLista(
  db: Consulta,
  r: Omit<Reporte, 'periodo' | 'totales'>,
  formato: unknown,
): Promise<{ archivo: Buffer; nombre: string }> {
  if (formato !== 'xlsx' && formato !== 'pdf')
    throw new BadRequestException('Formato inválido: xlsx o pdf');
  const enc = await encabezadoEmpresa(db);
  const [a, m, d] = enc.hoy.split('-');
  const reporte: Reporte = {
    ...r,
    periodo: `Al ${d}/${m}/${a}`,
    totales: null,
  };
  const archivo =
    formato === 'xlsx' ? await aExcel(reporte, enc) : await aPdf(reporte, enc);
  return { archivo, nombre: `${r.codigo}_${enc.hoy}.${formato}` };
}
