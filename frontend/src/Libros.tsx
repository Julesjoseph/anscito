import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Download, RefreshCw } from 'lucide-react'
import { SesionVencida } from './api'
import type { CuentaContable } from './api'
import { cambiarCierreFiscal, descargarLibro, estadosFinancieros, libroMayor } from './api-libros'
import type { EstadosFinancieros, LibroMayor, SeccionEstado } from './api-libros'
import { BOTON_SECUNDARIO, CAMPO, CajaError } from './componentes'
import { dinero, mensajeDe } from './formato'

// Libro mayor por cuenta y estados financieros (estado de resultados y
// balance general), con descarga en Excel y PDF.

function fechaCorta(dia: string): string {
  const [a, m, d] = dia.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

const CIERRES: [string, string][] = [
  ['12-31', '31 de diciembre'],
  ['03-31', '31 de marzo'],
  ['06-30', '30 de junio'],
  ['09-30', '30 de septiembre'],
]

function useDescarga(token: string, onSesionVencida: () => void, setError: (e: string) => void) {
  const [bajando, setBajando] = useState(false)
  async function bajar(reporte: 'balance' | 'resultados' | 'mayor', formato: 'xlsx' | 'pdf', f: Record<string, string>) {
    setBajando(true)
    setError('')
    try {
      const { archivo, nombre } = await descargarLibro(token, reporte, formato, f)
      const url = URL.createObjectURL(archivo)
      const a = document.createElement('a')
      a.href = url
      a.download = nombre
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    } finally {
      setBajando(false)
    }
  }
  return { bajando, bajar }
}

function Botones({ disabled, onBajar }: { disabled: boolean; onBajar: (formato: 'xlsx' | 'pdf') => void }) {
  return (
    <div className="flex gap-2">
      <button type="button" className={`${BOTON_SECUNDARIO} flex items-center gap-2`} disabled={disabled} onClick={() => onBajar('xlsx')}>
        <Download size={14} /> Excel
      </button>
      <button type="button" className={`${BOTON_SECUNDARIO} flex items-center gap-2`} disabled={disabled} onClick={() => onBajar('pdf')}>
        <Download size={14} /> PDF
      </button>
    </div>
  )
}

function Fechas({ desde, hasta, setDesde, setHasta, extra }: { desde: string; hasta: string; setDesde: (v: string) => void; setHasta: (v: string) => void; extra?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Desde
        <input type="date" className={CAMPO} value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Hasta
        <input type="date" className={CAMPO} value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
      </label>
      {extra}
    </div>
  )
}

// ---------- Estados financieros ----------

function Seccion({ titulo, s, etiquetaTotal }: { titulo: string; s: SeccionEstado; etiquetaTotal?: string }) {
  return (
    <>
      <tr className="bg-gray-50">
        <td colSpan={2} className="px-3 py-1.5 text-xs font-semibold tracking-wide text-gray-600 uppercase">
          {titulo}
        </td>
      </tr>
      {s.grupos.length === 0 && (
        <tr>
          <td colSpan={2} className="px-3 py-1 text-gray-400">
            Sin saldo
          </td>
        </tr>
      )}
      {s.grupos.map((g) => (
        <GrupoFilas key={g.grupo} g={g} />
      ))}
      <tr className="border-t border-gray-200 font-medium">
        <td className="px-3 py-1.5">{etiquetaTotal ?? `Total ${titulo.toLowerCase()}`}</td>
        <td className="px-3 py-1.5 text-right">{dinero(s.total)}</td>
      </tr>
    </>
  )
}

function GrupoFilas({ g }: { g: SeccionEstado['grupos'][number] }) {
  return (
    <>
      <tr>
        <td className="px-3 pt-2 pb-1 text-gray-700">{g.grupo}</td>
        <td />
      </tr>
      {g.cuentas.map((c) => (
        <tr key={c.codigo} className="text-gray-600">
          <td className="py-0.5 pr-3 pl-7">
            <span className="font-mono text-xs text-gray-400">{c.codigo}</span> {c.nombre}
          </td>
          <td className="px-3 py-0.5 text-right">{dinero(c.monto)}</td>
        </tr>
      ))}
      <tr className="text-gray-700">
        <td className="py-0.5 pr-3 pl-7 italic">Total {g.grupo}</td>
        <td className="px-3 py-0.5 text-right italic">{dinero(g.total)}</td>
      </tr>
    </>
  )
}

function Resultado({ nombre, valor, fuerte }: { nombre: string; valor: string; fuerte?: boolean }) {
  return (
    <tr className={`border-t-2 border-gray-200 ${fuerte ? 'text-base font-semibold' : 'font-medium'}`}>
      <td className="px-3 py-2">{nombre}</td>
      <td className={`px-3 py-2 text-right ${valor.startsWith('-') ? 'text-red-700' : ''}`}>{dinero(valor)}</td>
    </tr>
  )
}

export function Estados({ token, hoy, puedeCerrar, onSesionVencida }: { token: string; hoy: string; puedeCerrar: boolean; onSesionVencida: () => void }) {
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState(hoy)
  const [datos, setDatos] = useState<EstadosFinancieros | null>(null)
  const [vista, setVista] = useState<'resultados' | 'balance'>('resultados')
  const [error, setError] = useState('')
  const { bajando, bajar } = useDescarga(token, onSesionVencida, setError)

  const cargar = useCallback(async () => {
    setError('')
    try {
      const d = await estadosFinancieros(token, desde, hasta)
      setDatos(d)
      if (!desde) setDesde(d.desde)
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, desde, hasta, onSesionVencida])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function cambiarCierre(v: string) {
    setError('')
    try {
      await cambiarCierreFiscal(token, v)
      setDesde('')
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['resultados', 'Estado de resultados'],
            ['balance', 'Balance general'],
          ] as const
        ).map(([id, nombre]) => (
          <button
            key={id}
            type="button"
            onClick={() => setVista(id)}
            className={`rounded-lg border px-3 py-2 text-sm ${vista === id ? 'border-[#C8102E] bg-red-50 font-medium text-[#C8102E]' : 'border-gray-300 hover:bg-gray-50'}`}
          >
            {nombre}
          </button>
        ))}
      </div>
      <Fechas
        desde={desde}
        hasta={hasta}
        setDesde={setDesde}
        setHasta={setHasta}
        extra={
          <>
            <button type="button" className={BOTON_SECUNDARIO} onClick={() => void cargar()} aria-label="Actualizar">
              <RefreshCw size={16} />
            </button>
            <Botones disabled={bajando || !datos} onBajar={(formato) => void bajar(vista, formato, { desde, hasta })} />
          </>
        }
      />
      {datos && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          Año fiscal: cierra el
          {puedeCerrar ? (
            <select className={`${CAMPO} h-8 text-sm`} value={datos.cierreFiscal} onChange={(e) => void cambiarCierre(e.target.value)} aria-label="Cierre del año fiscal">
              {CIERRES.map(([v, n]) => (
                <option key={v} value={v}>
                  {n}
                </option>
              ))}
            </select>
          ) : (
            <strong>{CIERRES.find(([v]) => v === datos.cierreFiscal)?.[1]}</strong>
          )}
          · el ejercicio actual empieza el {fechaCorta(datos.inicioEjercicio)}. Confírmelo con su contador.
        </div>
      )}
      {error && <CajaError>{error}</CajaError>}
      {!datos ? (
        !error && <p className="text-sm text-gray-500">Cargando…</p>
      ) : vista === 'resultados' ? (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-3 py-2 text-sm">
            <span className="font-medium">Estado de resultados</span> · del {fechaCorta(datos.desde)} al {fechaCorta(datos.hasta)}
          </div>
          <table className="w-full min-w-[480px] text-sm">
            <tbody>
              <Seccion titulo="Ingresos" s={datos.resultados.ingresos} />
              <Seccion titulo="Costos" s={datos.resultados.costos} />
              <Resultado nombre="Utilidad bruta" valor={datos.resultados.utilidadBruta} />
              <Seccion titulo="Gastos" s={datos.resultados.gastos} />
              <Resultado nombre="Utilidad (pérdida) neta, antes del ISR" valor={datos.resultados.utilidadNeta} fuerte />
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-3 py-2 text-sm">
            <span>
              <span className="font-medium">Balance general</span> · al {fechaCorta(datos.balance.fecha)}
            </span>
            {datos.balance.cuadra ? (
              <span className="flex items-center gap-1 text-green-700">
                <CheckCircle2 size={14} /> Activos = Pasivo + Capital
              </span>
            ) : (
              <span className="flex items-center gap-1 text-red-700">
                <AlertTriangle size={14} /> No cuadra: revise con el contador
              </span>
            )}
          </div>
          <table className="w-full min-w-[480px] text-sm">
            <tbody>
              <Seccion titulo="Activos" s={datos.balance.activos} />
              <Seccion titulo="Pasivos" s={datos.balance.pasivos} />
              <Seccion titulo="Capital" s={datos.balance.capital} etiquetaTotal="Total capital aportado" />
              <tr>
                <td className="px-3 py-1">Utilidades acumuladas (años anteriores)</td>
                <td className="px-3 py-1 text-right">{dinero(datos.balance.utilidadesAcumuladas)}</td>
              </tr>
              <tr>
                <td className="px-3 py-1">Utilidad del ejercicio (desde el {fechaCorta(datos.inicioEjercicio)})</td>
                <td className="px-3 py-1 text-right">{dinero(datos.balance.utilidadEjercicio)}</td>
              </tr>
              <Resultado nombre="Total capital" valor={datos.balance.totalCapital} />
              <Resultado nombre="Total pasivo y capital" valor={datos.balance.totalPasivoCapital} fuerte />
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500">
        Salen de todos los asientos (un asiento anulado y su reverso se cancelan). El catálogo y las reglas son una propuesta: su
        contador debe validarlos antes de usar estos estados para impuestos o bancos.
      </p>
    </div>
  )
}

// ---------- Libro mayor ----------

export function Mayor({ token, hoy, cuentas, onSesionVencida }: { token: string; hoy: string; cuentas: CuentaContable[]; onSesionVencida: () => void }) {
  const detalle = useMemo(() => cuentas.filter((c) => c.acepta_movimientos), [cuentas])
  const [cuentaId, setCuentaId] = useState('')
  const [desde, setDesde] = useState(`${hoy.slice(0, 7)}-01`)
  const [hasta, setHasta] = useState(hoy)
  const [datos, setDatos] = useState<LibroMayor | null>(null)
  const [error, setError] = useState('')
  const { bajando, bajar } = useDescarga(token, onSesionVencida, setError)

  const cargar = useCallback(async () => {
    if (!cuentaId) return
    setError('')
    try {
      setDatos(await libroMayor(token, cuentaId, desde, hasta))
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, cuentaId, desde, hasta, onSesionVencida])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-gray-600 sm:max-w-md">
        Cuenta
        <select className={CAMPO} value={cuentaId} onChange={(e) => setCuentaId(e.target.value)}>
          <option value="">Seleccione la cuenta…</option>
          {detalle.map((c) => (
            <option key={c.id} value={c.id}>
              {c.codigo} · {c.nombre}
              {c.is_active ? '' : ' (inactiva)'}
            </option>
          ))}
        </select>
      </label>
      <Fechas
        desde={desde}
        hasta={hasta}
        setDesde={setDesde}
        setHasta={setHasta}
        extra={<Botones disabled={bajando || !datos} onBajar={(formato) => void bajar('mayor', formato, { cuentaId, desde, hasta })} />}
      />
      {error && <CajaError>{error}</CajaError>}
      {cuentaId && datos && datos.cuenta.id === cuentaId && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-3 py-2 text-sm">
            <span className="font-mono text-xs text-gray-500">{datos.cuenta.codigo}</span> <span className="font-medium">{datos.cuenta.nombre}</span>{' '}
            <span className="text-gray-500">· saldo {datos.cuenta.naturaleza}</span>
          </div>
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Asiento</th>
                <th className="px-3 py-2">Concepto</th>
                <th className="px-3 py-2 text-right">Débito</th>
                <th className="px-3 py-2 text-right">Crédito</th>
                <th className="px-3 py-2 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-gray-100 bg-gray-50">
                <td className="px-3 py-1.5">{fechaCorta(datos.desde)}</td>
                <td />
                <td className="px-3 py-1.5 italic">Saldo anterior</td>
                <td />
                <td />
                <td className="px-3 py-1.5 text-right">{dinero(datos.saldoAnterior)}</td>
              </tr>
              {datos.movimientos.map((m, i) => (
                <tr key={`${m.asientoId}-${i}`} className={`border-t border-gray-100 ${m.estado === 'anulado' ? 'text-gray-400' : ''}`}>
                  <td className="px-3 py-1.5">{fechaCorta(m.fecha)}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{m.asiento}</td>
                  <td className="px-3 py-1.5">
                    {m.concepto}
                    {m.descripcion && <div className="text-xs text-gray-500">{m.descripcion}</div>}
                    {m.estado === 'anulado' && <span className="text-xs"> (anulado)</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right">{m.debito !== '0.00' ? dinero(m.debito) : ''}</td>
                  <td className="px-3 py-1.5 text-right">{m.credito !== '0.00' ? dinero(m.credito) : ''}</td>
                  <td className="px-3 py-1.5 text-right">{dinero(m.saldo)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 font-medium">
              <tr>
                <td colSpan={3} className="px-3 py-2">
                  Totales del período · saldo final
                </td>
                <td className="px-3 py-2 text-right">{dinero(datos.totales.debitos)}</td>
                <td className="px-3 py-2 text-right">{dinero(datos.totales.creditos)}</td>
                <td className="px-3 py-2 text-right">{dinero(datos.saldoFinal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {!cuentaId && <p className="text-sm text-gray-500">Escoja una cuenta para ver sus movimientos.</p>}
    </div>
  )
}
