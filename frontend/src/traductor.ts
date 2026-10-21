// Traductor de pantalla: cuando el idioma no es español, cambia los textos
// que se ven (y los placeholder, title y aria-label) por su traducción del
// diccionario (src/textos/). Así no hay que tocar el código de cada
// pantalla: basta con agregar sus textos al diccionario. Lo que no esté en
// el diccionario se queda en español. Guarda el texto original de cada
// nodo, para volver al español o cambiar de idioma sin recargar.
// No traduce lo que escribe el usuario (campos) ni lo marcado con
// data-no-traducir (nombres de clientes, productos…).
// Todo lo que se imprime o se descarga sale SIEMPRE en español (decisión del
// dueño, por la DGII): los PDF y Excel vienen del servidor, y los recibos se
// imprimen desde un marco (iframe) aparte, que este traductor no toca.
import { escucharIdioma, leerIdioma } from './idioma'
import type { Idioma } from './idioma'
import { FRASES, PATRONES } from './textos'

type Otro = Exclude<Idioma, 'es'>

// Espacios repetidos y saltos de línea cuentan como un espacio.
const normal = (s: string) => s.replace(/\s+/g, ' ').trim()

const diccionario = new Map<string, Record<Otro, string>>()
for (const [es, en, fr, ht] of FRASES) {
  const k = normal(es)
  if (!diccionario.has(k)) diccionario.set(k, { en, fr, ht })
}

function traducir(texto: string, idioma: Otro): string | null {
  const limpio = normal(texto)
  if (!limpio || !/[A-Za-zÁÉÍÓÚÑáéíóúñ¿¡]/.test(limpio)) return null
  const directo = diccionario.get(limpio)
  if (directo) return directo[idioma]
  for (const p of PATRONES) {
    const m = p.es.exec(limpio)
    if (m) return p[idioma](...m.slice(1))
  }
  return null
}

const ATRIBUTOS = ['placeholder', 'title', 'aria-label', 'alt']
// Texto original (en español) de cada nodo y lo último que se puso.
const originalTexto = new WeakMap<Text, { es: string; puesto: string }>()
const originalAttr = new WeakMap<Element, Map<string, { es: string; puesto: string }>>()

function excluido(el: Element | null): boolean {
  for (let x = el; x; x = x.parentElement) {
    const tag = x.tagName
    // Los marcos (iframe) son los recibos que se imprimen: siempre en español.
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'IFRAME') return true
    if (x.hasAttribute('data-no-traducir') || (x as HTMLElement).isContentEditable) return true
  }
  return false
}

function nodoTexto(n: Text, idioma: Idioma) {
  if (excluido(n.parentElement)) return
  const actual = n.nodeValue ?? ''
  let o = originalTexto.get(n)
  // Si React cambió el texto (no es lo que pusimos), ese es el nuevo original.
  if (!o || actual !== o.puesto) {
    o = { es: actual, puesto: actual }
    originalTexto.set(n, o)
  }
  const nuevo =
    idioma === 'es'
      ? o.es
      : (() => {
          const t = traducir(o.es, idioma)
          if (t === null) return o.es
          // Conserva los espacios de los lados (separan palabras en la línea).
          const antes = /^\s*/.exec(o.es)?.[0] ?? ''
          const despues = /\s*$/.exec(o.es)?.[0] ?? ''
          return antes + t + despues
        })()
  if (nuevo !== actual) n.nodeValue = nuevo
  o.puesto = nuevo
}

function atributos(el: Element, idioma: Idioma) {
  if (excluido(el)) return
  for (const a of ATRIBUTOS) {
    if (!el.hasAttribute(a)) continue
    const actual = el.getAttribute(a) ?? ''
    let mapa = originalAttr.get(el)
    if (!mapa) {
      mapa = new Map()
      originalAttr.set(el, mapa)
    }
    let o = mapa.get(a)
    if (!o || actual !== o.puesto) {
      o = { es: actual, puesto: actual }
      mapa.set(a, o)
    }
    const nuevo = idioma === 'es' ? o.es : (traducir(o.es, idioma) ?? o.es)
    if (nuevo !== actual) el.setAttribute(a, nuevo)
    o.puesto = nuevo
  }
}

function recorrer(raiz: Node, idioma: Idioma) {
  if (raiz.nodeType === Node.TEXT_NODE) {
    nodoTexto(raiz as Text, idioma)
    return
  }
  if (raiz.nodeType !== Node.ELEMENT_NODE && raiz.nodeType !== Node.DOCUMENT_NODE) return
  if (raiz.nodeType === Node.ELEMENT_NODE) atributos(raiz as Element, idioma)
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) nodoTexto(n as Text, idioma)
    else atributos(n as Element, idioma)
  }
}

let observador: MutationObserver | null = null
let aplicando = false

function aplicar(raices: Iterable<Node>) {
  if (aplicando) return
  aplicando = true
  const idioma = leerIdioma()
  try {
    for (const r of raices) recorrer(r, idioma)
  } finally {
    // Nuestros propios cambios no se vuelven a procesar.
    observador?.takeRecords()
    aplicando = false
  }
}

// Empieza a traducir (una sola vez, al abrir la aplicación).
export function iniciarTraductor() {
  if (observador) return
  observador = new MutationObserver((cambios) => {
    const raices = new Set<Node>()
    for (const c of cambios) {
      if (c.type === 'characterData') raices.add(c.target)
      else if (c.type === 'attributes') raices.add(c.target)
      else c.addedNodes.forEach((n) => raices.add(n))
    }
    aplicar(raices)
  })
  observador.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATRIBUTOS,
  })
  aplicar([document.body])
  escucharIdioma(() => aplicar([document.body]))
}

// Al cambiar de idioma: se vuelve a traducir toda la página.
export function retraducir() {
  aplicar([document.body])
}
