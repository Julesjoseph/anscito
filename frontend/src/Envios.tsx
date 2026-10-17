import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  Send,
  UserPlus,
  XCircle,
} from 'lucide-react'
import {
  SesionVencida,
  buscarBeneficiarios,
  calcularEnvio,
  confirmarEnvio,
  crearAgente,
  crearTercero,
  cuentasAgentes,
  detalleEnvio,
  editarAgente,
  estadoAgente,
  listarAgentes,
  listarEnvios,
  listarTarifas,
  listarTerceros,
  movimientosAgente,
  nuevaTarifa,
  obtenerReciboEnvio,
  pagarComisionesAgente,
  prepararEnvios,
  rechazarEnvio,
  registrarEntregaAgente,
  registrarEnvio,
  reporteDiaEnvios,
  ticketEnvio,
  tiposDocumento,
} from './api'
import type {
  BeneficiarioOpcion,
  CalculoEnvio,
  CuentaAgente,
  EstadoEnvio,
  FilaAgente,
  FilaEnvio,
  FilaTarifa,
  FiltrosEnvios,
  MovimientosAgente,
  PaginaEnvios,
  PrepararEnvios,
  ReporteDiaAgente,
  TipoDocumento,
} from './api'
import BotonesImprimir from './BotonesImprimir'
import { cajaDeEstaComputadora } from './cajaLocal'
import {
  AREA,
  BOTON_PELIGRO,
  BOTON_PRINCIPAL,
  BOTON_SECUNDARIO,
  CAMPO,
  CajaError,
  Ventana,
} from './componentes'
import { dinero, mensajeDe } from './formato'

type Props = {
  token: string
  permisos: string[]
  onSesionVencida: () => void
}

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const PARENTESCOS = ['Madre', 'Padre', 'Hermano', 'Hermana', 'Hijo', 'Hija', 'Esposo', 'Esposa', 'Tío', 'Tía', 'Primo', 'Prima', 'Abuelo', 'Abuela', 'Amigo', 'Amiga', 'Otro']

function gourdes(v: string | null | undefined): string {
  const t = dinero(v)
  return t === '—' ? t : t.replace('RD$', 'HTG ')
}

function positivo(v: string): boolean {
  return MONTO.test(v.trim()) && !/^0+(\.0+)?$/.test(v.trim())
}

// Teléfono de Haití: 8 dígitos, o 509 + 8 (la letra O se toma como cero).
// Devuelve 509-XX-XX-XXXX o null. Igual que en el servidor.
function telefonoHaiti(valor: string): string | null {
  const d = valor.toUpperCase().replace(/O/g, '0').replace(/\D/g, '')
  const ocho = d.length === 11 && d.startsWith('509') ? d.slice(3) : d
  if (ocho.length !== 8) return null
  return `509-${ocho.slice(0, 2)}-${ocho.slice(2, 4)}-${ocho.slice(4)}`
}

function hoy(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date())
}

function fechaHora(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('es-DO') : '—'
}

function fechaCorta(dia: string | null): string {
  if (!dia) return '—'
  const [a, m, d] = dia.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

function guardado(clave: string): string {
  try {
    return localStorage.getItem(clave) ?? ''
  } catch {
    return ''
  }
}

function guardar(clave: string, valor: string) {
  try {
    localStorage.setItem(clave, valor)
  } catch {
    // No pasa nada si no se puede recordar.
  }
}

function EstadoEtiqueta({ estado }: { estado: EstadoEnvio }) {
  const c =
    estado === 'confirmado'
      ? 'bg-green-100 text-green-800'
      : estado === 'pendiente'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-red-100 text-red-800'
  const t = estado === 'confirmado' ? 'Confirmado' : estado === 'pendiente' ? 'Pendiente' : 'Rechazado'
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c}`}>{t}</span>
}

// Guarda, maneja la sesión vencida y muestra el error.
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

// ---------- Recibo en PDF ----------

function BotonRecibo({ token, id, onSesionVencida }: { token: string; id: string; onSesionVencida: () => void }) {
  return (
    <BotonesImprimir
      texto="Imprimir recibo"
      nombrePdf="recibo-envio.pdf"
      cargarTicket={() => ticketEnvio(token, id)}
      cargarPdf={(formato) => obtenerReciboEnvio(token, id, formato)}
      onSesionVencida={onSesionVencida}
    />
  )
}

// ---------- Cliente nuevo (remitente) ----------

function FormCliente({
  token,
  onListo,
  onSesionVencida,
}: {
  token: string
  onListo: (c: { id: string; nombre: string; documento: string; telefono: string }) => void
  onSesionVencida: () => void
}) {
  const [tipos, setTipos] = useState<TipoDocumento[]>([])
  const [tipoId, setTipoId] = useState('')
  const [numero, setNumero] = useState('')
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const { error, guardando, enviar } = useEnviar(onSesionVencida)

  useEffect(() => {
    tiposDocumento('clientes', token)
      .then((t) => {
        setTipos(t)
        setTipoId(t.find((x) => x.codigo === 'cedula')?.id ?? '')
      })
      .catch(() => setTipos([]))
  }, [token])

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void enviar(async () => {
          const r = await crearTercero('clientes', token, {
            tipoDocumentoId: tipoId,
            numeroDocumento: numero,
            nombre,
            nombreComercial: '',
            esContribuyente: false,
            direccion: '',
            telefono,
            whatsapp: '',
            correo: '',
            notas: '',
            puedeCredito: false,
            personaContacto: '',
            diasCredito: '',
          })
          onListo({ id: r.id, nombre, documento: numero, telefono })
        }, () => undefined)
      }}
      className="flex flex-col gap-3 text-sm"
    >
      <label className="flex flex-col gap-1 text-gray-600">
        Nombre completo
        <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} className={CAMPO} autoFocus />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-gray-600">
          Documento
          <select value={tipoId} onChange={(e) => setTipoId(e.target.value)} className={CAMPO}>
            {tipos
              .filter((t) => t.codigo !== 'rnc')
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-gray-600">
          Número
          <input type="text" value={numero} onChange={(e) => setNumero(e.target.value)} className={`${CAMPO} font-mono`} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-gray-600">
        Teléfono
        <input type="text" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="829-555-1234" className={CAMPO} />
      </label>
      {error && (
        <CajaError>
          {error}
          {/ya existe/i.test(error) && ' Búsquelo con la lupa en “Remitente” y tóquelo en la lista.'}
        </CajaError>
      )}
      <button type="submit" disabled={guardando || !nombre.trim() || !numero.trim()} className={BOTON_PRINCIPAL}>
        {guardando ? 'Guardando…' : 'Guardar cliente'}
      </button>
      <p className="text-xs text-gray-500">El documento es obligatorio para enviar. El cliente queda también en la lista de Clientes.</p>
    </form>
  )
}

// ---------- Nuevo envío ----------

type Remitente = { id: string; nombre: string; documento: string | null; telefono: string | null }

function NuevoEnvio({
  token,
  permisos,
  prep,
  onRegistrado,
  onSesionVencida,
}: Props & { prep: PrepararEnvios; onRegistrado: () => void }) {
  const activos = prep.agentes
  const [agenteId, setAgenteId] = useState(() => {
    const g = guardado('anscito.agenteEnvio')
    return activos.some((a) => a.id === g) ? g : ''
  })
  const [buscarRem, setBuscarRem] = useState('')
  const [remitentes, setRemitentes] = useState<Remitente[] | null>(null)
  const [remitente, setRemitente] = useState<Remitente | null>(null)
  const [nuevoCliente, setNuevoCliente] = useState(false)
  const [avisoCliente, setAvisoCliente] = useState('')
  const [buscarBen, setBuscarBen] = useState('')
  const [beneficiarios, setBeneficiarios] = useState<BeneficiarioOpcion[] | null>(null)
  const [beneficiario, setBeneficiario] = useState<BeneficiarioOpcion | null>(null)
  const [benNuevo, setBenNuevo] = useState<{ nombre: string; telefono: string } | null>(null)
  const [parentesco, setParentesco] = useState('')
  const [motivoId, setMotivoId] = useState(prep.motivos[0]?.id ?? '')
  const [cuentaId, setCuentaId] = useState(() => {
    const g = guardado('anscito.billeteraEnvio')
    return prep.billeteras.some((b) => b.id === g) ? g : (prep.billeteras[0]?.id ?? '')
  })
  const [monto, setMonto] = useState('')
  // El monto se escribe en pesos (lo que envía) o en gourdes (lo que recibe).
  const [montoEn, setMontoEn] = useState<'DOP' | 'HTG'>('DOP')
  const [notas, setNotas] = useState('')
  const [calculo, setCalculo] = useState<CalculoEnvio | null>(null)
  const [hecho, setHecho] = useState<(CalculoEnvio & { id: string; numero: string }) | null>(null)
  const { error, setError, guardando, enviar } = useEnviar(onSesionVencida)

  const agente = activos.find((a) => a.id === agenteId)

  // Vista previa de los montos (con la tarifa vigente del servidor).
  // Los envíos van en pesos y gourdes enteros (decisión del dueño).
  const montoOk = /^\d{1,12}$/.test(monto.trim()) && Number(monto.trim()) > 0

  useEffect(() => {
    if (!agenteId || !montoOk) {
      const t = setTimeout(() => setCalculo(null), 0)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => {
      calcularEnvio(token, montoEn === 'HTG' ? { agenteId, montoRecibir: monto.trim() } : { agenteId, montoEnviado: monto.trim() })
        .then(setCalculo)
        .catch(() => setCalculo(null))
    }, 300)
    return () => clearTimeout(t)
  }, [token, agenteId, monto, montoOk, montoEn])

  async function buscarRemitente(e: FormEvent) {
    e.preventDefault()
    try {
      const r = await listarTerceros('clientes', token, { texto: buscarRem, estado: 'activos', soloContribuyentes: false, pagina: 1 })
      setRemitentes(r.filas.map((f) => ({ id: f.id, nombre: f.nombre, documento: f.numero_documento, telefono: f.telefono })))
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    }
  }

  async function buscarBeneficiario(e: FormEvent) {
    e.preventDefault()
    try {
      setBeneficiarios(await buscarBeneficiarios(token, buscarBen))
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    }
  }

  function limpiar() {
    setAvisoCliente('')
    setRemitente(null)
    setRemitentes(null)
    setBuscarRem('')
    setBeneficiario(null)
    setBenNuevo(null)
    setBeneficiarios(null)
    setBuscarBen('')
    setParentesco('')
    setMonto('')
    setNotas('')
    setHecho(null)
  }

  const telBenNuevo = benNuevo ? telefonoHaiti(benNuevo.telefono) : null
  // Lo que falta para poder registrar (se muestra debajo del botón).
  const faltan: string[] = []
  if (!agente) faltan.push('Elija el agente (paso 1).')
  if (!remitente) faltan.push('Elija el remitente: búsquelo con la lupa y toque su nombre en la lista, o créelo con “Nuevo” (paso 2).')
  else if (!remitente.documento) faltan.push('El remitente no tiene documento: agréguelo en Clientes.')
  if (!beneficiario && !benNuevo) faltan.push('Elija o cree el beneficiario (paso 3).')
  if (benNuevo && benNuevo.nombre.trim().length < 2) faltan.push('Escriba el nombre del beneficiario.')
  if (benNuevo && !telBenNuevo) faltan.push('El teléfono del beneficiario debe ser de Haití: 509 + 8 dígitos (ej: 509-37-38-2382).')
  if (!parentesco.trim()) faltan.push('Escriba el parentesco (paso 3).')
  if (!cuentaId) faltan.push('Elija la billetera (paso 4).')
  if (!montoOk)
    faltan.push(
      montoEn === 'HTG'
        ? 'Escriba las gourdes que recibe, enteras, sin centavos (paso 4).'
        : 'Escriba el monto que envía en pesos enteros, sin centavos (paso 4).',
    )
  else if (!calculo) faltan.push('Calculando el monto…')
  const listo = faltan.length === 0

  function registrar(e: FormEvent) {
    e.preventDefault()
    if (!remitente) return
    void enviar(async () => {
      const r = await registrarEnvio(token, {
        agenteId,
        remitenteId: remitente.id,
        beneficiarioId: beneficiario?.id,
        beneficiarioNuevo: beneficiario ? undefined : (benNuevo ?? undefined),
        parentesco,
        motivoEnvioId: motivoId,
        cuentaId,
        ...(montoEn === 'HTG' ? { montoRecibir: monto.trim() } : { montoEnviado: monto.trim() }),
        notas: notas.trim() || undefined,
      })
      setHecho(r)
      onRegistrado()
    }, () => undefined)
  }

  if (hecho) {
    return (
      <div className="flex max-w-xl flex-col gap-3 rounded-xl border border-green-200 bg-white p-6">
        <div className="flex items-center gap-2 text-lg font-medium text-green-800">
          <CheckCircle2 size={22} /> Envío {hecho.numero} registrado: pendiente
        </div>
        <p className="text-sm text-gray-600">
          El beneficiario recibe <span className="font-medium">{gourdes(hecho.monto_recibir)}</span>. El cliente paga{' '}
          <span className="font-medium">{dinero(hecho.total_pagar)}</span>. Avise en el grupo para que Haití lo realice y lo confirme.
        </p>
        <BotonRecibo token={token} id={hecho.id} onSesionVencida={onSesionVencida} />
        <button type="button" onClick={limpiar} className={`${BOTON_PRINCIPAL} self-start`}>
          <Plus size={16} /> Nuevo envío
        </button>
      </div>
    )
  }

  const docFalta = remitente !== null && !remitente.documento

  return (
    <>
    <form onSubmit={registrar} className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="flex flex-col gap-4 xl:col-span-2">
        <section className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
          <h2 className="font-medium">1. Agente que pide el envío</h2>
          <select
            value={agenteId}
            onChange={(e) => {
              setAgenteId(e.target.value)
              guardar('anscito.agenteEnvio', e.target.value)
            }}
            className={CAMPO}
          >
            <option value="">Seleccione el agente…</option>
            {activos.map((a) => (
              <option key={a.id} value={a.id}>
                {a.codigo} · {a.nombre}
                {a.tipo === 'propio' ? ' (punto propio)' : ''}
              </option>
            ))}
          </select>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
          <h2 className="font-medium">2. Remitente (quien envía, en RD)</h2>
          {avisoCliente && remitente && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-green-800">
              <CheckCircle2 size={16} /> {avisoCliente}
            </div>
          )}
          {remitente ? (
            <div className="flex items-start justify-between gap-2 rounded-lg bg-gray-50 p-3">
              <div>
                <div className="font-medium">{remitente.nombre}</div>
                <div className="text-gray-500">
                  {remitente.documento ? <span className="font-mono">{remitente.documento}</span> : <span className="text-red-700">Sin documento</span>}
                  {remitente.telefono && ` · ${remitente.telefono}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRemitente(null)
                  setAvisoCliente('')
                }}
                className="text-xs text-[#C8102E] hover:underline"
              >
                Cambiar
              </button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  type="search"
                  value={buscarRem}
                  onChange={(e) => setBuscarRem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void buscarRemitente(e)
                  }}
                  placeholder="Nombre, teléfono o documento"
                  className={`${CAMPO} flex-1`}
                />
                <button type="button" onClick={(e) => void buscarRemitente(e)} className={BOTON_SECUNDARIO} aria-label="Buscar remitente">
                  <Search size={16} />
                </button>
                {permisos.includes('clientes.crear') && (
                  <button type="button" onClick={() => setNuevoCliente(true)} className={BOTON_SECUNDARIO}>
                    <span className="inline-flex items-center gap-1"><UserPlus size={16} /> Nuevo</span>
                  </button>
                )}
              </div>
              {!remitentes && <span className="text-xs text-gray-500">Escriba y pulse la lupa (o Enter); luego toque el nombre en la lista.</span>}
              {remitentes && (
                <ul className="flex max-h-48 flex-col overflow-y-auto rounded-lg border border-gray-200">
                  {remitentes.length === 0 && <li className="px-3 py-2 text-gray-400">No se encontró. Créelo con “Nuevo”.</li>}
                  {remitentes.map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => setRemitente(r)} className="flex w-full justify-between gap-2 px-3 py-2 text-left hover:bg-gray-50">
                        <span>{r.nombre}</span>
                        <span className="font-mono text-xs text-gray-500">{r.documento ?? 'sin documento'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {docFalta && (
            <p className="flex gap-2 text-xs text-red-700">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              Este cliente no tiene documento: agréguelo en Clientes (cédula o pasaporte) antes de enviar.
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
          <h2 className="font-medium">3. Beneficiario (quien recibe, en Haití)</h2>
          {beneficiario ? (
            <div className="flex items-start justify-between gap-2 rounded-lg bg-gray-50 p-3">
              <div>
                <div className="font-medium">{beneficiario.nombre}</div>
                <div className="font-mono text-gray-500">{beneficiario.telefono}</div>
              </div>
              <button type="button" onClick={() => setBeneficiario(null)} className="text-xs text-[#C8102E] hover:underline">
                Cambiar
              </button>
            </div>
          ) : benNuevo ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-gray-600">
                Nombre completo
                <input type="text" value={benNuevo.nombre} onChange={(e) => setBenNuevo({ ...benNuevo, nombre: e.target.value })} className={CAMPO} autoFocus />
              </label>
              <label className="flex flex-col gap-1 text-gray-600">
                Teléfono en Haití
                <input type="text" value={benNuevo.telefono} onChange={(e) => setBenNuevo({ ...benNuevo, telefono: e.target.value })} placeholder="509-37-38-2382" className={`${CAMPO} font-mono`} />
                {benNuevo.telefono.trim() !== '' &&
                  (telBenNuevo ? (
                    <span className="text-xs text-green-700">Se guardará como {telBenNuevo}</span>
                  ) : (
                    <span className="text-xs text-red-600">Debe tener 509 + 8 dígitos</span>
                  ))}
              </label>
              <button type="button" onClick={() => setBenNuevo(null)} className="self-start text-xs text-gray-500 hover:underline">
                Buscar uno existente
              </button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  type="search"
                  value={buscarBen}
                  onChange={(e) => setBuscarBen(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void buscarBeneficiario(e)
                  }}
                  placeholder="Nombre o teléfono"
                  className={`${CAMPO} flex-1`}
                />
                <button type="button" onClick={(e) => void buscarBeneficiario(e)} className={BOTON_SECUNDARIO} aria-label="Buscar beneficiario">
                  <Search size={16} />
                </button>
                <button type="button" onClick={() => setBenNuevo({ nombre: buscarBen, telefono: '' })} className={BOTON_SECUNDARIO}>
                  <span className="inline-flex items-center gap-1"><UserPlus size={16} /> Nuevo</span>
                </button>
              </div>
              {beneficiarios && (
                <ul className="flex max-h-48 flex-col overflow-y-auto rounded-lg border border-gray-200">
                  {beneficiarios.length === 0 && <li className="px-3 py-2 text-gray-400">No se encontró. Créelo con “Nuevo”.</li>}
                  {beneficiarios.map((b) => (
                    <li key={b.id}>
                      <button type="button" onClick={() => setBeneficiario(b)} className="flex w-full justify-between gap-2 px-3 py-2 text-left hover:bg-gray-50">
                        <span>{b.nombre}</span>
                        <span className="font-mono text-xs text-gray-500">{b.telefono}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-gray-600">
              Parentesco con el remitente
              <input type="text" list="parentescos" value={parentesco} onChange={(e) => setParentesco(e.target.value)} placeholder="Hermana" className={CAMPO} />
              <datalist id="parentescos">
                {PARENTESCOS.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-1 text-gray-600">
              Motivo del envío
              <select value={motivoId} onChange={(e) => setMotivoId(e.target.value)} className={CAMPO}>
                {prep.motivos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      </div>

      <section className="flex h-fit flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
        <h2 className="font-medium">4. Monto</h2>
        <label className="flex flex-col gap-1 text-gray-600">
          Billetera de donde salen las gourdes
          <select
            value={cuentaId}
            onChange={(e) => {
              setCuentaId(e.target.value)
              guardar('anscito.billeteraEnvio', e.target.value)
            }}
            className={CAMPO}
          >
            {prep.billeteras.length === 0 && <option value="">No hay billeteras en HTG (créelas en Bancos)</option>}
            {prep.billeteras.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nombre}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2 text-sm">
          {(
            [
              ['DOP', 'Escribir en pesos (RD$)'],
              ['HTG', 'Escribir en gourdes (HTG)'],
            ] as const
          ).map(([id, nombre]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setMontoEn(id)
                setMonto('')
              }}
              className={`flex-1 rounded-lg border px-2 py-1.5 ${montoEn === id ? 'border-[#C8102E] bg-red-50 font-medium text-[#C8102E]' : 'border-gray-300 hover:bg-gray-50'}`}
            >
              {nombre}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-gray-600">
          {montoEn === 'HTG' ? 'Gourdes que recibe en Haití (HTG)' : 'Monto que envía (RD$)'}
          <input type="text" inputMode="numeric" value={monto} onChange={(e) => setMonto(e.target.value.replace(/[,\s]/g, ''))} placeholder="0" className={`${CAMPO} text-lg`} />
          {montoEn === 'HTG' && <span className="text-xs text-gray-400">Los pesos se calculan con la tasa y se suben al peso entero.</span>}
        </label>
        <dl className="flex flex-col gap-1 border-y border-gray-100 py-3">
          <div className="flex justify-between"><dt className="text-gray-500">Tasa</dt><dd>1 RD$ = {prep.tarifa.tasa.replace(/\.?0+$/, '')} HTG</dd></div>
          {montoEn === 'HTG' && <div className="flex justify-between text-base font-medium"><dt>Envía (RD$)</dt><dd>{dinero(calculo?.monto_enviado)}</dd></div>}
          <div className="flex justify-between text-base font-medium"><dt>Recibe en Haití</dt><dd>{gourdes(calculo?.monto_recibir)}</dd></div>
          <div className="flex justify-between"><dt className="text-gray-500">Comisión ({prep.tarifa.comision_pct.replace(/\.?0+$/, '')}%)</dt><dd>{dinero(calculo?.comision)}</dd></div>
          <div className="mt-1 flex justify-between text-xl font-medium"><dt>Total a pagar</dt><dd>{dinero(calculo?.total_pagar)}</dd></div>
          {calculo && (
            <div className="flex justify-between text-xs text-gray-500">
              <dt>De la comisión</dt>
              <dd>{agente?.tipo === 'propio' ? 'todo para SCITO' : `agente ${dinero(calculo.comision_agente)} · SCITO ${dinero(calculo.comision_scito)}`}</dd>
            </div>
          )}
        </dl>
        <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} placeholder="Notas (opcional)" className={AREA} />
        {error && <CajaError>{error}</CajaError>}
        <button type="submit" disabled={guardando || !listo} className={`${BOTON_PRINCIPAL} h-12 text-base`}>
          <Send size={18} /> {guardando ? 'Registrando…' : 'Registrar envío'}
        </button>
        {faltan.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {faltan.map((f) => (
              <li key={f}>• {f}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-gray-500">Queda pendiente hasta que el operador de Haití lo realice y lo confirme con el código de la transacción.</p>
      </section>

    </form>
    {/* Fuera del formulario del envío: un formulario no puede ir dentro de otro. */}
    {nuevoCliente && (
      <Ventana titulo="Nuevo cliente (remitente)" onCerrar={() => setNuevoCliente(false)}>
        <FormCliente
          token={token}
          onSesionVencida={onSesionVencida}
          onListo={(c) => {
            setRemitente({ id: c.id, nombre: c.nombre, documento: c.documento, telefono: c.telefono || null })
            setAvisoCliente(`Cliente “${c.nombre}” guardado y elegido como remitente.`)
            setNuevoCliente(false)
          }}
        />
      </Ventana>
    )}
    </>
  )
}

// ---------- Confirmar / rechazar / detalle ----------

function FormConfirmar({ token, envio, onListo, onSesionVencida }: { token: string; envio: FilaEnvio; onListo: () => void; onSesionVencida: () => void }) {
  const [codigo, setCodigo] = useState('')
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void enviar(() => confirmarEnvio(token, envio.id, codigo), onListo)
      }}
      className="flex flex-col gap-3 text-sm"
    >
      <div className="rounded-lg bg-gray-50 p-3">
        <div className="text-2xl font-medium">{gourdes(envio.monto_recibir)}</div>
        <div className="font-medium">{envio.beneficiario_nombre}</div>
        <div className="font-mono text-gray-600">{envio.beneficiario_telefono}</div>
        <div className="text-gray-500">{envio.numero_texto} · desde {envio.billetera} · agente {envio.agente_codigo}</div>
      </div>
      <label className="flex flex-col gap-1 text-gray-600">
        Código de la transacción (NatCash / MonCash)
        <input type="text" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} placeholder="A3154153" className={`${CAMPO} font-mono text-lg`} autoFocus />
      </label>
      <p className="text-xs text-gray-500">Al confirmar, las gourdes salen de la billetera. Envíe la prueba en el grupo de WhatsApp del agente.</p>
      {error && <CajaError>{error}</CajaError>}
      <button type="submit" disabled={guardando || codigo.trim().length < 4} className={BOTON_PRINCIPAL}>
        <CheckCircle2 size={16} /> {guardando ? 'Confirmando…' : 'Confirmar envío'}
      </button>
    </form>
  )
}

function FormRechazar({ token, envio, onListo, onSesionVencida }: { token: string; envio: FilaEnvio; onListo: () => void; onSesionVencida: () => void }) {
  const [motivo, setMotivo] = useState('')
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void enviar(() => rechazarEnvio(token, envio.id, motivo), onListo)
      }}
      className="flex flex-col gap-3 text-sm"
    >
      <p className="text-gray-600">
        {envio.numero_texto} para {envio.beneficiario_nombre} ({gourdes(envio.monto_recibir)}). Al rechazarlo, el agente le devuelve al cliente
        el total ({dinero(envio.total_pagar)}) y no lo debe.
      </p>
      <label className="flex flex-col gap-1 text-gray-600">
        Motivo del rechazo
        <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: número de NatCash equivocado" className={CAMPO} autoFocus />
      </label>
      {error && <CajaError>{error}</CajaError>}
      <button type="submit" disabled={guardando || motivo.trim().length < 5} className={BOTON_PELIGRO}>
        <XCircle size={16} /> {guardando ? 'Rechazando…' : 'Rechazar envío'}
      </button>
    </form>
  )
}

function VerEnvio({ token, id, onSesionVencida }: { token: string; id: string; onSesionVencida: () => void }) {
  const [e, setE] = useState<FilaEnvio | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    detalleEnvio(token, id)
      .then(setE)
      .catch((err) => {
        if (err instanceof SesionVencida) onSesionVencida()
        else setError(mensajeDe(err))
      })
  }, [token, id, onSesionVencida])
  if (!e) return error ? <CajaError>{error}</CajaError> : <div className="text-gray-500">Cargando…</div>
  const fila = (t: string, v: string | null | undefined) => (
    <div className="flex justify-between gap-3">
      <dt className="text-gray-500">{t}</dt>
      <dd className="text-right">{v || '—'}</dd>
    </div>
  )
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-mono text-lg font-medium">{e.numero_texto}</span>
        <EstadoEtiqueta estado={e.estado} />
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {fila('Fecha', fechaHora(e.fecha))}
        {fila('Agente', `${e.agente_codigo} ${e.agente}`)}
        {fila('Remitente', e.remitente_nombre)}
        {fila('Documento', e.remitente_documento && `${e.remitente_tipo_documento ?? ''} ${e.remitente_documento}`)}
        {fila('Beneficiario', e.beneficiario_nombre)}
        {fila('Teléfono', e.beneficiario_telefono)}
        {fila('Parentesco', e.parentesco)}
        {fila('Motivo', e.motivo_envio)}
        {fila('Billetera', e.billetera)}
        {fila('Tasa', `1 RD$ = ${e.tasa.replace(/\.?0+$/, '')} HTG`)}
        {fila('Enviado', dinero(e.monto_enviado))}
        {fila('Recibe', gourdes(e.monto_recibir))}
        {fila('Comisión', dinero(e.comision))}
        {fila('Total pagado', dinero(e.total_pagar))}
        {e.agente_tipo !== 'propio' && fila('Comisión del agente', `${dinero(e.comision_agente)}${e.pago_comision_id ? ' (pagada)' : ''}`)}
        {fila('Registró', e.registrado_por)}
        {e.estado !== 'pendiente' && fila(e.estado === 'confirmado' ? 'Confirmó' : 'Rechazó', `${e.resuelto_por ?? ''} · ${fechaHora(e.resuelto_en)}`)}
        {e.codigo_externo && fila('Código', e.codigo_externo)}
      </dl>
      {e.motivo_rechazo && <div className="rounded-lg bg-red-50 p-2 text-red-800">Motivo del rechazo: {e.motivo_rechazo}</div>}
      {e.notas && <div className="text-gray-500">Notas: {e.notas}</div>}
      <BotonRecibo token={token} id={e.id} onSesionVencida={onSesionVencida} />
    </div>
  )
}

// ---------- Lista de envíos ----------

function ListaEnvios({ token, permisos, prep, version, onCambio, onSesionVencida }: Props & { prep: PrepararEnvios; version: number; onCambio: () => void }) {
  const [filtros, setFiltros] = useState<FiltrosEnvios>({ estado: 'pendiente', agenteId: '', desde: '', hasta: '', texto: '', pagina: 1 })
  const [datos, setDatos] = useState<PaginaEnvios | null>(null)
  const [error, setError] = useState('')
  const [accion, setAccion] = useState<{ tipo: 'ver' | 'confirmar' | 'rechazar'; envio: FilaEnvio } | null>(null)
  const puedeConfirmar = permisos.includes('remesas.confirmar')

  const cargar = useCallback(async () => {
    try {
      setDatos(await listarEnvios(token, filtros))
      setError('')
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, filtros, onSesionVencida])

  // Se actualiza al entrar y cada 30 segundos (llegan envíos nuevos).
  useEffect(() => {
    const primera = setTimeout(() => void cargar(), 0)
    const cada = setInterval(() => void cargar(), 30_000)
    return () => {
      clearTimeout(primera)
      clearInterval(cada)
    }
  }, [cargar, version])

  const paginas = datos ? Math.max(1, Math.ceil(datos.total / datos.porPagina)) : 1
  function listo() {
    setAccion(null)
    onCambio()
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Estado
          <select value={filtros.estado} onChange={(e) => setFiltros({ ...filtros, estado: e.target.value as FiltrosEnvios['estado'], pagina: 1 })} className={CAMPO}>
            <option value="pendiente">Pendientes</option>
            <option value="confirmado">Confirmados</option>
            <option value="rechazado">Rechazados</option>
            <option value="todos">Todos</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Agente
          <select value={filtros.agenteId} onChange={(e) => setFiltros({ ...filtros, agenteId: e.target.value, pagina: 1 })} className={CAMPO}>
            <option value="">Todos</option>
            {prep.agentes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.codigo} · {a.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Desde
          <input type="date" value={filtros.desde} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value, pagina: 1 })} className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Hasta
          <input type="date" value={filtros.hasta} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value, pagina: 1 })} className={CAMPO} />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs text-gray-500">
          Buscar
          <input type="search" value={filtros.texto} onChange={(e) => setFiltros({ ...filtros, texto: e.target.value, pagina: 1 })} placeholder="Nombre, E-000001 o código" className={CAMPO} />
        </label>
        <button type="button" onClick={() => void cargar()} className="rounded-lg p-2.5 text-gray-500 hover:bg-gray-100" aria-label="Actualizar" title="Actualizar">
          <RefreshCw size={16} />
        </button>
      </div>
      {error && <CajaError>{error}</CajaError>}
      {datos && filtros.estado !== 'pendiente' && filtros.estado !== 'rechazado' && (
        <p className="text-sm text-gray-500">
          {datos.total} envío(s) · confirmados: enviado {dinero(datos.resumen.enviado)}, comisión {dinero(datos.resumen.comision)}, cobrado {dinero(datos.resumen.total)}
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">Envío</th>
              <th className="px-3 py-2 font-medium">Agente</th>
              <th className="px-3 py-2 font-medium">Beneficiario</th>
              <th className="px-3 py-2 text-right font-medium">Recibe</th>
              <th className="px-3 py-2 text-right font-medium">Pagado</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {datos?.filas.map((f) => (
              <tr key={f.id} className="border-t border-gray-100 align-top">
                <td className="px-3 py-2">
                  <span className="font-mono">{f.numero_texto}</span>
                  <span className="block text-xs text-gray-500">{fechaHora(f.fecha)}</span>
                </td>
                <td className="px-3 py-2">{f.agente_codigo}<span className="block text-xs text-gray-500">{f.agente}</span></td>
                <td className="px-3 py-2">
                  {f.beneficiario_nombre}
                  <span className="block font-mono text-xs text-gray-500">{f.beneficiario_telefono}</span>
                  <span className="block text-xs text-gray-400">de {f.remitente_nombre}</span>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap font-medium">{gourdes(f.monto_recibir)}<span className="block text-xs font-normal text-gray-500">{f.billetera}</span></td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{dinero(f.total_pagar)}</td>
                <td className="px-3 py-2">
                  <EstadoEtiqueta estado={f.estado} />
                  {f.codigo_externo && <span className="block font-mono text-xs text-gray-500">{f.codigo_externo}</span>}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {f.estado === 'pendiente' && puedeConfirmar && (
                    <>
                      <button type="button" onClick={() => setAccion({ tipo: 'confirmar', envio: f })} className="mr-1 rounded-lg bg-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-green-800">
                        Confirmar
                      </button>
                      <button type="button" onClick={() => setAccion({ tipo: 'rechazar', envio: f })} className="mr-1 rounded-lg border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50">
                        Rechazar
                      </button>
                    </>
                  )}
                  <button type="button" onClick={() => setAccion({ tipo: 'ver', envio: f })} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" aria-label={`Ver ${f.numero_texto}`} title="Ver">
                    <Eye size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {datos && datos.filas.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">No hay envíos con esos filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {datos && paginas > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button type="button" disabled={filtros.pagina <= 1} onClick={() => setFiltros({ ...filtros, pagina: filtros.pagina - 1 })} className="rounded-lg p-2 hover:bg-gray-100 disabled:opacity-40" aria-label="Página anterior"><ChevronLeft size={16} /></button>
          Página {filtros.pagina} de {paginas}
          <button type="button" disabled={filtros.pagina >= paginas} onClick={() => setFiltros({ ...filtros, pagina: filtros.pagina + 1 })} className="rounded-lg p-2 hover:bg-gray-100 disabled:opacity-40" aria-label="Página siguiente"><ChevronRight size={16} /></button>
        </div>
      )}
      {accion?.tipo === 'ver' && (
        <Ventana titulo="Detalle del envío" ancho="max-w-2xl" onCerrar={() => setAccion(null)}>
          <VerEnvio token={token} id={accion.envio.id} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
      {accion?.tipo === 'confirmar' && (
        <Ventana titulo={`Confirmar ${accion.envio.numero_texto}`} onCerrar={() => setAccion(null)}>
          <FormConfirmar token={token} envio={accion.envio} onListo={listo} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
      {accion?.tipo === 'rechazar' && (
        <Ventana titulo={`Rechazar ${accion.envio.numero_texto}`} onCerrar={() => setAccion(null)}>
          <FormRechazar token={token} envio={accion.envio} onListo={listo} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
    </div>
  )
}

// ---------- Agentes: entregas y comisiones ----------

function OrigenDinero({
  prep,
  forma,
  cajaId,
  setCajaId,
  cuentaId,
  setCuentaId,
}: {
  prep: PrepararEnvios
  forma: 'efectivo' | 'banco'
  cajaId: string
  setCajaId: (v: string) => void
  cuentaId: string
  setCuentaId: (v: string) => void
}) {
  const cajas = prep.cajas.filter((c) => c.sesion_id)
  return forma === 'efectivo' ? (
    <label className="flex flex-col gap-1 text-gray-600">
      Caja (abierta)
      <select value={cajaId} onChange={(e) => setCajaId(e.target.value)} className={CAMPO}>
        <option value="">Seleccione…</option>
        {cajas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </select>
      {cajas.length === 0 && <span className="text-xs text-amber-800">No hay cajas abiertas: abra una en Caja.</span>}
    </label>
  ) : (
    <label className="flex flex-col gap-1 text-gray-600">
      Cuenta (RD$)
      <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} className={CAMPO}>
        <option value="">Seleccione…</option>
        {prep.cuentasPesos.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </select>
    </label>
  )
}

function FormEntrega({ token, prep, agente, dia, onListo, onSesionVencida }: { token: string; prep: PrepararEnvios; agente: ReporteDiaAgente; dia: string; onListo: () => void; onSesionVencida: () => void }) {
  const [monto, setMonto] = useState(agente.saldo_total.startsWith('-') ? '' : agente.saldo_total)
  const [forma, setForma] = useState<'efectivo' | 'deposito'>('efectivo')
  const local = cajaDeEstaComputadora()
  const [cajaId, setCajaId] = useState(prep.cajas.some((c) => c.id === local && c.sesion_id) ? (local ?? '') : '')
  const [cuentaId, setCuentaId] = useState('')
  const [referencia, setReferencia] = useState('')
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void enviar(
          () =>
            registrarEntregaAgente(token, {
              agenteId: agente.id,
              dia,
              monto: monto.trim(),
              forma,
              cajaId: forma === 'efectivo' ? cajaId : undefined,
              cuentaId: forma === 'deposito' ? cuentaId : undefined,
              referencia: referencia.trim() || undefined,
            }),
          onListo,
        )
      }}
      className="flex flex-col gap-3 text-sm"
    >
      <p className="text-gray-600">
        {agente.codigo} {agente.nombre} debe en total <span className="font-medium">{dinero(agente.saldo_total)}</span>
        {agente.a_entregar !== '0.00' && ` (del día ${fechaCorta(dia)}: ${dinero(agente.a_entregar)})`}.
      </p>
      <div className="flex gap-2">
        {(
          [
            ['efectivo', 'Trae el efectivo'],
            ['deposito', 'Depositó en una cuenta'],
          ] as const
        ).map(([v, t]) => (
          <button key={v} type="button" onClick={() => setForma(v)} className={`flex-1 rounded-lg border px-3 py-2 ${forma === v ? 'border-[#C8102E] bg-red-50 font-medium text-[#C8102E]' : 'border-gray-300 hover:bg-gray-50'}`}>
            {t}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-gray-600">
        Monto que entrega (RD$)
        <input type="text" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} className={`${CAMPO} text-lg`} autoFocus />
      </label>
      <OrigenDinero prep={prep} forma={forma === 'efectivo' ? 'efectivo' : 'banco'} cajaId={cajaId} setCajaId={setCajaId} cuentaId={cuentaId} setCuentaId={setCuentaId} />
      <label className="flex flex-col gap-1 text-gray-600">
        Referencia (opcional)
        <input type="text" value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder={forma === 'deposito' ? 'Número de la boleta' : ''} className={CAMPO} />
      </label>
      {forma === 'deposito' && <p className="text-xs text-gray-500">El depósito queda “por confirmar” en Bancos hasta verlo en el estado de cuenta.</p>}
      {error && <CajaError>{error}</CajaError>}
      <button type="submit" disabled={guardando || !positivo(monto) || (forma === 'efectivo' ? !cajaId : !cuentaId)} className={BOTON_PRINCIPAL}>
        <Banknote size={16} /> {guardando ? 'Guardando…' : 'Registrar entrega'}
      </button>
    </form>
  )
}

function FormPagoComision({ token, prep, agente, onListo, onSesionVencida }: { token: string; prep: PrepararEnvios; agente: CuentaAgente; onListo: () => void; onSesionVencida: () => void }) {
  const [hasta, setHasta] = useState(hoy())
  const [forma, setForma] = useState<'efectivo' | 'banco'>('efectivo')
  const local = cajaDeEstaComputadora()
  const [cajaId, setCajaId] = useState(prep.cajas.some((c) => c.id === local && c.sesion_id) ? (local ?? '') : '')
  const [cuentaId, setCuentaId] = useState('')
  const [referencia, setReferencia] = useState('')
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void enviar(
          () =>
            pagarComisionesAgente(token, {
              agenteId: agente.id,
              hasta,
              forma,
              cajaId: forma === 'efectivo' ? cajaId : undefined,
              cuentaId: forma === 'banco' ? cuentaId : undefined,
              referencia: referencia.trim() || undefined,
            }),
          onListo,
        )
      }}
      className="flex flex-col gap-3 text-sm"
    >
      <p className="text-gray-600">
        {agente.codigo} {agente.nombre} tiene <span className="font-medium">{dinero(agente.comision_pendiente)}</span> de comisión sin pagar ({agente.envios_sin_pagar} envíos). Pago{' '}
        {agente.frecuencia_pago}
        {agente.ultimo_pago && `; último pago hasta el ${fechaCorta(agente.ultimo_pago)}`}.
      </p>
      <label className="flex flex-col gap-1 text-gray-600">
        Pagar los envíos confirmados hasta el día
        <input type="date" value={hasta} max={hoy()} onChange={(e) => setHasta(e.target.value)} className={CAMPO} />
      </label>
      <div className="flex gap-2">
        {(
          [
            ['efectivo', 'Efectivo de caja'],
            ['banco', 'Desde una cuenta'],
          ] as const
        ).map(([v, t]) => (
          <button key={v} type="button" onClick={() => setForma(v)} className={`flex-1 rounded-lg border px-3 py-2 ${forma === v ? 'border-[#C8102E] bg-red-50 font-medium text-[#C8102E]' : 'border-gray-300 hover:bg-gray-50'}`}>
            {t}
          </button>
        ))}
      </div>
      <OrigenDinero prep={prep} forma={forma} cajaId={cajaId} setCajaId={setCajaId} cuentaId={cuentaId} setCuentaId={setCuentaId} />
      <label className="flex flex-col gap-1 text-gray-600">
        Referencia (opcional)
        <input type="text" value={referencia} onChange={(e) => setReferencia(e.target.value)} className={CAMPO} />
      </label>
      <p className="text-xs text-gray-500">Se registra como gasto “Comisiones de agentes de envíos”.</p>
      {error && <CajaError>{error}</CajaError>}
      <button type="submit" disabled={guardando || (forma === 'efectivo' ? !cajaId : !cuentaId)} className={BOTON_PRINCIPAL}>
        {guardando ? 'Pagando…' : 'Pagar comisión'}
      </button>
    </form>
  )
}

function VerMovimientosAgente({ token, id, onSesionVencida }: { token: string; id: string; onSesionVencida: () => void }) {
  const [d, setD] = useState<MovimientosAgente | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    movimientosAgente(token, id)
      .then(setD)
      .catch((e) => {
        if (e instanceof SesionVencida) onSesionVencida()
        else setError(mensajeDe(e))
      })
  }, [token, id, onSesionVencida])
  if (!d) return error ? <CajaError>{error}</CajaError> : <div className="text-gray-500">Cargando…</div>
  const a = d.agente
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 sm:grid-cols-4">
        <div><div className="text-xs text-gray-500">Cobrado (confirmados)</div><div className="font-medium">{dinero(a.cobrado)}</div></div>
        <div><div className="text-xs text-gray-500">Entregado</div><div className="font-medium">{dinero(a.entregado)}</div></div>
        <div><div className="text-xs text-gray-500">Debe</div><div className={`font-medium ${a.debe !== '0.00' ? 'text-red-700' : ''}`}>{dinero(a.debe)}</div></div>
        <div><div className="text-xs text-gray-500">Comisión sin pagar</div><div className="font-medium">{dinero(a.comision_pendiente)}</div></div>
      </div>
      <section>
        <h3 className="mb-1 font-medium">Entregas</h3>
        {d.entregas.length === 0 ? (
          <p className="text-gray-400">Todavía no hay entregas.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {d.entregas.map((e) => (
              <li key={e.id} className="flex justify-between gap-2 border-t border-gray-100 pt-1">
                <span>
                  Día {fechaCorta(e.dia)} · {e.forma === 'efectivo' ? 'efectivo' : 'depósito'}
                  {e.referencia && ` · ${e.referencia}`}
                  <span className="block text-xs text-gray-400">{e.usuario} · {fechaHora(e.created_at)}</span>
                </span>
                <span className="font-medium">{dinero(e.monto)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {a.tipo === 'autorizado' && (
        <section>
          <h3 className="mb-1 font-medium">Pagos de comisión</h3>
          {d.pagos.length === 0 ? (
            <p className="text-gray-400">Todavía no hay pagos.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {d.pagos.map((p) => (
                <li key={p.id} className="flex justify-between gap-2 border-t border-gray-100 pt-1">
                  <span>
                    {fechaCorta(p.desde)} a {fechaCorta(p.hasta)} · {p.cantidad} envíos · {p.forma === 'efectivo' ? 'efectivo' : 'banco'}
                    <span className="block text-xs text-gray-400">{p.usuario} · {fechaHora(p.created_at)}</span>
                  </span>
                  <span className="font-medium">{dinero(p.monto)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

function Agentes({ token, permisos, prep, version, onCambio, onSesionVencida }: Props & { prep: PrepararEnvios; version: number; onCambio: () => void }) {
  const [dia, setDia] = useState(hoy())
  const [reporte, setReporte] = useState<ReporteDiaAgente[] | null>(null)
  const [cuentas, setCuentas] = useState<CuentaAgente[]>([])
  const [error, setError] = useState('')
  const [accion, setAccion] = useState<{ tipo: 'entrega' | 'comision' | 'ver'; id: string } | null>(null)

  const cargar = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([reporteDiaEnvios(token, dia), cuentasAgentes(token)])
      setReporte(r.agentes)
      setCuentas(c)
      setError('')
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, dia, onSesionVencida])

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0)
    return () => clearTimeout(t)
  }, [cargar, version])

  function listo() {
    setAccion(null)
    onCambio()
  }

  const cuenta = (id: string) => cuentas.find((c) => c.id === id)
  const filaReporte = accion ? reporte?.find((r) => r.id === accion.id) : undefined
  const totalEntregar = (reporte ?? []).reduce((s, r) => s + BigInt(r.saldo_total.replace('.', '').replace('-', '')) * (r.saldo_total.startsWith('-') ? -1n : 1n), 0n)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Día
          <input type="date" value={dia} max={hoy()} onChange={(e) => setDia(e.target.value || hoy())} className={CAMPO} />
        </label>
        <div className="text-sm text-gray-600">
          Total que deben los agentes: <span className="font-medium">{dinero(`${totalEntregar / 100n}.${String((totalEntregar < 0n ? -totalEntregar : totalEntregar) % 100n).padStart(2, '0')}`)}</span>
        </div>
      </div>
      {error && <CajaError>{error}</CajaError>}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">Agente</th>
              <th className="px-3 py-2 text-right font-medium">Envíos del día</th>
              <th className="px-3 py-2 text-right font-medium">A entregar (día)</th>
              <th className="px-3 py-2 text-right font-medium">Entregado (día)</th>
              <th className="px-3 py-2 text-right font-medium">Debe en total</th>
              <th className="px-3 py-2 text-right font-medium">Comisión sin pagar</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {reporte?.map((r) => {
              const c = cuenta(r.id)
              const debe = r.saldo_total !== '0.00'
              return (
                <tr key={r.id} className="border-t border-gray-100 align-top">
                  <td className="px-3 py-2">{r.codigo}<span className="block text-xs text-gray-500">{r.nombre}{r.tipo === 'propio' && ' (propio)'}</span></td>
                  <td className="px-3 py-2 text-right">
                    {r.confirmados}
                    {(r.pendientes > 0 || r.rechazados > 0) && <span className="block text-xs text-gray-500">{r.pendientes} pend. · {r.rechazados} rech.</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{dinero(r.a_entregar)}</td>
                  <td className="px-3 py-2 text-right">{dinero(r.entregado)}</td>
                  <td className={`px-3 py-2 text-right font-medium ${debe ? 'text-red-700' : 'text-green-700'}`}>{dinero(r.saldo_total)}</td>
                  <td className="px-3 py-2 text-right">{r.tipo === 'propio' ? '—' : dinero(c?.comision_pendiente ?? '0.00')}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {debe && (
                      <button type="button" onClick={() => setAccion({ tipo: 'entrega', id: r.id })} className="mr-1 rounded-lg bg-[#C8102E] px-2 py-1 text-xs font-medium text-white hover:bg-[#a80d26]">
                        Entrega
                      </button>
                    )}
                    {r.tipo === 'autorizado' && c && c.comision_pendiente !== '0.00' && permisos.includes('remesas.comisiones') && (
                      <button type="button" onClick={() => setAccion({ tipo: 'comision', id: r.id })} className="mr-1 rounded-lg border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">
                        Pagar comisión
                      </button>
                    )}
                    <button type="button" onClick={() => setAccion({ tipo: 'ver', id: r.id })} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" aria-label={`Movimientos de ${r.codigo}`} title="Movimientos">
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">
        “A entregar” cuenta solo los envíos confirmados. El punto propio entrega lo cobrado en la oficina a la Caja antes de cerrarla.
      </p>
      {accion?.tipo === 'entrega' && filaReporte && (
        <Ventana titulo={`Entrega de ${filaReporte.codigo}`} onCerrar={() => setAccion(null)}>
          <FormEntrega token={token} prep={prep} agente={filaReporte} dia={dia} onListo={listo} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
      {accion?.tipo === 'comision' && cuenta(accion.id) && (
        <Ventana titulo="Pagar comisión" onCerrar={() => setAccion(null)}>
          <FormPagoComision token={token} prep={prep} agente={cuenta(accion.id) as CuentaAgente} onListo={listo} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
      {accion?.tipo === 'ver' && (
        <Ventana titulo="Cuenta del agente" ancho="max-w-2xl" onCerrar={() => setAccion(null)}>
          <VerMovimientosAgente token={token} id={accion.id} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
    </div>
  )
}

// ---------- Configuración: tasa y agentes ----------

function FormTarifa({ token, actual, onListo, onSesionVencida }: { token: string; actual: PrepararEnvios['tarifa']; onListo: () => void; onSesionVencida: () => void }) {
  const limpio = (v: string) => v.replace(/\.?0+$/, '')
  const [tasa, setTasa] = useState(limpio(actual.tasa))
  const [pct, setPct] = useState(limpio(actual.comision_pct))
  const [pctAgente, setPctAgente] = useState(limpio(actual.comision_agente_pct))
  const [motivo, setMotivo] = useState('')
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void enviar(() => nuevaTarifa(token, { tasa, comisionPct: pct, comisionAgentePct: pctAgente, motivo }), onListo)
      }}
      className="flex flex-col gap-3 text-sm"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-gray-600">
          Tasa (HTG por 1 RD$)
          <input type="text" inputMode="decimal" value={tasa} onChange={(e) => setTasa(e.target.value)} className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1 text-gray-600">
          Comisión del cliente (%)
          <input type="text" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1 text-gray-600">
          Parte del agente (%)
          <input type="text" inputMode="decimal" value={pctAgente} onChange={(e) => setPctAgente(e.target.value)} className={CAMPO} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-gray-600">
        Motivo del cambio
        <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: subió el gourde" className={CAMPO} />
      </label>
      <p className="text-xs text-gray-500">Se aplica a los envíos que se registren desde ahora; los anteriores conservan su tasa.</p>
      {error && <CajaError>{error}</CajaError>}
      <button type="submit" disabled={guardando || motivo.trim().length < 5} className={BOTON_PRINCIPAL}>
        {guardando ? 'Guardando…' : 'Guardar nueva tasa'}
      </button>
    </form>
  )
}

function FormAgente({ token, agente, onListo, onSesionVencida }: { token: string; agente: FilaAgente | null; onListo: () => void; onSesionVencida: () => void }) {
  const [codigo, setCodigo] = useState('')
  const [nombre, setNombre] = useState(agente?.nombre ?? '')
  const [telefono, setTelefono] = useState(agente?.telefono ?? '')
  const [tipo, setTipo] = useState<'propio' | 'autorizado'>(agente?.tipo ?? 'autorizado')
  const [frecuencia, setFrecuencia] = useState(agente?.frecuencia_pago ?? 'semanal')
  const [grupo, setGrupo] = useState(agente?.grupo_whatsapp ?? '')
  const [notas, setNotas] = useState(agente?.notas ?? '')
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const datos = { nombre, telefono, tipo, frecuenciaPago: tipo === 'autorizado' ? frecuencia : '', grupoWhatsapp: grupo, notas }
        void enviar(() => (agente ? editarAgente(token, agente.id, datos) : crearAgente(token, { ...datos, codigo })), onListo)
      }}
      className="flex flex-col gap-3 text-sm"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!agente && (
          <label className="flex flex-col gap-1 text-gray-600">
            Código
            <input type="text" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} placeholder="SC-014" className={`${CAMPO} font-mono`} autoFocus />
          </label>
        )}
        <label className="flex flex-col gap-1 text-gray-600">
          Nombre
          <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1 text-gray-600">
          Teléfono
          <input type="text" value={telefono} onChange={(e) => setTelefono(e.target.value)} className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1 text-gray-600">
          Grupo de WhatsApp
          <input type="text" value={grupo} onChange={(e) => setGrupo(e.target.value)} className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1 text-gray-600">
          Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value as 'propio' | 'autorizado')} className={CAMPO}>
            <option value="autorizado">Agente autorizado (gana comisión)</option>
            <option value="propio">Punto propio de SCITO (sin comisión)</option>
          </select>
        </label>
        {tipo === 'autorizado' && (
          <label className="flex flex-col gap-1 text-gray-600">
            Pago de comisión
            <select value={frecuencia} onChange={(e) => setFrecuencia(e.target.value as 'semanal' | 'quincenal' | 'mensual')} className={CAMPO}>
              <option value="semanal">Semanal</option>
              <option value="quincenal">Quincenal</option>
              <option value="mensual">Mensual</option>
            </select>
          </label>
        )}
      </div>
      <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} placeholder="Notas (opcional)" className={AREA} />
      {error && <CajaError>{error}</CajaError>}
      <button type="submit" disabled={guardando || !nombre.trim() || (!agente && !codigo.trim())} className={BOTON_PRINCIPAL}>
        {guardando ? 'Guardando…' : agente ? 'Guardar' : 'Crear agente'}
      </button>
    </form>
  )
}

function FormEstadoAgente({ token, agente, onListo, onSesionVencida }: { token: string; agente: FilaAgente; onListo: () => void; onSesionVencida: () => void }) {
  const [motivo, setMotivo] = useState('')
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  const desactivar = agente.is_active
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void enviar(() => estadoAgente(token, agente.id, !desactivar, desactivar ? motivo : undefined), onListo)
      }}
      className="flex flex-col gap-3 text-sm"
    >
      <p className="text-gray-600">
        {desactivar
          ? `${agente.nombre} dejará de aparecer para registrar envíos. Solo se puede si no tiene envíos pendientes, dinero por entregar ni comisiones sin pagar.`
          : `${agente.nombre} volverá a estar disponible.`}
      </p>
      {desactivar && (
        <label className="flex flex-col gap-1 text-gray-600">
          Motivo
          <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} className={CAMPO} autoFocus />
        </label>
      )}
      {error && <CajaError>{error}</CajaError>}
      <button type="submit" disabled={guardando || (desactivar && motivo.trim().length < 5)} className={desactivar ? BOTON_PELIGRO : BOTON_PRINCIPAL}>
        {desactivar && <AlertTriangle size={16} />}
        {guardando ? 'Guardando…' : desactivar ? 'Desactivar' : 'Activar'}
      </button>
    </form>
  )
}

function Configuracion({ token, permisos, prep, version, onCambio, onSesionVencida }: Props & { prep: PrepararEnvios; version: number; onCambio: () => void }) {
  const [tarifas, setTarifas] = useState<FilaTarifa[]>([])
  const [agentes, setAgentes] = useState<FilaAgente[]>([])
  const [error, setError] = useState('')
  const [modal, setModal] = useState<{ tipo: 'tarifa' } | { tipo: 'agente'; agente: FilaAgente | null } | { tipo: 'estado'; agente: FilaAgente } | null>(null)
  const [verInactivos, setVerInactivos] = useState(false)
  const gestionar = permisos.includes('remesas.gestionar')

  const cargar = useCallback(async () => {
    try {
      const [t, a] = await Promise.all([listarTarifas(token), listarAgentes(token)])
      setTarifas(t)
      setAgentes(a)
      setError('')
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, onSesionVencida])

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0)
    return () => clearTimeout(t)
  }, [cargar, version])

  function listo() {
    setModal(null)
    onCambio()
  }
  const inactivos = agentes.filter((a) => !a.is_active).length
  const visibles = verInactivos ? agentes : agentes.filter((a) => a.is_active)
  const t = prep.tarifa

  return (
    <div className="flex flex-col gap-4">
      {error && <CajaError>{error}</CajaError>}
      <section className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-medium">Tasa y comisiones vigentes</h2>
            <p className="text-gray-600">
              1 RD$ = <span className="font-medium">{t.tasa.replace(/\.?0+$/, '')} HTG</span> · comisión{' '}
              <span className="font-medium">{t.comision_pct.replace(/\.?0+$/, '')}%</span> · agente{' '}
              <span className="font-medium">{t.comision_agente_pct.replace(/\.?0+$/, '')}%</span> de la comisión
            </p>
          </div>
          {permisos.includes('remesas.tarifas') && (
            <button type="button" onClick={() => setModal({ tipo: 'tarifa' })} className={BOTON_PRINCIPAL}>
              Cambiar tasa
            </button>
          )}
        </div>
        <ul className="flex flex-col gap-1 text-xs text-gray-500">
          {tarifas.slice(0, 8).map((x) => (
            <li key={x.id}>
              {fechaHora(x.vigente_desde)}: {x.tasa.replace(/\.?0+$/, '')} HTG · {x.comision_pct.replace(/\.?0+$/, '')}% · agente {x.comision_agente_pct.replace(/\.?0+$/, '')}%
              {x.motivo && ` — ${x.motivo}`}
              {x.usuario && ` (${x.usuario})`}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Agentes</h2>
          <div className="flex items-center gap-3">
            {inactivos > 0 && (
              <button type="button" onClick={() => setVerInactivos(!verInactivos)} className="text-sm text-gray-500 hover:underline">
                {verInactivos ? 'Ocultar inactivos' : `Mostrar inactivos (${inactivos})`}
              </button>
            )}
            {gestionar && (
              <button type="button" onClick={() => setModal({ tipo: 'agente', agente: null })} className={BOTON_SECUNDARIO}>
                <span className="inline-flex items-center gap-2"><Plus size={16} /> Nuevo agente</span>
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-xs text-gray-500">
              <tr>
                <th className="py-1 pr-2 font-medium">Código</th>
                <th className="py-1 pr-2 font-medium">Nombre</th>
                <th className="py-1 pr-2 font-medium">Teléfono</th>
                <th className="py-1 pr-2 font-medium">Tipo</th>
                <th className="py-1 pr-2 font-medium">Comisión</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {visibles.map((a) => (
                <tr key={a.id} className={`border-t border-gray-100 ${a.is_active ? '' : 'text-gray-400'}`}>
                  <td className="py-1.5 pr-2 font-mono">{a.codigo}</td>
                  <td className="py-1.5 pr-2">{a.nombre}{a.grupo_whatsapp && <span className="block text-xs text-gray-400">{a.grupo_whatsapp}</span>}</td>
                  <td className="py-1.5 pr-2">{a.telefono ?? '—'}</td>
                  <td className="py-1.5 pr-2">{a.tipo === 'propio' ? 'Punto propio' : 'Autorizado'}</td>
                  <td className="py-1.5 pr-2">{a.frecuencia_pago ?? '—'}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    {gestionar && (
                      <>
                        <button type="button" onClick={() => setModal({ tipo: 'agente', agente: a })} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" aria-label={`Editar ${a.codigo}`} title="Editar">
                          <Pencil size={16} />
                        </button>
                        <button type="button" onClick={() => setModal({ tipo: 'estado', agente: a })} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" aria-label={a.is_active ? `Desactivar ${a.codigo}` : `Activar ${a.codigo}`} title={a.is_active ? 'Desactivar' : 'Activar'}>
                          <Power size={16} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {modal?.tipo === 'tarifa' && (
        <Ventana titulo="Cambiar tasa y comisiones" ancho="max-w-xl" onCerrar={() => setModal(null)}>
          <FormTarifa token={token} actual={t} onListo={listo} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
      {modal?.tipo === 'agente' && (
        <Ventana titulo={modal.agente ? `Editar ${modal.agente.codigo}` : 'Nuevo agente'} ancho="max-w-xl" onCerrar={() => setModal(null)}>
          <FormAgente token={token} agente={modal.agente} onListo={listo} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
      {modal?.tipo === 'estado' && (
        <Ventana titulo={modal.agente.is_active ? `Desactivar ${modal.agente.codigo}` : `Activar ${modal.agente.codigo}`} onCerrar={() => setModal(null)}>
          <FormEstadoAgente token={token} agente={modal.agente} onListo={listo} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
    </div>
  )
}

// ---------- Página ----------

type Seccion = 'nuevo' | 'envios' | 'agentes' | 'config'

export default function Envios(props: Props) {
  const { token, permisos, onSesionVencida } = props
  const pestanas: [Seccion, string, boolean][] = [
    ['nuevo', 'Nuevo envío', permisos.includes('remesas.registrar')],
    ['envios', 'Envíos', true],
    ['agentes', 'Agentes: entregas y comisiones', permisos.includes('remesas.entregas')],
    ['config', 'Tasa y agentes', permisos.includes('remesas.gestionar') || permisos.includes('remesas.tarifas')],
  ]
  const visibles = pestanas.filter(([, , ver]) => ver)
  const [seccion, setSeccion] = useState<Seccion>(visibles[0][0])
  const [prep, setPrep] = useState<PrepararEnvios | null>(null)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)

  const cargar = useCallback(async () => {
    try {
      setPrep(await prepararEnvios(token))
      setError('')
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, onSesionVencida])

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0)
    return () => clearTimeout(t)
  }, [cargar, version])

  const cambio = () => setVersion((v) => v + 1)

  return (
    <div>
      <div className="mb-4">
        <h1 className="mb-1 text-xl font-medium">SCITO TRANSFER</h1>
        <p className="text-sm text-gray-500">
          NatCash / MonCash. El envío queda pendiente hasta que el operador de Haití lo realiza y lo confirma con el código de la transacción.
        </p>
      </div>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-gray-200">
        {visibles.map(([id, nombre]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSeccion(id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${seccion === id ? 'border-[#C8102E] font-medium text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
          >
            {nombre}
          </button>
        ))}
      </div>
      {error && <div className="mb-3"><CajaError>{error}</CajaError></div>}
      {!prep ? (
        !error && <div className="text-gray-500">Cargando…</div>
      ) : seccion === 'nuevo' ? (
        <NuevoEnvio {...props} prep={prep} onRegistrado={cambio} />
      ) : seccion === 'envios' ? (
        <ListaEnvios {...props} prep={prep} version={version} onCambio={cambio} />
      ) : seccion === 'agentes' ? (
        <Agentes {...props} prep={prep} version={version} onCambio={cambio} />
      ) : (
        <Configuracion {...props} prep={prep} version={version} onCambio={cambio} />
      )}
    </div>
  )
}
