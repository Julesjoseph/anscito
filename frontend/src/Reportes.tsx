import { useCallback, useEffect, useState } from 'react'
import { BarChart3, FileSpreadsheet, FileText, RefreshCw } from 'lucide-react'
import { SesionVencida, descargarReporte, generarReporte, opcionesReportes } from './api'
import type {
  AreaReporte,
  ColumnaReporte,
  DatosReporte,
  FiltrosReporte,
  OpcionesReportes,
} from './api'
import { CAMPO, CajaError } from './componentes'
import { mensajeDe } from './formato'

type Props = {
  token: string
  onSesionVencida: () => void
}

const AREAS: [AreaReporte, string][] = [
  ['ventas', 'Ventas y SCITO SERVICE'],
  ['envios', 'SCITO TRANSFER'],
  ['caja_bancos', 'Caja y Bancos'],
  ['inventario', 'Inventario'],
]

// Fechas de hoy en República Dominicana.
function hoy(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date())
}
function rango(tipo: 'hoy' | 'mes' | 'mes_pasado' | 'anio'): [string, string] {
  const h = hoy()
  const [a, m] = h.split('-').map(Number)
  if (tipo === 'hoy') return [h, h]
  if (tipo === 'mes') return [`${a}-${String(m).padStart(2, '0')}-01`, h]
  if (tipo === 'anio') return [`${a}-01-01`, h]
  const am = m === 1 ? a - 1 : a
  const mm = m === 1 ? 12 : m - 1
  const ultimo = new Date(Date.UTC(am, mm, 0)).getUTCDate()
  return [`${am}-${String(mm).padStart(2, '0')}-01`, `${am}-${String(mm).padStart(2, '0')}-${ultimo}`]
}

// Texto de una celda según el tipo de columna (igual que en el Excel y el PDF).
function celda(c: ColumnaReporte, v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return ''
  const s = String(v)
  if (c.tipo === 'dinero') {
    const neg = s.startsWith('-')
    const [e, d = '00'] = (neg ? s.slice(1) : s).split('.')
    return `${neg ? '-' : ''}${e.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${d.padEnd(2, '0')}`
  }
  if (c.tipo === 'cantidad') return s.includes('.') ? s.replace(/\.?0+$/, '') : s
  if (c.tipo === 'porcentaje') return `${s}%`
  if (c.tipo === 'fecha' || c.tipo === 'fechahora') {
    const [a, m, d] = s.slice(0, 10).split('-')
    return `${d}/${m}/${a}${c.tipo === 'fechahora' ? ` ${s.slice(11, 16)}` : ''}`
  }
  return s
}

const NUMERICO = ['dinero', 'entero', 'cantidad', 'porcentaje']

export default function Reportes({ token, onSesionVencida }: Props) {
  const [opciones, setOpciones] = useState<OpcionesReportes | null>(null)
  const [codigo, setCodigo] = useState('')
  const [[desde, hasta], setFechas] = useState<[string, string]>(rango('mes'))
  const [agenteId, setAgenteId] = useState('')
  const [cuentaId, setCuentaId] = useState('')
  const [estado, setEstado] = useState('todos')
  const [datos, setDatos] = useState<DatosReporte | null>(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const [bajando, setBajando] = useState<'' | 'xlsx' | 'pdf'>('')

  const manejar = useCallback(
    (e: unknown) => {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    },
    [onSesionVencida],
  )

  useEffect(() => {
    opcionesReportes(token)
      .then((o) => {
        setOpciones(o)
        setCodigo(o.reportes[0]?.codigo ?? '')
      })
      .catch(manejar)
  }, [token, manejar])

  const necesitaAgente = codigo === 'estado-agente'
  const necesitaCuenta = codigo === 'movimientos-cuenta'
  const usaAgente = necesitaAgente || codigo === 'envios-detalle'
  const soloHasta = codigo === 'inventario'
  const filtros: FiltrosReporte = {
    desde: soloHasta ? hasta : desde,
    hasta,
    agenteId: usaAgente ? agenteId : undefined,
    cuentaId: necesitaCuenta ? cuentaId : undefined,
    estado: codigo === 'envios-detalle' ? estado : undefined,
  }
  const listo = codigo !== '' && (!necesitaAgente || agenteId !== '') && (!necesitaCuenta || cuentaId !== '')
  const clave = JSON.stringify([codigo, filtros])

  // Se actualiza solo al cambiar el reporte o los filtros.
  useEffect(() => {
    if (!listo) {
      const t = setTimeout(() => setDatos(null), 0)
      return () => clearTimeout(t)
    }
    let activo = true
    const t = setTimeout(() => {
      setCargando(true)
      setError('')
      generarReporte(token, codigo, JSON.parse(clave)[1] as FiltrosReporte)
        .then((d) => {
          if (activo) setDatos(d)
        })
        .catch((e) => {
          if (activo) {
            setDatos(null)
            manejar(e)
          }
        })
        .finally(() => {
          if (activo) setCargando(false)
        })
    }, 250)
    return () => {
      activo = false
      clearTimeout(t)
    }
  }, [token, codigo, clave, listo, manejar])

  async function descargar(formato: 'xlsx' | 'pdf') {
    setBajando(formato)
    setError('')
    try {
      const { archivo, nombre } = await descargarReporte(token, codigo, formato, filtros)
      const url = URL.createObjectURL(archivo)
      const a = document.createElement('a')
      a.href = url
      a.download = nombre
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      manejar(e)
    } finally {
      setBajando('')
    }
  }

  if (!opciones) return error ? <CajaError>{error}</CajaError> : <div className="text-gray-500">Cargando…</div>
  if (opciones.reportes.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
        Su usuario no tiene permisos de reportes. Pídale al administrador que se los asigne en Roles y permisos (grupo
        “Reportes”).
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="mb-1 text-xl font-medium">Reportes</h1>
        <p className="text-sm text-gray-500">Elija un reporte y el período. Se puede descargar en Excel o en PDF.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        <nav className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 text-sm">
          {AREAS.filter(([a]) => opciones.reportes.some((r) => r.area === a)).map(([area, nombre]) => (
            <div key={area} className="flex flex-col gap-1">
              <div className="px-2 text-xs font-medium uppercase text-gray-400">{nombre}</div>
              {opciones.reportes
                .filter((r) => r.area === area)
                .map((r) => (
                  <button
                    key={r.codigo}
                    type="button"
                    onClick={() => setCodigo(r.codigo)}
                    className={`rounded-lg px-2 py-1.5 text-left ${codigo === r.codigo ? 'bg-red-50 font-medium text-[#C8102E]' : 'text-gray-700 hover:bg-gray-50'}`}
                  >
                    {r.titulo}
                  </button>
                ))}
            </div>
          ))}
        </nav>

        <section className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-3">
            {!soloHasta && (
              <label className="flex flex-col gap-1 text-xs text-gray-500">
                Desde
                <input type="date" value={desde} max={hasta} onChange={(e) => setFechas([e.target.value || desde, hasta])} className={CAMPO} />
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs text-gray-500">
              {soloHasta ? 'Existencia al día' : 'Hasta'}
              <input type="date" value={hasta} max={hoy()} onChange={(e) => setFechas([desde, e.target.value || hasta])} className={CAMPO} />
            </label>
            {!soloHasta && (
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ['hoy', 'Hoy'],
                    ['mes', 'Este mes'],
                    ['mes_pasado', 'Mes pasado'],
                    ['anio', 'Este año'],
                  ] as const
                ).map(([t, n]) => (
                  <button key={t} type="button" onClick={() => setFechas(rango(t))} className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm hover:bg-gray-50">
                    {n}
                  </button>
                ))}
              </div>
            )}
            {usaAgente && (
              <label className="flex flex-col gap-1 text-xs text-gray-500">
                Agente{necesitaAgente ? '' : ' (opcional)'}
                <select value={agenteId} onChange={(e) => setAgenteId(e.target.value)} className={CAMPO}>
                  <option value="">{necesitaAgente ? 'Seleccione…' : 'Todos'}</option>
                  {opciones.agentes.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.codigo} · {a.nombre}
                      {a.is_active ? '' : ' (inactivo)'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {codigo === 'envios-detalle' && (
              <label className="flex flex-col gap-1 text-xs text-gray-500">
                Estado
                <select value={estado} onChange={(e) => setEstado(e.target.value)} className={CAMPO}>
                  <option value="todos">Todos</option>
                  <option value="confirmado">Confirmados</option>
                  <option value="pendiente">Pendientes</option>
                  <option value="rechazado">Rechazados</option>
                </select>
              </label>
            )}
            {necesitaCuenta && (
              <label className="flex flex-col gap-1 text-xs text-gray-500">
                Cuenta
                <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} className={CAMPO}>
                  <option value="">Seleccione…</option>
                  {opciones.cuentas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre} ({c.simbolo}){c.is_active ? '' : ' (inactiva)'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => void descargar('xlsx')} disabled={!datos || bajando !== ''} className="inline-flex h-10 items-center gap-2 rounded-lg border border-green-700 bg-white px-3 text-sm font-medium text-green-800 hover:bg-green-50 disabled:opacity-50">
                <FileSpreadsheet size={16} /> {bajando === 'xlsx' ? 'Preparando…' : 'Excel'}
              </button>
              <button type="button" onClick={() => void descargar('pdf')} disabled={!datos || bajando !== ''} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#C8102E] bg-white px-3 text-sm font-medium text-[#C8102E] hover:bg-red-50 disabled:opacity-50">
                <FileText size={16} /> {bajando === 'pdf' ? 'Preparando…' : 'PDF'}
              </button>
            </div>
          </div>

          {error && <CajaError>{error}</CajaError>}
          {!listo && (
            <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
              {necesitaAgente ? 'Seleccione el agente.' : 'Seleccione la cuenta.'}
            </div>
          )}

          {datos && listo && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="flex items-center gap-2 font-medium">
                    <BarChart3 size={18} className="text-gray-500" /> {datos.titulo}
                  </h2>
                  <p className="text-sm text-gray-500">
                    {datos.periodo}
                    {datos.detalle && ` · ${datos.detalle}`} · {datos.filas.length} fila{datos.filas.length === 1 ? '' : 's'}
                  </p>
                </div>
                {cargando && <RefreshCw size={16} className="animate-spin text-gray-400" />}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      {datos.columnas.map((c) => (
                        <th key={c.clave} className={`px-2 py-2 font-medium whitespace-nowrap ${NUMERICO.includes(c.tipo) ? 'text-right' : ''}`}>
                          {c.titulo}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {datos.filas.map((f, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        {datos.columnas.map((c) => {
                          const v = celda(c, f[c.clave])
                          return (
                            <td
                              key={c.clave}
                              className={`px-2 py-1.5 ${NUMERICO.includes(c.tipo) ? `text-right whitespace-nowrap ${v.startsWith('-') ? 'text-red-700' : ''}` : ''} ${c.tipo === 'fecha' || c.tipo === 'fechahora' ? 'whitespace-nowrap' : ''}`}
                            >
                              {v}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                    {datos.filas.length === 0 && (
                      <tr>
                        <td colSpan={datos.columnas.length} className="px-2 py-6 text-center text-gray-400">
                          No hay datos en este período.
                        </td>
                      </tr>
                    )}
                    {datos.totales && (
                      <tr className="border-t-2 border-gray-300 font-medium">
                        {datos.columnas.map((c, i) => (
                          <td key={c.clave} className={`px-2 py-2 ${NUMERICO.includes(c.tipo) ? 'text-right whitespace-nowrap' : ''}`}>
                            {i === 0 ? 'TOTAL' : celda(c, datos.totales?.[c.clave])}
                          </td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {datos.notas.map((n) => (
                <p key={n} className="mt-2 text-xs text-gray-500">
                  {n}
                </p>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
