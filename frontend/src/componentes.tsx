import { useState } from 'react'
import type { ReactNode } from 'react'
import { FileSpreadsheet, FileText, X } from 'lucide-react'

// Piezas visuales compartidas por las pantallas nuevas.

export const CAMPO =
  'h-10 rounded-lg border border-gray-300 px-3 text-base text-gray-900 outline-none focus:border-[#C8102E]'

export const AREA =
  'rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 outline-none focus:border-[#C8102E]'

export const BOTON_PRINCIPAL =
  'flex h-10 items-center justify-center gap-2 rounded-lg bg-[#C8102E] px-4 text-sm font-medium text-white hover:bg-[#a80d26] disabled:opacity-60'

export const BOTON_SECUNDARIO =
  'h-10 rounded-lg border border-gray-300 bg-white px-4 text-sm hover:bg-gray-50'

// Acciones peligrosas: borde rojo + ícono de advertencia, distinto del rojo de marca.
export const BOTON_PELIGRO =
  'flex h-10 items-center gap-2 rounded-lg border border-red-300 bg-white px-4 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60'

export function CajaError({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {children}
    </div>
  )
}

export function Ventana({
  titulo,
  onCerrar,
  ancho = 'max-w-md',
  children,
}: {
  titulo: string
  onCerrar: () => void
  ancho?: string
  children: ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
    >
      <div
        className={`max-h-[90vh] w-full ${ancho} overflow-y-auto rounded-xl border border-gray-200 bg-white p-6`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-medium">{titulo}</h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="text-gray-400 hover:text-gray-700"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// Línea de negocio de un gasto (opcional): vacío = gastos generales.
export function SelectorLinea({
  unidades,
  valor,
  setValor,
}: {
  unidades: { id: string; nombre: string }[]
  valor: string
  setValor: (v: string) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-sm text-gray-600">
      ¿De qué línea de negocio es? (opcional)
      <select value={valor} onChange={(e) => setValor(e.target.value)} className={CAMPO}>
        <option value="">General (de todo el negocio)</option>
        {unidades.map((u) => (
          <option key={u.id} value={u.id}>
            {u.nombre}
          </option>
        ))}
      </select>
    </label>
  )
}

// Botones "Excel" y "PDF" para descargar una lista. "bajar" hace la descarga;
// si falla, el error se pasa a "onError".
export function BotonesDescarga({
  bajar,
  onError,
}: {
  bajar: (formato: 'xlsx' | 'pdf') => Promise<void>
  onError: (e: unknown) => void
}) {
  const [bajando, setBajando] = useState<'' | 'xlsx' | 'pdf'>('')
  async function descargar(formato: 'xlsx' | 'pdf') {
    setBajando(formato)
    try {
      await bajar(formato)
    } catch (e) {
      onError(e)
    } finally {
      setBajando('')
    }
  }
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => void descargar('xlsx')}
        disabled={bajando !== ''}
        title="Descargar la lista en Excel"
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-green-700 bg-white px-3 text-sm font-medium text-green-800 hover:bg-green-50 disabled:opacity-50"
      >
        <FileSpreadsheet size={16} /> {bajando === 'xlsx' ? 'Preparando…' : 'Excel'}
      </button>
      <button
        type="button"
        onClick={() => void descargar('pdf')}
        disabled={bajando !== ''}
        title="Descargar la lista en PDF"
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#C8102E] bg-white px-3 text-sm font-medium text-[#C8102E] hover:bg-red-50 disabled:opacity-50"
      >
        <FileText size={16} /> {bajando === 'pdf' ? 'Preparando…' : 'PDF'}
      </button>
    </div>
  )
}
