// Vista previa del ITBIS en pantalla. Usa el mismo método que el servidor
// (centavos enteros, la mitad sube), pero el servidor es quien decide:
// la pantalla siempre verifica su resultado con POST /servicios/calcular.

import type { Desglose } from './api'

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const TASA = /^\d{1,3}(\.\d{1,2})?$/

export function montoValido(texto: string): boolean {
  return MONTO.test(texto.trim())
}

function aCentesimas(texto: string): bigint {
  const [entero, decimales = ''] = texto.split('.')
  return BigInt(entero) * 100n + BigInt(decimales.padEnd(2, '0'))
}

function formatear(centavos: bigint): string {
  return `${centavos / 100n}.${(centavos % 100n).toString().padStart(2, '0')}`
}

function dividirRedondeando(a: bigint, b: bigint): bigint {
  return (2n * a + b) / (2n * b)
}

export function vistaPrevia(
  precio: string,
  tasa: string,
  incluye: boolean,
): Desglose | null {
  const p = precio.trim()
  if (!MONTO.test(p) || !TASA.test(tasa)) return null
  const c = aCentesimas(p)
  const t = aCentesimas(tasa)
  if (incluye) {
    const base = dividirRedondeando(c * 10000n, 10000n + t)
    return { base: formatear(base), itbis: formatear(c - base), total: formatear(c) }
  }
  const itbis = dividirRedondeando(c * t, 10000n)
  return { base: formatear(c), itbis: formatear(itbis), total: formatear(c + itbis) }
}
