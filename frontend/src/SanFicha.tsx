import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  AlertTriangle,
  Ban,
  Camera,
  CheckCircle2,
  FileSignature,
  FileText,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  SesionVencida,
  agregarGaranteSan,
  anularContratoSan,
  crearPersonaSan,
  descargarSan,
  fichaSan,
  firmadoContratoSan,
  generarContratoSan,
  guardarFichaSan,
  nuevaPlantillaSan,
  plantillasSan,
  quitarGaranteSan,
  subirFotoSan,
  confirmarGaranteSan,
} from './api'
import type {
  ContratoSan,
  DatosFichaSan,
  DatosGaranteSan,
  FichaSan,
  GaranteSan,
  IdiomaContrato,
  PlantillaSan,
  PrepararSanes,
  TipoDocumento,
} from './api'
import { AREA, BOTON_PELIGRO, BOTON_PRINCIPAL, BOTON_SECUNDARIO, CAMPO, CajaError, Ventana } from './componentes'
import { mensajeDe } from './formato'
import { IDIOMAS, abrirArchivo, prepararArchivo } from './sanArchivos'

// Ficha completa del participante del SAN: datos, dirección, emergencia,
// referencias y fiador (con confirmación), fotos del documento y contratos
// en español, francés o criollo.

const NOMBRE_ESTADO_CONTRATO: Record<ContratoSan['estado'], string> = {
  generado: 'Generado (falta firmar)',
  firmado: 'Firmado',
  anulado: 'Anulado',
}

function fechaHora(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('es-DO') : '—'
}

function guardado(clave: string, porDefecto: string): string {
  try {
    return localStorage.getItem(clave) ?? porDefecto
  } catch {
    return porDefecto
  }
}

function guardar(clave: string, valor: string) {
  try {
    localStorage.setItem(clave, valor)
  } catch {
    // No pasa nada si no se puede recordar.
  }
}

function useEnviar(onSesionVencida: () => void) {
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  async function enviar(accion: () => Promise<unknown>, listo: () => void) {
    setGuardando(true)
    setError('')
    try {
      await accion()
      listo()
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    } finally {
      setGuardando(false)
    }
  }
  return { error, setError, guardando, enviar }
}

// ---------- Piezas del formulario ----------

function Campo({ etiqueta, children, ayuda }: { etiqueta: string; children: ReactNode; ayuda?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-gray-700">
      {etiqueta}
      {children}
      {ayuda && <span className="text-xs text-gray-500">{ayuda}</span>}
    </label>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-gray-200 p-3">
      <legend className="px-1 text-sm font-medium text-gray-900">{titulo}</legend>
      {children}
    </fieldset>
  )
}

const FICHA_VACIA: DatosFichaSan = {
  fechaNacimiento: '',
  ocupacion: '',
  lugarTrabajo: '',
  sector: '',
  municipio: '',
  provincia: '',
  referenciaDireccion: '',
  emergenciaNombre: '',
  emergenciaTelefono: '',
  emergenciaRelacion: '',
  idioma: 'es',
  telefono: '',
  whatsapp: '',
  direccion: '',
}

// Datos personales, contacto, dirección y emergencia (se usa al crear y al editar).
function CamposFicha({ d, poner }: { d: DatosFichaSan; poner: (k: keyof DatosFichaSan, v: string) => void }) {
  const campo = (k: keyof DatosFichaSan, extra: Record<string, unknown> = {}) => (
    <input className={CAMPO} value={d[k]} onChange={(e) => poner(k, e.target.value)} {...extra} />
  )
  return (
    <>
      <Seccion titulo="Contacto">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo etiqueta="Teléfono">{campo('telefono', { placeholder: '809-555-1234' })}</Campo>
          <Campo etiqueta="WhatsApp" ayuda="Al menos uno de los dos">{campo('whatsapp', { placeholder: '829-555-1234' })}</Campo>
        </div>
      </Seccion>
      <Seccion titulo="Datos personales">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Campo etiqueta="Fecha de nacimiento (opcional)">{campo('fechaNacimiento', { type: 'date' })}</Campo>
          <Campo etiqueta="Ocupación">{campo('ocupacion', { maxLength: 100 })}</Campo>
          <Campo etiqueta="Lugar de trabajo (opcional)">{campo('lugarTrabajo', { maxLength: 150 })}</Campo>
        </div>
      </Seccion>
      <Seccion titulo="Dirección">
        <Campo etiqueta="Calle y número">{campo('direccion', { maxLength: 300 })}</Campo>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Campo etiqueta="Sector">{campo('sector', { maxLength: 100 })}</Campo>
          <Campo etiqueta="Ciudad o municipio">{campo('municipio', { maxLength: 100 })}</Campo>
          <Campo etiqueta="Provincia">{campo('provincia', { maxLength: 100 })}</Campo>
        </div>
        <Campo etiqueta="Referencia" ayuda='Ej.: "al lado del colmado Juan, casa verde"'>
          {campo('referenciaDireccion', { maxLength: 200 })}
        </Campo>
      </Seccion>
      <Seccion titulo="Contacto de emergencia (opcional)">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Campo etiqueta="Nombre">{campo('emergenciaNombre', { maxLength: 150 })}</Campo>
          <Campo etiqueta="Teléfono">{campo('emergenciaTelefono')}</Campo>
          <Campo etiqueta="Relación">{campo('emergenciaRelacion', { maxLength: 60, placeholder: 'Esposa, hijo…' })}</Campo>
        </div>
      </Seccion>
      <Campo etiqueta="Idioma del contrato">
        <select className={CAMPO} value={d.idioma} onChange={(e) => poner('idioma', e.target.value)}>
          {IDIOMAS.map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </Campo>
    </>
  )
}

function CamposGarante({
  d,
  poner,
  fiador,
  tipos,
}: {
  d: DatosGaranteSan
  poner: (k: keyof DatosGaranteSan, v: string) => void
  fiador: boolean
  tipos: TipoDocumento[]
}) {
  const tipo = tipos.find((t) => t.id === d.tipoDocumentoId)
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Campo etiqueta="Nombre completo">
          <input className={CAMPO} value={d.nombre} maxLength={150} onChange={(e) => poner('nombre', e.target.value)} />
        </Campo>
        <Campo etiqueta="Teléfono">
          <input className={CAMPO} value={d.telefono} onChange={(e) => poner('telefono', e.target.value)} />
        </Campo>
        <Campo etiqueta="Relación">
          <input className={CAMPO} value={d.relacion} maxLength={60} placeholder="Hermano, vecina, jefe…" onChange={(e) => poner('relacion', e.target.value)} />
        </Campo>
      </div>
      {fiador && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Campo etiqueta="Documento">
              <select className={CAMPO} value={d.tipoDocumentoId ?? ''} onChange={(e) => poner('tipoDocumentoId', e.target.value)}>
                {tipos
                  .filter((t) => t.codigo !== 'rnc')
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                    </option>
                  ))}
              </select>
            </Campo>
            <Campo etiqueta="Número" ayuda={tipo?.ayuda}>
              <input className={`${CAMPO} font-mono`} value={d.numeroDocumento ?? ''} onChange={(e) => poner('numeroDocumento', e.target.value)} />
            </Campo>
            <Campo etiqueta="Ocupación (opcional)">
              <input className={CAMPO} value={d.ocupacion ?? ''} maxLength={100} onChange={(e) => poner('ocupacion', e.target.value)} />
            </Campo>
          </div>
          <Campo etiqueta="Dirección del fiador">
            <input className={CAMPO} value={d.direccion ?? ''} maxLength={250} onChange={(e) => poner('direccion', e.target.value)} />
          </Campo>
        </>
      )}
    </div>
  )
}

function garanteVacio(tipos: TipoDocumento[], fiador: boolean): DatosGaranteSan {
  return fiador
    ? { nombre: '', telefono: '', relacion: '', tipoDocumentoId: tipos.find((t) => t.codigo === 'cedula')?.id ?? '', numeroDocumento: '', direccion: '', ocupacion: '' }
    : { nombre: '', telefono: '', relacion: '' }
}

// ---------- Persona nueva desde el SAN ----------

export function FormPersona({
  token,
  prep,
  onCreada,
  onCerrar,
  onSesionVencida,
}: {
  token: string
  prep: PrepararSanes
  onCreada: (id: string) => void
  onCerrar: () => void
  onSesionVencida: () => void
}) {
  const tipos = prep.tiposDocumento
  const [nombre, setNombre] = useState('')
  const [tipoId, setTipoId] = useState(tipos.find((t) => t.codigo === 'cedula')?.id ?? '')
  const [numero, setNumero] = useState('')
  const [ficha, setFicha] = useState<DatosFichaSan>(FICHA_VACIA)
  const [referencias, setReferencias] = useState<DatosGaranteSan[]>([garanteVacio(tipos, false)])
  const [fiador, setFiador] = useState<DatosGaranteSan>(garanteVacio(tipos, true))
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  const tipo = tipos.find((t) => t.id === tipoId)

  function guardarPersona(e: FormEvent) {
    e.preventDefault()
    void enviar(async () => {
      const r = await crearPersonaSan(token, {
        ...ficha,
        nombre,
        tipoDocumentoId: tipoId,
        numeroDocumento: numero,
        correo: '',
        referencias: referencias.filter((x) => x.nombre.trim() || x.telefono.trim()),
        fiador,
      })
      onCreada(r.id)
    }, () => undefined)
  }

  return (
    <Ventana titulo="Nueva persona para el SOL CASH" onCerrar={onCerrar} ancho="max-w-3xl">
      <form onSubmit={guardarPersona} className="flex flex-col gap-4">
        <Seccion titulo="Identificación">
          <Campo etiqueta="Nombre completo">
            <input className={CAMPO} value={nombre} maxLength={150} onChange={(e) => setNombre(e.target.value)} autoFocus />
          </Campo>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo etiqueta="Documento (opcional)" ayuda="Cédula, pasaporte, CIN/NIU de Haití u otro">
              <select className={CAMPO} value={tipoId} onChange={(e) => setTipoId(e.target.value)}>
                {tipos
                  .filter((t) => t.codigo !== 'rnc')
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                    </option>
                  ))}
              </select>
            </Campo>
            <Campo etiqueta="Número" ayuda={numero.trim() ? tipo?.ayuda : 'Déjelo vacío si no tiene documento'}>
              <input className={`${CAMPO} font-mono`} value={numero} onChange={(e) => setNumero(e.target.value)} />
            </Campo>
          </div>
        </Seccion>
        <CamposFicha d={ficha} poner={(k, v) => setFicha({ ...ficha, [k]: v })} />
        <Seccion titulo="Referencias personales (1 o 2)">
          {referencias.map((r, i) => (
            <div key={i} className="flex flex-col gap-2">
              <CamposGarante
                d={r}
                fiador={false}
                tipos={tipos}
                poner={(k, v) => setReferencias(referencias.map((x, j) => (j === i ? { ...x, [k]: v } : x)))}
              />
              {referencias.length > 1 && (
                <button type="button" className="self-start text-xs text-gray-500 hover:underline" onClick={() => setReferencias(referencias.filter((_, j) => j !== i))}>
                  Quitar esta referencia
                </button>
              )}
            </div>
          ))}
          {referencias.length < 2 && (
            <button type="button" className="flex items-center gap-1 self-start text-xs text-[#C8102E] hover:underline" onClick={() => setReferencias([...referencias, garanteVacio(tipos, false)])}>
              <Plus size={14} /> Otra referencia
            </button>
          )}
        </Seccion>
        <Seccion titulo="Fiador (responde si deja de pagar)">
          <CamposGarante d={fiador} fiador tipos={tipos} poner={(k, v) => setFiador({ ...fiador, [k]: v })} />
        </Seccion>
        <p className="text-xs text-gray-500">
          Después de guardar: confirme por teléfono el fiador y al menos una referencia. La foto del documento es opcional (se
          recomienda si la persona tiene documento).
        </p>
        {error && <CajaError>{error}</CajaError>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON_SECUNDARIO} onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className={BOTON_PRINCIPAL} disabled={guardando || !nombre.trim()}>
            {guardando ? 'Guardando…' : 'Guardar persona'}
          </button>
        </div>
      </form>
    </Ventana>
  )
}

// ---------- Ficha de una persona ----------

export function FichaVista({
  token,
  prep,
  terceroId,
  permisos,
  onCerrar,
  onCambio,
  onSesionVencida,
}: {
  token: string
  prep: PrepararSanes
  terceroId: string
  permisos: string[]
  onCerrar: () => void
  onCambio?: () => void
  onSesionVencida: () => void
}) {
  const [f, setF] = useState<FichaSan | null>(null)
  const [error, setError] = useState('')
  const [editar, setEditar] = useState(false)
  const [nuevoGarante, setNuevoGarante] = useState<'referencia' | 'fiador' | null>(null)

  const cargar = useCallback(async () => {
    try {
      setF(await fichaSan(token, terceroId))
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, terceroId, onSesionVencida])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const cambio = () => {
    void cargar()
    onCambio?.()
  }

  if (!f)
    return (
      <Ventana titulo="Ficha del SOL CASH" onCerrar={onCerrar} ancho="max-w-3xl">
        {error ? <CajaError>{error}</CajaError> : <p className="text-sm text-gray-500">Cargando…</p>}
      </Ventana>
    )

  const puedeVerificar = permisos.includes('sanes.verificar')
  const puedeContratos = permisos.includes('sanes.contratos')
  const referencias = f.garantes.filter((g) => g.tipo === 'referencia')
  const fiador = f.garantes.find((g) => g.tipo === 'fiador')
  const fotos = f.archivos.filter((a) => a.tipo !== 'contrato_firmado')

  return (
    <Ventana titulo={`Ficha del SOL CASH · ${f.cliente.nombre}`} onCerrar={onCerrar} ancho="max-w-3xl">
      <div className="flex flex-col gap-4 text-sm">
        {f.falta.length > 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <span>Para entrar a un SOL CASH le falta: {f.falta.join(', ')}.</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-green-800">
            <CheckCircle2 size={18} /> Ficha completa: puede entrar a un SOL CASH y se le puede hacer contrato.
          </div>
        )}
        {error && <CajaError>{error}</CajaError>}

        <Seccion titulo="Datos">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            {f.cliente.codigo && <Dato t="Código" v={f.cliente.codigo} />}
            <Dato t="Documento" v={f.cliente.numero_documento ? `${f.cliente.tipo_documento ?? ''} ${f.cliente.numero_documento}` : 'Sin documento'} />
            <Dato t="Teléfono / WhatsApp" v={[f.cliente.telefono, f.cliente.whatsapp].filter(Boolean).join(' · ') || '—'} />
            {f.ficha ? (
              <>
                <Dato t="Nacimiento" v={f.ficha.fecha_nacimiento ? f.ficha.fecha_nacimiento.split('-').reverse().join('/') : '—'} />
                <Dato t="Ocupación" v={[f.ficha.ocupacion, f.ficha.lugar_trabajo].filter(Boolean).join(' · ')} />
                <Dato t="Dirección" v={[f.cliente.direccion, f.ficha.sector, f.ficha.municipio, f.ficha.provincia].filter(Boolean).join(', ')} />
                <Dato t="Referencia" v={f.ficha.referencia_direccion} />
                <Dato t="Emergencia" v={f.ficha.emergencia_nombre ? `${f.ficha.emergencia_nombre} · ${f.ficha.emergencia_telefono}${f.ficha.emergencia_relacion ? ` (${f.ficha.emergencia_relacion})` : ''}` : '—'} />
                <Dato t="Idioma del contrato" v={IDIOMAS.find(([v]) => v === f.ficha?.idioma)?.[1] ?? ''} />
              </>
            ) : (
              <p className="text-amber-700 sm:col-span-2">Todavía no tiene ficha del SOL CASH.</p>
            )}
          </dl>
          <button type="button" className={`${BOTON_SECUNDARIO} self-start`} onClick={() => setEditar(true)}>
            {f.ficha ? 'Editar datos' : 'Completar ficha'}
          </button>
        </Seccion>

        <Seccion titulo="Foto del documento">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(['documento_frente', 'documento_dorso'] as const).map((tipo) => (
              <Foto
                key={tipo}
                token={token}
                terceroId={terceroId}
                tipo={tipo}
                actual={fotos.find((a) => a.tipo === tipo) ?? null}
                onSubida={cambio}
                onSesionVencida={onSesionVencida}
              />
            ))}
          </div>
        </Seccion>

        <Seccion titulo="Fiador y referencias">
          {[...(fiador ? [fiador] : []), ...referencias].map((g) => (
            <Garante key={g.id} token={token} g={g} puedeVerificar={puedeVerificar} onCambio={cambio} onSesionVencida={onSesionVencida} />
          ))}
          {!fiador && <p className="text-amber-700">Falta el fiador.</p>}
          <div className="flex flex-wrap gap-3">
            <button type="button" className="flex items-center gap-1 text-xs text-[#C8102E] hover:underline" onClick={() => setNuevoGarante('fiador')}>
              <Plus size={14} /> {fiador ? 'Cambiar el fiador' : 'Agregar fiador'}
            </button>
            {referencias.length < 2 && (
              <button type="button" className="flex items-center gap-1 text-xs text-[#C8102E] hover:underline" onClick={() => setNuevoGarante('referencia')}>
                <Plus size={14} /> Agregar referencia
              </button>
            )}
          </div>
        </Seccion>

        {f.contratos.length > 0 && (
          <Seccion titulo="Contratos">
            {f.contratos.map((c) => (
              <ContratoFila key={c.id} token={token} c={c} puede={puedeContratos} onCambio={cambio} onSesionVencida={onSesionVencida} />
            ))}
          </Seccion>
        )}
      </div>

      {editar && (
        <EditarFicha token={token} f={f} onCerrar={() => setEditar(false)} onListo={() => { setEditar(false); cambio() }} onSesionVencida={onSesionVencida} />
      )}
      {nuevoGarante && (
        <NuevoGarante
          token={token}
          terceroId={terceroId}
          tipo={nuevoGarante}
          tipos={prep.tiposDocumento}
          onCerrar={() => setNuevoGarante(null)}
          onListo={() => { setNuevoGarante(null); cambio() }}
          onSesionVencida={onSesionVencida}
        />
      )}
    </Ventana>
  )
}

function Dato({ t, v }: { t: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{t}</dt>
      <dd>{v}</dd>
    </div>
  )
}

function EditarFicha({
  token,
  f,
  onCerrar,
  onListo,
  onSesionVencida,
}: {
  token: string
  f: FichaSan
  onCerrar: () => void
  onListo: () => void
  onSesionVencida: () => void
}) {
  const x = f.ficha
  const [d, setD] = useState<DatosFichaSan>({
    fechaNacimiento: x?.fecha_nacimiento ?? '',
    ocupacion: x?.ocupacion ?? '',
    lugarTrabajo: x?.lugar_trabajo ?? '',
    sector: x?.sector ?? '',
    municipio: x?.municipio ?? '',
    provincia: x?.provincia ?? '',
    referenciaDireccion: x?.referencia_direccion ?? '',
    emergenciaNombre: x?.emergencia_nombre ?? '',
    emergenciaTelefono: x?.emergencia_telefono ?? '',
    emergenciaRelacion: x?.emergencia_relacion ?? '',
    idioma: x?.idioma ?? 'es',
    telefono: f.cliente.telefono ?? '',
    whatsapp: f.cliente.whatsapp ?? '',
    direccion: f.cliente.direccion ?? '',
  })
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  return (
    <Ventana titulo={`Datos de ${f.cliente.nombre}`} onCerrar={onCerrar} ancho="max-w-3xl">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void enviar(() => guardarFichaSan(token, f.cliente.id, d), onListo)
        }}
      >
        <CamposFicha d={d} poner={(k, v) => setD({ ...d, [k]: v })} />
        {error && <CajaError>{error}</CajaError>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON_SECUNDARIO} onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className={BOTON_PRINCIPAL} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Ventana>
  )
}

function Foto({
  token,
  terceroId,
  tipo,
  actual,
  onSubida,
  onSesionVencida,
}: {
  token: string
  terceroId: string
  tipo: 'documento_frente' | 'documento_dorso'
  actual: FichaSan['archivos'][number] | null
  onSubida: () => void
  onSesionVencida: () => void
}) {
  const [vista, setVista] = useState<string | null>(null)
  const { error, setError, guardando, enviar } = useEnviar(onSesionVencida)

  // Miniatura de la foto guardada.
  useEffect(() => {
    if (!actual || actual.mime === 'application/pdf') return
    let url = ''
    let vigente = true
    descargarSan(token, `/sanes/archivos/${actual.id}`)
      .then((b) => {
        if (!vigente) return
        url = URL.createObjectURL(b)
        setVista(url)
      })
      .catch(() => undefined)
    return () => {
      vigente = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [token, actual])

  return (
    <div className="flex flex-col gap-2">
      <span className="font-medium">{tipo === 'documento_frente' ? 'Frente (opcional, recomendado)' : 'Dorso (opcional)'}</span>
      {actual ? (
        vista ? (
          <button type="button" onClick={() => void abrirArchivo(token, `/sanes/archivos/${actual.id}`, onSesionVencida, setError)}>
            <img src={vista} alt={tipo === 'documento_frente' ? 'Frente del documento' : 'Dorso del documento'} className="max-h-40 rounded-lg border border-gray-200 object-contain" />
          </button>
        ) : (
          <button type="button" className="self-start text-xs underline" onClick={() => void abrirArchivo(token, `/sanes/archivos/${actual.id}`, onSesionVencida, setError)}>
            Ver archivo
          </button>
        )
      ) : (
        <span className="text-xs text-amber-700">Sin foto</span>
      )}
      <label className={`${BOTON_SECUNDARIO} flex cursor-pointer items-center gap-2 self-start ${guardando ? 'opacity-60' : ''}`}>
        <Camera size={16} /> {guardando ? 'Subiendo…' : actual ? 'Cambiar foto' : 'Tomar o subir foto'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          disabled={guardando}
          onChange={(e) => {
            const archivo = e.target.files?.[0]
            e.target.value = ''
            if (!archivo) return
            void enviar(async () => subirFotoSan(token, terceroId, tipo, await prepararArchivo(archivo, false)), onSubida)
          }}
        />
      </label>
      {error && <CajaError>{error}</CajaError>}
    </div>
  )
}

function Garante({
  token,
  g,
  puedeVerificar,
  onCambio,
  onSesionVencida,
}: {
  token: string
  g: GaranteSan
  puedeVerificar: boolean
  onCambio: () => void
  onSesionVencida: () => void
}) {
  const [accion, setAccion] = useState<'confirmar' | 'quitar' | null>(null)
  const [nota, setNota] = useState('')
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-gray-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium">
            {g.tipo === 'fiador' ? 'Fiador' : 'Referencia'}: {g.nombre}
          </div>
          <div className="text-xs text-gray-600">
            {g.relacion} · {g.telefono}
            {g.numero_documento && ` · ${g.tipo_documento} ${g.numero_documento}`}
            {g.direccion && ` · ${g.direccion}`}
          </div>
          {g.confirmado ? (
            <div className="mt-1 flex items-center gap-1 text-xs text-green-700">
              <ShieldCheck size={14} /> Confirmado por {g.confirmado_por_usuario} el {fechaHora(g.confirmado_en)}: {g.nota_confirmacion}
            </div>
          ) : (
            <div className="mt-1 text-xs text-amber-700">Sin confirmar: llame y verifique.</div>
          )}
        </div>
        <div className="flex gap-3">
          {!g.confirmado && puedeVerificar && (
            <button type="button" className="text-xs text-[#C8102E] hover:underline" onClick={() => setAccion('confirmar')}>
              Confirmar
            </button>
          )}
          <button type="button" className="text-gray-400 hover:text-red-700" aria-label={`Quitar a ${g.nombre}`} title="Quitar" onClick={() => setAccion('quitar')}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {accion && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void enviar(
              () => (accion === 'confirmar' ? confirmarGaranteSan(token, g.id, nota) : quitarGaranteSan(token, g.id, nota)),
              () => {
                setAccion(null)
                setNota('')
                onCambio()
              },
            )
          }}
        >
          <input
            className={CAMPO}
            value={nota}
            maxLength={300}
            autoFocus
            onChange={(e) => setNota(e.target.value)}
            placeholder={accion === 'confirmar' ? '¿Qué se verificó? Ej.: "Llamé, lo conoce hace 5 años"' : 'Motivo para quitarlo'}
          />
          {error && <CajaError>{error}</CajaError>}
          <div className="flex gap-2">
            <button type="submit" className={accion === 'confirmar' ? BOTON_PRINCIPAL : BOTON_PELIGRO} disabled={guardando || nota.trim().length < 5}>
              {accion === 'confirmar' ? 'Confirmar' : 'Quitar'}
            </button>
            <button type="button" className={BOTON_SECUNDARIO} onClick={() => setAccion(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function NuevoGarante({
  token,
  terceroId,
  tipo,
  tipos,
  onCerrar,
  onListo,
  onSesionVencida,
}: {
  token: string
  terceroId: string
  tipo: 'referencia' | 'fiador'
  tipos: TipoDocumento[]
  onCerrar: () => void
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [d, setD] = useState<DatosGaranteSan>(garanteVacio(tipos, tipo === 'fiador'))
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  return (
    <Ventana titulo={tipo === 'fiador' ? 'Fiador' : 'Nueva referencia'} onCerrar={onCerrar} ancho="max-w-2xl">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void enviar(() => agregarGaranteSan(token, terceroId, { ...d, tipo }), onListo)
        }}
      >
        {tipo === 'fiador' && <p className="text-sm text-gray-600">Si ya tenía fiador, este lo reemplaza y hay que confirmarlo de nuevo.</p>}
        <CamposGarante d={d} fiador={tipo === 'fiador'} tipos={tipos} poner={(k, v) => setD({ ...d, [k]: v })} />
        {error && <CajaError>{error}</CajaError>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON_SECUNDARIO} onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className={BOTON_PRINCIPAL} disabled={guardando}>
            Guardar
          </button>
        </div>
      </form>
    </Ventana>
  )
}

// ---------- Contratos ----------

function ContratoFila({
  token,
  c,
  puede,
  onCambio,
  onSesionVencida,
}: {
  token: string
  c: ContratoSan
  puede: boolean
  onCambio: () => void
  onSesionVencida: () => void
}) {
  const [anular, setAnular] = useState(false)
  const [motivo, setMotivo] = useState('')
  const { error, setError, guardando, enviar } = useEnviar(onSesionVencida)
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-gray-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-medium">{c.codigo}</span> · {c.san_codigo} número {c.numero_san} ·{' '}
          {IDIOMAS.find(([v]) => v === c.idioma)?.[1]}
          <div className={`text-xs ${c.estado === 'firmado' ? 'text-green-700' : c.estado === 'anulado' ? 'text-gray-500' : 'text-amber-700'}`}>
            {NOMBRE_ESTADO_CONTRATO[c.estado]}
            {c.firmado_en && ` el ${fechaHora(c.firmado_en)}`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button type="button" className="flex items-center gap-1 hover:underline" onClick={() => void abrirArchivo(token, `/sanes/contratos/${c.id}/pdf`, onSesionVencida, setError)}>
            <FileText size={14} /> Ver / imprimir
          </button>
          {puede && c.estado !== 'anulado' && (
            <>
              <label className={`flex cursor-pointer items-center gap-1 text-[#C8102E] hover:underline ${guardando ? 'opacity-60' : ''}`}>
                <Upload size={14} /> {c.estado === 'firmado' ? 'Otra página firmada' : 'Subir el firmado'}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  disabled={guardando}
                  onChange={(e) => {
                    const archivo = e.target.files?.[0]
                    e.target.value = ''
                    if (!archivo) return
                    void enviar(async () => firmadoContratoSan(token, c.id, await prepararArchivo(archivo, true)), onCambio)
                  }}
                />
              </label>
              <button type="button" className="flex items-center gap-1 text-gray-500 hover:text-red-700" onClick={() => setAnular(true)}>
                <Ban size={14} /> Anular
              </button>
            </>
          )}
        </div>
      </div>
      {anular && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void enviar(() => anularContratoSan(token, c.id, motivo), () => {
              setAnular(false)
              onCambio()
            })
          }}
        >
          <input className={CAMPO} value={motivo} maxLength={300} autoFocus onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo de la anulación" />
          <div className="flex gap-2">
            <button type="submit" className={BOTON_PELIGRO} disabled={guardando || motivo.trim().length < 5}>
              Anular contrato
            </button>
            <button type="button" className={BOTON_SECUNDARIO} onClick={() => setAnular(false)}>
              Volver
            </button>
          </div>
        </form>
      )}
      {error && <CajaError>{error}</CajaError>}
    </div>
  )
}

// Generar el contrato de un número del SAN y abrirlo para imprimir.
export function GenerarContrato({
  token,
  participacionId,
  terceroId,
  nombre,
  numero,
  onCerrar,
  onListo,
  onSesionVencida,
}: {
  token: string
  participacionId: string
  terceroId: string
  nombre: string
  numero: number
  onCerrar: () => void
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [idioma, setIdioma] = useState<IdiomaContrato>('es')
  const [lugar, setLugar] = useState(() => guardado('anscito.lugarContrato', 'Santo Domingo'))
  const { error, setError, guardando, enviar } = useEnviar(onSesionVencida)

  // El idioma que la persona prefiere (está en su ficha).
  useEffect(() => {
    fichaSan(token, terceroId)
      .then((f) => {
        if (f.ficha) setIdioma(f.ficha.idioma)
      })
      .catch(() => undefined)
  }, [token, terceroId])
  return (
    <Ventana titulo={`Contrato · número ${numero} · ${nombre}`} onCerrar={onCerrar}>
      <form
        className="flex flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault()
          guardar('anscito.lugarContrato', lugar.trim())
          void enviar(async () => {
            const r = await generarContratoSan(token, { participacionId, idioma, lugar })
            await abrirArchivo(token, `/sanes/contratos/${r.id}/pdf`, onSesionVencida, setError)
          }, onListo)
        }}
      >
        <Campo etiqueta="Idioma">
          <select className={CAMPO} value={idioma} onChange={(e) => setIdioma(e.target.value as IdiomaContrato)}>
            {IDIOMAS.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Lugar donde se firma">
          <input className={CAMPO} value={lugar} maxLength={100} onChange={(e) => setLugar(e.target.value)} />
        </Campo>
        <p className="text-xs text-gray-500">
          Se abre el PDF para imprimir. Cuando lo firmen, súbalo desde la ficha de la persona (foto de cada página o PDF).
        </p>
        {error && <CajaError>{error}</CajaError>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON_SECUNDARIO} onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className={BOTON_PRINCIPAL} disabled={guardando || !lugar.trim()}>
            <FileSignature size={16} /> {guardando ? 'Generando…' : 'Generar contrato'}
          </button>
        </div>
      </form>
    </Ventana>
  )
}

// ---------- Texto de los contratos (plantillas) ----------

export function Plantillas({
  token,
  puedeEditar,
  onSesionVencida,
}: {
  token: string
  puedeEditar: boolean
  onSesionVencida: () => void
}) {
  const [datos, setDatos] = useState<{ plantillas: PlantillaSan[]; marcadores: string[] } | null>(null)
  const [idioma, setIdioma] = useState<IdiomaContrato>('es')
  const [titulo, setTitulo] = useState('')
  const [texto, setTexto] = useState('')
  const [ok, setOk] = useState('')
  const { error, setError, guardando, enviar } = useEnviar(onSesionVencida)

  const cargar = useCallback(async () => {
    try {
      setDatos(await plantillasSan(token))
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, onSesionVencida, setError])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const actual = datos?.plantillas.find((p) => p.idioma === idioma)
  useEffect(() => {
    if (!actual) return
    setTitulo(actual.titulo)
    setTexto(actual.texto)
  }, [actual])

  if (!datos) return error ? <CajaError>{error}</CajaError> : <p className="text-sm text-gray-500">Cargando…</p>

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" />
        <span>
          El texto inicial es un borrador: un abogado debe revisarlo antes de usarlo con clientes, y una persona que hable
          francés y criollo debe revisar esas traducciones. Quite el aviso "BORRADOR" cuando esté aprobado.
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {IDIOMAS.map(([v, t]) => (
          <button
            key={v}
            type="button"
            onClick={() => {
              setIdioma(v)
              setOk('')
            }}
            className={`rounded-lg border px-3 py-1.5 ${idioma === v ? 'border-[#C8102E] bg-red-50 text-[#C8102E]' : 'border-gray-300'}`}
          >
            {t}
          </button>
        ))}
      </div>
      {actual && (
        <p className="text-xs text-gray-500">
          Versión {actual.version} · {fechaHora(actual.created_at)}
          {actual.creada_por ? ` · ${actual.creada_por}` : ''}. Los contratos ya generados no cambian.
        </p>
      )}
      <Campo etiqueta="Título">
        <input className={CAMPO} value={titulo} maxLength={150} disabled={!puedeEditar} onChange={(e) => setTitulo(e.target.value)} />
      </Campo>
      <Campo etiqueta="Texto" ayuda="Deje una línea en blanco entre párrafos.">
        <textarea className={`${AREA} min-h-96 font-mono text-sm`} value={texto} disabled={!puedeEditar} onChange={(e) => setTexto(e.target.value)} />
      </Campo>
      <div className="text-xs text-gray-600">
        Marcadores que se llenan solos:{' '}
        {datos.marcadores.map((m) => (
          <code key={m} className="mr-1 rounded bg-gray-100 px-1">{`{{${m}}}`}</code>
        ))}
      </div>
      {error && <CajaError>{error}</CajaError>}
      {ok && <p className="text-green-700">{ok}</p>}
      {puedeEditar && (
        <button
          type="button"
          className={`${BOTON_PRINCIPAL} self-start`}
          disabled={guardando || !actual || (titulo === actual.titulo && texto === actual.texto)}
          onClick={() =>
            void enviar(
              async () => {
                const r = await nuevaPlantillaSan(token, { idioma, titulo, texto })
                setOk(`Guardado como versión ${r.version}.`)
              },
              () => void cargar(),
            )
          }
        >
          Guardar nueva versión
        </button>
      )}
    </div>
  )
}
