import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  UserCheck,
  UserX,
  X,
} from 'lucide-react'
import {
  SesionVencida,
  cambiarEstadoUsuario,
  crearUsuario,
  desbloquearUsuario,
  editarUsuario,
  listarRoles,
  listarUsuarios,
  resetearPassword,
} from './api'
import type { FilaUsuario, Rol } from './api'

const CAMPO =
  'h-10 rounded-lg border border-gray-300 px-3 text-base text-gray-900 outline-none focus:border-[#C8102E]'

type Props = {
  token: string
  permisos: string[]
  usuarioId: string
  onSesionVencida: () => void
}

type Modal =
  | { tipo: 'crear' }
  | { tipo: 'editar'; fila: FilaUsuario }
  | { tipo: 'estado'; fila: FilaUsuario }
  | { tipo: 'password'; fila: FilaUsuario }
  | { tipo: 'desbloquear'; fila: FilaUsuario }
  | null

function estaBloqueado(f: FilaUsuario): boolean {
  return f.locked_until !== null && new Date(f.locked_until) > new Date()
}

function Ventana({
  titulo,
  onCerrar,
  children,
}: {
  titulo: string
  onCerrar: () => void
  children: ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
    >
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6">
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

function mensajeDe(err: unknown): string {
  if (err instanceof TypeError) return 'No se pudo conectar con el servidor'
  return (err as Error).message
}

type PropsForm = {
  token: string
  roles: Rol[]
  fila?: FilaUsuario
  onListo: () => void
  onCancelar: () => void
  onSesionVencida: () => void
}

function FormUsuario({
  token,
  roles,
  fila,
  onListo,
  onCancelar,
  onSesionVencida,
}: PropsForm) {
  const [username, setUsername] = useState(fila?.username ?? '')
  const [nombre, setNombre] = useState(fila?.nombre ?? '')
  const [apellido, setApellido] = useState(fila?.apellido ?? '')
  const [password, setPassword] = useState('')
  const [rolId, setRolId] = useState(fila?.rol_id ?? '')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      if (fila) {
        await editarUsuario(token, fila.id, { nombre, apellido, rolId })
      } else {
        await crearUsuario(token, { username, nombre, apellido, password, rolId })
      }
      onListo()
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Usuario
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          disabled={Boolean(fila)}
          autoComplete="off"
          className={`${CAMPO} disabled:bg-gray-100 disabled:text-gray-500`}
        />
        {!fila && (
          <span className="text-xs text-gray-400">
            Minúsculas, números, punto, guion o guion bajo (ej: maria.caja)
          </span>
        )}
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Nombre
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className={CAMPO}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Apellido
          <input
            type="text"
            value={apellido}
            onChange={(e) => setApellido(e.target.value)}
            className={CAMPO}
          />
        </label>
      </div>
      {!fila && (
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Contraseña
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            className={CAMPO}
          />
          <span className="text-xs text-gray-400">Mínimo 10 caracteres</span>
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Rol
        <select
          value={rolId}
          onChange={(e) => setRolId(e.target.value)}
          className={CAMPO}
        >
          <option value="">Seleccione un rol</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nombre}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancelar}
          className="h-10 rounded-lg border border-gray-300 bg-white px-4 text-sm hover:bg-gray-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={guardando}
          className="h-10 rounded-lg bg-[#C8102E] px-4 text-sm font-medium text-white hover:bg-[#a80d26] disabled:opacity-60"
        >
          {guardando ? 'Guardando…' : fila ? 'Guardar cambios' : 'Crear usuario'}
        </button>
      </div>
    </form>
  )
}

type PropsEstado = {
  token: string
  fila: FilaUsuario
  onListo: () => void
  onCancelar: () => void
  onSesionVencida: () => void
}

function ConfirmarEstado({
  token,
  fila,
  onListo,
  onCancelar,
  onSesionVencida,
}: PropsEstado) {
  const activar = !fila.is_active
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function confirmar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      await cambiarEstadoUsuario(token, fila.id, activar, motivo.trim() || undefined)
      onListo()
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={confirmar} className="flex flex-col gap-4">
      <p className="text-sm text-gray-600">
        {activar
          ? `¿Activar a ${fila.username}? Podrá volver a entrar al sistema.`
          : `¿Desactivar a ${fila.username}? Dejará de poder entrar al sistema de inmediato. Quedará registrado quién lo hizo y el motivo.`}
      </p>
      {!activar && (
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Motivo
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            className="rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 outline-none focus:border-[#C8102E]"
          />
        </label>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancelar}
          className="h-10 rounded-lg border border-gray-300 bg-white px-4 text-sm hover:bg-gray-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={guardando}
          className={
            activar
              ? 'h-10 rounded-lg bg-[#C8102E] px-4 text-sm font-medium text-white hover:bg-[#a80d26] disabled:opacity-60'
              : 'flex h-10 items-center gap-2 rounded-lg border border-red-300 bg-white px-4 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60'
          }
        >
          {!activar && <AlertTriangle size={16} />}
          {guardando ? 'Guardando…' : activar ? 'Activar' : 'Desactivar'}
        </button>
      </div>
    </form>
  )
}

// La clave temporal solo vive en el estado de esta ventana: al cerrarla se pierde.
function RestablecerPassword({
  token,
  fila,
  onListo,
  onCancelar,
  onSesionVencida,
}: PropsEstado) {
  const [temporal, setTemporal] = useState('')
  const [copiada, setCopiada] = useState(false)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function confirmar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      const r = await resetearPassword(token, fila.id)
      setTemporal(r.passwordTemporal)
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    } finally {
      setGuardando(false)
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(temporal)
      setCopiada(true)
    } catch {
      setError('No se pudo copiar. Selecciónela y cópiela a mano.')
    }
  }

  if (temporal) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-600">
          Contraseña temporal de <span className="font-medium">{fila.username}</span>:
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 select-all rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 font-mono text-lg tracking-wider text-gray-900">
            {temporal}
          </code>
          <button
            type="button"
            onClick={copiar}
            className="flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm hover:bg-gray-50"
          >
            {copiada ? <Check size={16} /> : <Copy size={16} />}
            {copiada ? 'Copiada' : 'Copiar'}
          </button>
        </div>
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            Esta contraseña se muestra una sola vez. Entréguela en persona al
            usuario. Al entrar, el sistema le pedirá cambiarla.
          </span>
        </div>
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onListo}
            className="h-10 rounded-lg bg-[#C8102E] px-4 text-sm font-medium text-white hover:bg-[#a80d26]"
          >
            Listo, ya la entregué
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={confirmar} className="flex flex-col gap-4">
      <p className="text-sm text-gray-600">
        ¿Restablecer la contraseña de {fila.username}? Se generará una
        contraseña temporal, la actual dejará de funcionar y se cerrarán sus
        sesiones abiertas. Quedará registrado quién lo hizo.
      </p>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancelar}
          className="h-10 rounded-lg border border-gray-300 bg-white px-4 text-sm hover:bg-gray-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={guardando}
          className="flex h-10 items-center gap-2 rounded-lg border border-red-300 bg-white px-4 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
        >
          <AlertTriangle size={16} />
          {guardando ? 'Restableciendo…' : 'Restablecer'}
        </button>
      </div>
    </form>
  )
}

function ConfirmarDesbloqueo({
  token,
  fila,
  onListo,
  onCancelar,
  onSesionVencida,
}: PropsEstado) {
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function confirmar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      await desbloquearUsuario(token, fila.id)
      onListo()
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={confirmar} className="flex flex-col gap-4">
      <p className="text-sm text-gray-600">
        ¿Desbloquear a {fila.username}? Podrá volver a intentar entrar de
        inmediato con su contraseña actual. Quedará registrado quién lo hizo.
      </p>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancelar}
          className="h-10 rounded-lg border border-gray-300 bg-white px-4 text-sm hover:bg-gray-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={guardando}
          className="h-10 rounded-lg bg-[#C8102E] px-4 text-sm font-medium text-white hover:bg-[#a80d26] disabled:opacity-60"
        >
          {guardando ? 'Desbloqueando…' : 'Desbloquear'}
        </button>
      </div>
    </form>
  )
}

export default function Usuarios({
  token,
  permisos,
  usuarioId,
  onSesionVencida,
}: Props) {
  const [filas, setFilas] = useState<FilaUsuario[] | null>(null)
  const [roles, setRoles] = useState<Rol[]>([])
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [modal, setModal] = useState<Modal>(null)

  const puedeCrear = permisos.includes('usuarios.crear')
  const puedeEditar = permisos.includes('usuarios.editar')
  const puedeEstado = permisos.includes('usuarios.desactivar')
  const puedeSeguridad = permisos.includes('usuarios.resetear_password')
  const hayAcciones = puedeEditar || puedeEstado || puedeSeguridad

  const manejar = useCallback(
    (e: unknown) => {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    },
    [onSesionVencida],
  )

  const cargar = useCallback(async () => {
    try {
      setFilas(await listarUsuarios(token))
      setError('')
    } catch (e) {
      manejar(e)
    }
  }, [token, manejar])

  useEffect(() => {
    void cargar()
  }, [cargar])

  useEffect(() => {
    if (!puedeCrear && !puedeEditar) return
    listarRoles(token).then(setRoles).catch(manejar)
  }, [token, puedeCrear, puedeEditar, manejar])

  function terminado(mensaje: string) {
    setModal(null)
    setAviso(mensaje)
    void cargar()
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-xl font-medium">Usuarios</h1>
          <p className="text-sm text-gray-500">Personas con acceso al sistema.</p>
        </div>
        {puedeCrear && (
          <button
            type="button"
            onClick={() => {
              setAviso('')
              setModal({ tipo: 'crear' })
            }}
            className="flex h-10 items-center gap-2 rounded-lg bg-[#C8102E] px-4 text-sm font-medium text-white hover:bg-[#a80d26]"
          >
            <Plus size={16} />
            Nuevo usuario
          </button>
        )}
      </div>

      {aviso && (
        <div className="mb-4 max-w-xl rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {aviso}
        </div>
      )}
      {error && (
        <div className="mb-4 max-w-xl rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {!filas && !error && <div className="text-gray-500">Cargando…</div>}

      {filas && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 text-left text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Usuario</th>
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Rol</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Último acceso</th>
                {hayAcciones && <th className="px-4 py-3" />}
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
                      className={`rounded-md px-2 py-0.5 text-xs ${
                        f.is_active
                          ? 'bg-green-50 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {f.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                    {estaBloqueado(f) && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                        <Lock size={12} />
                        Bloqueado
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {f.last_login_at
                      ? new Date(f.last_login_at).toLocaleString('es-DO')
                      : 'Nunca'}
                  </td>
                  {hayAcciones && (
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {puedeEditar && (
                        <button
                          type="button"
                          onClick={() => {
                            setAviso('')
                            setModal({ tipo: 'editar', fila: f })
                          }}
                          className="mr-3 inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                        >
                          <Pencil size={14} />
                          Editar
                        </button>
                      )}
                      {puedeEstado && f.id !== usuarioId && (
                        <button
                          type="button"
                          onClick={() => {
                            setAviso('')
                            setModal({ tipo: 'estado', fila: f })
                          }}
                          className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                        >
                          {f.is_active ? <UserX size={14} /> : <UserCheck size={14} />}
                          {f.is_active ? 'Desactivar' : 'Activar'}
                        </button>
                      )}
                      {puedeSeguridad && f.id !== usuarioId && (
                        <button
                          type="button"
                          onClick={() => {
                            setAviso('')
                            setModal({ tipo: 'password', fila: f })
                          }}
                          className="ml-3 inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                        >
                          <KeyRound size={14} />
                          Contraseña
                        </button>
                      )}
                      {puedeSeguridad && f.id !== usuarioId && estaBloqueado(f) && (
                        <button
                          type="button"
                          onClick={() => {
                            setAviso('')
                            setModal({ tipo: 'desbloquear', fila: f })
                          }}
                          className="ml-3 inline-flex items-center gap-1 text-amber-800 hover:text-amber-900"
                        >
                          <LockOpen size={14} />
                          Desbloquear
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal?.tipo === 'crear' && (
        <Ventana titulo="Nuevo usuario" onCerrar={() => setModal(null)}>
          <FormUsuario
            token={token}
            roles={roles}
            onListo={() => terminado('Usuario creado correctamente')}
            onCancelar={() => setModal(null)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
      {modal?.tipo === 'editar' && (
        <Ventana titulo="Editar usuario" onCerrar={() => setModal(null)}>
          <FormUsuario
            token={token}
            roles={roles}
            fila={modal.fila}
            onListo={() => terminado('Cambios guardados')}
            onCancelar={() => setModal(null)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
      {modal?.tipo === 'estado' && (
        <Ventana
          titulo={modal.fila.is_active ? 'Desactivar usuario' : 'Activar usuario'}
          onCerrar={() => setModal(null)}
        >
          <ConfirmarEstado
            token={token}
            fila={modal.fila}
            onListo={() =>
              terminado(modal.fila.is_active ? 'Usuario desactivado' : 'Usuario activado')
            }
            onCancelar={() => setModal(null)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
      {modal?.tipo === 'password' && (
        <Ventana
          titulo="Restablecer contraseña"
          onCerrar={() => {
            setModal(null)
            void cargar()
          }}
        >
          <RestablecerPassword
            token={token}
            fila={modal.fila}
            onListo={() =>
              terminado(`Contraseña restablecida para ${modal.fila.username}`)
            }
            onCancelar={() => setModal(null)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
      {modal?.tipo === 'desbloquear' && (
        <Ventana titulo="Desbloquear usuario" onCerrar={() => setModal(null)}>
          <ConfirmarDesbloqueo
            token={token}
            fila={modal.fila}
            onListo={() => terminado(`${modal.fila.username} fue desbloqueado`)}
            onCancelar={() => setModal(null)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
    </div>
  )
}