import { useState } from 'react'
import type { FormEvent } from 'react'
import { SesionVencida, cambiarPassword } from './api'

type Props = { token: string; onListo: () => void; onSalir: () => void }

const CAMPO =
  'h-10 rounded-lg border border-gray-300 px-3 text-base text-gray-900 outline-none focus:border-[#C8102E]'

export default function CambiarPassword({ token, onListo, onSalir }: Props) {
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetir, setRepetir] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (nueva.length < 10) {
      setError('La contraseña nueva debe tener al menos 10 caracteres')
      return
    }
    if (nueva !== repetir) {
      setError('Las contraseñas nuevas no coinciden')
      return
    }
    setGuardando(true)
    try {
      await cambiarPassword(token, actual, nueva)
      onListo()
    } catch (err) {
      if (err instanceof SesionVencida) onSalir()
      else if (err instanceof TypeError) {
        setError('No se pudo conectar con el servidor')
      } else setError((err as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-sm bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex flex-col items-center gap-1 mb-6">
          <div className="w-12 h-12 rounded-xl bg-[#C8102E] text-white flex items-center justify-center text-2xl font-medium">
            S
          </div>
          <div className="text-lg font-medium mt-2">Cambie su contraseña</div>
          <div className="text-sm text-gray-500 text-center">
            Por seguridad, debe elegir una contraseña nueva antes de continuar.
          </div>
        </div>

        <form onSubmit={enviar} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-gray-600">
            Contraseña actual
            <input
              type="password"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              autoComplete="current-password"
              className={CAMPO}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-600">
            Contraseña nueva
            <input
              type="password"
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
              autoComplete="new-password"
              className={CAMPO}
            />
            <span className="text-xs text-gray-400">Mínimo 10 caracteres</span>
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-600">
            Repita la contraseña nueva
            <input
              type="password"
              value={repetir}
              onChange={(e) => setRepetir(e.target.value)}
              autoComplete="new-password"
              className={CAMPO}
            />
          </label>

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={guardando}
            className="h-10 rounded-lg bg-[#C8102E] text-white font-medium hover:bg-[#a80d26] disabled:opacity-60"
          >
            {guardando ? 'Guardando…' : 'Cambiar contraseña'}
          </button>
          <button
            type="button"
            onClick={onSalir}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            Salir
          </button>
        </form>
      </div>
    </div>
  )
}