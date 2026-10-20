import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FileDown,
  FileSignature,
  HandCoins,
  Pencil,
  Play,
  Plus,
  Printer,
  RefreshCw,
  Search,
  UserMinus,
  UserPlus,
  XCircle,
} from 'lucide-react'
import {
  SesionVencida,
  asignarNumeroSan,
  atrasadosSan,
  buscarClientesSan,
  cobrarSan,
  configurarSanes,
  crearSan,
  cuentaSan,
  descargarSan,
  detalleSan,
  editarSan,
  entregarSan,
  estadoSan,
  fichaSan,
  fechaTurnoSan,
  listarSanes,
  pdfSan,
  prepararSanes,
  previaEntregaSan,
  quitarNumeroSan,
  sanesDePersona,
  ticketSan,
} from './api'
import type {
  AtrasadoSan,
  ClienteSan,
  CuentaSan,
  DatosSan,
  DetalleSan,
  EstadoSan,
  FilaSan,
  FrecuenciaSan,
  ParticipacionSan,
  PrepararSanes,
  PreviaEntregaSan,
} from './api'
import BotonesImprimir from './BotonesImprimir'
import { cajaDeEstaComputadora } from './cajaLocal'
import { FichaVista, FormPersona, GenerarContrato, Plantillas } from './SanFicha'
import { abrirArchivo } from './sanArchivos'
import {
  AREA,
  BOTON_PELIGRO,
  BOTON_PRINCIPAL,
  BOTON_SECUNDARIO,
  CAMPO,
  CajaError,
  Ventana,
} from './componentes'
import { dinero, mensajeDe, porcentaje } from './formato'

// SAN administrado por SCITO: cobrar cuotas en la oficina, armar los SAN
// (números y turnos), entregar la mano y ver quién está atrasado.

type Props = {
  token: string
  permisos: string[]
  onSesionVencida: () => void
}

type Pestana = 'cobrar' | 'sanes' | 'atrasados' | 'contratos' | 'config'

const FRECUENCIAS: [FrecuenciaSan, string][] = [
  ['semanal', 'Semanal (cada 7 días)'],
  ['quincenal', 'Quincenal (días 15 y 30)'],
  ['mensual', 'Mensual (mismo día cada mes)'],
]

const NOMBRE_FRECUENCIA: Record<FrecuenciaSan, string> = {
  semanal: 'Semanal',
  quincenal: 'Quincenal',
  mensual: 'Mensual',
}

const NOMBRE_ESTADO: Record<EstadoSan, string> = {
  preparacion: 'En preparación',
  activo: 'Activo',
  terminado: 'Terminado',
  cancelado: 'Cancelado',
}

const COLOR_ESTADO: Record<EstadoSan, string> = {
  preparacion: 'bg-amber-100 text-amber-800',
  activo: 'bg-green-100 text-green-800',
  terminado: 'bg-gray-100 text-gray-700',
  cancelado: 'bg-red-100 text-red-800',
}

// ---------- Utilidades ----------

// Dinero con enteros (centavos) para sumar en pantalla sin errores.
function centavos(v: string): bigint {
  const neg = v.startsWith('-')
  const [e, d = ''] = (neg ? v.slice(1) : v).split('.')
  const c = BigInt(e || '0') * 100n + BigInt((d + '00').slice(0, 2))
  return neg ? -c : c
}

function texto2(c: bigint): string {
  const neg = c < 0n
  const a = neg ? -c : c
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`
}

function fechaCorta(dia: string | null | undefined): string {
  if (!dia) return '—'
  const [a, m, d] = dia.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

function hoy(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date())
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

function EstadoEtiqueta({ estado }: { estado: EstadoSan }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${COLOR_ESTADO[estado]}`}>
      {NOMBRE_ESTADO[estado]}
    </span>
  )
}

function parteTexto(parte: string) {
  return parte === 'medio' ? ' (medio)' : ''
}

// ---------- Recibos en PDF ----------

function Imprimir({
  token,
  tipo,
  id,
  texto = 'Imprimir',
  onSesionVencida,
}: {
  token: string
  tipo: 'recibos' | 'entregas'
  id: string
  texto?: string
  onSesionVencida: () => void
}) {
  return (
    <BotonesImprimir
      texto={texto}
      nombrePdf={tipo === 'recibos' ? 'recibo-sol-cash.pdf' : 'entrega-sol-cash.pdf'}
      cargarTicket={() => ticketSan(token, tipo, id)}
      cargarPdf={(formato) => pdfSan(token, tipo, id, formato)}
      onSesionVencida={onSesionVencida}
    />
  )
}

// ---------- Elegir de dónde sale o a dónde entra el dinero ----------

type Forma = 'efectivo' | 'transferencia'

function useDestino(prep: PrepararSanes) {
  const local = cajaDeEstaComputadora()
  const [forma, setForma] = useState<Forma>('efectivo')
  const [cajaId, setCajaId] = useState(
    prep.cajas.some((c) => c.id === local && c.sesion_id) ? (local ?? '') : '',
  )
  const [cuentaId, setCuentaId] = useState('')
  const [referencia, setReferencia] = useState('')
  return {
    forma,
    datos: {
      forma,
      cajaId: forma === 'efectivo' ? cajaId : undefined,
      cuentaId: forma === 'transferencia' ? cuentaId : undefined,
      referencia: referencia.trim() || undefined,
    },
    campos: (entra: boolean) => (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-4 text-sm">
          {(['efectivo', 'transferencia'] as Forma[]).map((f) => (
            <label key={f} className="flex items-center gap-2">
              <input type="radio" checked={forma === f} onChange={() => setForma(f)} />
              {f === 'efectivo' ? 'Efectivo' : 'Transferencia / depósito'}
            </label>
          ))}
        </div>
        {forma === 'efectivo' ? (
          <label className="flex flex-col gap-1 text-sm">
            Caja {entra ? 'donde entra' : 'de donde sale'} el dinero
            <select className={CAMPO} value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
              <option value="">Seleccione…</option>
              {prep.cajas.map((c) => (
                <option key={c.id} value={c.id} disabled={!c.sesion_id}>
                  {c.nombre}
                  {c.sesion_id ? '' : ' (cerrada)'}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm">
              Cuenta {entra ? 'donde entra' : 'de donde sale'} el dinero
              <select className={CAMPO} value={cuentaId} onChange={(e) => setCuentaId(e.target.value)}>
                <option value="">Seleccione…</option>
                {prep.cuentas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Referencia {entra ? '(obligatoria)' : '(opcional)'}
              <input className={CAMPO} value={referencia} maxLength={60} onChange={(e) => setReferencia(e.target.value)} />
            </label>
          </>
        )}
      </div>
    ),
  }
}

// ---------- Buscar cliente ----------

function BuscarCliente({
  token,
  soloParticipantes,
  onElegir,
  onSesionVencida,
}: {
  token: string
  soloParticipantes: boolean
  onElegir: (c: ClienteSan) => void
  onSesionVencida: () => void
}) {
  const [texto, setTexto] = useState('')
  const [lista, setLista] = useState<ClienteSan[]>([])
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const t = texto.trim()
    if (t.length < 2) {
      setLista([])
      return
    }
    let vigente = true
    const espera = setTimeout(async () => {
      setBuscando(true)
      setError('')
      try {
        const r = await buscarClientesSan(token, t, soloParticipantes)
        if (vigente) setLista(r)
      } catch (e) {
        if (e instanceof SesionVencida) onSesionVencida()
        else if (vigente) setError(mensajeDe(e))
      } finally {
        if (vigente) setBuscando(false)
      }
    }, 300)
    return () => {
      vigente = false
      clearTimeout(espera)
    }
  }, [texto, token, soloParticipantes, onSesionVencida])

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search size={16} className="absolute top-3 left-3 text-gray-400" />
        <input
          className={`${CAMPO} w-full pl-9`}
          placeholder="Nombre, código SCITO, cédula o teléfono"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          autoFocus
        />
      </div>
      {error && <CajaError>{error}</CajaError>}
      {buscando && <p className="text-sm text-gray-500">Buscando…</p>}
      {!buscando && texto.trim().length >= 2 && lista.length === 0 && (
        <p className="text-sm text-gray-500">
          {soloParticipantes ? 'Nadie con ese dato tiene números en un SOL CASH activo.' : 'No se encontró ningún cliente.'}
        </p>
      )}
      {lista.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {lista.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-gray-50"
                onClick={() => {
                  onElegir(c)
                  setTexto('')
                  setLista([])
                }}
              >
                <span className="font-medium">{c.nombre}</span>
                <span className="text-xs text-gray-500">
                  {[c.codigo, c.numero_documento ?? 'Sin documento', c.telefono].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------- Pantalla principal ----------

export default function Sanes({ token, permisos, onSesionVencida }: Props) {
  const puedeCobrar = permisos.includes('sanes.cobrar')
  const puedeGestionar = permisos.includes('sanes.gestionar')
  const [pestana, setPestana] = useState<Pestana>(puedeCobrar ? 'cobrar' : 'sanes')
  const [prep, setPrep] = useState<PrepararSanes | null>(null)
  const [error, setError] = useState('')
  // Desde "Atrasados" se puede ir directo a cobrarle a alguien.
  const [cobroInicial, setCobroInicial] = useState<{ cliente: ClienteSan; sanId: string } | null>(null)

  const cargarPrep = useCallback(async () => {
    try {
      setPrep(await prepararSanes(token))
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, onSesionVencida])

  useEffect(() => {
    void cargarPrep()
  }, [cargarPrep])

  const pestanas: [Pestana, string, boolean][] = [
    ['cobrar', 'Cobrar cuotas', puedeCobrar],
    ['sanes', 'Los SOL CASH', true],
    ['atrasados', 'Atrasados', true],
    ['contratos', 'Texto de contratos', permisos.includes('sanes.contratos') || permisos.includes('sanes.plantillas')],
    ['config', 'Configuración', puedeGestionar],
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-medium">SOL CASH</h1>
          <p className="text-sm text-gray-500">
            Cobro de cuotas en la oficina, números, turnos y entrega de la mano.
          </p>
        </div>
        <button
          type="button"
          className={`${BOTON_SECUNDARIO} flex items-center gap-2`}
          title="Formulario de solicitud de número para llenar en el celular, la computadora o a mano (español y kreyòl)"
          onClick={async () => {
            try {
              const archivo = await descargarSan(token, '/sanes/formulario')
              const url = URL.createObjectURL(archivo)
              const a = document.createElement('a')
              a.href = url
              a.download = 'SOL-CASH-solicitud-de-numero.pdf'
              a.click()
              setTimeout(() => URL.revokeObjectURL(url), 60_000)
            } catch (e) {
              if (e instanceof SesionVencida) onSesionVencida()
              else setError(mensajeDe(e))
            }
          }}
        >
          <FileDown size={16} /> Descargar formulario
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-gray-200">
        {pestanas
          .filter(([, , ver]) => ver)
          .map(([id, nombre]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setPestana(id)
                if (id !== 'cobrar') setCobroInicial(null)
              }}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                pestana === id ? 'border-[#C8102E] text-[#C8102E]' : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {nombre}
            </button>
          ))}
      </div>

      {error && <CajaError>{error}</CajaError>}
      {!prep ? (
        !error && <p className="text-sm text-gray-500">Cargando…</p>
      ) : pestana === 'cobrar' ? (
        <Cobrar
          key={cobroInicial ? `${cobroInicial.cliente.id}:${cobroInicial.sanId}` : 'nuevo'}
          token={token}
          prep={prep}
          inicial={cobroInicial}
          onSesionVencida={onSesionVencida}
        />
      ) : pestana === 'sanes' ? (
        <ListaSanes token={token} prep={prep} permisos={permisos} onSesionVencida={onSesionVencida} />
      ) : pestana === 'contratos' ? (
        <Plantillas token={token} puedeEditar={permisos.includes('sanes.plantillas')} onSesionVencida={onSesionVencida} />
      ) : pestana === 'atrasados' ? (
        <Atrasados
          token={token}
          puedeCobrar={puedeCobrar}
          onCobrar={(a) => {
            setCobroInicial({
              cliente: { id: a.tercero_id, nombre: a.nombre, numero_documento: null, telefono: a.telefono },
              sanId: a.san_id,
            })
            setPestana('cobrar')
          }}
          onSesionVencida={onSesionVencida}
        />
      ) : (
        <Configuracion
          token={token}
          prep={prep}
          onGuardado={() => void cargarPrep()}
          onSesionVencida={onSesionVencida}
        />
      )}
    </div>
  )
}

// ---------- Cobrar cuotas ----------

function Cobrar({
  token,
  prep,
  inicial,
  onSesionVencida,
}: {
  token: string
  prep: PrepararSanes
  inicial: { cliente: ClienteSan; sanId: string } | null
  onSesionVencida: () => void
}) {
  const [cliente, setCliente] = useState<ClienteSan | null>(inicial?.cliente ?? null)
  const [sanes, setSanes] = useState<{ id: string; codigo: string; nombre: string }[] | null>(null)
  const [sanId, setSanId] = useState(inicial?.sanId ?? '')
  const [cuenta, setCuenta] = useState<CuentaSan | null>(null)
  // Cuántos períodos sin pagar se cobran de cada número (siempre en orden).
  const [cuantos, setCuantos] = useState<Record<string, number>>({})
  const [error, setError] = useState('')
  const [hecho, setHecho] = useState<{ id: string; recibo: string; cuotas: string; mora: string; total: string } | null>(null)
  const destino = useDestino(prep)
  const { error: errorCobro, guardando, enviar } = useEnviar(onSesionVencida)

  const manejar = useCallback(
    (e: unknown) => {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    },
    [onSesionVencida],
  )

  // Al elegir la persona: sus SAN activos (si tiene uno solo, se abre).
  useEffect(() => {
    if (!cliente) return
    let vigente = true
    setError('')
    sanesDePersona(token, cliente.id)
      .then((r) => {
        if (!vigente) return
        setSanes(r)
        setSanId((actual) => (r.some((s) => s.id === actual) ? actual : r.length === 1 ? r[0].id : ''))
      })
      .catch(manejar)
    return () => {
      vigente = false
    }
  }, [cliente, token, manejar])

  const cargarCuenta = useCallback(async () => {
    if (!cliente || !sanId) {
      setCuenta(null)
      return
    }
    try {
      const c = await cuentaSan(token, sanId, cliente.id)
      setCuenta(c)
      // Por defecto se marca lo vencido de cada número.
      setCuantos(Object.fromEntries(c.participaciones.map((p) => [p.id, p.vencidos])))
    } catch (e) {
      manejar(e)
    }
  }, [cliente, sanId, token, manejar])

  useEffect(() => {
    void cargarCuenta()
  }, [cargarCuenta])

  // Los períodos elegidos: los primeros N sin pagar de cada número.
  const elegidos =
    cuenta?.participaciones.flatMap((p) =>
      p.periodos
        .filter((x) => x.estado !== 'pagado')
        .slice(0, cuantos[p.id] ?? 0)
        .map((x) => ({ p, x })),
    ) ?? []
  const totalCuotas = elegidos.reduce((a, e) => a + centavos(e.x.cuota), 0n)
  const totalMora = elegidos.reduce((a, e) => a + centavos(e.x.mora), 0n)

  function cobrar(ev: FormEvent) {
    ev.preventDefault()
    if (!cliente || !cuenta) return
    void enviar(
      async () => {
        const r = await cobrarSan(token, {
          sanId: cuenta.san.id,
          terceroId: cliente.id,
          periodos: elegidos.map((e) => ({ participacionId: e.p.id, turno: e.x.turno })),
          ...destino.datos,
        })
        setHecho(r)
      },
      () => void cargarCuenta(),
    )
  }

  if (!cliente)
    return (
      <div className="flex max-w-xl flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="font-medium">¿Quién viene a pagar?</h2>
        <BuscarCliente token={token} soloParticipantes onElegir={setCliente} onSesionVencida={onSesionVencida} />
      </div>
    )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <div className="text-xs text-gray-500">Participante</div>
          <div className="text-lg font-medium">{cliente.nombre}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sanes && sanes.length > 1 && (
            <select className={CAMPO} value={sanId} onChange={(e) => setSanId(e.target.value)} aria-label="SOL CASH">
              <option value="">Elija el SOL CASH…</option>
              {sanes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.codigo} · {s.nombre}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className={BOTON_SECUNDARIO}
            onClick={() => {
              setCliente(null)
              setSanes(null)
              setSanId('')
              setCuenta(null)
            }}
          >
            Otra persona
          </button>
        </div>
      </div>

      {error && <CajaError>{error}</CajaError>}
      {sanes && sanes.length === 0 && (
        <p className="text-sm text-gray-500">Esta persona no tiene números en ningún SOL CASH activo.</p>
      )}

      {cuenta && (
        <form onSubmit={cobrar} className="flex flex-col gap-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <div className="font-medium">
              {cuenta.san.codigo} · {cuenta.san.nombre}
            </div>
            <div className="text-gray-500">
              {NOMBRE_FRECUENCIA[cuenta.san.frecuencia]} · cuota {dinero(cuenta.san.cuota)} por número · mora{' '}
              {porcentaje(cuenta.san.mora_pct)} después de {cuenta.san.dias_gracia} día(s) de gracia · hoy{' '}
              {fechaCorta(cuenta.hoy)}
            </div>
          </div>

          {cuenta.participaciones.map((p) => (
            <TarjetaNumero
              key={p.id}
              p={p}
              cuantos={cuantos[p.id] ?? 0}
              onCuantos={(n) => setCuantos((c) => ({ ...c, [p.id]: n }))}
            />
          ))}

          <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="lg:w-96">{destino.campos(true)}</div>
            <div className="flex flex-col gap-2 lg:w-72">
              <dl className="flex flex-col gap-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Períodos</dt>
                  <dd>{elegidos.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Cuotas</dt>
                  <dd>{dinero(texto2(totalCuotas))}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Mora</dt>
                  <dd className={totalMora > 0n ? 'text-red-700' : ''}>{dinero(texto2(totalMora))}</dd>
                </div>
                <div className="flex justify-between border-t border-gray-200 pt-1 text-lg font-medium">
                  <dt>Total a cobrar</dt>
                  <dd>{dinero(texto2(totalCuotas + totalMora))}</dd>
                </div>
              </dl>
              {errorCobro && <CajaError>{errorCobro}</CajaError>}
              <button type="submit" className={BOTON_PRINCIPAL} disabled={guardando || elegidos.length === 0}>
                <Banknote size={16} />
                {guardando ? 'Cobrando…' : 'Cobrar y dar recibo'}
              </button>
            </div>
          </div>
        </form>
      )}

      {hecho && (
        <Ventana titulo="Pago registrado" onCerrar={() => setHecho(null)}>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2 size={20} />
              <span className="font-medium">Recibo {hecho.recibo}</span>
            </div>
            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">Cuotas</dt>
                <dd>{dinero(hecho.cuotas)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Mora</dt>
                <dd>{dinero(hecho.mora)}</dd>
              </div>
              <div className="flex justify-between text-base font-medium">
                <dt>Total</dt>
                <dd>{dinero(hecho.total)}</dd>
              </div>
            </dl>
            <Imprimir token={token} tipo="recibos" id={hecho.id} texto="Imprimir recibo" onSesionVencida={onSesionVencida} />
          </div>
        </Ventana>
      )}
    </div>
  )
}

function TarjetaNumero({
  p,
  cuantos,
  onCuantos,
}: {
  p: CuentaSan['participaciones'][number]
  cuantos: number
  onCuantos: (n: number) => void
}) {
  const pendientes = p.periodos.filter((x) => x.estado !== 'pagado')
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">
            Número {p.numero}
            {p.parte === 'medio' ? ' · medio número' : ''}
          </div>
          <div className="text-sm text-gray-500">
            Cuota {dinero(p.cuota)} · su mano {dinero(p.mano)} · pagados {p.pagados} de {p.periodos.length}
            {p.entrega ? ` · ya cobró su mano (${p.entrega.numero})` : ''}
          </div>
        </div>
        {p.vencidos > 0 ? (
          <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
            <AlertTriangle size={14} />
            Debe {p.vencidos}: {dinero(p.debe_cuotas)}
            {p.debe_mora !== '0.00' ? ` + mora ${dinero(p.debe_mora)}` : ''}
          </span>
        ) : (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Al día</span>
        )}
      </div>
      {pendientes.length === 0 ? (
        <p className="text-sm text-gray-500">Pagó todos sus períodos.</p>
      ) : (
        <>
          <p className="text-xs text-gray-500">
            Marque hasta qué período paga (se paga en orden; puede adelantar).
          </p>
          <div className="flex flex-wrap gap-2">
            {p.periodos.map((x) => {
              if (x.estado === 'pagado')
                return (
                  <span
                    key={x.turno}
                    className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-400 line-through"
                  >
                    {x.turno} · {fechaCorta(x.fecha)}
                  </span>
                )
              const pos = pendientes.indexOf(x)
              const marcado = pos < cuantos
              return (
                <button
                  key={x.turno}
                  type="button"
                  onClick={() => onCuantos(marcado ? pos : pos + 1)}
                  className={`rounded-lg border px-2 py-1 text-left text-xs ${
                    marcado
                      ? 'border-[#C8102E] bg-red-50 text-[#C8102E]'
                      : x.estado === 'vencido'
                        ? 'border-red-300 bg-white text-red-700'
                        : 'border-gray-300 bg-white text-gray-700'
                  }`}
                  title={x.estado === 'vencido' ? `Vencido hace ${x.dias_atraso} día(s)` : 'Adelanto'}
                >
                  <span className="font-medium">
                    {x.turno} · {fechaCorta(x.fecha)}
                  </span>
                  {x.mora !== '0.00' && <span className="block">+ mora {dinero(x.mora)}</span>}
                  {x.estado === 'vencido' && x.mora === '0.00' && <span className="block">vencido (en gracia)</span>}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <button type="button" className="text-gray-600 underline" onClick={() => onCuantos(0)}>
              Ninguno
            </button>
            {p.vencidos > 0 && (
              <button type="button" className="text-gray-600 underline" onClick={() => onCuantos(p.vencidos)}>
                Solo lo vencido
              </button>
            )}
            <button type="button" className="text-gray-600 underline" onClick={() => onCuantos(cuantos + 1)} disabled={cuantos >= pendientes.length}>
              Uno más (adelantar)
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ---------- Lista de SAN y detalle ----------

function ListaSanes({
  token,
  prep,
  permisos,
  onSesionVencida,
}: {
  token: string
  prep: PrepararSanes
  permisos: string[]
  onSesionVencida: () => void
}) {
  const [filas, setFilas] = useState<FilaSan[] | null>(null)
  const [error, setError] = useState('')
  const [nuevo, setNuevo] = useState(false)
  const [abierto, setAbierto] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setError('')
    try {
      setFilas(await listarSanes(token))
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, onSesionVencida])

  useEffect(() => {
    void cargar()
  }, [cargar])

  if (abierto)
    return (
      <DetalleVista
        token={token}
        prep={prep}
        id={abierto}
        permisos={permisos}
        onVolver={() => {
          setAbierto(null)
          void cargar()
        }}
        onSesionVencida={onSesionVencida}
      />
    )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {permisos.includes('sanes.gestionar') && (
          <button type="button" className={BOTON_PRINCIPAL} onClick={() => setNuevo(true)}>
            <Plus size={16} />
            Nuevo SOL CASH
          </button>
        )}
        <button type="button" className={BOTON_SECUNDARIO} onClick={() => void cargar()}>
          <span className="flex items-center gap-2">
            <RefreshCw size={16} />
            Actualizar
          </span>
        </button>
      </div>
      {error && <CajaError>{error}</CajaError>}
      {!filas ? (
        !error && <p className="text-sm text-gray-500">Cargando…</p>
      ) : filas.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
          Todavía no hay ningún SOL CASH. {permisos.includes('sanes.gestionar') && 'Cree el primero con "Nuevo SOL CASH".'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">SOL CASH</th>
                <th className="px-3 py-2 font-medium">Frecuencia</th>
                <th className="px-3 py-2 text-right font-medium">Cuota</th>
                <th className="px-3 py-2 text-right font-medium">Mano</th>
                <th className="px-3 py-2 font-medium">Números</th>
                <th className="px-3 py-2 font-medium">Próximo turno</th>
                <th className="px-3 py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((s) => (
                <tr
                  key={s.id}
                  className="cursor-pointer border-t border-gray-100 hover:bg-gray-50"
                  onClick={() => setAbierto(s.id)}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{s.codigo}</div>
                    <div className="text-gray-500">{s.nombre}</div>
                  </td>
                  <td className="px-3 py-2">{NOMBRE_FRECUENCIA[s.frecuencia]}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{dinero(s.cuota)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{dinero(s.mano)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {s.asignados} de {s.cantidad_numeros} con dueño
                    <div className="text-xs text-gray-500">{s.entregas} mano(s) entregada(s)</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{fechaCorta(s.proximo_turno)}</td>
                  <td className="px-3 py-2">
                    <EstadoEtiqueta estado={s.estado} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {nuevo && (
        <FormSan
          token={token}
          prep={prep}
          onCerrar={() => setNuevo(false)}
          onListo={(id) => {
            setNuevo(false)
            setAbierto(id)
          }}
          onSesionVencida={onSesionVencida}
        />
      )}
    </div>
  )
}

function FormSan({
  token,
  prep,
  san,
  onCerrar,
  onListo,
  onSesionVencida,
}: {
  token: string
  prep: PrepararSanes
  san?: DetalleSan
  onCerrar: () => void
  onListo: (id: string) => void
  onSesionVencida: () => void
}) {
  const [d, setD] = useState<DatosSan>(
    san
      ? {
          nombre: san.nombre,
          frecuencia: san.frecuencia,
          cuota: san.cuota,
          cantidadNumeros: String(san.cantidad_numeros),
          fechaInicio: san.fecha_inicio,
          comisionPct: san.comision_pct,
          moraPct: san.mora_pct,
          diasGracia: String(san.dias_gracia),
          notas: san.notas ?? '',
        }
      : {
          nombre: '',
          frecuencia: 'quincenal',
          cuota: '',
          cantidadNumeros: '10',
          fechaInicio: hoy(),
          comisionPct: prep.comisionPct,
          moraPct: prep.moraPct,
          diasGracia: String(prep.diasGracia),
          notas: '',
        },
  )
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  const poner = (k: keyof DatosSan) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value })

  // Vista previa: la mano y lo que gana SCITO por mano.
  const cuotaOk = /^\d{1,10}(\.\d{1,2})?$/.test(d.cuota.trim())
  const n = Number(d.cantidadNumeros)
  const pctOk = /^\d{1,3}(\.\d{1,2})?$/.test(d.comisionPct.trim())
  const mano = cuotaOk && Number.isInteger(n) && n > 0 ? centavos(d.cuota.trim()) * BigInt(n) : null
  const comision = mano !== null && pctOk ? (mano * centavos(d.comisionPct.trim()) + 5000n) / 10000n : null

  return (
    <Ventana titulo={san ? `Editar ${san.codigo}` : 'Nuevo SOL CASH'} onCerrar={onCerrar} ancho="max-w-lg">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void enviar(
            async () => {
              if (san) {
                await editarSan(token, san.id, d)
                onListo(san.id)
              } else {
                const r = await crearSan(token, d)
                onListo(r.id)
              }
            },
            () => undefined,
          )
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          Nombre del SOL CASH
          <input className={CAMPO} value={d.nombre} onChange={poner('nombre')} maxLength={80} placeholder="Ej.: SOL CASH quincenal de enero" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Frecuencia
          <select className={CAMPO} value={d.frecuencia} onChange={poner('frecuencia')}>
            {FRECUENCIAS.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Cuota por número (RD$)
            <input className={CAMPO} value={d.cuota} onChange={poner('cuota')} inputMode="decimal" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Cantidad de números
            <input className={CAMPO} value={d.cantidadNumeros} onChange={poner('cantidadNumeros')} inputMode="numeric" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Fecha del primer turno
            <input type="date" className={CAMPO} value={d.fechaInicio} onChange={poner('fechaInicio')} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Comisión de SCITO por mano (%)
            <input className={CAMPO} value={d.comisionPct} onChange={poner('comisionPct')} inputMode="decimal" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Mora por cuota atrasada (%)
            <input className={CAMPO} value={d.moraPct} onChange={poner('moraPct')} inputMode="decimal" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Días de gracia
            <input className={CAMPO} value={d.diasGracia} onChange={poner('diasGracia')} inputMode="numeric" />
          </label>
        </div>
        {d.frecuencia === 'quincenal' && (
          <p className="text-xs text-gray-500">
            Los turnos caen los días 15 y 30 (en febrero, el último día). Si la fecha del primer turno no es 15 ni 30,
            se usa el siguiente 15 o 30.
          </p>
        )}
        <label className="flex flex-col gap-1 text-sm">
          Notas (opcional)
          <textarea className={AREA} rows={2} value={d.notas} onChange={poner('notas')} maxLength={500} />
        </label>
        {mano !== null && (
          <div className="rounded-lg bg-gray-50 p-3 text-sm">
            Cada mano: <strong>{dinero(texto2(mano))}</strong>
            {comision !== null && (
              <>
                {' '}
                · comisión SCITO {dinero(texto2(comision))} · recibe {dinero(texto2(mano - comision))}
              </>
            )}
          </div>
        )}
        {error && <CajaError>{error}</CajaError>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON_SECUNDARIO} onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className={BOTON_PRINCIPAL} disabled={guardando}>
            {guardando ? 'Guardando…' : san ? 'Guardar cambios' : 'Crear SOL CASH'}
          </button>
        </div>
      </form>
    </Ventana>
  )
}

type Accion =
  | { tipo: 'editar' }
  | { tipo: 'fecha'; turno: number; fecha: string }
  | { tipo: 'asignar'; numero: number }
  | { tipo: 'quitar'; p: ParticipacionSan }
  | { tipo: 'entregar'; p: ParticipacionSan }
  | { tipo: 'estado'; estado: EstadoSan }
  | { tipo: 'ficha'; terceroId: string }
  | { tipo: 'contrato'; p: ParticipacionSan }

function DetalleVista({
  token,
  prep,
  id,
  permisos,
  onVolver,
  onSesionVencida,
}: {
  token: string
  prep: PrepararSanes
  id: string
  permisos: string[]
  onVolver: () => void
  onSesionVencida: () => void
}) {
  const gestionar = permisos.includes('sanes.gestionar')
  const puedeEntregar = permisos.includes('sanes.entregar')
  const puedeFichas = permisos.includes('sanes.fichas')
  const puedeContratos = permisos.includes('sanes.contratos')
  const [s, setS] = useState<DetalleSan | null>(null)
  const [error, setError] = useState('')
  const [accion, setAccion] = useState<Accion | null>(null)

  const cargar = useCallback(async () => {
    setError('')
    try {
      setS(await detalleSan(token, id))
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, id, onSesionVencida])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const listo = () => {
    setAccion(null)
    void cargar()
  }

  if (!s)
    return (
      <div className="flex flex-col gap-3">
        <button type="button" className="flex items-center gap-1 text-sm text-gray-600" onClick={onVolver}>
          <ArrowLeft size={16} /> Volver
        </button>
        {error ? <CajaError>{error}</CajaError> : <p className="text-sm text-gray-500">Cargando…</p>}
      </div>
    )

  const enPreparacion = s.estado === 'preparacion'
  const activo = s.estado === 'activo'
  const d = s.dinero

  return (
    <div className="flex flex-col gap-4">
      <button type="button" className="flex items-center gap-1 self-start text-sm text-gray-600" onClick={onVolver}>
        <ArrowLeft size={16} /> Volver a la lista
      </button>

      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-medium">
                {s.codigo} · {s.nombre}
              </h2>
              <EstadoEtiqueta estado={s.estado} />
            </div>
            <p className="text-sm text-gray-500">
              {NOMBRE_FRECUENCIA[s.frecuencia]} · {s.cantidad_numeros} números · cuota {dinero(s.cuota)} · mano{' '}
              {dinero(s.mano)} · comisión {porcentaje(s.comision_pct)} · mora {porcentaje(s.mora_pct)} después de{' '}
              {s.dias_gracia} día(s)
            </p>
            {s.notas && <p className="text-sm text-gray-500">{s.notas}</p>}
          </div>
          {gestionar && (
            <div className="flex flex-wrap gap-2">
              {enPreparacion && (
                <>
                  <button type="button" className={BOTON_SECUNDARIO} onClick={() => setAccion({ tipo: 'editar' })}>
                    <span className="flex items-center gap-2">
                      <Pencil size={16} /> Editar
                    </span>
                  </button>
                  <button type="button" className={BOTON_PRINCIPAL} onClick={() => setAccion({ tipo: 'estado', estado: 'activo' })}>
                    <Play size={16} /> Activar
                  </button>
                  <button type="button" className={BOTON_PELIGRO} onClick={() => setAccion({ tipo: 'estado', estado: 'cancelado' })}>
                    <XCircle size={16} /> Cancelar SOL CASH
                  </button>
                </>
              )}
              {activo && (
                <button type="button" className={BOTON_SECUNDARIO} onClick={() => setAccion({ tipo: 'estado', estado: 'terminado' })}>
                  <span className="flex items-center gap-2">
                    <CheckCircle2 size={16} /> Terminar
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
        {enPreparacion && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            En preparación: asigne un dueño a cada número (o dos medios) y ajuste las fechas si hace falta. Después pulse
            "Activar" para empezar a cobrar.
          </p>
        )}
      </div>

      {error && <CajaError>{error}</CajaError>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {(
          [
            ['Cuotas cobradas', d.cuotas_cobradas, ''],
            ['Manos entregadas', d.manos_entregadas, ''],
            ['Fondo en mano', d.fondo, ''],
            ['Adelantado por SCITO', d.adelantado_scito, d.adelantado_scito !== '0.00' ? 'text-amber-700' : ''],
            ['Comisión ganada', d.comision_ganada, 'text-green-700'],
            ['Mora cobrada', d.mora_cobrada, 'text-green-700'],
          ] as [string, string, string][]
        ).map(([t, v, c]) => (
          <div key={t} className="rounded-xl border border-gray-200 bg-white p-3">
            <div className="text-xs text-gray-500">{t}</div>
            <div className={`font-medium ${c}`}>{dinero(v)}</div>
          </div>
        ))}
      </div>
      <p className="-mt-2 text-xs text-gray-500">
        Las cuotas son dinero de los participantes; solo la comisión y la mora son ganancia de SCITO.
      </p>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">Número</th>
              <th className="px-3 py-2 font-medium">Fecha de la mano</th>
              <th className="px-3 py-2 font-medium">Dueño(s)</th>
              <th className="px-3 py-2 font-medium">Cuotas</th>
              <th className="px-3 py-2 font-medium">Mano</th>
            </tr>
          </thead>
          <tbody>
            {s.turnos.map((t) => {
              const duenos = s.participaciones.filter((p) => p.numero === t.turno)
              const lleno = duenos.some((p) => p.parte === 'completo') || duenos.length >= 2
              const yaCobro = duenos.some((p) => p.entrega)
              const puedeAsignar = gestionar && !lleno && (enPreparacion || (activo && !yaCobro))
              const llego = t.fecha <= s.hoy
              return (
                <tr key={t.turno} className="border-t border-gray-100 align-top">
                  <td className="px-3 py-2 text-base font-medium">{t.turno}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {fechaCorta(t.fecha)}
                    {gestionar && enPreparacion && (
                      <button
                        type="button"
                        className="ml-2 text-gray-400 hover:text-gray-700"
                        aria-label={`Cambiar fecha del turno ${t.turno}`}
                        onClick={() => setAccion({ tipo: 'fecha', turno: t.turno, fecha: t.fecha })}
                      >
                        <CalendarDays size={15} />
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      {duenos.map((p) => (
                        <div key={p.id} className="flex flex-wrap items-center gap-2">
                          <span>
                            {p.nombre}
                            <span className="text-gray-500">{parteTexto(p.parte)}</span>
                          </span>
                          {puedeFichas && (
                            <button
                              type="button"
                              className="text-gray-400 hover:text-gray-700"
                              aria-label={`Ficha de ${p.nombre}`}
                              title="Ficha, fiador, referencias y contratos"
                              onClick={() => setAccion({ tipo: 'ficha', terceroId: p.tercero_id })}
                            >
                              <ClipboardList size={15} />
                            </button>
                          )}
                          {p.falta && p.falta.length > 0 && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800" title={`Falta: ${p.falta.join(', ')}`}>
                              Ficha incompleta
                            </span>
                          )}
                          {p.contrato ? (
                            <button
                              type="button"
                              className={`rounded-full px-2 py-0.5 text-xs ${p.contrato.estado === 'firmado' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}
                              title="Abrir el contrato"
                              onClick={() => void abrirArchivo(token, `/sanes/contratos/${p.contrato?.id}/pdf`, onSesionVencida, setError)}
                            >
                              {p.contrato.codigo} · {p.contrato.estado === 'firmado' ? 'firmado' : 'sin firmar'}
                            </button>
                          ) : (
                            puedeContratos &&
                            (enPreparacion || activo) &&
                            p.falta?.length === 0 && (
                              <button
                                type="button"
                                className="flex items-center gap-1 text-xs text-[#C8102E] hover:underline"
                                onClick={() => setAccion({ tipo: 'contrato', p })}
                              >
                                <FileSignature size={14} /> Contrato
                              </button>
                            )
                          )}
                          {gestionar && (enPreparacion || activo) && p.pagados === 0 && !p.entrega && (
                            <button
                              type="button"
                              className="text-gray-400 hover:text-red-700"
                              aria-label={`Quitar a ${p.nombre}`}
                              title="Quitar"
                              onClick={() => setAccion({ tipo: 'quitar', p })}
                            >
                              <UserMinus size={15} />
                            </button>
                          )}
                        </div>
                      ))}
                      {duenos.length === 0 && <span className="text-gray-400">Sin dueño</span>}
                      {puedeAsignar && (
                        <button
                          type="button"
                          className="flex items-center gap-1 self-start text-xs text-[#C8102E] hover:underline"
                          onClick={() => setAccion({ tipo: 'asignar', numero: t.turno })}
                        >
                          <UserPlus size={14} />
                          {duenos.length === 1 ? 'Agregar el otro medio' : 'Asignar dueño'}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {duenos.map((p) => (
                      <div key={p.id} className="whitespace-nowrap">
                        {p.vencidos > 0 ? (
                          <span className="text-red-700">
                            Debe {p.vencidos} ({dinero(p.debe_cuotas)}
                            {p.debe_mora !== '0.00' ? ` + ${dinero(p.debe_mora)} mora` : ''})
                          </span>
                        ) : activo ? (
                          <span className="text-green-700">Al día · {p.pagados} pagadas</span>
                        ) : (
                          <span className="text-gray-500">{p.pagados} pagadas</span>
                        )}
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-2">
                    {duenos.map((p) => (
                      <div key={p.id} className="flex items-center gap-2 whitespace-nowrap">
                        {p.entrega ? (
                          <>
                            <span className="text-green-700">
                              {p.entrega.numero} · {dinero(p.entrega.neto)}
                            </span>
                            <ReimprimirEntrega token={token} id={p.entrega.id} onSesionVencida={onSesionVencida} />
                          </>
                        ) : activo && puedeEntregar && llego ? (
                          <button
                            type="button"
                            className="flex items-center gap-1 rounded-lg bg-[#C8102E] px-2 py-1 text-xs font-medium text-white hover:bg-[#a80d26]"
                            onClick={() => setAccion({ tipo: 'entregar', p })}
                          >
                            <HandCoins size={14} />
                            Entregar{duenos.length > 1 ? ` a ${p.nombre.split(' ')[0]}` : ''}
                          </button>
                        ) : (
                          <span className="text-gray-400">{llego ? 'Pendiente' : 'Todavía no'}</span>
                        )}
                      </div>
                    ))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {accion?.tipo === 'editar' && (
        <FormSan token={token} prep={prep} san={s} onCerrar={() => setAccion(null)} onListo={listo} onSesionVencida={onSesionVencida} />
      )}
      {accion?.tipo === 'fecha' && (
        <FormFecha token={token} sanId={s.id} turno={accion.turno} fecha={accion.fecha} onCerrar={() => setAccion(null)} onListo={listo} onSesionVencida={onSesionVencida} />
      )}
      {accion?.tipo === 'asignar' && (
        <FormAsignar
          token={token}
          prep={prep}
          permisos={permisos}
          san={s}
          numero={accion.numero}
          onCerrar={() => setAccion(null)}
          onListo={listo}
          onSesionVencida={onSesionVencida}
        />
      )}
      {accion?.tipo === 'ficha' && (
        <FichaVista
          token={token}
          prep={prep}
          terceroId={accion.terceroId}
          permisos={permisos}
          onCerrar={() => {
            setAccion(null)
            void cargar()
          }}
          onSesionVencida={onSesionVencida}
        />
      )}
      {accion?.tipo === 'contrato' && (
        <GenerarContrato
          token={token}
          participacionId={accion.p.id}
          terceroId={accion.p.tercero_id}
          nombre={accion.p.nombre}
          numero={accion.p.numero}
          onCerrar={() => setAccion(null)}
          onListo={listo}
          onSesionVencida={onSesionVencida}
        />
      )}
      {accion?.tipo === 'quitar' && (
        <Confirmar
          titulo={`Quitar a ${accion.p.nombre}`}
          texto={`¿Quitar a ${accion.p.nombre} del número ${accion.p.numero}? Solo se puede si no ha pagado nada.`}
          boton="Quitar"
          onCerrar={() => setAccion(null)}
          onConfirmar={() => quitarNumeroSan(token, s.id, accion.p.id)}
          onListo={listo}
          onSesionVencida={onSesionVencida}
        />
      )}
      {accion?.tipo === 'estado' && (
        <FormEstado token={token} san={s} estado={accion.estado} onCerrar={() => setAccion(null)} onListo={listo} onSesionVencida={onSesionVencida} />
      )}
      {accion?.tipo === 'entregar' && (
        <FormEntregar
          token={token}
          prep={prep}
          san={s}
          p={accion.p}
          onCerrar={() => setAccion(null)}
          onHecho={() => void cargar()}
          onSesionVencida={onSesionVencida}
        />
      )}
    </div>
  )
}

function ReimprimirEntrega({ token, id, onSesionVencida }: { token: string; id: string; onSesionVencida: () => void }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <>
      <button type="button" className="text-gray-400 hover:text-gray-700" aria-label="Imprimir entrega" onClick={() => setAbierto(true)}>
        <Printer size={15} />
      </button>
      {abierto && (
        <Ventana titulo="Recibo de entrega" onCerrar={() => setAbierto(false)}>
          <Imprimir token={token} tipo="entregas" id={id} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
    </>
  )
}

function Confirmar({
  titulo,
  texto,
  boton,
  onCerrar,
  onConfirmar,
  onListo,
  onSesionVencida,
}: {
  titulo: string
  texto: string
  boton: string
  onCerrar: () => void
  onConfirmar: () => Promise<unknown>
  onListo: () => void
  onSesionVencida: () => void
}) {
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  return (
    <Ventana titulo={titulo} onCerrar={onCerrar}>
      <div className="flex flex-col gap-3">
        <p className="text-sm">{texto}</p>
        {error && <CajaError>{error}</CajaError>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON_SECUNDARIO} onClick={onCerrar}>
            No
          </button>
          <button type="button" className={BOTON_PELIGRO} disabled={guardando} onClick={() => void enviar(onConfirmar, onListo)}>
            <AlertTriangle size={16} />
            {guardando ? 'Un momento…' : boton}
          </button>
        </div>
      </div>
    </Ventana>
  )
}

function FormFecha({
  token,
  sanId,
  turno,
  fecha: inicial,
  onCerrar,
  onListo,
  onSesionVencida,
}: {
  token: string
  sanId: string
  turno: number
  fecha: string
  onCerrar: () => void
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [fecha, setFecha] = useState(inicial)
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  return (
    <Ventana titulo={`Fecha del turno ${turno}`} onCerrar={onCerrar}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void enviar(() => fechaTurnoSan(token, sanId, turno, fecha), onListo)
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          Nueva fecha (entre la del turno anterior y la del siguiente)
          <input type="date" className={CAMPO} value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </label>
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

function FormAsignar({
  token,
  prep,
  permisos,
  san,
  numero,
  onCerrar,
  onListo,
  onSesionVencida,
}: {
  token: string
  prep: PrepararSanes
  permisos: string[]
  san: DetalleSan
  numero: number
  onCerrar: () => void
  onListo: () => void
  onSesionVencida: () => void
}) {
  const puedeFichas = permisos.includes('sanes.fichas')
  const yaHayMedio = san.participaciones.some((p) => p.numero === numero)
  const [cliente, setCliente] = useState<ClienteSan | null>(null)
  const [parte, setParte] = useState<'completo' | 'medio'>(yaHayMedio ? 'medio' : 'completo')
  const [falta, setFalta] = useState<string[] | null>(null)
  const [nueva, setNueva] = useState(false)
  const [fichaAbierta, setFichaAbierta] = useState(false)
  const { error, setError, guardando, enviar } = useEnviar(onSesionVencida)

  // Lo que le falta a la persona elegida para entrar al SAN.
  const revisar = useCallback(
    async (id: string) => {
      if (!puedeFichas) return
      try {
        const f = await fichaSan(token, id)
        setFalta(f.falta)
        return f
      } catch (e) {
        if (e instanceof SesionVencida) onSesionVencida()
        else setError(mensajeDe(e))
      }
    },
    [token, puedeFichas, onSesionVencida, setError],
  )

  function elegir(c: ClienteSan) {
    setCliente(c)
    setFalta(null)
    void revisar(c.id)
  }

  return (
    <Ventana titulo={`Número ${numero}: asignar dueño`} onCerrar={onCerrar}>
      <div className="flex flex-col gap-3">
        {cliente ? (
          <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
            <span>
              <span className="font-medium">{cliente.nombre}</span>
              <span className="block text-xs text-gray-500">{cliente.numero_documento ?? 'Sin documento'}</span>
            </span>
            <button type="button" className="text-xs text-gray-600 underline" onClick={() => setCliente(null)}>
              Cambiar
            </button>
          </div>
        ) : (
          <>
            <BuscarCliente token={token} soloParticipantes={false} onElegir={elegir} onSesionVencida={onSesionVencida} />
            {puedeFichas && (
              <button type="button" className="flex items-center gap-1 self-start text-sm text-[#C8102E] hover:underline" onClick={() => setNueva(true)}>
                <UserPlus size={16} /> Nueva persona (con ficha completa)
              </button>
            )}
          </>
        )}
        {cliente && falta && falta.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <span>Para entrar al SOL CASH le falta: {falta.join(', ')}.</span>
            <button type="button" className={`${BOTON_SECUNDARIO} self-start`} onClick={() => setFichaAbierta(true)}>
              Completar su ficha
            </button>
          </div>
        )}
        {cliente && falta && falta.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-green-700">
            <CheckCircle2 size={16} /> Ficha completa
            <button type="button" className="text-xs text-gray-600 underline" onClick={() => setFichaAbierta(true)}>
              Ver ficha
            </button>
          </div>
        )}
        <div className="flex flex-col gap-1 text-sm">
          <label className={`flex items-center gap-2 ${yaHayMedio ? 'text-gray-400' : ''}`}>
            <input type="radio" checked={parte === 'completo'} disabled={yaHayMedio} onChange={() => setParte('completo')} />
            Número completo (cuota {dinero(san.cuota)}, mano {dinero(san.mano)})
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={parte === 'medio'} onChange={() => setParte('medio')} />
            Medio número (cuota {dinero(texto2(centavos(san.cuota) / 2n))}, mano {dinero(texto2(centavos(san.mano) / 2n))})
          </label>
        </div>
        <p className="text-xs text-gray-500">
          Para entrar necesita: teléfono o WhatsApp, ficha (ocupación y dirección), fiador confirmado y al menos una referencia
          confirmada. El documento y su foto son opcionales.
        </p>
        {error && <CajaError>{error}</CajaError>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON_SECUNDARIO} onClick={onCerrar}>
            Cancelar
          </button>
          <button
            type="button"
            className={BOTON_PRINCIPAL}
            disabled={!cliente || guardando || (falta !== null && falta.length > 0)}
            onClick={() =>
              cliente && void enviar(() => asignarNumeroSan(token, san.id, { numero: String(numero), terceroId: cliente.id, parte }), onListo)
            }
          >
            Asignar
          </button>
        </div>
      </div>
      {nueva && (
        <FormPersona
          token={token}
          prep={prep}
          onCerrar={() => setNueva(false)}
          onCreada={(id) => {
            setNueva(false)
            void revisar(id).then((f) => {
              if (f) setCliente({ id, nombre: f.cliente.nombre, numero_documento: f.cliente.numero_documento, telefono: f.cliente.telefono ?? f.cliente.whatsapp })
              setFichaAbierta(true)
            })
          }}
          onSesionVencida={onSesionVencida}
        />
      )}
      {fichaAbierta && cliente && (
        <FichaVista
          token={token}
          prep={prep}
          terceroId={cliente.id}
          permisos={permisos}
          onCerrar={() => setFichaAbierta(false)}
          onCambio={() => void revisar(cliente.id)}
          onSesionVencida={onSesionVencida}
        />
      )}
    </Ventana>
  )
}

function FormEstado({
  token,
  san,
  estado,
  onCerrar,
  onListo,
  onSesionVencida,
}: {
  token: string
  san: DetalleSan
  estado: EstadoSan
  onCerrar: () => void
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  const textos: Partial<Record<EstadoSan, [string, string]>> = {
    activo: [
      `Activar ${san.codigo}`,
      'Al activarlo ya no se pueden cambiar la cuota, la cantidad de números ni las fechas. Desde ese momento se cobran las cuotas.',
    ],
    cancelado: [`Cancelar ${san.codigo}`, 'El SOL CASH queda cancelado y no se podrá usar. Escriba el motivo.'],
    terminado: [`Terminar ${san.codigo}`, 'Solo se puede terminar cuando todas las manos fueron entregadas.'],
  }
  const [titulo, texto] = textos[estado] ?? ['', '']
  return (
    <Ventana titulo={titulo} onCerrar={onCerrar}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void enviar(() => estadoSan(token, san.id, estado, motivo.trim() || undefined), onListo)
        }}
      >
        <p className="text-sm">{texto}</p>
        {estado === 'cancelado' && (
          <label className="flex flex-col gap-1 text-sm">
            Motivo
            <input className={CAMPO} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
          </label>
        )}
        {error && <CajaError>{error}</CajaError>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON_SECUNDARIO} onClick={onCerrar}>
            Volver
          </button>
          <button type="submit" className={estado === 'cancelado' ? BOTON_PELIGRO : BOTON_PRINCIPAL} disabled={guardando}>
            {guardando ? 'Un momento…' : titulo}
          </button>
        </div>
      </form>
    </Ventana>
  )
}

function FormEntregar({
  token,
  prep,
  san,
  p,
  onCerrar,
  onHecho,
  onSesionVencida,
}: {
  token: string
  prep: PrepararSanes
  san: DetalleSan
  p: ParticipacionSan
  onCerrar: () => void
  onHecho: () => void
  onSesionVencida: () => void
}) {
  const [previa, setPrevia] = useState<PreviaEntregaSan | null>(null)
  const [errorPrevia, setErrorPrevia] = useState('')
  const [hecho, setHecho] = useState<{ id: string; entrega: string; neto: string } | null>(null)
  const destino = useDestino(prep)
  const { error, guardando, enviar } = useEnviar(onSesionVencida)

  useEffect(() => {
    previaEntregaSan(token, san.id, p.id)
      .then(setPrevia)
      .catch((e) => {
        if (e instanceof SesionVencida) onSesionVencida()
        else setErrorPrevia(mensajeDe(e))
      })
  }, [token, san.id, p.id, onSesionVencida])

  if (hecho)
    return (
      <Ventana titulo="Mano entregada" onCerrar={onCerrar}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle2 size={20} />
            <span className="font-medium">
              {hecho.entrega}: {p.nombre} recibe {dinero(hecho.neto)}
            </span>
          </div>
          <p className="text-sm text-gray-600">Imprima el recibo y pídale que firme "Recibí conforme".</p>
          <Imprimir token={token} tipo="entregas" id={hecho.id} texto="Imprimir recibo de entrega" onSesionVencida={onSesionVencida} />
        </div>
      </Ventana>
    )

  return (
    <Ventana titulo={`Entregar la mano del número ${p.numero}`} onCerrar={onCerrar}>
      {errorPrevia ? (
        <CajaError>{errorPrevia}</CajaError>
      ) : !previa ? (
        <p className="text-sm text-gray-500">Calculando…</p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void enviar(
              async () => {
                const r = await entregarSan(token, { sanId: san.id, participacionId: p.id, ...destino.datos })
                setHecho(r)
              },
              onHecho,
            )
          }}
        >
          <div className="text-sm">
            <span className="font-medium">{previa.nombre}</span>
            {previa.parte === 'medio' ? ' (medio número)' : ''} · turno del {fechaCorta(previa.fecha_turno)}
          </div>
          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Mano</dt>
              <dd>{dinero(previa.bruto)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">− Comisión SCITO ({porcentaje(san.comision_pct)})</dt>
              <dd>{dinero(previa.comision)}</dd>
            </div>
            {previa.cuotas_descontadas.map((c) => (
              <div key={c.turno} className="flex justify-between text-red-700">
                <dt>
                  − Cuota que debe, turno {c.turno} ({fechaCorta(c.fecha)})
                  {c.mora !== '0.00' ? ' + mora' : ''}
                </dt>
                <dd>{dinero(texto2(centavos(c.cuota) + centavos(c.mora)))}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-gray-200 pt-1 text-lg font-medium">
              <dt>Recibe</dt>
              <dd>{dinero(previa.neto)}</dd>
            </div>
          </dl>
          {!previa.puede ? (
            <CajaError>Esta mano se entrega a partir del {fechaCorta(previa.fecha_turno)}.</CajaError>
          ) : (
            <>
              {previa.neto !== '0.00' && destino.campos(false)}
              {error && <CajaError>{error}</CajaError>}
              <div className="flex justify-end gap-2">
                <button type="button" className={BOTON_SECUNDARIO} onClick={onCerrar}>
                  Cancelar
                </button>
                <button type="submit" className={BOTON_PRINCIPAL} disabled={guardando}>
                  <HandCoins size={16} />
                  {guardando ? 'Entregando…' : 'Entregar la mano'}
                </button>
              </div>
            </>
          )}
        </form>
      )}
    </Ventana>
  )
}

// ---------- Atrasados ----------

function Atrasados({
  token,
  puedeCobrar,
  onCobrar,
  onSesionVencida,
}: {
  token: string
  puedeCobrar: boolean
  onCobrar: (a: AtrasadoSan) => void
  onSesionVencida: () => void
}) {
  const [filas, setFilas] = useState<AtrasadoSan[] | null>(null)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    setError('')
    try {
      setFilas(await atrasadosSan(token))
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, onSesionVencida])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const total = (filas ?? []).reduce((a, f) => a + centavos(f.debe_cuotas) + centavos(f.debe_mora), 0n)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600">
          Personas con cuotas vencidas sin pagar en los SOL CASH activos.
          {filas && filas.length > 0 && <strong> Total por cobrar: {dinero(texto2(total))}</strong>}
        </p>
        <button type="button" className={BOTON_SECUNDARIO} onClick={() => void cargar()}>
          <span className="flex items-center gap-2">
            <RefreshCw size={16} />
            Actualizar
          </span>
        </button>
      </div>
      {error && <CajaError>{error}</CajaError>}
      {!filas ? (
        !error && <p className="text-sm text-gray-500">Cargando…</p>
      ) : filas.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-green-700">Nadie está atrasado.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Persona</th>
                <th className="px-3 py-2 font-medium">SOL CASH / número</th>
                <th className="px-3 py-2 font-medium">Desde</th>
                <th className="px-3 py-2 text-right font-medium">Cuotas</th>
                <th className="px-3 py-2 text-right font-medium">Mora</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                {puedeCobrar && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={`${f.san_id}:${f.numero}:${f.tercero_id}`} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    <div className="font-medium">{f.nombre}</div>
                    <div className="text-xs text-gray-500">{f.telefono ?? 'Sin teléfono'}</div>
                  </td>
                  <td className="px-3 py-2">
                    {f.san} · Nº {f.numero}
                    {parteTexto(f.parte)}
                    <div className="text-xs text-gray-500">{f.san_nombre}</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {fechaCorta(f.mas_antiguo)}
                    <div className="text-xs text-gray-500">{f.vencidos} cuota(s)</div>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{dinero(f.debe_cuotas)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-red-700">{dinero(f.debe_mora)}</td>
                  <td className="px-3 py-2 text-right font-medium whitespace-nowrap">
                    {dinero(texto2(centavos(f.debe_cuotas) + centavos(f.debe_mora)))}
                  </td>
                  {puedeCobrar && (
                    <td className="px-3 py-2 text-right">
                      <button type="button" className="text-sm text-[#C8102E] hover:underline" onClick={() => onCobrar(f)}>
                        Cobrar
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------- Configuración ----------

function Configuracion({
  token,
  prep,
  onGuardado,
  onSesionVencida,
}: {
  token: string
  prep: PrepararSanes
  onGuardado: () => void
  onSesionVencida: () => void
}) {
  const [d, setD] = useState({
    comisionPct: prep.comisionPct,
    moraPct: prep.moraPct,
    diasGracia: String(prep.diasGracia),
  })
  const [ok, setOk] = useState(false)
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  return (
    <form
      className="flex max-w-md flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault()
        setOk(false)
        void enviar(
          () => configurarSanes(token, d),
          () => {
            setOk(true)
            onGuardado()
          },
        )
      }}
    >
      <h2 className="font-medium">Valores por defecto para los SOL CASH nuevos</h2>
      <p className="text-sm text-gray-500">
        Cada SOL CASH guarda sus propios porcentajes al crearse; cambiar esto no modifica los SOL CASH que ya existen.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        Comisión de SCITO por mano (%)
        <input className={CAMPO} value={d.comisionPct} onChange={(e) => setD({ ...d, comisionPct: e.target.value })} inputMode="decimal" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Mora por cuota atrasada (%)
        <input className={CAMPO} value={d.moraPct} onChange={(e) => setD({ ...d, moraPct: e.target.value })} inputMode="decimal" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Días de gracia antes de cobrar mora
        <input className={CAMPO} value={d.diasGracia} onChange={(e) => setD({ ...d, diasGracia: e.target.value })} inputMode="numeric" />
      </label>
      {error && <CajaError>{error}</CajaError>}
      {ok && <p className="text-sm text-green-700">Guardado.</p>}
      <button type="submit" className={BOTON_PRINCIPAL} disabled={guardando}>
        {guardando ? 'Guardando…' : 'Guardar'}
      </button>
    </form>
  )
}
