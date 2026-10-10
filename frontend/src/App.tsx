import { useState } from 'react'
import Login from './Login'
import type { Usuario } from './api'

export default function App() {
  const [usuario, setUsuario] = useState<Usuario | null>(null)

  function entrar(token: string, u: Usuario) {
    sessionStorage.setItem('token', token)
    setUsuario(u)
  }

  function salir() {
    sessionStorage.removeItem('token')
    setUsuario(null)
  }

  if (!usuario) {
    return <Login onEntrar={entrar} />
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-100">
      <div className="w-12 h-12 rounded-xl bg-[#C8102E] text-white flex items-center justify-center text-2xl font-medium">
        S
      </div>
      <div className="text-lg font-medium">
        Bienvenido, {usuario.nombre} {usuario.apellido}
      </div>
      <div className="text-sm text-gray-500">
        Sesión iniciada como {usuario.username}
      </div>
      <button
        onClick={salir}
        className="h-10 px-4 rounded-lg border border-gray-300 bg-white text-sm hover:bg-gray-50"
      >
        Salir
      </button>
    </div>
  )
}