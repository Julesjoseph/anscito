import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import {
  AlertTriangle,
  ImagePlus,
  Lock,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Trash2,
} from 'lucide-react'
import {
  SesionVencida,
  cambiarEstadoSucursal,
  crearSucursal,
  editarEmpresa,
  editarSucursal,
  listarSucursales,
  quitarLogo,
  subirLogo,
  verEmpresa,
} from './api'
import type { DatosEmpresa, FilaSucursal, Marca } from './api'
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
import { LogoMarca } from './marca'

type Props = {
  token: string
  permisos: string[]
  marca: Marca
  onMarcaCambiada: () => void
  onSesionVencida: () => void
}

const LOGO_MAXIMO = 512 * 1024

// Reduce la imagen a 512 px como máximo y la convierte a PNG (o WebP si
// pesa mucho), para que el logo sea liviano.
async function prepararLogo(archivo: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(archivo.type)) {
    throw new Error('Elija una imagen PNG, JPG o WebP')
  }
  const imagen = await createImageBitmap(archivo)
  const escala = Math.min(1, 512 / Math.max(imagen.width, imagen.height))
  const lienzo = document.createElement('canvas')
  lienzo.width = Math.round(imagen.width * escala)
  lienzo.height = Math.round(imagen.height * escala)
  lienzo.getContext('2d')?.drawImage(imagen, 0, 0, lienzo.width, lienzo.height)
  let datos = lienzo.toDataURL('image/png')
  if (datos.length * 0.75 > LOGO_MAXIMO) datos = lienzo.toDataURL('image/webp', 0.85)
  if (datos.length * 0.75 > LOGO_MAXIMO || !datos.startsWith('data:image/')) {
    throw new Error('La imagen es demasiado pesada; pruebe con otra más sencilla')
  }
  return datos
}

// ---------- Datos de la empresa ----------

function DatosDeEmpresa({ token, permisos, marca, onMarcaCambiada, onSesionVencida }: Props) {
  const puedeEditar = permisos.includes('empresa.editar')
  const [cargado, setCargado] = useState(false)
  const [d, setD] = useState<DatosEmpresa>({
    razonSocial: '',
    nombreComercial: '',
    rnc: '',
    direccion: '',
    telefono: '',
    whatsapp: '',
    correo: '',
    sitioWeb: '',
  })
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [confirmarQuitar, setConfirmarQuitar] = useState(false)
  const archivo = useRef<HTMLInputElement>(null)

  const manejar = useCallback(
    (e: unknown) => {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    },
    [onSesionVencida],
  )

  useEffect(() => {
    let activo = true
    verEmpresa(token)
      .then((e) => {
        if (!activo) return
        setD({
          razonSocial: e.razon_social ?? '',
          nombreComercial: e.nombre_comercial,
          rnc: e.rnc ?? '',
          direccion: e.direccion ?? '',
          telefono: e.telefono ?? '',
          whatsapp: e.whatsapp ?? '',
          correo: e.correo ?? '',
          sitioWeb: e.sitio_web ?? '',
        })
        setCargado(true)
      })
      .catch(manejar)
    return () => {
      activo = false
    }
  }, [token, manejar])

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setAviso('')
    setGuardando(true)
    try {
      await editarEmpresa(token, d)
      setAviso('Datos de la empresa guardados')
      onMarcaCambiada()
    } catch (err) {
      manejar(err)
    } finally {
      setGuardando(false)
    }
  }

  async function elegirLogo(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setError('')
    setAviso('')
    try {
      await subirLogo(token, await prepararLogo(f))
      setAviso('Logo actualizado')
      onMarcaCambiada()
    } catch (err) {
      manejar(err)
    }
  }

  async function quitar() {
    setConfirmarQuitar(false)
    try {
      await quitarLogo(token)
      setAviso('Logo quitado')
      onMarcaCambiada()
    } catch (err) {
      manejar(err)
    }
  }

  if (!cargado && !error) return <div className="text-gray-500">Cargando…</div>

  const campo = (clave: keyof DatosEmpresa, etiqueta: string, extra: object = {}) => (
    <label className="flex flex-col gap-1 text-sm text-gray-600">
      {etiqueta}
      <input
        type="text"
        value={d[clave]}
        onChange={(e) => setD({ ...d, [clave]: e.target.value })}
        disabled={!puedeEditar}
        className={`${CAMPO} disabled:bg-gray-100 disabled:text-gray-600`}
        {...extra}
      />
    </label>
  )

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {aviso && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {aviso}
        </div>
      )}
      {error && <CajaError>{error}</CajaError>}

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-3 font-medium">Logo</h2>
        <div className="flex flex-wrap items-center gap-4">
          <LogoMarca marca={marca} tamano="grande" />
          {puedeEditar && (
            <div className="flex flex-wrap gap-2">
              <input
                ref={archivo}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={elegirLogo}
              />
              <button type="button" onClick={() => archivo.current?.click()} className={`${BOTON_SECUNDARIO} inline-flex items-center gap-2`}>
                <ImagePlus size={16} /> {marca.tiene_logo ? 'Cambiar logo' : 'Subir logo'}
              </button>
              {marca.tiene_logo && (
                <button type="button" onClick={() => setConfirmarQuitar(true)} className={BOTON_PELIGRO}>
                  <Trash2 size={16} /> Quitar logo
                </button>
              )}
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          PNG, JPG o WebP. Se reduce solo a 512 px. Se muestra en el menú, en la
          pantalla de entrada y más adelante en facturas y reportes.
        </p>
      </section>

      <form onSubmit={guardar} className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="font-medium">Datos de la empresa</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {campo('nombreComercial', 'Nombre comercial (el que ven los clientes)')}
          {campo('razonSocial', 'Razón social (nombre legal)')}
          {campo('rnc', 'RNC', { placeholder: '1-30-00000-1', className: `${CAMPO} font-mono disabled:bg-gray-100` })}
          {campo('correo', 'Correo', { type: 'email', placeholder: 'info@empresa.com' })}
          {campo('telefono', 'Teléfono', { type: 'tel', placeholder: '809-555-1234' })}
          {campo('whatsapp', 'WhatsApp', { type: 'tel', placeholder: '829-555-1234' })}
        </div>
        {campo('direccion', 'Dirección')}
        {campo('sitioWeb', 'Sitio web o redes (opcional)', { placeholder: 'www.empresa.com · @empresa' })}
        <p className="text-xs text-gray-500">
          El nombre comercial aparece en el menú, en la pantalla de entrada y en
          la pestaña del navegador.
        </p>
        {puedeEditar && (
          <div className="flex justify-end">
            <button type="submit" disabled={guardando} className={BOTON_PRINCIPAL}>
              {guardando ? 'Guardando…' : 'Guardar datos'}
            </button>
          </div>
        )}
      </form>

      {confirmarQuitar && (
        <Ventana titulo="Quitar logo" onCerrar={() => setConfirmarQuitar(false)}>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-600">
              ¿Quitar el logo? En su lugar se mostrará la inicial del nombre
              comercial. Puede subir otro cuando quiera.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmarQuitar(false)} className={BOTON_SECUNDARIO}>
                Cancelar
              </button>
              <button type="button" onClick={() => void quitar()} className={BOTON_PELIGRO}>
                <AlertTriangle size={16} /> Quitar logo
              </button>
            </div>
          </div>
        </Ventana>
      )}
    </div>
  )
}

// ---------- Sucursales ----------

function FormSucursal({
  token,
  fila,
  onListo,
  onCancelar,
  onSesionVencida,
}: {
  token: string
  fila?: FilaSucursal
  onListo: () => void
  onCancelar: () => void
  onSesionVencida: () => void
}) {
  const [codigo, setCodigo] = useState(fila?.codigo ?? '')
  const [nombre, setNombre] = useState(fila?.nombre ?? '')
  const [direccion, setDireccion] = useState(fila?.direccion ?? '')
  const [telefono, setTelefono] = useState(fila?.telefono ?? '')
  const [encargado, setEncargado] = useState(fila?.encargado ?? '')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    const datos = { codigo, nombre, direccion, telefono, encargado }
    try {
      if (fila) await editarSucursal(token, fila.id, datos)
      else await crearSucursal(token, datos)
      onListo()
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Código
          <input
            type="text"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            placeholder="SUC-02"
            className={`${CAMPO} font-mono`}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600 sm:col-span-2">
          Nombre
          <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} className={CAMPO} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Dirección (opcional)
        <input type="text" value={direccion} onChange={(e) => setDireccion(e.target.value)} className={CAMPO} />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Teléfono (opcional)
          <input type="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Encargado (opcional)
          <input type="text" value={encargado} onChange={(e) => setEncargado(e.target.value)} className={CAMPO} />
        </label>
      </div>
      {error && <CajaError>{error}</CajaError>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className={BOTON_SECUNDARIO}>
          Cancelar
        </button>
        <button type="submit" disabled={guardando} className={BOTON_PRINCIPAL}>
          {guardando ? 'Guardando…' : fila ? 'Guardar cambios' : 'Crear sucursal'}
        </button>
      </div>
    </form>
  )
}

function ConfirmarEstado({
  token,
  fila,
  onListo,
  onCancelar,
  onSesionVencida,
}: {
  token: string
  fila: FilaSucursal
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
      await cambiarEstadoSucursal(token, fila.id, activar, motivo.trim() || undefined)
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
          ? `¿Activar la sucursal ${fila.nombre}?`
          : `¿Desactivar la sucursal ${fila.nombre}? No se borra; puede reactivarla cuando quiera.`}
      </p>
      {!activar && fila.usuarios > 0 && (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            Tiene {fila.usuarios} usuario(s) activo(s). Primero cámbielos de
            sucursal en la pantalla de Usuarios.
          </span>
        </div>
      )}
      {!activar && (
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Motivo
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} className={AREA} />
        </label>
      )}
      {error && <CajaError>{error}</CajaError>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className={BOTON_SECUNDARIO}>
          Cancelar
        </button>
        <button type="submit" disabled={guardando} className={activar ? BOTON_PRINCIPAL : BOTON_PELIGRO}>
          {!activar && <AlertTriangle size={16} />}
          {guardando ? 'Guardando…' : activar ? 'Activar' : 'Desactivar'}
        </button>
      </div>
    </form>
  )
}

type ModalSucursal =
  | { tipo: 'crear' }
  | { tipo: 'editar'; fila: FilaSucursal }
  | { tipo: 'estado'; fila: FilaSucursal }
  | null

function Sucursales({ token, permisos, onSesionVencida }: Props) {
  const puedeGestionar = permisos.includes('sucursales.gestionar')
  const [filas, setFilas] = useState<FilaSucursal[] | null>(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [modal, setModal] = useState<ModalSucursal>(null)

  const cargar = useCallback(async () => {
    try {
      setFilas(await listarSucursales(token))
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

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-2xl text-sm text-gray-500">
          Locales de la empresa. Por ahora todo el inventario está en la
          sucursal principal; separarlo por sucursal se construirá cuando abra
          la segunda.
        </p>
        {puedeGestionar && (
          <button type="button" onClick={() => setModal({ tipo: 'crear' })} className={BOTON_PRINCIPAL}>
            <Plus size={16} /> Nueva sucursal
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
                <th className="px-4 py-3 font-medium">Código</th>
                <th className="px-4 py-3 font-medium">Sucursal</th>
                <th className="px-4 py-3 font-medium">Dirección y teléfono</th>
                <th className="px-4 py-3 font-medium">Encargado</th>
                <th className="px-4 py-3 font-medium">Usuarios</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                {puedeGestionar && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-b border-gray-100 align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{f.codigo}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 font-medium">
                      {f.nombre}
                      {f.es_principal && <Lock size={12} className="text-gray-400" aria-label="Principal" />}
                    </div>
                    {f.es_principal && <div className="text-xs text-gray-500">Principal · aquí está el inventario</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {f.direccion && <div>{f.direccion}</div>}
                    {f.telefono && <div>{f.telefono}</div>}
                    {!f.direccion && !f.telefono && <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3">{f.encargado ?? <span className="text-gray-400">—</span>}</td>
                  <td className="px-4 py-3">{f.usuarios}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-md px-2 py-0.5 text-xs ${f.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {f.is_active ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  {puedeGestionar && (
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setModal({ tipo: 'editar', fila: f })}
                        className="mr-3 inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                      >
                        <Pencil size={14} /> Editar
                      </button>
                      {!f.es_principal && (
                        <button
                          type="button"
                          onClick={() => setModal({ tipo: 'estado', fila: f })}
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
      {(modal?.tipo === 'crear' || modal?.tipo === 'editar') && (
        <Ventana titulo={modal.tipo === 'crear' ? 'Nueva sucursal' : 'Editar sucursal'} onCerrar={() => setModal(null)}>
          <FormSucursal
            token={token}
            fila={modal.tipo === 'editar' ? modal.fila : undefined}
            onListo={() => terminado(modal.tipo === 'crear' ? 'Sucursal creada' : 'Cambios guardados')}
            onCancelar={() => setModal(null)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
      {modal?.tipo === 'estado' && (
        <Ventana titulo={modal.fila.is_active ? 'Desactivar sucursal' : 'Activar sucursal'} onCerrar={() => setModal(null)}>
          <ConfirmarEstado
            token={token}
            fila={modal.fila}
            onListo={() => terminado(modal.fila.is_active ? 'Sucursal desactivada' : 'Sucursal activada')}
            onCancelar={() => setModal(null)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
    </div>
  )
}

// ---------- Página ----------

export default function Empresa(props: Props) {
  const verSucursales = props.permisos.includes('sucursales.ver')
  const [seccion, setSeccion] = useState<'datos' | 'sucursales'>('datos')

  return (
    <div>
      <div className="mb-4">
        <h1 className="mb-1 text-xl font-medium">Empresa</h1>
        <p className="text-sm text-gray-500">Datos de la empresa y sus sucursales.</p>
      </div>
      {verSucursales && (
        <div className="mb-4 flex flex-wrap gap-1 border-b border-gray-200">
          {(
            [
              ['datos', 'Datos de la empresa'],
              ['sucursales', 'Sucursales'],
            ] as const
          ).map(([id, nombre]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSeccion(id)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm ${
                seccion === id ? 'border-[#C8102E] font-medium text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {nombre}
            </button>
          ))}
        </div>
      )}
      {seccion === 'sucursales' && verSucursales ? <Sucursales {...props} /> : <DatosDeEmpresa {...props} />}
    </div>
  )
}
