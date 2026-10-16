import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Lock, XCircle } from 'lucide-react'
import { SesionVencida, llamar } from './api'
import { BOTON_PRINCIPAL, BOTON_SECUNDARIO, CAMPO, CajaError, Ventana } from './componentes'
import { mensajeDe } from './formato'

// Revisión antes de cerrar un mes: lo grave (en rojo) no deja cerrar; los
// avisos (en amarillo) dejan cerrar escribiendo un motivo.

type Punto = { clave: string; titulo: string; detalle: string; cantidad: number; donde: string }
type Revision = { anio: number; mes: number; desde: string; hasta: string; bloqueos: Punto[]; avisos: Punto[]; correctos: string[] }

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export default function CierreMes({
  token,
  anio,
  mes,
  onCerrar,
  onListo,
  onSesionVencida,
}: {
  token: string
  anio: number
  mes: number
  onCerrar: () => void
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [rev, setRev] = useState<Revision | null>(null)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    llamar<Revision>('GET', `/contabilidad/periodos/revision?${new URLSearchParams({ anio: String(anio), mes: String(mes) }).toString()}`, token)
      .then(setRev)
      .catch((e: unknown) => {
        if (e instanceof SesionVencida) onSesionVencida()
        else setError(mensajeDe(e))
      })
  }, [token, anio, mes, onSesionVencida])

  async function cerrar() {
    setGuardando(true)
    setError('')
    try {
      await llamar<{ ok: boolean }>('POST', '/contabilidad/periodos/cerrar', token, { anio, mes, motivo: motivo.trim() })
      onListo()
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    } finally {
      setGuardando(false)
    }
  }

  const bloqueado = (rev?.bloqueos.length ?? 0) > 0
  const conAvisos = (rev?.avisos.length ?? 0) > 0

  return (
    <Ventana titulo={`Cerrar ${MESES[mes - 1]} ${anio}`} onCerrar={onCerrar} ancho="max-w-xl">
      <div className="flex flex-col gap-3 text-sm">
        {!rev ? (
          !error && <p className="text-gray-500">Revisando el mes…</p>
        ) : (
          <>
            {rev.bloqueos.map((b) => (
              <div key={b.clave} className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-900">
                <XCircle size={16} className="mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">
                    {b.titulo} ({b.cantidad})
                  </div>
                  <div>{b.detalle}</div>
                  <div className="text-xs text-red-700">Dónde: {b.donde}</div>
                </div>
              </div>
            ))}
            {rev.avisos.map((a) => (
              <div key={a.clave} className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">
                    {a.titulo} ({a.cantidad})
                  </div>
                  <div>{a.detalle}</div>
                  <div className="text-xs text-amber-700">Dónde: {a.donde}</div>
                </div>
              </div>
            ))}
            {rev.correctos.length > 0 && (
              <ul className="flex flex-col gap-1 text-green-800">
                {rev.correctos.map((x) => (
                  <li key={x} className="flex items-center gap-2">
                    <CheckCircle2 size={14} /> {x}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-gray-500">
              Recuerde: los formatos 606 y 607 del mes se envían a la DGII a más tardar el día 15 del mes siguiente.
            </p>
            {bloqueado ? (
              <p className="font-medium text-red-800">Resuelva lo que está en rojo para poder cerrar el mes.</p>
            ) : (
              <>
                {conAvisos && (
                  <label className="flex flex-col gap-1 text-gray-600">
                    Motivo para cerrar con avisos
                    <input className={CAMPO} value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: el depósito se confirma en el mes siguiente" />
                  </label>
                )}
                <p className="text-gray-600">Un mes cerrado no acepta asientos. Para corregir algo después hay que reabrirlo (con motivo).</p>
              </>
            )}
          </>
        )}
        {error && <CajaError>{error}</CajaError>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON_SECUNDARIO} onClick={onCerrar}>
            Volver
          </button>
          <button
            type="button"
            className={BOTON_PRINCIPAL}
            disabled={!rev || bloqueado || guardando || (conAvisos && motivo.trim().length < 5)}
            onClick={() => void cerrar()}
          >
            <Lock size={16} /> {guardando ? 'Cerrando…' : 'Cerrar el mes'}
          </button>
        </div>
      </div>
    </Ventana>
  )
}
