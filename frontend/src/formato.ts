// Funciones de formato compartidas por las pantallas.

export function mensajeDe(err: unknown): string {
  if (err instanceof TypeError) return 'No se pudo conectar con el servidor'
  return (err as Error).message
}

// "1234.5" -> "RD$1,234.50" (solo para mostrar; nunca para calcular).
export function dinero(monto: string | null | undefined): string {
  if (monto === null || monto === undefined || monto === '') return '—'
  const [entero, dec = '00'] = monto.split('.')
  const conComas = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `RD$${conComas}.${dec.padEnd(2, '0')}`
}

// "18.00" -> "18%", "16.50" -> "16.5%"
export function porcentaje(tasa: string): string {
  return `${tasa.replace(/\.?0+$/, '')}%`
}
