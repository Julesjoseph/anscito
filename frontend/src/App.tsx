import { useEffect, useState } from 'react'
import Login from './Login'
import Layout from './Layout'
import CambiarPassword from './CambiarPassword'
import { obtenerMarca, obtenerPerfil } from './api'
import type { Marca, Perfil } from './api'

// Marca mientras carga o si el servidor no responde.
const MARCA_INICIAL: Marca = {
  nombre_comercial: 'SCITO ENTREPRISE',
  tiene_logo: false,
  version: '0',
}

export default function App() {
  const [token, setToken] = useState<string | null>(() =>
    sessionStorage.getItem('token'),
  )
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [marca, setMarca] = useState<Marca>(MARCA_INICIAL)

  function recargarMarca() {
    obtenerMarca()
      .then(setMarca)
      .catch(() => undefined)
  }

  useEffect(() => {
    let activo = true
    obtenerMarca()
      .then((m) => {
        if (activo) setMarca(m)
      })
      .catch(() => undefined)
    return () => {
      activo = false
    }
  }, [])

  // El nombre comercial también va en la pestaña del navegador.
  useEffect(() => {
    document.title = marca.nombre_comercial
  }, [marca.nombre_comercial])
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

  function recargarPerfil() {
    if (!token) return
    setCargando(true)
    obtenerPerfil(token)
      .then(setPerfil)
      .catch(salir)
      .finally(() => setCargando(false))
  }

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 text-gray-500">
        Cargando…
      </div>
    )
  }

  if (!token || !perfil) {
    return <Login onEntrar={entrar} marca={marca} />
  }

  if (perfil.must_change_password) {
    return (
      <CambiarPassword token={token} onListo={recargarPerfil} onSalir={salir} />
    )
  }

  return (
    <Layout
      perfil={perfil}
      token={token}
      marca={marca}
      onMarcaCambiada={recargarMarca}
      onSalir={salir}
    />
  )
}