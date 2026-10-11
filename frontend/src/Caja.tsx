import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Eye,
  Lock,
  Monitor,
  Pencil,
  Plus,
  Power,
  Printer,
  Unlock,
  Wallet,
} from 'lucide-react'
import {
  SesionVencida,
  abrirCaja,
  cerrarCaja,
  crearCaja,
  detalleSesionCaja,
  editarCaja,
  estadoCaja,
  listarCajas,
  listarSesionesCaja,
  movimientoCaja,
  obtenerCuadre,
  prepararCaja,
} from './api'
import type {
  FiltrosSesionesCaja,
  FilaCaja,
  FormatoRecibo,
  PaginaSesionesCaja,
  PrepararCaja,
  SesionCaja,
} from './api'
import { cajaDeEstaComputadora, guardarCajaDeEstaComputadora } from './cajaLocal'
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

const NOMBRE_TIPO: Record<string, string> = {
  venta: 'Venta en efectivo',
  devolucion: 'Devolución (venta anulada)',
  gasto: 'Gasto',
  retiro: 'Retiro',
  ingreso: 'Ingreso',
}

// ---------- Dinero con enteros (solo para el conteo en pantalla) ----------

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

function fecha(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('es-DO') : '—'
}

function hoy(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date())
}

// ---------- Imprimir el cuadre ----------

const FORMATOS: [FormatoRecibo, string][] = [
  ['80', 'Rollo 80 mm'],
  ['58', 'Rollo 58 mm'],
  ['carta', 'Hoja carta'],
]

// Mismo tamaño de papel que el comprobante de venta de esta computadora.
function formatoGuardado(): FormatoRecibo {
  try {
    const f = localStorage.getItem('anscito.formatoRecibo')
    if (f === '80' || f === '58' || f === 'carta') return f
  } catch {
    // Sin almacenamiento disponible: se usa el de 80 mm.
  }
  return '80'
}

function BotonCuadre({
  token,
  sesionId,
  abierta,
  onSesionVencida,
}: {
  token: string
  sesionId: string
  abierta: boolean
  onSesionVencida: () => void
}) {
  const [formato, setFormato] = useState<FormatoRecibo>(formatoGuardado)
  const [error, setError] = useState('')
  const [generando, setGenerando] = useState(false)

  async function imprimir() {
    setError('')
    setGenerando(true)
    try {
      localStorage.setItem('anscito.formatoRecibo', formato)
    } catch {
      // No pasa nada si no se puede recordar.
    }
    // La pestaña se abre en el mismo clic para que el navegador no la bloquee.
    const pestana = window.open('', '_blank')
    try {
      const pdf = await obtenerCuadre(token, sesionId, formato)
      const url = URL.createObjectURL(pdf)
      if (pestana) {
        pestana.location.href = url
      } else {
        const a = document.createElement('a')
        a.href = url
        a.download = 'cuadre.pdf'
        a.click()
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      pestana?.close()
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    } finally {
      setGenerando(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={formato}
          onChange={(e) => setFormato(e.target.value as FormatoRecibo)}
          className="h-10 rounded-lg border border-gray-300 px-2 text-sm"
          aria-label="Tamaño del papel"
        >
          {FORMATOS.map(([id, nombre]) => (
            <option key={id} value={id}>
              {nombre}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void imprimir()} disabled={generando} className={`${BOTON_SECUNDARIO} inline-flex items-center gap-2`}>
          <Printer size={16} /> {generando ? 'Generando…' : abierta ? 'Imprimir estado' : 'Imprimir cuadre'}
        </button>
      </div>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}

// ---------- Abrir ----------

function FormAbrir({
  token,
  caja,
  onListo,
  onSesionVencida,
}: {
  token: string
  caja: FilaCaja
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [fondo, setFondo] = useState('')
  const [notas, setNotas] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setGuardando(true)
    setError('')
    try {
      await abrirCaja(token, caja.id, { fondoInicial: fondo.trim(), notas })
      onListo()
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Fondo inicial (RD$)
        <input
          type="text"
          inputMode="decimal"
          value={fondo}
          onChange={(e) => setFondo(e.target.value)}
          placeholder="0.00"
          className={`${CAMPO} text-lg`}
          autoFocus
        />
        <span className="text-xs text-gray-500">El cambio con que empieza la caja (puede ser 0).</span>
      </label>
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Notas (opcional)
        <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} className={AREA} />
      </label>
      {error && <CajaError>{error}</CajaError>}
      <button type="submit" disabled={guardando || !MONTO.test(fondo.trim())} className={BOTON_PRINCIPAL}>
        <Unlock size={16} /> {guardando ? 'Abriendo…' : `Abrir ${caja.nombre}`}
      </button>
    </form>
  )
}

// ---------- Gasto, retiro o ingreso ----------

function FormMovimiento({
  token,
  sesionId,
  esperado,
  prep,
  onListo,
  onSesionVencida,
}: {
  token: string
  sesionId: string
  esperado: string
  prep: PrepararCaja
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [tipo, setTipo] = useState<'gasto' | 'retiro' | 'ingreso'>('gasto')
  const [monto, setMonto] = useState('')
  const [categoria, setCategoria] = useState('')
  const [comprobante, setComprobante] = useState('')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const valido = MONTO.test(monto.trim()) && centavos(monto.trim()) > 0n
  const sale = tipo !== 'ingreso'
  const pasa = valido && sale && centavos(monto.trim()) > centavos(esperado)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setGuardando(true)
    setError('')
    try {
      await movimientoCaja(token, sesionId, {
        tipo,
        monto: monto.trim(),
        categoriaGastoId: tipo === 'gasto' ? categoria : undefined,
        comprobante: tipo === 'gasto' ? comprobante.trim() || undefined : undefined,
        motivo,
      })
      onListo()
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-3">
      <div className="flex gap-2">
        {(
          [
            ['gasto', 'Gasto', 'Se pagó algo con dinero de la caja'],
            ['retiro', 'Retiro', 'Se sacó dinero (ej: depósito al banco)'],
            ['ingreso', 'Ingreso', 'Se puso dinero (ej: más cambio)'],
          ] as const
        ).map(([id, nombre, ayuda]) => (
          <button
            key={id}
            type="button"
            title={ayuda}
            onClick={() => setTipo(id)}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm ${tipo === id ? 'border-[#C8102E] bg-red-50 font-medium text-[#C8102E]' : 'border-gray-300 hover:bg-gray-50'}`}
          >
            {nombre}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500">
        {tipo === 'gasto'
          ? 'Un pago hecho con dinero de la caja (resta).'
          : tipo === 'retiro'
            ? 'Dinero que se saca de la caja, por ejemplo para depositarlo (resta).'
            : 'Dinero que se agrega a la caja, por ejemplo más cambio (suma).'}{' '}
        En la caja hay ahora {dinero(esperado)}.
      </p>
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Monto (RD$)
        <input type="text" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" className={`${CAMPO} text-lg`} autoFocus />
        {pasa && <span className="text-xs text-red-600">Es más de lo que hay en la caja ({dinero(esperado)}).</span>}
      </label>
      {tipo === 'gasto' && (
        <>
          <label className="flex flex-col gap-1 text-sm text-gray-600">
            Categoría
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className={CAMPO}>
              <option value="">Seleccione…</option>
              {prep.categoriasGasto.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-600">
            Comprobante (opcional)
            <input type="text" value={comprobante} onChange={(e) => setComprobante(e.target.value.toUpperCase())} placeholder="NCF o número de la factura" className={`${CAMPO} font-mono`} />
          </label>
        </>
      )}
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Motivo
        <input
          type="text"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder={tipo === 'gasto' ? 'Ej: cloro y jabón' : tipo === 'retiro' ? 'Ej: depósito al banco' : 'Ej: cambio que trajo el dueño'}
          className={CAMPO}
        />
      </label>
      {error && <CajaError>{error}</CajaError>}
      <button
        type="submit"
        disabled={guardando || !valido || pasa || motivo.trim().length < 5 || (tipo === 'gasto' && !categoria)}
        className={BOTON_PRINCIPAL}
      >
        {guardando ? 'Guardando…' : `Registrar ${tipo}`}
      </button>
    </form>
  )
}

// ---------- Cerrar contando billetes y monedas ----------

function FormCerrar({
  token,
  sesion,
  prep,
  onListo,
  onSesionVencida,
}: {
  token: string
  sesion: SesionCaja
  prep: PrepararCaja
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [conteo, setConteo] = useState<Record<string, string>>({})
  const [motivo, setMotivo] = useState('')
  const [notas, setNotas] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const cantidades = useMemo(() => {
    const r: Record<string, number> = {}
    for (const d of prep.denominaciones) {
      const t = (conteo[d] ?? '').trim()
      if (/^\d{1,6}$/.test(t) && Number(t) > 0) r[d] = Number(t)
    }
    return r
  }, [conteo, prep.denominaciones])
  const invalido = prep.denominaciones.some((d) => {
    const t = (conteo[d] ?? '').trim()
    return t !== '' && !/^\d{1,6}$/.test(t)
  })
  const contado = Object.entries(cantidades).reduce((s, [d, n]) => s + BigInt(d) * 100n * BigInt(n), 0n)
  const diferencia = contado - centavos(sesion.esperado)
  const pideMotivo = diferencia !== 0n

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setGuardando(true)
    setError('')
    try {
      await cerrarCaja(token, sesion.id, { conteo: cantidades, motivo, notas })
      onListo()
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-3 text-sm">
      <p className="text-gray-600">
        Cuente el dinero de la caja y escriba cuántos billetes y monedas hay de cada uno. Una vez
        cerrada, la sesión <span className="font-medium">no se puede volver a abrir</span>.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {prep.denominaciones.map((d) => {
          const n = cantidades[d] ?? 0
          return (
            <label key={d} className="flex flex-col gap-1 rounded-lg border border-gray-200 p-2">
              <span className="font-medium">RD${Number(d).toLocaleString('en-US')}</span>
              <input
                type="text"
                inputMode="numeric"
                value={conteo[d] ?? ''}
                onChange={(e) => setConteo({ ...conteo, [d]: e.target.value })}
                placeholder="0"
                aria-label={`Cantidad de RD$${d}`}
                className={`${CAMPO} h-9`}
              />
              <span className="text-xs text-gray-500">{n > 0 ? dinero(texto2(BigInt(d) * 100n * BigInt(n))) : '—'}</span>
            </label>
          )
        })}
      </div>
      {invalido && <span className="text-xs text-red-600">Escriba solo números enteros en las cantidades.</span>}
      <dl className="flex flex-col gap-1 border-y border-gray-100 py-3">
        <div className="flex justify-between"><dt className="text-gray-500">Debería haber</dt><dd className="font-medium">{dinero(sesion.esperado)}</dd></div>
        <div className="flex justify-between"><dt className="text-gray-500">Contado</dt><dd className="font-medium">{dinero(texto2(contado))}</dd></div>
        <div className={`flex justify-between text-base font-medium ${diferencia === 0n ? 'text-green-700' : 'text-red-700'}`}>
          <dt>{diferencia === 0n ? 'Cuadra' : diferencia < 0n ? 'Falta' : 'Sobra'}</dt>
          <dd>{dinero(texto2(diferencia < 0n ? -diferencia : diferencia))}</dd>
        </div>
      </dl>
      {pideMotivo && (
        <label className="flex flex-col gap-1 text-gray-600">
          Motivo de la diferencia (obligatorio)
          <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: se dio devuelta de más" className={CAMPO} />
        </label>
      )}
      <label className="flex flex-col gap-1 text-gray-600">
        Notas (opcional)
        <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} className={AREA} />
      </label>
      {error && <CajaError>{error}</CajaError>}
      <button type="submit" disabled={guardando || invalido || (pideMotivo && motivo.trim().length < 5)} className={BOTON_PRINCIPAL}>
        <Lock size={16} /> {guardando ? 'Cerrando…' : 'Cerrar la caja'}
      </button>
    </form>
  )
}

// ---------- Sesión (detalle, movimientos y acciones) ----------

function VerSesion({
  token,
  id,
  permisos,
  prep,
  onCambio,
  onSesionVencida,
}: {
  token: string
  id: string
  permisos: string[]
  prep: PrepararCaja | null
  onCambio: () => void
  onSesionVencida: () => void
}) {
  const [s, setS] = useState<SesionCaja | null>(null)
  const [error, setError] = useState('')
  const [accion, setAccion] = useState<'movimiento' | 'cerrar' | null>(null)

  const cargar = useCallback(async () => {
    try {
      setS(await detalleSesionCaja(token, id))
      setError('')
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, id, onSesionVencida])

  useEffect(() => {
    const espera = setTimeout(() => void cargar(), 0)
    return () => clearTimeout(espera)
  }, [cargar])

  function listo() {
    setAccion(null)
    void cargar()
    onCambio()
  }

  if (!s) return error ? <CajaError>{error}</CajaError> : <div className="text-gray-500">Cargando…</div>
  const abierta = s.estado === 'abierta'

  if (accion && prep) {
    return (
      <div className="flex flex-col gap-3">
        <button type="button" onClick={() => setAccion(null)} className="inline-flex items-center gap-1 self-start text-sm text-gray-500 hover:text-gray-800">
          <ChevronLeft size={16} /> Volver a la sesión
        </button>
        {accion === 'movimiento' ? (
          <FormMovimiento token={token} sesionId={s.id} esperado={s.esperado} prep={prep} onListo={listo} onSesionVencida={onSesionVencida} />
        ) : (
          <FormCerrar token={token} sesion={s} prep={prep} onListo={listo} onSesionVencida={onSesionVencida} />
        )}
      </div>
    )
  }

  const t = s.totales
  const dif = s.diferencia

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-mono text-lg font-medium">{s.sesion_texto}</div>
          <div className="text-gray-500">{s.caja} · {s.sucursal}</div>
          <div className="text-gray-500">Abierta: {fecha(s.abierta_en)} por {s.abierta_por_usuario}</div>
          {s.cerrada_en && <div className="text-gray-500">Cerrada: {fecha(s.cerrada_en)} por {s.cerrada_por_usuario}</div>}
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${abierta ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
          {abierta ? 'Abierta' : 'Cerrada'}
        </span>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        <div className="flex justify-between"><dt className="text-gray-500">Fondo inicial</dt><dd>{dinero(s.fondo_inicial)}</dd></div>
        <div className="flex justify-between"><dt className="text-gray-500">+ Ventas en efectivo ({t.cantidad_ventas})</dt><dd>{dinero(t.ventas)}</dd></div>
        <div className="flex justify-between"><dt className="text-gray-500">+ Ingresos</dt><dd>{dinero(t.ingresos)}</dd></div>
        <div className="flex justify-between"><dt className="text-gray-500">− Gastos</dt><dd>{dinero(t.gastos)}</dd></div>
        <div className="flex justify-between"><dt className="text-gray-500">− Retiros</dt><dd>{dinero(t.retiros)}</dd></div>
        <div className="flex justify-between"><dt className="text-gray-500">− Devoluciones</dt><dd>{dinero(t.devoluciones)}</dd></div>
      </dl>
      <div className="flex flex-col gap-1 rounded-lg bg-gray-50 p-3">
        <div className="flex justify-between text-base font-medium"><span>Debería haber</span><span>{dinero(s.esperado)}</span></div>
        {s.contado !== null && dif !== null && (
          <>
            <div className="flex justify-between"><span>Contado</span><span>{dinero(s.contado)}</span></div>
            <div className={`flex justify-between font-medium ${dif === '0.00' ? 'text-green-700' : 'text-red-700'}`}>
              <span>{dif === '0.00' ? 'Cuadró' : dif.startsWith('-') ? 'Faltante' : 'Sobrante'}</span>
              <span>{dinero(dif.replace('-', ''))}</span>
            </div>
            {s.motivo_diferencia && <div className="text-gray-600">Motivo: {s.motivo_diferencia}</div>}
          </>
        )}
        {s.notas && <div className="text-gray-500">Notas: {s.notas}</div>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {abierta && permisos.includes('caja.movimientos') && (
          <button type="button" onClick={() => setAccion('movimiento')} disabled={!prep} className={`${BOTON_SECUNDARIO} inline-flex items-center gap-2`}>
            <Plus size={16} /> Gasto, retiro o ingreso
          </button>
        )}
        {abierta && permisos.includes('caja.cerrar') && (
          <button type="button" onClick={() => setAccion('cerrar')} disabled={!prep} className={BOTON_PRINCIPAL}>
            <Lock size={16} /> Cerrar y cuadrar
          </button>
        )}
        <BotonCuadre token={token} sesionId={s.id} abierta={abierta} onSesionVencida={onSesionVencida} />
      </div>
      {error && <CajaError>{error}</CajaError>}

      <section>
        <h3 className="mb-2 font-medium">Movimientos</h3>
        {s.movimientos.length === 0 ? (
          <p className="text-gray-400">Todavía no hay movimientos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th className="py-1 pr-2 font-medium">Hora</th>
                  <th className="py-1 pr-2 font-medium">Tipo</th>
                  <th className="py-1 pr-2 font-medium">Detalle</th>
                  <th className="py-1 pr-2 text-right font-medium">Monto</th>
                </tr>
              </thead>
              <tbody>
                {s.movimientos.map((m) => {
                  const suma = m.tipo === 'venta' || m.tipo === 'ingreso'
                  return (
                    <tr key={m.id} className="border-t border-gray-100 align-top">
                      <td className="py-1.5 pr-2 whitespace-nowrap text-gray-500">{new Date(m.fecha).toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit' })}</td>
                      <td className="py-1.5 pr-2">{NOMBRE_TIPO[m.tipo] ?? m.tipo}</td>
                      <td className="py-1.5 pr-2 text-gray-600">
                        {[m.venta, m.categoria, m.comprobante, m.motivo].filter(Boolean).join(' · ')}
                        <span className="block text-xs text-gray-400">{m.usuario}</span>
                      </td>
                      <td className={`py-1.5 pr-2 text-right whitespace-nowrap font-medium ${suma ? 'text-green-700' : 'text-red-700'}`}>
                        {suma ? '+' : '−'}{dinero(m.monto)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

// ---------- Crear o renombrar una caja ----------

function FormCaja({
  token,
  caja,
  onListo,
  onSesionVencida,
}: {
  token: string
  caja: FilaCaja | null
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [codigo, setCodigo] = useState('')
  const [nombre, setNombre] = useState(caja?.nombre ?? '')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setGuardando(true)
    setError('')
    try {
      if (caja) await editarCaja(token, caja.id, nombre)
      else await crearCaja(token, { codigo, nombre })
      onListo()
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-3">
      {!caja && (
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Código
          <input type="text" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} placeholder="CAJA-2" className={`${CAMPO} font-mono`} autoFocus />
          <span className="text-xs text-gray-500">Letras, números o guiones. No se puede cambiar después.</span>
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Nombre
        <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Caja 2" className={CAMPO} autoFocus={!!caja} />
      </label>
      {error && <CajaError>{error}</CajaError>}
      <button type="submit" disabled={guardando || !nombre.trim() || (!caja && !codigo.trim())} className={BOTON_PRINCIPAL}>
        {guardando ? 'Guardando…' : caja ? 'Guardar' : 'Crear caja'}
      </button>
    </form>
  )
}

function FormEstado({
  token,
  caja,
  onListo,
  onSesionVencida,
}: {
  token: string
  caja: FilaCaja
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const desactivar = caja.is_active

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setGuardando(true)
    setError('')
    try {
      await estadoCaja(token, caja.id, !desactivar, desactivar ? motivo : undefined)
      onListo()
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-3 text-sm">
      <p className="text-gray-600">
        {desactivar
          ? `${caja.nombre} dejará de aparecer para abrir y cobrar. Sus sesiones anteriores se conservan.`
          : `${caja.nombre} volverá a estar disponible.`}
      </p>
      {desactivar && (
        <label className="flex flex-col gap-1 text-gray-600">
          Motivo
          <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} className={CAMPO} autoFocus />
        </label>
      )}
      {error && <CajaError>{error}</CajaError>}
      <button
        type="submit"
        disabled={guardando || (desactivar && motivo.trim().length < 5)}
        className={desactivar ? BOTON_PELIGRO : BOTON_PRINCIPAL}
      >
        {desactivar && <AlertTriangle size={16} />}
        {guardando ? 'Guardando…' : desactivar ? 'Desactivar' : 'Activar'}
      </button>
    </form>
  )
}

// ---------- Cajas de hoy ----------

type Modal =
  | { tipo: 'abrir'; caja: FilaCaja }
  | { tipo: 'sesion'; id: string }
  | { tipo: 'caja'; caja: FilaCaja | null }
  | { tipo: 'estado'; caja: FilaCaja }

function Cajas({
  token,
  permisos,
  prep,
  version,
  onCambio,
  onSesionVencida,
}: Props & { prep: PrepararCaja | null; version: number; onCambio: () => void }) {
  const [cajas, setCajas] = useState<FilaCaja[] | null>(null)
  const [error, setError] = useState('')
  const [local, setLocal] = useState<string | null>(cajaDeEstaComputadora)
  const [modal, setModal] = useState<Modal | null>(null)
  const gestionar = permisos.includes('caja.gestionar')

  const cargar = useCallback(async () => {
    try {
      setCajas(await listarCajas(token))
      setError('')
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, onSesionVencida])

  useEffect(() => {
    const espera = setTimeout(() => void cargar(), 0)
    return () => clearTimeout(espera)
  }, [cargar, version])

  function elegirLocal(id: string) {
    guardarCajaDeEstaComputadora(id || null)
    setLocal(id || null)
  }

  function listo() {
    setModal(null)
    onCambio()
  }

  if (!cajas) return error ? <CajaError>{error}</CajaError> : <div className="text-gray-500">Cargando…</div>
  const activas = cajas.filter((c) => c.is_active)
  const visibles = gestionar ? cajas : activas
  const miCaja = activas.find((c) => c.id === local)

  return (
    <div className="flex flex-col gap-4">
      {error && <CajaError>{error}</CajaError>}

      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <Monitor size={20} className="text-gray-500" />
        <div className="flex-1 text-sm">
          <div className="font-medium">Esta computadora</div>
          <div className="text-gray-500">
            {miCaja
              ? `Cobra en efectivo con ${miCaja.nombre}${miCaja.sesion_id ? ' (abierta)' : ' (cerrada: ábrala para cobrar en efectivo)'}.`
              : 'No tiene caja asignada: elija cuál es para poder cobrar en efectivo.'}
          </div>
        </div>
        <select value={miCaja?.id ?? ''} onChange={(e) => elegirLocal(e.target.value)} className={`${CAMPO} min-w-40`} aria-label="Caja de esta computadora">
          <option value="">Sin caja</option>
          {activas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </section>

      {gestionar && (
        <div className="flex justify-end">
          <button type="button" onClick={() => setModal({ tipo: 'caja', caja: null })} className={BOTON_SECUNDARIO}>
            <span className="inline-flex items-center gap-2"><Plus size={16} /> Nueva caja</span>
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visibles.map((c) => {
          const abierta = c.sesion_id !== null
          return (
            <div key={c.id} className={`flex flex-col gap-3 rounded-xl border bg-white p-4 ${c.is_active ? 'border-gray-200' : 'border-dashed border-gray-300 opacity-70'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    <Wallet size={18} className="text-gray-500" />
                    {c.nombre}
                    {c.id === miCaja?.id && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-normal text-blue-700">Esta computadora</span>}
                  </div>
                  <div className="text-xs text-gray-500">{c.codigo} · {c.sucursal}</div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${!c.is_active ? 'bg-gray-100 text-gray-500' : abierta ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                  {!c.is_active ? 'Inactiva' : abierta ? 'Abierta' : 'Cerrada'}
                </span>
              </div>
              {abierta ? (
                <div className="text-sm">
                  <div className="text-2xl font-medium">{dinero(c.esperado)}</div>
                  <div className="text-xs text-gray-500">
                    Debería haber · {c.sesion_texto} · abierta por {c.abierta_por} el {fecha(c.abierta_en)} con {dinero(c.fondo_inicial)}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-400">Sin sesión abierta.</div>
              )}
              <div className="flex flex-wrap gap-2">
                {abierta && c.sesion_id && (
                  <button type="button" onClick={() => setModal({ tipo: 'sesion', id: c.sesion_id as string })} className={BOTON_PRINCIPAL}>
                    <Eye size={16} /> Ver, registrar y cerrar
                  </button>
                )}
                {!abierta && c.is_active && permisos.includes('caja.abrir') && (
                  <button type="button" onClick={() => setModal({ tipo: 'abrir', caja: c })} className={BOTON_PRINCIPAL}>
                    <Unlock size={16} /> Abrir caja
                  </button>
                )}
                {gestionar && (
                  <>
                    <button type="button" onClick={() => setModal({ tipo: 'caja', caja: c })} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label={`Renombrar ${c.nombre}`} title="Renombrar">
                      <Pencil size={16} />
                    </button>
                    {!abierta && (
                      <button type="button" onClick={() => setModal({ tipo: 'estado', caja: c })} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label={c.is_active ? `Desactivar ${c.nombre}` : `Activar ${c.nombre}`} title={c.is_active ? 'Desactivar' : 'Activar'}>
                        <Power size={16} />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}
        {visibles.length === 0 && <p className="text-sm text-gray-500">No hay cajas activas.</p>}
      </div>

      {modal?.tipo === 'abrir' && (
        <Ventana titulo={`Abrir ${modal.caja.nombre}`} onCerrar={() => setModal(null)}>
          <FormAbrir token={token} caja={modal.caja} onListo={listo} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
      {modal?.tipo === 'sesion' && (
        <Ventana titulo="Sesión de caja" ancho="max-w-3xl" onCerrar={() => setModal(null)}>
          <VerSesion token={token} id={modal.id} permisos={permisos} prep={prep} onCambio={onCambio} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
      {modal?.tipo === 'caja' && (
        <Ventana titulo={modal.caja ? `Renombrar ${modal.caja.nombre}` : 'Nueva caja'} onCerrar={() => setModal(null)}>
          <FormCaja token={token} caja={modal.caja} onListo={listo} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
      {modal?.tipo === 'estado' && (
        <Ventana titulo={modal.caja.is_active ? `Desactivar ${modal.caja.nombre}` : `Activar ${modal.caja.nombre}`} onCerrar={() => setModal(null)}>
          <FormEstado token={token} caja={modal.caja} onListo={listo} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
    </div>
  )
}

// ---------- Historial de sesiones ----------

function Historial({
  token,
  permisos,
  prep,
  version,
  onCambio,
  onSesionVencida,
}: Props & { prep: PrepararCaja | null; version: number; onCambio: () => void }) {
  const [filtros, setFiltros] = useState<FiltrosSesionesCaja>({ cajaId: '', desde: '', hasta: hoy(), estado: 'todas', pagina: 1 })
  const [datos, setDatos] = useState<PaginaSesionesCaja | null>(null)
  const [cajas, setCajas] = useState<FilaCaja[]>([])
  const [error, setError] = useState('')
  const [abierta, setAbierta] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      setDatos(await listarSesionesCaja(token, filtros))
      setError('')
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, filtros, onSesionVencida])

  useEffect(() => {
    const espera = setTimeout(() => void cargar(), 0)
    return () => clearTimeout(espera)
  }, [cargar, version])

  useEffect(() => {
    listarCajas(token).then(setCajas).catch(() => setCajas([]))
  }, [token])

  const paginas = datos ? Math.max(1, Math.ceil(datos.total / datos.porPagina)) : 1

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Caja
          <select value={filtros.cajaId} onChange={(e) => setFiltros({ ...filtros, cajaId: e.target.value, pagina: 1 })} className={CAMPO}>
            <option value="">Todas</option>
            {cajas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
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
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Estado
          <select value={filtros.estado} onChange={(e) => setFiltros({ ...filtros, estado: e.target.value as FiltrosSesionesCaja['estado'], pagina: 1 })} className={CAMPO}>
            <option value="todas">Todas</option>
            <option value="abiertas">Abiertas</option>
            <option value="cerradas">Cerradas</option>
          </select>
        </label>
      </div>
      {error && <CajaError>{error}</CajaError>}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">Sesión</th>
              <th className="px-3 py-2 font-medium">Caja</th>
              <th className="px-3 py-2 font-medium">Abierta</th>
              <th className="px-3 py-2 font-medium">Cerrada</th>
              <th className="px-3 py-2 text-right font-medium">Debería haber</th>
              <th className="px-3 py-2 text-right font-medium">Contado</th>
              <th className="px-3 py-2 text-right font-medium">Diferencia</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {datos?.filas.map((f) => {
              const dif = f.diferencia
              return (
                <tr key={f.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-mono">{f.sesion_texto}</td>
                  <td className="px-3 py-2">{f.caja}</td>
                  <td className="px-3 py-2 text-gray-600">{fecha(f.abierta_en)}<span className="block text-xs text-gray-400">{f.abierta_por}</span></td>
                  <td className="px-3 py-2 text-gray-600">
                    {f.estado === 'abierta' ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Abierta</span> : <>{fecha(f.cerrada_en)}<span className="block text-xs text-gray-400">{f.cerrada_por}</span></>}
                  </td>
                  <td className="px-3 py-2 text-right">{f.esperado ? dinero(f.esperado) : '—'}</td>
                  <td className="px-3 py-2 text-right">{f.contado ? dinero(f.contado) : '—'}</td>
                  <td className={`px-3 py-2 text-right font-medium ${dif === null ? '' : dif === '0.00' ? 'text-green-700' : 'text-red-700'}`} title={f.motivo_diferencia ?? undefined}>
                    {dif === null ? '—' : dif === '0.00' ? 'Cuadró' : `${dif.startsWith('-') ? 'Faltan' : 'Sobran'} ${dinero(dif.replace('-', ''))}`}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => setAbierta(f.id)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label={`Ver ${f.sesion_texto}`} title="Ver">
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              )
            })}
            {datos && datos.filas.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">No hay sesiones con esos filtros.</td></tr>
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
      {abierta && (
        <Ventana titulo="Sesión de caja" ancho="max-w-3xl" onCerrar={() => setAbierta(null)}>
          <VerSesion token={token} id={abierta} permisos={permisos} prep={prep} onCambio={onCambio} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
    </div>
  )
}

// ---------- Página ----------

export default function Caja(props: Props) {
  const [seccion, setSeccion] = useState<'cajas' | 'historial'>('cajas')
  const [prep, setPrep] = useState<PrepararCaja | null>(null)
  const [version, setVersion] = useState(0)
  const { token, onSesionVencida } = props

  useEffect(() => {
    prepararCaja(token)
      .then(setPrep)
      .catch((e) => {
        if (e instanceof SesionVencida) onSesionVencida()
      })
  }, [token, onSesionVencida])

  const cambio = () => setVersion((v) => v + 1)

  return (
    <div>
      <div className="mb-4">
        <h1 className="mb-1 text-xl font-medium">Caja</h1>
        <p className="text-sm text-gray-500">
          Abra la caja con su fondo, registre gastos, retiros e ingresos, y ciérrela contando el dinero.
          Las ventas en efectivo entran solas.
        </p>
      </div>
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {(
          [
            ['cajas', 'Cajas'],
            ['historial', 'Historial'],
          ] as const
        ).map(([id, nombre]) => (
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
      {seccion === 'cajas' ? (
        <Cajas {...props} prep={prep} version={version} onCambio={cambio} />
      ) : (
        <Historial {...props} prep={prep} version={version} onCambio={cambio} />
      )}
      <p className="mt-4 text-xs text-gray-400">
        Los movimientos de caja no se pueden modificar ni borrar; una sesión cerrada no se vuelve a abrir.
      </p>
    </div>
  )
}
