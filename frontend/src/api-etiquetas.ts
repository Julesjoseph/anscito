// Etiquetas de precio de los productos (PDF con código de barras).
import { API_URL, SesionVencida, llamar } from './api'

export type PedidoEtiquetas = {
  formato: 'carta' | 'rollo'
  inicio?: number // carta: primera posición libre (1 a 30)
  productos: { productoId: string; cantidad: number }[]
}

export type RevisionEtiquetas = {
  listos: { id: string; codigo: string; nombre: string; precio: string; cantidad: number }[]
  noSeImprimen: { id: string; codigo: string; nombre: string; motivo: string }[]
  etiquetas: number
}

export const revisarEtiquetas = (token: string, p: PedidoEtiquetas) =>
  llamar<RevisionEtiquetas>('POST', '/etiquetas/revisar', token, p)

export async function descargarEtiquetas(token: string, p: PedidoEtiquetas): Promise<{ archivo: Blob; nombre: string }> {
  const res = await fetch(`${API_URL}/etiquetas/pdf`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  })
  if (res.status === 401) throw new SesionVencida('Sesión vencida')
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.message ?? 'No se pudo generar el PDF')
  }
  const nombre = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'etiquetas.pdf'
  return { archivo: await res.blob(), nombre }
}
