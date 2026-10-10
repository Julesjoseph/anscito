import { useEffect, useState } from 'react'
import Login from './Login'
import Layout from './Layout'
import { obtenerPerfil } from './api'
import type { Perfil } from './api'

export default function App() {
  const [token, setToken] = useState<string | null>(() =>
    sessionStorage.getItem('token'),
  )
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [cargando, setCargando] = useState<boolean>(
    () => sessionStorage.getItem('token') !== null,
  )

  useEffect(() => {
    if (!token) return
    let activo = true
    obtenerPerfil(token)
      .then((p) => {
        if (activo) setPerfil(p)
      })
      .catch(() => {
        if (!activo) return
        sessionStorage.removeItem('token')
        setToken(null)
      })
      .finally(() => {
        if (activo) setCargando(false)
      })
    return () => {
      activo = false
    }
  }, [token])

  function entrar(nuevoToken: string) {
    sessionStorage.setItem('token', nuevoToken)
    setCargando(true)
    setToken(nuevoToken)
  }

  function salir() {
    sessionStorage.removeItem('token')
    setPerfil(null)
    setToken(null)
  }

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 text-gray-500">
        Cargando…
      </div>
    )
  }

  if (!token || !perfil) {
    return <Login onEntrar={entrar} />
  }

  return <Layout perfil={perfil} token={token} onSalir={salir} />
}