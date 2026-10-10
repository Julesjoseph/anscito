import { useState } from 'react'
import type { FormEvent } from 'react'
import { login } from './api'
import type { Usuario } from './api'

type Props = { onEntrar: (token: string, usuario: Usuario) => void }

export default function Login({ onEntrar }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!username.trim() || !password) {
      setError('Escriba su usuario y contraseña')
      return
    }
    setCargando(true)
    try {
      const r = await login(username.trim(), password)
      onEntrar(r.token, r.usuario)
    } catch (err) {
      setError(
        err instanceof TypeError
          ? 'No se pudo conectar con el servidor'
          : (err as Error).message,
      )
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-sm bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex flex-col items-center gap-1 mb-6">
          <div className="w-12 h-12 rounded-xl bg-[#C8102E] text-white flex items-center justify-center text-2xl font-medium">
            S
          </div>
          <div className="text-lg font-medium tracking-wide mt-2">
            SCITO ENTREPRISE
          </div>
          <div className="text-sm text-gray-500">Área de administración</div>
        </div>

        <form onSubmit={enviar} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-gray-600">
            Usuario
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="h-10 rounded-lg border border-gray-300 px-3 text-base text-gray-900 outline-none focus:border-[#C8102E]"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-600">
            Contraseña
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="h-10 rounded-lg border border-gray-300 px-3 text-base text-gray-900 outline-none focus:border-[#C8102E]"
            />
          </label>

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={cargando}
            className="h-10 rounded-lg bg-[#C8102E] text-white font-medium hover:bg-[#a80d26] disabled:opacity-60"
          >
            {cargando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center mt-4">
          ¿Problemas para entrar? Consulte al administrador.
        </p>
      </div>
    </div>
  )
}