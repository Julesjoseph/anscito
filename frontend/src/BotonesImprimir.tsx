import { useState } from 'react'
import { FileText, Printer } from 'lucide-react'
import { SesionVencida } from './api'
import type { FormatoRecibo } from './api'
import { BOTON_SECUNDARIO } from './componentes'
import { mensajeDe } from './formato'
import { ANCHOS_TICKET, htmlTicketFilas, imprimirHtml } from './ticket'
import type { AnchoTicket, TicketFilas } from './ticket'

// Papel + "Imprimir" (directo, se ajusta a la impresora) + "PDF" (para guardar
// o compartir). Lo usan los recibos de envíos, de SOL CASH y el cuadre de caja.

function anchoGuardado(): AnchoTicket {
  try {
    const f = localStorage.getItem('anscito.anchoTicket') ?? localStorage.getItem('anscito.formatoRecibo')
    if (f === '80' || f === '58' || f === 'auto' || f === 'carta') return f
  } catch {
    // Sin almacenamiento disponible: se usa el de 80 mm.
  }
  return '80'
}

export default function BotonesImprimir({
  texto = 'Imprimir',
  nombrePdf,
  cargarTicket,
  cargarPdf,
  onSesionVencida,
}: {
  texto?: string
  nombrePdf: string
  cargarTicket: () => Promise<TicketFilas>
  cargarPdf: (formato: FormatoRecibo) => Promise<Blob>
  onSesionVencida: () => void
}) {
  const [ancho, setAncho] = useState<AnchoTicket>(anchoGuardado)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState<'' | 'imprimir' | 'pdf'>('')

  function recordar() {
    try {
      localStorage.setItem('anscito.anchoTicket', ancho)
    } catch {
      // No pasa nada si no se puede recordar.
    }
  }

  async function imprimir() {
    setError('')
    setOcupado('imprimir')
    recordar()
    try {
      await imprimirHtml(htmlTicketFilas(await cargarTicket(), ancho))
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    } finally {
      setOcupado('')
    }
  }

  async function pdf() {
    setError('')
    setOcupado('pdf')
    recordar()
    // La pestaña se abre en el mismo clic para que el navegador no la bloquee.
    const pestana = window.open('', '_blank')
    try {
      const url = URL.createObjectURL(await cargarPdf(ancho === 'auto' ? '80' : ancho))
      if (pestana) pestana.location.href = url
      else {
        const a = document.createElement('a')
        a.href = url
        a.download = nombrePdf
        a.click()
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      pestana?.close()
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    } finally {
      setOcupado('')
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={ancho}
          onChange={(e) => setAncho(e.target.value as AnchoTicket)}
          className="h-10 rounded-lg border border-gray-300 px-2 text-sm"
          aria-label="Tamaño del papel"
        >
          {ANCHOS_TICKET.map(([id, nombre]) => (
            <option key={id} value={id}>
              {nombre}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void imprimir()} disabled={ocupado !== ''} className={`${BOTON_SECUNDARIO} inline-flex items-center gap-2`}>
          <Printer size={16} /> {ocupado === 'imprimir' ? 'Preparando…' : texto}
        </button>
        <button type="button" onClick={() => void pdf()} disabled={ocupado !== ''} className={`${BOTON_SECUNDARIO} inline-flex items-center gap-2`}>
          <FileText size={16} /> {ocupado === 'pdf' ? 'Generando…' : 'PDF'}
        </button>
      </div>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
