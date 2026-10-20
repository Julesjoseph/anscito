import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  Lock,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Power,
  PowerOff,
  Search,
} from 'lucide-react'
import {
  SesionVencida,
  crearTercero,
  descargarTerceros,
  editarTercero,
  estadoTercero,
  listarTerceros,
  tiposDocumento,
} from './api'
import type {
  FilaTercero,
  FiltrosTerceros,
  PaginaTerceros,
  RolTercero,
  TipoDocumento,
} from './api'
import {
  AREA,
  BOTON_PELIGRO,
  BOTON_PRINCIPAL,
  BOTON_SECUNDARIO,
  BotonesDescarga,
  CAMPO,
  CajaError,
  Ventana,
} from './componentes'
import { mensajeDe } from './formato'

// Pantalla compartida por Clientes y Proveedores (listas separadas).

type Props = {
  rol: RolTercero
  token: string
  permisos: string[]
  onSesionVencida: () => void
}

type Modal =
  | { tipo: 'crear' }
  | { tipo: 'editar'; fila: FilaTercero }
  | { tipo: 'estado'; fila: FilaTercero }
  | null

const TEXTOS = {
  clientes: {
    titulo: 'Clientes',
    descripcion: 'Personas y empresas que te compran.',
    singular: 'cliente',
    nuevo: 'Nuevo cliente',
    permiso: 'clientes',
  },
  proveedores: {
    titulo: 'Proveedores',
    descripcion: 'Personas y empresas que te venden mercancía o servicios.',
    singular: 'proveedor',
    nuevo: 'Nuevo proveedor',
    permiso: 'proveedores',
  },
} as const

const AVISO_PRIVACIDAD =
  'La cédula, el teléfono, el WhatsApp, el correo y la dirección son datos personales: regístrelos solo si los necesita. El cumplimiento de la Ley 172-13 de protección de datos debe revisarlo su abogado.'

// Enlace de WhatsApp: los números de 10 dígitos de RD llevan el código 1.
function enlaceWhatsapp(numero: string): string {
  const d = numero.replace(/\D/g, '')
  return `https://wa.me/${d.length === 10 ? '1' + d : d}`
}

// ---------- Formulario ----------

function FormTercero({
  rol,
  token,
  tipos,
  fila,
  verDocumento,
  onListo,
  onCancelar,
  onSesionVencida,
}: {
  rol: RolTercero
  token: string
  tipos: TipoDocumento[]
  fila?: FilaTercero
  verDocumento: boolean
  onListo: () => void
  onCancelar: () => void
  onSesionVencida: () => void
}) {
  const esCliente = rol === 'clientes'
  // Sin permiso, el documento llega oculto y no se puede cambiar.
  const documentoFijo = fila !== undefined && !verDocumento
  const [tipoId, setTipoId] = useState(fila?.tipo_documento_id ?? '')
  const [numero, setNumero] = useState(fila?.numero_documento ?? '')
  const [nombre, setNombre] = useState(fila?.nombre ?? '')
  const [comercial, setComercial] = useState(fila?.nombre_comercial ?? '')
  const [contribuyente, setContribuyente] = useState(fila?.es_contribuyente ?? false)
  const [direccion, setDireccion] = useState(fila?.direccion ?? '')
  const [telefono, setTelefono] = useState(fila?.telefono ?? '')
  const [whatsapp, setWhatsapp] = useState(fila?.whatsapp ?? '')
  const [correo, setCorreo] = useState(fila?.correo ?? '')
  const [notas, setNotas] = useState(fila?.notas ?? '')
  const [credito, setCredito] = useState(fila?.puede_credito ?? false)
  const [contacto, setContacto] = useState(fila?.persona_contacto ?? '')
  const [dias, setDias] = useState(fila?.dias_credito?.toString() ?? '')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const tipo = tipos.find((t) => t.id === tipoId)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    const datos = {
      tipoDocumentoId: tipoId,
      numeroDocumento: numero,
      nombre,
      nombreComercial: comercial,
      esContribuyente: contribuyente,
      direccion,
      telefono,
      whatsapp,
      correo,
      notas,
      puedeCredito: esCliente ? credito : false,
      personaContacto: contacto,
      diasCredito: esCliente ? '' : dias,
    }
    try {
      if (fila) await editarTercero(rol, token, fila.id, datos)
      else await crearTercero(rol, token, datos)
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
        Nombre o razón social
        <input
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className={CAMPO}
          autoFocus
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Nombre comercial (opcional)
        <input
          type="text"
          value={comercial}
          onChange={(e) => setComercial(e.target.value)}
          placeholder="Ej: Colmado La Esquina"
          className={CAMPO}
        />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Documento
          <select
            value={tipoId}
            onChange={(e) => {
              setTipoId(e.target.value)
              if (!e.target.value) setNumero('')
            }}
            disabled={documentoFijo}
            className={`${CAMPO} disabled:bg-gray-100 disabled:text-gray-500`}
          >
            <option value="">Sin documento</option>
            {tipos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600 sm:col-span-2">
          Número
          <input
            type="text"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            disabled={documentoFijo || !tipoId}
            placeholder={tipo ? tipo.ayuda : 'Elija primero el tipo de documento'}
            className={`${CAMPO} font-mono disabled:bg-gray-100 disabled:text-gray-500`}
          />
          {documentoFijo ? (
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <EyeOff size={12} /> Documento oculto: no tiene permiso para verlo ni
              cambiarlo.
            </span>
          ) : (
            tipo && (
              <span className="text-xs text-gray-400">
                {tipo.ayuda}. Puede escribirlo con guiones o espacios.
              </span>
            )
          )}
        </label>
      </div>

      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={contribuyente}
          onChange={(e) => setContribuyente(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[#C8102E]"
        />
        <span>
          Es contribuyente
          <span className="block text-xs text-gray-500">
            {esCliente
              ? 'Pide factura con crédito fiscal. Requiere su documento (normalmente RNC o cédula: confírmelo con su contador).'
              : 'Emite facturas con comprobante fiscal. Requiere su documento.'}
          </span>
        </span>
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Teléfono (opcional)
          <input
            type="tel"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="809-555-1234"
            className={CAMPO}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          WhatsApp (opcional)
          <input
            type="tel"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="829-555-1234"
            className={CAMPO}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Correo (opcional)
          <input
            type="email"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            placeholder="ventas@empresa.com"
            className={CAMPO}
          />
        </label>
        {!esCliente && (
          <label className="flex flex-col gap-1 text-sm text-gray-600">
            Persona de contacto (opcional)
            <input
              type="text"
              value={contacto}
              onChange={(e) => setContacto(e.target.value)}
              placeholder="A quién llamar"
              className={CAMPO}
            />
          </label>
        )}
      </div>

      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Dirección (opcional)
        <input
          type="text"
          value={direccion}
          onChange={(e) => setDireccion(e.target.value)}
          className={CAMPO}
        />
      </label>

      {esCliente ? (
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={credito}
            onChange={(e) => setCredito(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[#C8102E]"
          />
          <span>
            Puede comprar a crédito
            <span className="block text-xs text-gray-500">
              El control de lo que debe llegará con el módulo de Cuentas por
              cobrar.
            </span>
          </span>
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-sm text-gray-600 sm:max-w-xs">
          Días de plazo para pagarle (opcional)
          <input
            type="text"
            inputMode="numeric"
            value={dias}
            onChange={(e) => setDias(e.target.value)}
            placeholder="Vacío = al contado"
            className={CAMPO}
          />
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Notas (opcional)
        <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} className={AREA} />
      </label>

      <p className="text-xs text-gray-500">{AVISO_PRIVACIDAD}</p>

      {error && <CajaError>{error}</CajaError>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className={BOTON_SECUNDARIO}>
          Cancelar
        </button>
        <button type="submit" disabled={guardando} className={BOTON_PRINCIPAL}>
          {guardando ? 'Guardando…' : fila ? 'Guardar cambios' : 'Guardar'}
        </button>
      </div>
    </form>
  )
}

// ---------- Activar / desactivar ----------

function ConfirmarEstado({
  rol,
  token,
  fila,
  onListo,
  onCancelar,
  onSesionVencida,
}: {
  rol: RolTercero
  token: string
  fila: FilaTercero
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
      await estadoTercero(rol, token, fila.id, activar, motivo.trim() || undefined)
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
          ? `¿Activar a ${fila.nombre}?`
          : `¿Desactivar a ${fila.nombre}? Dejará de aparecer en la lista, pero no se borra: puede reactivarlo cuando quiera.`}
      </p>
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

// ---------- Página ----------

export default function Terceros({ rol, token, permisos, onSesionVencida }: Props) {
  const t = TEXTOS[rol]
  const esCliente = rol === 'clientes'
  const [tipos, setTipos] = useState<TipoDocumento[]>([])
  const [datos, setDatos] = useState<PaginaTerceros | null>(null)
  const [filtros, setFiltros] = useState<FiltrosTerceros>({
    texto: '',
    estado: 'activos',
    soloContribuyentes: false,
    pagina: 1,
  })
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [modal, setModal] = useState<Modal>(null)

  const puedeCrear = permisos.includes(`${t.permiso}.crear`)
  const puedeEditar = permisos.includes(`${t.permiso}.editar`)
  const puedeEstado = permisos.includes(`${t.permiso}.desactivar`)

  const manejar = useCallback(
    (e: unknown) => {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    },
    [onSesionVencida],
  )

  const cargar = useCallback(async () => {
    try {
      setDatos(await listarTerceros(rol, token, filtros))
      setError('')
    } catch (e) {
      manejar(e)
    }
  }, [rol, token, filtros, manejar])

  useEffect(() => {
    let activo = true
    tiposDocumento(rol, token)
      .then((r) => {
        if (activo) setTipos(r)
      })
      .catch(manejar)
    return () => {
      activo = false
    }
  }, [rol, token, manejar])

  useEffect(() => {
    const espera = setTimeout(() => void cargar(), 300)
    return () => clearTimeout(espera)
  }, [cargar])

  function cambiarFiltro(cambio: Partial<FiltrosTerceros>) {
    setFiltros({ ...filtros, ...cambio, pagina: 1 })
  }

  function terminado(mensaje: string) {
    setModal(null)
    setAviso(mensaje)
    void cargar()
  }

  function abrir(m: Modal) {
    setAviso('')
    setModal(m)
  }

  const filas = datos?.filas ?? []
  const desde = datos ? (datos.pagina - 1) * datos.porPagina + 1 : 0
  const hasta = datos ? desde + filas.length - 1 : 0
  const ultima = datos ? Math.max(1, Math.ceil(datos.total / datos.porPagina)) : 1

  return (
    <div>
      <div className="mb-4">
        <h1 className="mb-1 text-xl font-medium">{t.titulo}</h1>
        <p className="text-sm text-gray-500">{t.descripcion}</p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="search"
            value={filtros.texto}
            onChange={(e) => cambiarFiltro({ texto: e.target.value })}
            placeholder={rol === 'clientes' ? 'Buscar por nombre, código SCITO, documento o teléfono' : 'Buscar por nombre, documento o teléfono'}
            className={`${CAMPO} w-full pl-9`}
          />
        </div>
        <select
          value={filtros.estado}
          onChange={(e) => cambiarFiltro({ estado: e.target.value as FiltrosTerceros['estado'] })}
          className={CAMPO}
          aria-label="Estado"
        >
          <option value="activos">Activos</option>
          <option value="inactivos">Inactivos</option>
          <option value="todos">Todos</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={filtros.soloContribuyentes}
            onChange={(e) => cambiarFiltro({ soloContribuyentes: e.target.checked })}
            className="h-4 w-4 accent-[#C8102E]"
          />
          Solo contribuyentes
        </label>
        <BotonesDescarga bajar={(formato) => descargarTerceros(rol, token, filtros, formato)} onError={manejar} />
        {puedeCrear && (
          <button type="button" onClick={() => abrir({ tipo: 'crear' })} className={BOTON_PRINCIPAL}>
            <Plus size={16} />
            {t.nuevo}
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
      {!datos && !error && <div className="text-gray-500">Cargando…</div>}

      {datos && filas.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          No hay {t.titulo.toLowerCase()} que coincidan.
        </div>
      )}

      {filas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 text-left text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Documento</th>
                <th className="px-4 py-3 font-medium">Contacto</th>
                <th className="px-4 py-3 font-medium">{esCliente ? 'Crédito' : 'Plazo de pago'}</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                {(puedeEditar || puedeEstado) && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-b border-gray-100 align-top last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 font-medium">
                      {f.nombre}
                      {f.es_protegido && <Lock size={12} className="text-gray-400" aria-label="Registro del sistema" />}
                    </div>
                    {f.codigo && <div className="font-mono text-xs text-[#C8102E]">{f.codigo}</div>}
                    {f.nombre_comercial && (
                      <div className="text-xs text-gray-500">{f.nombre_comercial}</div>
                    )}
                    {f.es_contribuyente && (
                      <span className="mt-1 inline-block rounded-md bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
                        Contribuyente
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {f.numero_documento ? (
                      <>
                        <div className="text-xs text-gray-500">{f.tipo_documento}</div>
                        <div className="font-mono">{f.numero_documento}</div>
                      </>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {f.persona_contacto && <div className="font-medium">{f.persona_contacto}</div>}
                    {f.telefono && (
                      <div className="flex items-center gap-1 text-gray-700">
                        <Phone size={12} /> {f.telefono}
                      </div>
                    )}
                    {f.whatsapp && (
                      <a
                        href={enlaceWhatsapp(f.whatsapp)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-green-700 hover:underline"
                      >
                        <MessageCircle size={12} /> {f.whatsapp}
                      </a>
                    )}
                    {f.correo && (
                      <div className="flex items-center gap-1 text-gray-600">
                        <Mail size={12} /> {f.correo}
                      </div>
                    )}
                    {f.direccion && <div className="text-xs text-gray-500">{f.direccion}</div>}
                    {!f.telefono && !f.whatsapp && !f.correo && !f.direccion && !f.persona_contacto && (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {esCliente
                      ? f.puede_credito
                        ? 'Puede a crédito'
                        : 'Solo contado'
                      : f.dias_credito
                        ? `${f.dias_credito} días`
                        : 'Al contado'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs ${
                        f.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {f.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  {(puedeEditar || puedeEstado) && (
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {f.es_protegido ? (
                        <span className="text-xs text-gray-400">Del sistema</span>
                      ) : (
                        <>
                          {puedeEditar && (
                            <button
                              type="button"
                              onClick={() => abrir({ tipo: 'editar', fila: f })}
                              className="mr-3 inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                            >
                              <Pencil size={14} /> Editar
                            </button>
                          )}
                          {puedeEstado && (
                            <button
                              type="button"
                              onClick={() => abrir({ tipo: 'estado', fila: f })}
                              className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                            >
                              {f.is_active ? <PowerOff size={14} /> : <Power size={14} />}
                              {f.is_active ? 'Desactivar' : 'Activar'}
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {datos && datos.total > 0 && (
        <div className="mt-3 flex items-center justify-between gap-2 text-sm text-gray-600">
          <span>
            Mostrando {desde}–{hasta} de {datos.total}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={datos.pagina <= 1}
              onClick={() => setFiltros({ ...filtros, pagina: filtros.pagina - 1 })}
              className={`${BOTON_SECUNDARIO} inline-flex items-center gap-1 disabled:opacity-40`}
            >
              <ChevronLeft size={16} /> Anterior
            </button>
            <button
              type="button"
              disabled={datos.pagina >= ultima}
              onClick={() => setFiltros({ ...filtros, pagina: filtros.pagina + 1 })}
              className={`${BOTON_SECUNDARIO} inline-flex items-center gap-1 disabled:opacity-40`}
            >
              Siguiente <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {datos && !datos.verDocumento && (
        <p className="mt-3 flex items-center gap-1 text-xs text-gray-500">
          <EyeOff size={12} /> Los documentos se muestran ocultos porque no tiene el
          permiso para verlos completos.
        </p>
      )}
      <p className="mt-2 max-w-3xl text-xs text-gray-500">{AVISO_PRIVACIDAD}</p>

      {(modal?.tipo === 'crear' || modal?.tipo === 'editar') && (
        <Ventana
          titulo={modal.tipo === 'crear' ? t.nuevo : `Editar ${t.singular}`}
          ancho="max-w-2xl"
          onCerrar={() => setModal(null)}
        >
          <FormTercero
            rol={rol}
            token={token}
            tipos={tipos}
            fila={modal.tipo === 'editar' ? modal.fila : undefined}
            verDocumento={datos?.verDocumento ?? false}
            onListo={() =>
              terminado(modal.tipo === 'crear' ? `${t.singular[0].toUpperCase()}${t.singular.slice(1)} guardado` : 'Cambios guardados')
            }
            onCancelar={() => setModal(null)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
      {modal?.tipo === 'estado' && (
        <Ventana
          titulo={modal.fila.is_active ? `Desactivar ${t.singular}` : `Activar ${t.singular}`}
          onCerrar={() => setModal(null)}
        >
          <ConfirmarEstado
            rol={rol}
            token={token}
            fila={modal.fila}
            onListo={() => terminado(modal.fila.is_active ? 'Desactivado' : 'Activado')}
            onCancelar={() => setModal(null)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
    </div>
  )
}
