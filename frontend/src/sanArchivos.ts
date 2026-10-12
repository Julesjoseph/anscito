import { SesionVencida, descargarSan } from './api'
import type { IdiomaContrato } from './api'
import { mensajeDe } from './formato'

// Utilidades del SAN: idiomas del contrato, fotos (se achican antes de
// subir) y abrir archivos del servidor en otra pestaña.

export const IDIOMAS: [IdiomaContrato, string][] = [
  ['es', 'Español'],
  ['fr', 'Français'],
  ['ht', 'Kreyòl'],
]

const MAX_BYTES = 700_000

function leerComoDataUrl(archivo: Blob): Promise<string> {
  return new Promise((ok, mal) => {
    const r = new FileReader()
    r.onload = () => ok(String(r.result))
    r.onerror = () => mal(new Error('No se pudo leer el archivo'))
    r.readAsDataURL(archivo)
  })
}

// Foto -> JPEG de hasta 1600 px y menos de 700 KB. PDF -> tal cual (si es pequeño).
export async function prepararArchivo(archivo: File, permitirPdf: boolean): Promise<string> {
  if (archivo.type === 'application/pdf') {
    if (!permitirPdf) throw new Error('Aquí solo se aceptan fotos')
    if (archivo.size > MAX_BYTES) throw new Error('El PDF pesa más de 700 KB: tome fotos de las páginas en su lugar')
    return leerComoDataUrl(archivo)
  }
  if (!archivo.type.startsWith('image/')) throw new Error('Elija una foto (JPG o PNG)' + (permitirPdf ? ' o un PDF' : ''))
  const url = URL.createObjectURL(archivo)
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = () => mal(new Error('No se pudo abrir la foto'))
      i.src = url
    })
    let lado = 1600
    for (let intento = 0; intento < 6; intento++) {
      const escala = Math.min(1, lado / Math.max(img.width, img.height))
      const lienzo = document.createElement('canvas')
      lienzo.width = Math.round(img.width * escala)
      lienzo.height = Math.round(img.height * escala)
      lienzo.getContext('2d')?.drawImage(img, 0, 0, lienzo.width, lienzo.height)
      const blob = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, 'image/jpeg', 0.8))
      if (blob && blob.size <= MAX_BYTES) return leerComoDataUrl(blob)
      lado = Math.round(lado * 0.75)
    }
    throw new Error('La foto es demasiado grande')
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Abre un PDF o una foto del servidor en otra pestaña.
export async function abrirArchivo(token: string, ruta: string, onSesionVencida: () => void, onError: (m: string) => void) {
  const pestana = window.open('', '_blank')
  try {
    const url = URL.createObjectURL(await descargarSan(token, ruta))
    if (pestana) pestana.location.href = url
    else window.location.href = url
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (e) {
    pestana?.close()
    if (e instanceof SesionVencida) onSesionVencida()
    else onError(mensajeDe(e))
  }
}
