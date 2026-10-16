// Libro mayor y estados financieros (Contabilidad).
import { API_URL, SesionVencida, llamar } from './api'

export type SeccionEstado = {
  total: string
  grupos: { grupo: string; total: string; cuentas: { codigo: string; nombre: string; monto: string }[] }[]
}

export type EstadosFinancieros = {
  desde: string
  hasta: string
  cierreFiscal: string
  inicioEjercicio: string
  resultados: {
    ingresos: SeccionEstado
    costos: SeccionEstado
    gastos: SeccionEstado
    utilidadBruta: string
    utilidadNeta: string
  }
  balance: {
    fecha: string
    activos: SeccionEstado
    pasivos: SeccionEstado
    capital: SeccionEstado
    utilidadesAcumuladas: string
    utilidadEjercicio: string
    totalCapital: string
    totalPasivoCapital: string
    cuadra: boolean
  }
}

export type LibroMayor = {
  desde: string
  hasta: string
  cuenta: { id: string; codigo: string; nombre: string; naturaleza: string; tipo: string }
  saldoAnterior: string
  movimientos: {
    asientoId: string
    asiento: string
    fecha: string
    concepto: string
    documento: string | null
    estado: string
    descripcion: string | null
    debito: string
    credito: string
    saldo: string
  }[]
  totales: { debitos: string; creditos: string }
  saldoFinal: string
}

const consulta = (f: Record<string, string>) =>
  new URLSearchParams(Object.fromEntries(Object.entries(f).filter(([, v]) => v))).toString()

export const estadosFinancieros = (token: string, desde: string, hasta: string) =>
  llamar<EstadosFinancieros>('GET', `/contabilidad/libros/estados?${consulta({ desde, hasta })}`, token)

export const libroMayor = (token: string, cuentaId: string, desde: string, hasta: string) =>
  llamar<LibroMayor>('GET', `/contabilidad/libros/mayor?${consulta({ cuentaId, desde, hasta })}`, token)

export const cambiarCierreFiscal = (token: string, cierre: string) =>
  llamar<{ ok: boolean }>('PATCH', '/contabilidad/libros/cierre-fiscal', token, { cierre })

// Descarga el balance, el estado de resultados o el mayor en Excel o PDF.
export async function descargarLibro(
  token: string,
  reporte: 'balance' | 'resultados' | 'mayor',
  formato: 'xlsx' | 'pdf',
  f: Record<string, string>,
): Promise<{ archivo: Blob; nombre: string }> {
  const res = await fetch(`${API_URL}/contabilidad/libros/${reporte}/${formato}?${consulta(f)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) throw new SesionVencida('Sesión vencida')
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.message ?? 'No se pudo generar el archivo')
  }
  const nombre = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `${reporte}.${formato}`
  return { archivo: await res.blob(), nombre }
}
