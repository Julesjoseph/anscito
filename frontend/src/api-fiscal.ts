// Formatos de envío de la DGII (606, 607, 608) y estimado del ITBIS.
import { API_URL, SesionVencida, llamar } from './api'

export type AvisoFiscal = { documento: string; mensaje: string }

export type Fila606 = {
  compra: string
  proveedor: string
  rnc: string
  tipoId: string
  tipoBienes: string
  ncf: string
  fechaComprobante: string
  fechaPago: string
  servicios: string
  bienes: string
  total: string
  itbis: string
  itbisRetenido: string
  tipoRetencion: string
  retencionRenta: string
  formaPago: string
}

export type Fila607 = {
  comprador: string
  rnc: string
  tipoId: string
  ncf: string
  ncfModificado: string
  fechaComprobante: string
  montoFacturado: string
  itbis: string
  efectivo: string
  chequeTransferencia: string
  tarjeta: string
  credito: string
  otras: string
}

export type ResumenFiscal = {
  periodo: string
  rnc: string | null
  f606: {
    filas: Fila606[]
    avisos: AvisoFiscal[]
    sinNcf: { cantidad: number; total: string }
    totales: {
      cantidad: number
      servicios: string
      bienes: string
      total: string
      itbis: string
      itbisRetenido: string
      itbisAdelantar: string
      retencionRenta: string
    }
  }
  f607: {
    filas: Fila607[]
    avisos: AvisoFiscal[]
    porEmitir: number
    consumo: { desde: string; cantidad: number; monto: string; itbis: string; total: string }
    itbisNeto: string
    totales: { cantidad: number; montoFacturado: string; itbis: string }
  }
  f608: { cantidad: number }
  itbis: { ventas: string; compras: string; retenidoProveedores: string; aPagar: string; saldoFavor: string }
}

export const resumenFiscal = (token: string, periodo: string) =>
  llamar<ResumenFiscal>('GET', `/fiscal?${new URLSearchParams({ periodo }).toString()}`, token)

// Descarga el 606 o el 607 en TXT o Excel (con el nombre que da el servidor).
export async function descargarFormato(
  token: string,
  formato: '606' | '607',
  tipo: 'txt' | 'xlsx',
  periodo: string,
): Promise<{ archivo: Blob; nombre: string }> {
  const res = await fetch(`${API_URL}/fiscal/${formato}/${tipo}?${new URLSearchParams({ periodo }).toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) throw new SesionVencida('Sesión vencida')
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.message ?? 'No se pudo generar el archivo')
  }
  const nombre =
    /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `${formato}.${tipo}`
  return { archivo: await res.blob(), nombre }
}
