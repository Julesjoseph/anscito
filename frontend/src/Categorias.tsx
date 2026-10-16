import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertTriangle,
  FolderPlus,
  Pencil,
  Plus,
  Power,
  PowerOff,
} from 'lucide-react'
import {
  SesionVencida,
  arbolCategorias,
  impuestosCategorias,
  crearCategoria,
  crearUnidad,
  editarCategoria,
  editarUnidad,
  estadoCategoria,
  estadoUnidad,
} from './api'
import type { CategoriaArbol, UnidadArbol } from './api'
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
  // Dentro de otra pantalla (Inventario) no repite el título.
  incrustada?: boolean
}

type Modal =
  | { tipo: 'unidad'; unidad?: UnidadArbol }
  | { tipo: 'categoria'; unidadId: string; categoria?: CategoriaArbol }
  | { tipo: 'estadoUnidad'; unidad: UnidadArbol }
  | { tipo: 'estadoCategoria'; categoria: CategoriaArbol }
  | null

type PropsForm = {
  token: string
  onListo: (mensaje: string) => void
  onCancelar: () => void
  onSesionVencida: () => void
}

function Insignia({ activo }: { activo: boolean }) {
  return (
    <span
      className={`rounded-md px-2 py-0.5 text-xs ${
        activo ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
      }`}
    >
      {activo ? 'Activa' : 'Inactiva'}
    </span>
  )
}

function enUso(servicios: number, productos: number): string {
  const partes: string[] = []
  if (servicios > 0) {
    partes.push(servicios === 1 ? '1 servicio activo' : `${servicios} servicios activos`)
  }
  if (productos > 0) {
    partes.push(productos === 1 ? '1 producto activo' : `${productos} productos activos`)
  }
  return partes.length ? partes.join(' · ') : 'Sin servicios ni productos activos'
}

// Ejecuta una acción del formulario mostrando errores y estado "guardando".
function useEnvio(onSesionVencida: () => void) {
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function enviar(accion: () => Promise<void>) {
    setError('')
    setGuardando(true)
    try {
      await accion()
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    } finally {
      setGuardando(false)
    }
  }

  return { error, guardando, enviar }
}

function Botones({
  guardando,
  texto,
  onCancelar,
  peligro = false,
}: {
  guardando: boolean
  texto: string
  onCancelar: () => void
  peligro?: boolean
}) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onCancelar} className={BOTON_SECUNDARIO}>
        Cancelar
      </button>
      <button
        type="submit"
        disabled={guardando}
        className={peligro ? BOTON_PELIGRO : BOTON_PRINCIPAL}
      >
        {peligro && <AlertTriangle size={16} />}
        {guardando ? 'Guardando…' : texto}
      </button>
    </div>
  )
}

// ---------- Formularios ----------

function FormUnidad({
  token,
  unidad,
  onListo,
  onCancelar,
  onSesionVencida,
}: PropsForm & { unidad?: UnidadArbol }) {
  const [nombre, setNombre] = useState(unidad?.nombre ?? '')
  const { error, guardando, enviar } = useEnvio(onSesionVencida)

  function guardar(e: FormEvent) {
    e.preventDefault()
    void enviar(async () => {
      if (unidad) await editarUnidad(token, unidad.id, nombre)
      else await crearUnidad(token, nombre)
      onListo(unidad ? 'Unidad de negocio actualizada' : 'Unidad de negocio creada')
    })
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Nombre
        <input
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej: Fotocopias"
          className={CAMPO}
        />
      </label>
      <p className="text-xs text-gray-500">
        Las unidades de negocio agrupan las categorías y las usan tanto los
        servicios como los productos de inventario.
      </p>
      {error && <CajaError>{error}</CajaError>}
      <Botones
        guardando={guardando}
        texto={unidad ? 'Guardar cambios' : 'Crear unidad'}
        onCancelar={onCancelar}
      />
    </form>
  )
}

function FormCategoria({
  token,
  unidades,
  impuestos,
  unidadId,
  categoria,
  onListo,
  onCancelar,
  onSesionVencida,
}: PropsForm & {
  unidades: UnidadArbol[]
  impuestos: { id: string; nombre: string }[]
  unidadId: string
  categoria?: CategoriaArbol
}) {
  const [unidad, setUnidad] = useState(unidadId)
  const [nombre, setNombre] = useState(categoria?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(categoria?.descripcion ?? '')
  const [prefijo, setPrefijo] = useState(categoria?.prefijo ?? '')
  const [impuestoId, setImpuestoId] = useState(categoria?.impuesto_id ?? '')
  const { error, guardando, enviar } = useEnvio(onSesionVencida)

  // Con productos, el prefijo queda fijo: ya forma parte de sus códigos.
  const prefijoFijo = (categoria?.productos ?? 0) > 0
  const prefijoValido = /^[A-Z0-9]{2,5}$/.test(prefijo)
  const proximo = prefijoFijo
    ? categoria?.proximo
    : prefijoValido
      ? `${prefijo}-${String((categoria?.productos ?? 0) + 1).padStart(4, '0')}`
      : null

  function guardar(e: FormEvent) {
    e.preventDefault()
    void enviar(async () => {
      const datos = { unidadNegocioId: unidad, nombre, descripcion, prefijo, impuestoId }
      if (categoria) await editarCategoria(token, categoria.id, datos)
      else await crearCategoria(token, datos)
      onListo(categoria ? 'Categoría actualizada' : 'Categoría creada')
    })
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Unidad de negocio
        <select
          value={unidad}
          onChange={(e) => setUnidad(e.target.value)}
          className={CAMPO}
        >
          {unidades
            .filter((u) => u.is_active || u.id === unidadId)
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Nombre de la categoría
        <input
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej: Cuadernos"
          className={CAMPO}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Descripción (opcional)
        <textarea
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          rows={2}
          className={AREA}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Prefijo para códigos de productos (opcional)
        <input
          type="text"
          value={prefijo}
          onChange={(e) =>
            setPrefijo(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
          }
          maxLength={5}
          disabled={prefijoFijo}
          placeholder="Ej: CUA"
          className={`${CAMPO} font-mono uppercase disabled:bg-gray-100 disabled:text-gray-500`}
        />
        <span className="text-xs text-gray-400">
          {prefijoFijo
            ? 'No se puede cambiar: la categoría ya tiene productos con este prefijo.'
            : '2 a 5 letras o números. Solo hace falta si la categoría tendrá productos de inventario.'}
        </span>
        {proximo && (
          <span className="text-xs text-gray-600">
            Próximo código:{' '}
            <span className="font-mono font-medium text-gray-900">{proximo}</span>
          </span>
        )}
      </label>
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Impuesto sugerido
        <select value={impuestoId} onChange={(e) => setImpuestoId(e.target.value)} className={CAMPO}>
          <option value="">Sin sugerencia (se escoge en cada producto o servicio)</option>
          {impuestos.map((i) => (
            <option key={i.id} value={i.id}>
              {i.nombre}
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-400">
          Se pone solo al crear un producto o servicio de esta categoría; ahí se puede cambiar. Su contador debe confirmarlo.
        </span>
      </label>
      {error && <CajaError>{error}</CajaError>}
      <Botones
        guardando={guardando}
        texto={categoria ? 'Guardar cambios' : 'Crear categoría'}
        onCancelar={onCancelar}
      />
    </form>
  )
}

function ConfirmarEstado({
  token,
  tipo,
  id,
  nombre,
  activo,
  enUsoPor,
  onListo,
  onCancelar,
  onSesionVencida,
}: PropsForm & {
  tipo: 'unidad' | 'categoria'
  id: string
  nombre: string
  activo: boolean
  enUsoPor: number
}) {
  const activar = !activo
  const [motivo, setMotivo] = useState('')
  const { error, guardando, enviar } = useEnvio(onSesionVencida)
  const que = tipo === 'unidad' ? 'la unidad de negocio' : 'la categoría'

  function guardar(e: FormEvent) {
    e.preventDefault()
    void enviar(async () => {
      const cambiar = tipo === 'unidad' ? estadoUnidad : estadoCategoria
      await cambiar(token, id, activar, motivo.trim() || undefined)
      onListo(
        `${tipo === 'unidad' ? 'Unidad de negocio' : 'Categoría'} ${
          activar ? 'activada' : 'desactivada'
        }`,
      )
    })
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <p className="text-sm text-gray-600">
        {activar
          ? `¿Activar ${que} "${nombre}"? Volverá a aparecer al crear servicios y productos.`
          : `¿Desactivar ${que} "${nombre}"? Dejará de aparecer al crear servicios y productos, pero no se borra: los registros anteriores la conservan y puede reactivarla cuando quiera.`}
      </p>
      {!activar && tipo === 'unidad' && (
        <p className="text-xs text-gray-500">
          Sus categorías también dejarán de aparecer mientras la unidad esté
          inactiva.
        </p>
      )}
      {!activar && enUsoPor > 0 && (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            Está en uso por {enUsoPor === 1 ? '1 registro activo' : `${enUsoPor} registros activos`}{' '}
            (servicios o productos). Primero desactívelos o cámbielos de{' '}
            {tipo === 'unidad' ? 'unidad' : 'categoría'}.
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
      <Botones
        guardando={guardando}
        texto={activar ? 'Activar' : 'Desactivar'}
        onCancelar={onCancelar}
        peligro={!activar}
      />
    </form>
  )
}

// ---------- Página ----------

export default function Categorias({
  token,
  permisos,
  onSesionVencida,
  incrustada = false,
}: Props) {
  const [unidades, setUnidades] = useState<UnidadArbol[] | null>(null)
  const [impuestos, setImpuestos] = useState<{ id: string; nombre: string }[]>([])
  const [verInactivas, setVerInactivas] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [modal, setModal] = useState<Modal>(null)

  const puedeGestionar = permisos.includes('categorias.gestionar')

  const cargar = useCallback(async () => {
    try {
      const [arbol, imps] = await Promise.all([arbolCategorias(token), impuestosCategorias(token)])
      setUnidades(arbol)
      setImpuestos(imps)
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

  const visibles = (unidades ?? []).filter((u) => verInactivas || u.is_active)
  const propsForm = {
    token,
    onListo: terminado,
    onCancelar: () => setModal(null),
    onSesionVencida,
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          {!incrustada && <h1 className="mb-1 text-xl font-medium">Categorías</h1>}
          <p className="text-sm text-gray-500">
            Unidades de negocio y sus categorías. Son las mismas para Servicios
            e Inventario. El prefijo arma el código de los productos.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={verInactivas}
              onChange={(e) => setVerInactivas(e.target.checked)}
              className="h-4 w-4 accent-[#C8102E]"
            />
            Mostrar inactivas
          </label>
          {puedeGestionar && (
            <button
              type="button"
              onClick={() => abrir({ tipo: 'unidad' })}
              className={BOTON_PRINCIPAL}
            >
              <Plus size={16} />
              Nueva unidad de negocio
            </button>
          )}
        </div>
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
      {!unidades && !error && <div className="text-gray-500">Cargando…</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {visibles.map((u) => {
          const categorias = u.categorias.filter(
            (c) => verInactivas || c.is_active,
          )
          return (
            <section
              key={u.id}
              className={`rounded-xl border border-gray-200 bg-white p-4 ${
                u.is_active ? '' : 'opacity-70'
              }`}
            >
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-medium">{u.nombre}</h2>
                    <Insignia activo={u.is_active} />
                  </div>
                  <div className="text-xs text-gray-500">
                    {enUso(u.servicios_activos, u.productos_activos)}
                  </div>
                </div>
                {puedeGestionar && (
                  <div className="flex flex-wrap gap-3 text-sm">
                    {u.is_active && (
                      <button
                        type="button"
                        onClick={() =>
                          abrir({ tipo: 'categoria', unidadId: u.id })
                        }
                        className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                      >
                        <FolderPlus size={14} />
                        Nueva categoría
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => abrir({ tipo: 'unidad', unidad: u })}
                      className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                    >
                      <Pencil size={14} />
                      Renombrar
                    </button>
                    <button
                      type="button"
                      onClick={() => abrir({ tipo: 'estadoUnidad', unidad: u })}
                      className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                    >
                      {u.is_active ? <PowerOff size={14} /> : <Power size={14} />}
                      {u.is_active ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                )}
              </div>

              {categorias.length === 0 ? (
                <p className="text-sm text-gray-400">
                  Sin categorías
                  {puedeGestionar && u.is_active && '. Use "Nueva categoría" para agregar.'}
                </p>
              ) : (
                <ul className="divide-y divide-gray-100 border-t border-gray-100">
                  {categorias.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <div className={c.is_active ? '' : 'text-gray-400'}>
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          {c.nombre}
                          {c.prefijo && (
                            <span
                              className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700"
                              title={`Próximo código: ${c.proximo}`}
                            >
                              {c.prefijo} · próximo {c.proximo}
                            </span>
                          )}
                          {c.impuesto_id && (
                            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-800" title="Impuesto sugerido">
                              {impuestos.find((i) => i.id === c.impuesto_id)?.nombre ?? 'Impuesto'}
                            </span>
                          )}
                          {!c.is_active && <Insignia activo={false} />}
                        </div>
                        <div className="text-xs text-gray-500">
                          {c.descripcion ? `${c.descripcion} · ` : ''}
                          {enUso(c.servicios_activos, c.productos_activos)}
                        </div>
                      </div>
                      {puedeGestionar && (
                        <div className="flex gap-3 text-sm">
                          <button
                            type="button"
                            onClick={() =>
                              abrir({
                                tipo: 'categoria',
                                unidadId: u.id,
                                categoria: c,
                              })
                            }
                            className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                          >
                            <Pencil size={14} />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              abrir({ tipo: 'estadoCategoria', categoria: c })
                            }
                            className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                          >
                            {c.is_active ? (
                              <PowerOff size={14} />
                            ) : (
                              <Power size={14} />
                            )}
                            {c.is_active ? 'Desactivar' : 'Activar'}
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>

      {modal?.tipo === 'unidad' && (
        <Ventana
          titulo={modal.unidad ? 'Renombrar unidad de negocio' : 'Nueva unidad de negocio'}
          onCerrar={() => setModal(null)}
        >
          <FormUnidad {...propsForm} unidad={modal.unidad} />
        </Ventana>
      )}
      {modal?.tipo === 'categoria' && unidades && (
        <Ventana
          titulo={modal.categoria ? 'Editar categoría' : 'Nueva categoría'}
          onCerrar={() => setModal(null)}
        >
          <FormCategoria
            {...propsForm}
            unidades={unidades}
            impuestos={impuestos}
            unidadId={modal.unidadId}
            categoria={modal.categoria}
          />
        </Ventana>
      )}
      {modal?.tipo === 'estadoUnidad' && (
        <Ventana
          titulo={modal.unidad.is_active ? 'Desactivar unidad de negocio' : 'Activar unidad de negocio'}
          onCerrar={() => setModal(null)}
        >
          <ConfirmarEstado
            {...propsForm}
            tipo="unidad"
            id={modal.unidad.id}
            nombre={modal.unidad.nombre}
            activo={modal.unidad.is_active}
            enUsoPor={modal.unidad.servicios_activos + modal.unidad.productos_activos}
          />
        </Ventana>
      )}
      {modal?.tipo === 'estadoCategoria' && (
        <Ventana
          titulo={modal.categoria.is_active ? 'Desactivar categoría' : 'Activar categoría'}
          onCerrar={() => setModal(null)}
        >
          <ConfirmarEstado
            {...propsForm}
            tipo="categoria"
            id={modal.categoria.id}
            nombre={modal.categoria.nombre}
            activo={modal.categoria.is_active}
            enUsoPor={
              modal.categoria.servicios_activos + modal.categoria.productos_activos
            }
          />
        </Ventana>
      )}
    </div>
  )
}
