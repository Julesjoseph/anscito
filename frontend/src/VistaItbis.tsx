import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { Desglose } from './api'
import { SesionVencida } from './api'
import { dinero, porcentaje } from './formato'
import { montoValido, vistaPrevia } from './itbis'

// Muestra un monto como factura (base + ITBIS = total). Calcula en pantalla
// y verifica con el servidor, que es quien decide.
export default function VistaItbis({
  titulo,
  etiquetas,
  monto,
  tasa,
  incluye,
  verificar,
  onSesionVencida,
}: {
  titulo: string
  etiquetas: [string, string, string]
  monto: string
  tasa: string
  incluye: boolean
  verificar: (monto: string, incluye: boolean) => Promise<Desglose>
  onSesionVencida: () => void
}) {
  const [servidor, setServidor] = useState<{
    clave: string
    desglose: Desglose | null
  } | null>(null)

  const local = vistaPrevia(monto, tasa, incluye)
  const clave = `${monto.trim()}|${tasa}|${incluye}`
  const verificado = servidor?.clave === clave ? servidor.desglose : undefined

  useEffect(() => {
    if (!montoValido(monto)) return
    let activo = true
    const espera = setTimeout(() => {
      verificar(monto.trim(), incluye)
        .then((r) => {
          if (activo) setServidor({ clave, desglose: r })
        })
        .catch((err) => {
          if (!activo) return
          if (err instanceof SesionVencida) onSesionVencida()
          else setServidor({ clave, desglose: null })
        })
    }, 400)
    return () => {
      activo = false
      clearTimeout(espera)
    }
  }, [monto, incluye, clave, verificar, onSesionVencida])

  const mostrar = verificado ?? local
  const coincide =
    local !== null &&
    verificado != null &&
    local.base === verificado.base &&
    local.itbis === verificado.itbis &&
    local.total === verificado.total

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
      <div className="mb-2 font-medium text-gray-700">{titulo}</div>
      {mostrar ? (
        <dl className="grid grid-cols-3 gap-2">
          <div>
            <dt className="text-xs text-gray-500">{etiquetas[0]}</dt>
            <dd className="font-medium">{dinero(mostrar.base)}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">
              {etiquetas[1]} {porcentaje(tasa)}
            </dt>
            <dd className="font-medium">{dinero(mostrar.itbis)}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">{etiquetas[2]}</dt>
            <dd className="font-medium">{dinero(mostrar.total)}</dd>
          </div>
        </dl>
      ) : (
        <div className="text-gray-500">Escriba un monto válido.</div>
      )}
      {mostrar && verificado === undefined && (
        <div className="mt-2 text-xs text-gray-400">Verificando con el servidor…</div>
      )}
      {verificado && coincide && (
        <div className="mt-2 flex items-center gap-1 text-xs text-green-700">
          <CheckCircle2 size={14} /> Coincide con el cálculo del servidor
        </div>
      )}
      {verificado && !coincide && (
        <div className="mt-2 flex items-center gap-1 text-xs text-amber-800">
          <AlertTriangle size={14} /> Se muestra el cálculo del servidor, que es
          el que vale.
        </div>
      )}
    </div>
  )
}
