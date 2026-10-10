import { useEffect, useState } from 'react'
import { SesionVencida, listarUsuarios } from './api'
import type { FilaUsuario } from './api'

type Props = { token: string; onSesionVencida: () => void }

export default function Usuarios({ token, onSesionVencida }: Props) {
  const [filas, setFilas] = useState<FilaUsuario[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let activo = true
    listarUsuarios(token)
      .then((d) => {
        if (activo) setFilas(d)
      })
      .catch((e: unknown) => {
        if (!activo) return
        if (e instanceof SesionVencida) {
          onSesionVencida()
        } else if (e instanceof TypeError) {
          setError('No se pudo conectar con el servidor')
        } else {
          setError((e as Error).message)
        }
      })
    return () => {
      activo = false
    }
  }, [token, onSesionVencida])

  return (
    <div>
      <h1 className="text-xl font-medium mb-1">Usuarios</h1>
      <p className="text-sm text-gray-500 mb-4">
        Personas con acceso al sistema.
      </p>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 max-w-xl">
          {error}
        </div>
      )}
      {!filas && !error && <div className="text-gray-500">Cargando…</div>}

      {filas && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 font-medium">Usuario</th>
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Rol</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Último acceso</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3 font-medium">{f.username}</td>
                  <td className="px-4 py-3">
                    {f.nombre} {f.apellido}
                  </td>
                  <td className="px-4 py-3">{f.roles || '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-md text-xs ${
                        f.is_active
                          ? 'bg-green-50 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {f.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {f.last_login_at
                      ? new Date(f.last_login_at).toLocaleString('es-DO')
                      : 'Nunca'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}