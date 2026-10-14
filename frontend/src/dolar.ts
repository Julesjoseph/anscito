// Dólares en pantalla, con las mismas reglas que el servidor (backend
// comun/dolar.ts): enteros en centavos y la tasa × 10,000.
//   RD$ de un monto en US$ = al centavo (la mitad sube)
//   US$ que paga el cliente = subido al centavo (a favor del negocio)

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const TASA = /^\d{1,3}(\.\d{1,4})?$/

export function centavosUsd(v: string): bigint {
  const t = v.trim()
  if (!MONTO.test(t)) return 0n
  const [e, d = ''] = t.split('.')
  return BigInt(e || '0') * 100n + BigInt((d + '00').slice(0, 2))
}

function tasaEntera(tasa: string): bigint {
  if (!TASA.test(tasa)) return 0n
  const [e, d = ''] = tasa.split('.')
  return BigInt(e) * 10000n + BigInt((d + '0000').slice(0, 4))
}

export function texto2(c: bigint): string {
  const neg = c < 0n
  const a = neg ? -c : c
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`
}

// Centavos de US$ → centavos de RD$.
export function pesosDe(usdC: bigint, tasa: string): bigint {
  return (usdC * tasaEntera(tasa) + 5000n) / 10000n
}

// Centavos de RD$ → centavos de US$ que paga el cliente (hacia arriba).
export function dolaresArriba(rdC: bigint, tasa: string): bigint {
  const t = tasaEntera(tasa)
  if (t <= 0n) return 0n
  return (rdC * 10000n + t - 1n) / t
}

// "US$1,234.50"
export function dolares(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—'
  const [e, d = '00'] = v.split('.')
  return `US$${Number(e).toLocaleString('en-US')}.${d.padEnd(2, '0').slice(0, 2)}`
}

// "60.50" (sin ceros de más)
export function verTasa(tasa: string | null | undefined): string {
  if (!tasa) return '—'
  return tasa.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')
}
