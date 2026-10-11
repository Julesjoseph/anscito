import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertTriangle,
  Lock,
  Pencil,
  Plus,
  Power,
  PowerOff,
} from 'lucide-react'
import {
  SesionVencida,
  cambiarEstadoRol,
  crearRol,
  editarRol,
  listarPermisos,
  listarRolesGestion,
} from './api'
import type { FilaRol, Permiso } from './api'
import {
  AREA,
  BOTON_PELIGRO,
  BOTON_PRINCIPAL,
  BOTON_SECUNDARIO,
  CAMPO,
  CajaError,
  Ventana,
} from './componentes'
import { mensajeDe } from './formato'

type Props = {
  token: string
  permisos: string[]
  onSesionVencida: () => void
}

type Modal =
  | { tipo: 'crear' }
  | { tipo: 'editar'; fila: FilaRol }
  | { tipo: 'estado'; fila: FilaRol }
  | null

// Nombre visible de cada módulo; si aparece uno nuevo se muestra su código.
const NOMBRES_MODULO: Record<string, string> = {
  usuarios: 'Usuarios',
  roles: 'Roles y permisos',
  servicios: 'SCITO SERVICE',
  impuestos: 'Impuestos',
  categorias: 'Categorías',
  inventario: 'Inventario',
  clientes: 'Clientes',
  proveedores: 'Proveedores',
  terceros: 'Datos personales de clientes y proveedores',
  empresa: 'Empresa',
  sucursales: 'Sucursales',
  ventas: 'Ventas',
  caja: 'Caja',
  bancos: 'Bancos',
  remesas: 'SCITO TRANSFER',
}

function nombreModulo(modulo: string): string {
  return NOMBRES_MODULO[modulo] ?? modulo.charAt(0).toUpperCase() + modulo.slice(1)
}

function agrupar(permisos: Permiso[]): [string, Permiso[]][] {
  const grupos = new Map<string, Permiso[]>()
  for (const p of permisos) {
    grupos.set(p.modulo, [...(grupos.get(p.modulo) ?? []), p])
  }
  return [...grupos.entries()]
}

// ---------- Formulario crear / editar ----------

function FormRol({
  token,
  permisos,
  misPermisos,
  fila,
  onListo,
  onCancelar,
  onSesionVencida,
}: {
  token: string
  permisos: Permiso[]
  misPermisos: string[]
  fila?: FilaRol
  onListo: () => void
  onCancelar: () => void
  onSesionVencida: () => void
}) {
  const [codigo, setCodigo] = useState(fila?.codigo ?? '')
  const [nombre, setNombre] = useState(fila?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(fila?.descripcion ?? '')
  const [marcados, setMarcados] = useState<Set<string>>(
    () => new Set(fila?.permisos ?? []),
  )
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const protegido = fila?.is_system === true
  // Solo se pueden marcar o desmarcar los permisos que uno mismo tiene.
  const puedeTocar = (p: Permiso) => !protegido && misPermisos.includes(p.codigo)

  function alternar(p: Permiso) {
    const nuevo = new Set(marcados)
    if (nuevo.has(p.id)) nuevo.delete(p.id)
    else nuevo.add(p.id)
    setMarcados(nuevo)
  }

  function alternarModulo(lista: Permiso[], marcar: boolean) {
    const nuevo = new Set(marcados)
    for (const p of lista.filter(puedeTocar)) {
      if (marcar) nuevo.add(p.id)
      else nuevo.delete(p.id)
    }
    setMarcados(nuevo)
  }

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    const datos = { nombre, descripcion, permisos: [...marcados] }
    try {
      if (fila) await editarRol(token, fila.id, datos)
      else await crearRol(token, { ...datos, codigo })
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Código
          <input
            type="text"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toLowerCase())}
            disabled={Boolean(fila)}
            placeholder="cajero_noche"
            autoComplete="off"
            className={`${CAMPO} disabled:bg-gray-100 disabled:text-gray-500`}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600 sm:col-span-2">
          Nombre
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className={CAMPO}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Descripción (opcional)
        <textarea
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          rows={2}
          className={AREA}
        />
      </label>

      <div>
        <div className="mb-2 text-sm font-medium text-gray-700">
          Permisos ({marcados.size} marcados)
        </div>
        {protegido && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
            <Lock size={14} />
            Este rol está protegido: tiene todos los permisos y no se le pueden
            quitar. Solo puede cambiar su nombre y descripción.
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {agrupar(permisos).map(([modulo, lista]) => {
            const tocables = lista.filter(puedeTocar)
            const todos =
              tocables.length > 0 && tocables.every((p) => marcados.has(p.id))
            return (
              <fieldset
                key={modulo}
                className="rounded-lg border border-gray-200 p-3"
              >
                <legend className="px-1 text-sm font-medium text-gray-800">
                  {nombreModulo(modulo)}
                </legend>
                {tocables.length > 1 && (
                  <label className="mb-2 flex items-center gap-2 text-xs text-gray-500">
                    <input
                      type="checkbox"
                      checked={todos}
                      onChange={(e) => alternarModulo(lista, e.target.checked)}
                      className="h-4 w-4 accent-[#C8102E]"
                    />
                    Marcar todo el módulo
                  </label>
                )}
                <div className="flex flex-col gap-1.5">
                  {lista.map((p) => (
                    <label
                      key={p.id}
                      className={`flex items-start gap-2 text-sm ${
                        puedeTocar(p) ? 'text-gray-700' : 'text-gray-400'
                      }`}
                      title={
                        puedeTocar(p) || protegido
                          ? p.codigo
                          : 'No puede dar un permiso que usted no tiene'
                      }
                    >
                      <input
                        type="checkbox"
                        checked={marcados.has(p.id)}
                        onChange={() => alternar(p)}
                        disabled={!puedeTocar(p)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[#C8102E]"
                      />
                      <span>
                        {p.descripcion ?? p.codigo}
                        <span className="ml-1 font-mono text-xs text-gray-400">
                          {p.codigo}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )
          })}
        </div>
      </div>

      {error && <CajaError>{error}</CajaError>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className={BOTON_SECUNDARIO}>
          Cancelar
        </button>
        <button type="submit" disabled={guardando} className={BOTON_PRINCIPAL}>
          {guardando ? 'Guardando…' : fila ? 'Guardar cambios' : 'Crear rol'}
        </button>
      </div>
    </form>
  )
}

// ---------- Activar / desactivar ----------

function ConfirmarEstado({
  token,
  fila,
  onListo,
  onCancelar,
  onSesionVencida,
}: {
  token: string
  fila: FilaRol
  onListo: () => void
  onCancelar: () => void
  onSesionVencida: () => void
}) {
  const activar = !fila.is_active
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function confirmar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      await cambiarEstadoRol(token, fila.id, activar, motivo.trim() || undefined)
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
          ? `¿Activar el rol ${fila.nombre}? Los usuarios que lo tengan recuperarán sus permisos de inmediato.`
          : `¿Desactivar el rol ${fila.nombre}? Quedará registrado quién lo hizo y el motivo.`}
      </p>
      {!activar && fila.usuarios > 0 && (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            {fila.usuarios === 1
              ? '1 usuario activo tiene este rol y perderá'
              : `${fila.usuarios} usuarios activos tienen este rol y perderán`}{' '}
            sus permisos de inmediato.
          </span>
        </div>
      )}
      {!activar && (
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Motivo
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            className={AREA}
          />
        </label>
      )}
      {error && <CajaError>{error}</CajaError>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className={BOTON_SECUNDARIO}>
          Cancelar
        </button>
        <button
          type="submit"
          disabled={guardando}
          className={activar ? BOTON_PRINCIPAL : BOTON_PELIGRO}
        >
          {!activar && <AlertTriangle size={16} />}
          {guardando ? 'Guardando…' : activar ? 'Activar' : 'Desactivar'}
        </button>
      </div>
    </form>
  )
}

// ---------- Página ----------

export default function Roles({ token, permisos: misPermisos, onSesionVencida }: Props) {
  const [filas, setFilas] = useState<FilaRol[] | null>(null)
  const [permisos, setPermisos] = useState<Permiso[]>([])
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [modal, setModal] = useState<Modal>(null)

  const puedeGestionar = misPermisos.includes('roles.gestionar')

  const cargar = useCallback(async () => {
    try {
      const [r, p] = await Promise.all([
        listarRolesGestion(token),
        listarPermisos(token),
      ])
      setFilas(r)
      setPermisos(p)
      setError('')
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, onSesionVencida])

  useEffect(() => {
    const espera = setTimeout(() => void cargar(), 0)
    return () => clearTimeout(espera)
  }, [cargar])

  function terminado(mensaje: string) {
    setModal(null)
    setAviso(mensaje)
    void cargar()
  }

  function abrir(m: Modal) {
    setAviso('')
    setModal(m)
  }

  // Resumen de permisos por módulo: "Servicios (2), Impuestos (1)".
  function resumen(f: FilaRol): string {
    if (f.permisos.length === 0) return 'Sin permisos'
    const ids = new Set(f.permisos)
    return agrupar(permisos)
      .map(([modulo, lista]) => [modulo, lista.filter((p) => ids.has(p.id)).length] as const)
      .filter(([, n]) => n > 0)
      .map(([modulo, n]) => `${nombreModulo(modulo)} (${n})`)
      .join(', ')
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-xl font-medium">Roles y permisos</h1>
          <p className="text-sm text-gray-500">
            Cada rol define qué módulos y acciones pueden usar sus usuarios.
          </p>
        </div>
        {puedeGestionar && (
          <button
            type="button"
            onClick={() => abrir({ tipo: 'crear' })}
            disabled={permisos.length === 0}
            className={BOTON_PRINCIPAL}
          >
            <Plus size={16} />
            Nuevo rol
          </button>
        )}
      </div>

      {aviso && (
        <div className="mb-4 max-w-xl rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {aviso}
        </div>
      )}
      {error && (
        <div className="mb-4 max-w-xl">
          <CajaError>{error}</CajaError>
        </div>
      )}
      {!filas && !error && <div className="text-gray-500">Cargando…</div>}

      {filas && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 text-left text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Rol</th>
                <th className="px-4 py-3 font-medium">Permisos</th>
                <th className="px-4 py-3 font-medium">Usuarios</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                {puedeGestionar && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-b border-gray-100 align-top last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 font-medium">
                      {f.nombre}
                      {f.is_system && (
                        <Lock size={12} className="text-gray-400" aria-label="Protegido" />
                      )}
                    </div>
                    {f.descripcion && (
                      <div className="text-xs text-gray-500">{f.descripcion}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{resumen(f)}</td>
                  <td className="px-4 py-3">{f.usuarios}</td>
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
                  </td>
                  {puedeGestionar && (
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => abrir({ tipo: 'editar', fila: f })}
                        className="mr-3 inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                      >
                        <Pencil size={14} />
                        Editar
                      </button>
                      {!f.is_system && (
                        <button
                          type="button"
                          onClick={() => abrir({ tipo: 'estado', fila: f })}
                          className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                        >
                          {f.is_active ? <PowerOff size={14} /> : <Power size={14} />}
                          {f.is_active ? 'Desactivar' : 'Activar'}
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
        <Ventana titulo="Nuevo rol" ancho="max-w-3xl" onCerrar={() => setModal(null)}>
          <FormRol
            token={token}
            permisos={permisos}
            misPermisos={misPermisos}
            onListo={() => terminado('Rol creado correctamente')}
            onCancelar={() => setModal(null)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
      {modal?.tipo === 'editar' && (
        <Ventana
          titulo={`Editar rol: ${modal.fila.nombre}`}
          ancho="max-w-3xl"
          onCerrar={() => setModal(null)}
        >
          <FormRol
            token={token}
            permisos={permisos}
            misPermisos={misPermisos}
            fila={modal.fila}
            onListo={() => terminado('Cambios guardados')}
            onCancelar={() => setModal(null)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
      {modal?.tipo === 'estado' && (
        <Ventana
          titulo={modal.fila.is_active ? 'Desactivar rol' : 'Activar rol'}
          onCerrar={() => setModal(null)}
        >
          <ConfirmarEstado
            token={token}
            fila={modal.fila}
            onListo={() =>
              terminado(modal.fila.is_active ? 'Rol desactivado' : 'Rol activado')
            }
            onCancelar={() => setModal(null)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
    </div>
  )
}
