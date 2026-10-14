import type { DetalleVenta } from './api'
import { dinero } from './formato'

// Comprobante de venta para imprimir directo desde el navegador (sin PDF).
// Se arma como una página pequeña que se ajusta al papel de la impresora:
// rollo de 58 mm (imprime ~48 mm), de 80 mm (imprime ~72 mm), ancho
// automático (lo que tenga la impresora) u hoja carta / A4.

export type AnchoTicket = '58' | '80' | 'auto' | 'carta'

export const ANCHOS_TICKET: [AnchoTicket, string][] = [
  ['80', 'Rollo 80 mm'],
  ['58', 'Rollo 58 mm'],
  ['auto', 'Ancho automático'],
  ['carta', 'Hoja carta / A4'],
]

export type DatosTicket = {
  empresa: {
    nombre_comercial: string
    razon_social: string | null
    rnc: string | null
    direccion: string | null
    telefono: string | null
    whatsapp: string | null
    correo: string | null
    logo: string | null // data:image/...;base64,...
  }
  venta: DetalleVenta
  zonaHoraria: string
}

// Ancho del área impresa y tamaño de letra para cada papel.
const MEDIDAS: Record<AnchoTicket, { ancho: string; letra: string; pagina: string }> = {
  '58': { ancho: '48mm', letra: '8pt', pagina: 'margin: 0;' },
  '80': { ancho: '72mm', letra: '9pt', pagina: 'margin: 0;' },
  auto: { ancho: '100%', letra: '9pt', pagina: 'margin: 0;' },
  carta: { ancho: '100%', letra: '10.5pt', pagina: 'margin: 12mm;' },
}

// Todo texto que viene de la base se escapa antes de ponerlo en el HTML.
function esc(v: string | null | undefined): string {
  return (v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function cantidad(v: string): string {
  return v.includes('.') ? v.replace(/\.?0+$/, '') : v
}

function fila(izq: string, der: string, clase = ''): string {
  return `<div class="fila ${clase}"><span>${izq}</span><span class="der">${der}</span></div>`
}

const NOMBRE_ECF: Record<string, string> = {
  '31': 'Factura de Crédito Fiscal',
  '32': 'Factura de Consumo',
  '34': 'Nota de Crédito',
}

export function htmlTicket(d: DatosTicket, ancho: AnchoTicket): string {
  const v = d.venta
  const e = d.empresa
  const carta = ancho === 'carta'
  const fecha = new Intl.DateTimeFormat('es-DO', {
    timeZone: d.zonaHoraria,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(v.fecha))

  const cabecera = [
    e.logo ? `<img class="logo" src="${esc(e.logo)}" alt="">` : '',
    `<div class="nombre">${esc(e.nombre_comercial)}</div>`,
    e.razon_social ? `<div>${esc(e.razon_social)}</div>` : '',
    e.rnc ? `<div>RNC: ${esc(e.rnc)}</div>` : '',
    e.direccion ? `<div>${esc(e.direccion)}</div>` : '',
    [e.telefono && `Tel: ${esc(e.telefono)}`, e.whatsapp && `WhatsApp: ${esc(e.whatsapp)}`].filter(Boolean).join(' · ')
      ? `<div>${[e.telefono && `Tel: ${esc(e.telefono)}`, e.whatsapp && `WhatsApp: ${esc(e.whatsapp)}`].filter(Boolean).join(' · ')}</div>`
      : '',
    e.correo ? `<div>${esc(e.correo)}</div>` : '',
  ].join('')

  const lineas = carta
    ? `<table><thead><tr><th>Descripción</th><th class="n">Cant.</th><th class="n">Precio</th><th class="n">Desc.</th><th class="n">ITBIS</th><th class="n">Total</th></tr></thead><tbody>${v.lineas
        .map(
          (l) =>
            `<tr><td>${esc(l.descripcion)}</td><td class="n">${esc(cantidad(l.cantidad))}</td><td class="n">${dinero(l.precio_unitario)}</td><td class="n">${
              l.descuento === '0.00' ? '—' : `-${dinero(l.descuento)}`
            }</td><td class="n">${Number(l.tasa) === 0 ? 'Exento' : `${dinero(l.itbis)} (${esc(cantidad(l.tasa))}%)`}</td><td class="n">${dinero(l.total)}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : v.lineas
        .map(
          (l) =>
            `<div class="art">${esc(l.descripcion)}</div>` +
            fila(
              `${esc(cantidad(l.cantidad))} x ${dinero(l.precio_unitario)} ${Number(l.tasa) === 0 ? 'Exento' : `ITBIS ${esc(cantidad(l.tasa))}%`}`,
              dinero(l.total),
            ) +
            (l.descuento !== '0.00' ? fila('&nbsp;&nbsp;Descuento', `-${dinero(l.descuento)}`) : ''),
        )
        .join('')

  const pagos = v.pagos
    .map(
      (p) =>
        fila(esc(p.forma_pago), dinero(p.monto)) +
        (p.recibido ? fila('Recibido', dinero(p.recibido)) : '') +
        (p.devuelta ? fila('Devuelta', dinero(p.devuelta), 'negrita') : '') +
        (p.referencia ? fila('Referencia', esc(p.referencia)) : ''),
    )
    .join('')

  // Factura electrónica emitida (o el comprobante anotado antes del e-CF).
  const fiscal = (v.ecf ?? [])
    .filter((x) => x.estado === 'emitido')
    .map((x) => `<div>${esc(NOMBRE_ECF[x.tipo] ?? x.tipo)}: <b>${esc(x.encf)}</b><br>Código de seguridad: ${esc(x.codigo_seguridad)}</div>`)
    .join('')

  const cuerpo = `
    <div class="centro">${cabecera}</div>
    <hr>
    <div class="centro titulo">COMPROBANTE INTERNO DE VENTA</div>
    ${v.estado === 'anulada' ? `<div class="centro grande">*** ANULADA ***</div>${v.motivo_anulacion ? `<div class="centro">Motivo: ${esc(v.motivo_anulacion)}</div>` : ''}` : ''}
    ${fila('No.:', esc(v.numero_texto), 'negrita')}
    ${fila('Fecha:', esc(fecha))}
    ${fila('Atendió:', esc(v.vendedor))}
    ${fila('Sucursal:', esc(v.sucursal))}
    ${fila('Cliente:', esc(v.cliente))}
    ${v.cliente_codigo ? fila('Código:', esc(v.cliente_codigo)) : ''}
    ${v.cliente_documento ? fila('Documento:', esc(v.cliente_documento)) : ''}
    <hr>
    ${lineas}
    <hr>
    <div class="${carta ? 'totales' : ''}">
      ${fila('Subtotal', dinero(v.subtotal))}
      ${v.descuento !== '0.00' ? fila('Descuento', `-${dinero(v.descuento)}`) : ''}
      ${fila('Base imponible', dinero(v.base_imponible))}
      ${fila('ITBIS', dinero(v.itbis))}
      ${fila('TOTAL', dinero(v.total), 'negrita grande')}
      ${pagos}
    </div>
    <hr>
    <div class="centro pequena">
      ${fiscal}
      ${!fiscal && v.comprobante_fiscal ? `<div>Comprobante fiscal: ${esc(v.comprobante_fiscal)}</div>` : ''}
      <div>Este documento es un comprobante interno de venta y no sustituye el comprobante fiscal.</div>
    </div>
    <div class="centro negrita">¡Gracias por su compra!</div>`

  return pagina(v.numero_texto, cuerpo, ancho)
}

// Página completa del comprobante: estilos según el papel elegido.
function pagina(titulo: string, cuerpo: string, ancho: AnchoTicket): string {
  const m = MEDIDAS[ancho]
  const carta = ancho === 'carta'
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>
  @page { ${m.pagina} }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: ${m.letra}; line-height: 1.25; }
  .ticket { width: ${m.ancho}; max-width: 100%; margin: 0 auto; padding: ${carta ? '0' : '1mm 2mm 4mm'}; }
  .centro { text-align: center; }
  .nombre { font-weight: bold; font-size: 1.35em; }
  .titulo { font-weight: bold; margin: 1mm 0; }
  .grande { font-size: 1.25em; font-weight: bold; }
  .pequena { font-size: 0.85em; }
  .negrita { font-weight: bold; }
  .logo { max-width: 60%; max-height: 18mm; display: block; margin: 0 auto 1mm; }
  .fila { display: flex; justify-content: space-between; gap: 2mm; }
  .fila .der { text-align: right; white-space: nowrap; }
  .fila span:first-child { overflow-wrap: anywhere; }
  .art { font-weight: bold; margin-top: 1mm; overflow-wrap: anywhere; }
  hr { border: 0; border-top: 1px dashed #000; margin: 1.5mm 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 1mm 1.5mm; text-align: left; vertical-align: top; border-bottom: 1px solid #ddd; }
  th { border-bottom: 1px solid #000; }
  .n { text-align: right; white-space: nowrap; }
  .totales { width: 45%; margin-left: auto; }
  b { font-weight: bold; }
  .firma { margin-top: 10mm; }
  .columna { max-width: 110mm; margin: 0 auto; }
</style>
</head><body><div class="ticket">${cuerpo}</div></body></html>`
}

// ---------- Recibos "de filas" (envíos, SOL CASH, cuadre de caja) ----------

export type ElementoTicket =
  | { tipo: 'linea' }
  | { tipo: 'titulo'; texto: string }
  | { tipo: 'fila'; izq: string; der: string; negrita?: boolean; grande?: boolean }
  | { tipo: 'nota'; texto: string; negrita?: boolean }
  | { tipo: 'firma'; texto: string }

export type TicketFilas = {
  documento: string
  encabezado: { nombre: string; lineas: string[] }
  elementos: ElementoTicket[]
}

export function htmlTicketFilas(t: TicketFilas, ancho: AnchoTicket): string {
  const partes = t.elementos.map((e) => {
    if (e.tipo === 'linea') return '<hr>'
    if (e.tipo === 'titulo') return `<div class="centro titulo">${esc(e.texto)}</div>`
    if (e.tipo === 'nota') return `<div class="centro pequena${e.negrita ? ' negrita' : ''}">${esc(e.texto)}</div>`
    if (e.tipo === 'firma') return `<div class="centro firma">______________________<br>${esc(e.texto)}</div>`
    return fila(esc(e.izq), esc(e.der), [e.negrita ? 'negrita' : '', e.grande ? 'grande' : ''].join(' '))
  })
  const cuerpo = `
    <div class="centro"><div class="nombre">${esc(t.encabezado.nombre)}</div>${t.encabezado.lineas
      .map((l) => `<div>${esc(l)}</div>`)
      .join('')}</div>
    <hr>
    <div class="${ancho === 'carta' ? 'columna' : ''}">${partes.join('')}</div>`
  return pagina(t.documento, cuerpo, ancho)
}

// Imprime el HTML en un marco invisible (abre el cuadro de impresión).
export async function imprimirHtml(html: string): Promise<void> {
  const marco = document.createElement('iframe')
  marco.setAttribute('aria-hidden', 'true')
  marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(marco)
  const doc = marco.contentDocument
  const ventana = marco.contentWindow
  if (!doc || !ventana) {
    marco.remove()
    throw new Error('El navegador no permitió preparar la impresión')
  }
  doc.open()
  doc.write(html)
  doc.close()
  // Esperar el logo antes de imprimir.
  await Promise.all(
    Array.from(doc.images).map((img) =>
      img.complete ? null : new Promise((ok) => { img.onload = ok; img.onerror = ok }),
    ),
  )
  ventana.focus()
  ventana.print()
  // Se quita después (algunos navegadores siguen usando el marco mientras imprimen).
  setTimeout(() => marco.remove(), 60_000)
}
