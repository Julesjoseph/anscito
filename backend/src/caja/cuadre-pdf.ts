import PDFDocument from 'pdfkit';
import { dinero } from '../ventas/recibo-pdf';
import type { Formato } from '../ventas/recibo-pdf';
import { encabezado } from '../comun/ticket';
import type { ElementoTicket, Ticket } from '../comun/ticket';

// Cuadre de caja en PDF (rollo de 80 o 58 mm, u hoja carta).

export type DatosCuadre = {
  empresa: { nombre_comercial: string; rnc: string | null };
  sesion: {
    sesion_texto: string;
    caja: string;
    sucursal: string;
    estado: string;
    abierta_en: string;
    abierta_por_usuario: string;
    cerrada_en: string | null;
    cerrada_por_usuario: string | null;
    fondo_inicial: string;
    esperado: string;
    contado: string | null;
    diferencia: string | null;
    motivo_diferencia: string | null;
    conteo: Record<string, number> | null;
    totales: {
      ventas: string;
      ingresos: string;
      gastos: string;
      retiros: string;
      devoluciones: string;
      depositos: string;
      desde_cuentas: string;
      san_cuotas: string;
      san_manos: string;
      compras: string;
      compras_devueltas: string;
      abonos_credito: string;
      abonos_anulados: string;
      cantidad_ventas: number;
    };
    movimientos: {
      tipo: string;
      monto: string;
      fecha: string;
      categoria: string | null;
      motivo: string | null;
      venta: string | null;
      cuenta?: string | null;
      usuario: string;
    }[];
  };
  denominaciones: string[];
  zonaHoraria: string;
};

const MM = 72 / 25.4;
const MEDIDAS: Record<
  Formato,
  { ancho: number; margen: number; letra: number }
> = {
  '80': { ancho: 80 * MM, margen: 4 * MM, letra: 8 },
  '58': { ancho: 58 * MM, margen: 5 * MM, letra: 7 },
  carta: { ancho: 612, margen: 48, letra: 10 },
};

const NOMBRE_TIPO: Record<string, string> = {
  venta: 'Venta',
  devolucion: 'Devolución',
  gasto: 'Gasto',
  retiro: 'Retiro',
  ingreso: 'Ingreso',
  deposito: 'Depósito',
  desde_cuenta: 'Traído de',
  san_cuota: 'Cuota de SOL CASH',
  san_mano: 'Mano de SOL CASH',
  compra: 'Pago de compra',
  compra_reverso: 'Compra anulada (devuelto)',
  abono_credito: 'Abono de crédito',
  abono_anulado: 'Abono anulado (devuelto)',
};

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

function dibujar(doc: PDFKit.PDFDocument, d: DatosCuadre, f: Formato): number {
  const m = MEDIDAS[f];
  const util = m.ancho - m.margen * 2;
  const s = d.sesion;
  const centro = { width: util, align: 'center' as const };
  // En hoja carta, el resumen va en una columna de 300 pt centrada.
  const anchoFilas = f === 'carta' ? 300 : util;
  const xFilas = f === 'carta' ? m.margen + (util - 300) / 2 : m.margen;

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
    const w = doc.widthOfString(der);
    doc.text(izq, xFilas, y, { width: anchoFilas - w - 4 });
    const fin = doc.y;
    doc.text(der, xFilas, y, { width: anchoFilas, align: 'right' });
    doc.y = Math.max(fin, doc.y);
  };
  const menos = (v: string) => (v === '0.00' ? dinero(v) : `-${dinero(v)}`);

  doc.y = m.margen;
  doc
    .font('Helvetica-Bold')
    .fontSize(m.letra + 3)
    .text(d.empresa.nombre_comercial, m.margen, doc.y, centro);
  if (d.empresa.rnc)
    doc
      .font('Helvetica')
      .fontSize(m.letra)
      .text(`RNC: ${d.empresa.rnc}`, m.margen, doc.y, centro);
  linea();
  doc
    .font('Helvetica-Bold')
    .fontSize(m.letra + 1)
    .text(
      s.estado === 'cerrada' ? 'CUADRE DE CAJA' : 'ESTADO DE CAJA (ABIERTA)',
      m.margen,
      doc.y,
      centro,
    );
  doc.moveDown(0.3);
  fila('Sesión:', s.sesion_texto, true);
  fila('Caja:', `${s.caja} · ${s.sucursal}`);
  fila(
    'Abierta:',
    `${fecha(s.abierta_en, d.zonaHoraria)} · ${s.abierta_por_usuario}`,
  );
  if (s.cerrada_en)
    fila(
      'Cerrada:',
      `${fecha(s.cerrada_en, d.zonaHoraria)} · ${s.cerrada_por_usuario ?? ''}`,
    );
  linea();

  fila('Fondo inicial', dinero(s.fondo_inicial));
  fila(
    `+ Ventas en efectivo (${s.totales.cantidad_ventas})`,
    dinero(s.totales.ventas),
  );
  fila('+ Ingresos', dinero(s.totales.ingresos));
  if (s.totales.desde_cuentas !== '0.00')
    fila('+ Traído de cuentas', dinero(s.totales.desde_cuentas));
  if (s.totales.san_cuotas !== '0.00')
    fila('+ Cuotas de SOL CASH', dinero(s.totales.san_cuotas));
  fila('- Gastos', menos(s.totales.gastos));
  fila('- Retiros', menos(s.totales.retiros));
  fila('- Devoluciones', menos(s.totales.devoluciones));
  if (s.totales.depositos !== '0.00')
    fila('- Depósitos a cuentas', menos(s.totales.depositos));
  if (s.totales.san_manos !== '0.00')
    fila('- Manos de SOL CASH entregadas', menos(s.totales.san_manos));
  if (s.totales.compras !== '0.00')
    fila('- Pagos de compras', menos(s.totales.compras));
  if (s.totales.compras_devueltas !== '0.00')
    fila('+ Compras anuladas (devuelto)', dinero(s.totales.compras_devueltas));
  if (s.totales.abonos_credito !== '0.00')
    fila('+ Abonos de crédito', dinero(s.totales.abonos_credito));
  if (s.totales.abonos_anulados !== '0.00')
    fila('- Abonos anulados (devuelto)', menos(s.totales.abonos_anulados));
  doc.moveDown(0.2);
  fila('Debería haber', dinero(s.esperado), true, m.letra + 1);

  if (s.contado !== null && s.diferencia !== null) {
    fila('Contado', dinero(s.contado), true, m.letra + 1);
    const dif = s.diferencia;
    fila(
      dif === '0.00'
        ? 'Diferencia (cuadra)'
        : dif.startsWith('-')
          ? 'FALTANTE'
          : 'SOBRANTE',
      dif === '0.00' ? dinero('0.00') : dinero(dif.replace('-', '')),
      true,
      m.letra + 2,
    );
    if (s.motivo_diferencia) {
      doc
        .font('Helvetica')
        .fontSize(m.letra)
        .text(`Motivo: ${s.motivo_diferencia}`, xFilas, doc.y, {
          width: anchoFilas,
        });
    }
    if (s.conteo && Object.keys(s.conteo).length > 0) {
      linea();
      doc
        .font('Helvetica-Bold')
        .fontSize(m.letra)
        .text('Conteo', m.margen, doc.y, centro);
      for (const den of d.denominaciones) {
        const n = s.conteo[den];
        if (!n) continue;
        const sub = (BigInt(den) * BigInt(n)).toString();
        fila(`${n} x RD$${den}`, dinero(`${sub}.00`));
      }
    }
  }

  // Detalle de gastos, retiros, ingresos y devoluciones (las ventas se resumen).
  const otros = s.movimientos.filter((x) => x.tipo !== 'venta');
  if (otros.length > 0) {
    linea();
    doc
      .font('Helvetica-Bold')
      .fontSize(m.letra)
      .text('Otros movimientos', m.margen, doc.y, centro);
    for (const x of otros) {
      const signo =
        x.tipo === 'ingreso' ||
        x.tipo === 'desde_cuenta' ||
        x.tipo === 'san_cuota' ||
        x.tipo === 'compra_reverso' ||
        x.tipo === 'abono_credito'
          ? ''
          : '-';
      fila(
        `${NOMBRE_TIPO[x.tipo] ?? x.tipo}${x.categoria ? ` (${x.categoria})` : ''}${x.venta ? ` ${x.venta}` : ''}${x.cuenta ? ` ${x.cuenta}` : ''}`,
        `${signo}${dinero(x.monto)}`,
      );
      if (x.motivo) {
        doc
          .font('Helvetica')
          .fontSize(m.letra - 1)
          .text(`  ${x.motivo} · ${x.usuario}`, xFilas, doc.y, {
            width: anchoFilas,
          });
      }
    }
  }

  linea();
  doc
    .font('Helvetica')
    .fontSize(m.letra - 1)
    .text(
      `Impreso: ${fecha(new Date().toISOString(), d.zonaHoraria)}`,
      m.margen,
      doc.y,
      centro,
    );
  doc.moveDown(1.5);
  doc
    .font('Helvetica')
    .fontSize(m.letra)
    .text('_______________________', m.margen, doc.y, centro);
  doc.text('Firma del cajero', m.margen, doc.y, centro);
  return doc.y + m.margen;
}

// Las mismas líneas del cuadre, para imprimir directo desde la pantalla.
export function ticketCuadre(d: DatosCuadre): Ticket {
  const s = d.sesion;
  const t = s.totales;
  const menos = (v: string) => (v === '0.00' ? dinero(v) : `-${dinero(v)}`);
  const fila = (
    izq: string,
    der: string,
    negrita = false,
    grande = false,
  ): ElementoTicket => ({
    tipo: 'fila',
    izq,
    der,
    negrita,
    grande,
  });
  const el: ElementoTicket[] = [
    {
      tipo: 'titulo',
      texto:
        s.estado === 'cerrada' ? 'CUADRE DE CAJA' : 'ESTADO DE CAJA (ABIERTA)',
    },
    fila('Sesión:', s.sesion_texto, true),
    fila('Caja:', `${s.caja} · ${s.sucursal}`),
    fila(
      'Abierta:',
      `${fecha(s.abierta_en, d.zonaHoraria)} · ${s.abierta_por_usuario}`,
    ),
  ];
  if (s.cerrada_en)
    el.push(
      fila(
        'Cerrada:',
        `${fecha(s.cerrada_en, d.zonaHoraria)} · ${s.cerrada_por_usuario ?? ''}`,
      ),
    );
  el.push(
    { tipo: 'linea' },
    fila('Fondo inicial', dinero(s.fondo_inicial)),
    fila(`+ Ventas en efectivo (${t.cantidad_ventas})`, dinero(t.ventas)),
    fila('+ Ingresos', dinero(t.ingresos)),
  );
  if (t.desde_cuentas !== '0.00')
    el.push(fila('+ Traído de cuentas', dinero(t.desde_cuentas)));
  if (t.san_cuotas !== '0.00')
    el.push(fila('+ Cuotas de SOL CASH', dinero(t.san_cuotas)));
  el.push(
    fila('- Gastos', menos(t.gastos)),
    fila('- Retiros', menos(t.retiros)),
    fila('- Devoluciones', menos(t.devoluciones)),
  );
  if (t.depositos !== '0.00')
    el.push(fila('- Depósitos a cuentas', menos(t.depositos)));
  if (t.san_manos !== '0.00')
    el.push(fila('- Manos de SOL CASH entregadas', menos(t.san_manos)));
  if (t.compras !== '0.00')
    el.push(fila('- Pagos de compras', menos(t.compras)));
  if (t.compras_devueltas !== '0.00')
    el.push(fila('+ Compras anuladas (devuelto)', dinero(t.compras_devueltas)));
  if (t.abonos_credito !== '0.00')
    el.push(fila('+ Abonos de crédito', dinero(t.abonos_credito)));
  if (t.abonos_anulados !== '0.00')
    el.push(fila('- Abonos anulados (devuelto)', menos(t.abonos_anulados)));
  el.push(fila('Debería haber', dinero(s.esperado), true));
  if (s.contado !== null && s.diferencia !== null) {
    const dif = s.diferencia;
    el.push(
      fila('Contado', dinero(s.contado), true),
      fila(
        dif === '0.00'
          ? 'Diferencia (cuadra)'
          : dif.startsWith('-')
            ? 'FALTANTE'
            : 'SOBRANTE',
        dinero(dif.replace('-', '')),
        true,
        true,
      ),
    );
    if (s.motivo_diferencia)
      el.push({ tipo: 'nota', texto: `Motivo: ${s.motivo_diferencia}` });
    if (s.conteo && Object.keys(s.conteo).length > 0) {
      el.push(
        { tipo: 'linea' },
        { tipo: 'nota', texto: 'Conteo', negrita: true },
      );
      for (const den of d.denominaciones) {
        const n = s.conteo[den];
        if (!n) continue;
        el.push(
          fila(
            `${n} x RD$${den}`,
            dinero(`${(BigInt(den) * BigInt(n)).toString()}.00`),
          ),
        );
      }
    }
  }
  const otros = s.movimientos.filter((x) => x.tipo !== 'venta');
  if (otros.length > 0) {
    el.push(
      { tipo: 'linea' },
      { tipo: 'nota', texto: 'Otros movimientos', negrita: true },
    );
    for (const x of otros) {
      const signo =
        x.tipo === 'ingreso' ||
        x.tipo === 'desde_cuenta' ||
        x.tipo === 'san_cuota' ||
        x.tipo === 'compra_reverso' ||
        x.tipo === 'abono_credito'
          ? ''
          : '-';
      el.push(
        fila(
          `${NOMBRE_TIPO[x.tipo] ?? x.tipo}${x.categoria ? ` (${x.categoria})` : ''}${x.venta ? ` ${x.venta}` : ''}${x.cuenta ? ` ${x.cuenta}` : ''}`,
          `${signo}${dinero(x.monto)}`,
        ),
      );
      if (x.motivo)
        el.push({ tipo: 'nota', texto: `${x.motivo} · ${x.usuario}` });
    }
  }
  el.push(
    { tipo: 'linea' },
    {
      tipo: 'nota',
      texto: `Impreso: ${fecha(new Date().toISOString(), d.zonaHoraria)}`,
    },
    { tipo: 'firma', texto: 'Firma del cajero' },
  );
  return {
    documento: s.sesion_texto,
    encabezado: encabezado(d.empresa),
    elementos: el,
  };
}

function crear(tamano: [number, number], f: Formato) {
  const m = MEDIDAS[f].margen;
  return new PDFDocument({
    size: tamano,
    margins: { top: m, bottom: m, left: m, right: m },
    info: { Title: 'Cuadre de caja', Producer: 'ANSCITO' },
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

export async function generarCuadre(
  d: DatosCuadre,
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
