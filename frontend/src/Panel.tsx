import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Package,
  PackageX,
  RefreshCw,
  TrendingUp,
} from 'lucide-react'
import { SesionVencida, resumenPanel } from './api'
import type { PeriodoPanel, ResumenPanel } from './api'
import { CajaError } from './componentes'
import { cantidad, dinero, mensajeDe } from './formato'

type Props = {
  token: string
  onIr: (pagina: string) => void
  onSesionVencida: () => void
}

const PERIODOS: [PeriodoPanel, string, string][] = [
  ['hoy', 'Hoy', 'ayer a esta hora'],
  ['semana', 'Esta semana', 'la semana pasada'],
  ['mes', 'Este mes', 'el mes pasado'],
  ['trimestre', 'Este trimestre', 'el trimestre pasado'],
  ['anio', 'Este año', 'el año pasado'],
]

function centavos(v: string): bigint {
  const neg = v.startsWith('-')
  const [e, d = ''] = (neg ? v.slice(1) : v).split('.')
  const c = BigInt(e) * 100n + BigInt(d.padEnd(2, '0'))
  return neg ? -c : c
}

// Variación porcentual con 1 decimal (null si no hay base para comparar).
function variacion(actual: string, anterior: string): number | null {
  const a = centavos(anterior)
  if (a <= 0n) return null
  return Number(((centavos(actual) - a) * 1000n) / a) / 10
}

function Tarjeta({
  titulo,
  valor,
  detalle,
  icono,
  alerta = false,
  children,
}: {
  titulo: string
  valor: ReactNode
  detalle?: ReactNode
  icono?: ReactNode
  alerta?: boolean
  children?: ReactNode
}) {
  return (
    <div
      className={`flex flex-col gap-1 rounded-xl border bg-white p-4 ${
        alerta ? 'border-amber-300' : 'border-gray-200'
      }`}
    >
      <div className="flex items-center justify-between text-sm text-gray-500">
        {titulo}
        {icono}
      </div>
      <div className="text-2xl font-medium">{valor}</div>
      {detalle && <div className="text-xs text-gray-500">{detalle}</div>}
      {children}
    </div>
  )
}

function Proximamente({ titulo, modulo }: { titulo: string; modulo: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-dashed border-gray-300 p-4">
      <div className="text-sm text-gray-500">{titulo}</div>
      <div className="text-2xl font-medium text-gray-300">—</div>
      <div className="text-xs text-gray-400">Disponible con el módulo {modulo}</div>
    </div>
  )
}

export default function Panel({ token, onIr, onSesionVencida }: Props) {
  const [periodo, setPeriodo] = useState<PeriodoPanel>('hoy')
  const [datos, setDatos] = useState<ResumenPanel | null>(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      setDatos(await resumenPanel(token, periodo))
      setError('')
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    } finally {
      setCargando(false)
    }
  }, [token, periodo, onSesionVencida])

  // Se actualiza al entrar, al cambiar el período y cada 2 minutos.
  useEffect(() => {
    const primera = setTimeout(() => void cargar(), 0)
    const cada = setInterval(() => void cargar(), 120_000)
    return () => {
      clearTimeout(primera)
      clearInterval(cada)
    }
  }, [cargar])

  const anterior = PERIODOS.find((p) => p[0] === periodo)?.[2] ?? ''
  const v = datos?.ventas
  const g = datos?.ganancia
  const inv = datos?.inventario
  const cambio = v ? variacion(v.total, v.total_anterior) : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mb-1 text-xl font-medium">Resumen</h1>
          {datos && (
            <p className="text-sm text-gray-500">
              Desde el {new Date(datos.desde).toLocaleDateString('es-DO', { timeZone: 'America/Santo_Domingo', day: 'numeric', month: 'long', year: 'numeric' })} hasta
              ahora
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {PERIODOS.map(([id, nombre]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPeriodo(id)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                periodo === id
                  ? 'border-[#C8102E] bg-red-50 font-medium text-[#C8102E]'
                  : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {nombre}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void cargar()}
            className="ml-1 rounded-lg p-2 text-gray-500 hover:bg-gray-100"
            aria-label="Actualizar"
            title="Actualizar"
          >
            <RefreshCw size={16} className={cargando ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && <CajaError>{error}</CajaError>}
      {!datos && !error && <div className="text-gray-500">Cargando…</div>}

      {datos && !v && !inv && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
          Su usuario no tiene permisos para ver indicadores de ventas ni de
          inventario. Pídale al administrador que se los asigne en Roles y
          permisos.
        </div>
      )}

      {(v || inv) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {v && (
            <Tarjeta
              titulo="Ventas"
              valor={dinero(v.total)}
              icono={<TrendingUp size={16} />}
              detalle={
                <>
                  {v.cantidad} venta{v.cantidad === 1 ? '' : 's'}
                  {v.anuladas.cantidad > 0 && ` · ${v.anuladas.cantidad} anulada${v.anuladas.cantidad === 1 ? '' : 's'} (no suman)`}
                </>
              }
            >
              <div className="text-xs">
                {cambio === null ? (
                  <span className="text-gray-400">Sin ventas {anterior} para comparar</span>
                ) : (
                  <span className={`inline-flex items-center gap-1 ${cambio >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {cambio >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                    {cambio >= 0 ? '+' : ''}
                    {cambio}% frente a {anterior}
                  </span>
                )}
              </div>
            </Tarjeta>
          )}
          {v && (
            <Tarjeta
              titulo="Cobrado por forma de pago"
              valor={dinero(v.total)}
              detalle={
                v.por_forma_pago.length === 0
                  ? 'Sin cobros en el período'
                  : v.por_forma_pago.map((p) => `${p.forma}: ${dinero(p.total)}`).join(' · ')
              }
            />
          )}
          {g && (
            <Tarjeta
              titulo="Ganancia bruta estimada"
              valor={dinero(g.ganancia)}
              detalle={
                <>
                  {g.margen !== null && `Margen ${g.margen}% · `}venta sin ITBIS {dinero(g.venta)} − costo {dinero(g.costo)}
                  {centavos(g.venta_comision) > 0n && (
                    <span className="block text-gray-500">
                      Incluye {dinero(g.ganancia_comision)} de comisiones sobre {dinero(g.venta_comision)} en servicios
                    </span>
                  )}
                  {centavos(g.venta_sin_costo) > 0n && (
                    <span className="block text-amber-700">
                      {dinero(g.venta_sin_costo)} vendidos sin costo ni comisión (contados como ganancia completa)
                    </span>
                  )}
                </>
              }
            />
          )}
          {v && (
            <Tarjeta
              titulo="ITBIS cobrado"
              valor={dinero(v.itbis)}
              detalle={`Base imponible ${dinero(v.base)}${centavos(v.descuento) > 0n ? ` · descuentos ${dinero(v.descuento)}` : ''}`}
            />
          )}
          {inv && (
            <Tarjeta
              titulo="Alertas de inventario"
              alerta={inv.bajo + inv.agotado > 0}
              icono={inv.bajo + inv.agotado > 0 ? <AlertTriangle size={16} className="text-amber-600" /> : <Package size={16} />}
              valor={inv.bajo + inv.agotado === 0 ? 'Todo en orden' : `${inv.bajo + inv.agotado} producto${inv.bajo + inv.agotado === 1 ? '' : 's'}`}
              detalle={`${inv.bajo} con stock bajo · ${inv.agotado} agotado${inv.agotado === 1 ? '' : 's'} · de ${inv.productos} activos`}
            >
              <button type="button" onClick={() => onIr('inventario')} className="self-start text-xs text-[#C8102E] hover:underline">
                Ver inventario
              </button>
            </Tarjeta>
          )}
          {inv?.valor_al_costo !== undefined && (
            <Tarjeta
              titulo="Valor del inventario"
              valor={dinero(inv.valor_al_costo)}
              detalle="Existencia actual × costo promedio, sin ITBIS (hoy, no depende del período)"
            />
          )}
          <Proximamente titulo="Efectivo en caja" modulo="Caja y bancos" />
          <Proximamente titulo="Cuentas por cobrar" modulo="Cuentas por cobrar" />
        </div>
      )}

      {(v || inv) && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {v && (
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-medium">Más vendidos</h2>
              {v.mas_vendidos.length === 0 ? (
                <p className="text-sm text-gray-400">Sin ventas en el período.</p>
              ) : (
                <ol className="flex flex-col gap-2 text-sm">
                  {v.mas_vendidos.map((t, i) => (
                    <li key={t.codigo} className="flex justify-between gap-2">
                      <span>
                        <span className="mr-1 text-gray-400">{i + 1}.</span>
                        {t.descripcion}
                        <span className="block text-xs text-gray-500">
                          {cantidad(t.cantidad)} {t.tipo === 'servicio' ? 'servicio(s)' : 'unidad(es)'}
                        </span>
                      </span>
                      <span className="whitespace-nowrap font-medium">{dinero(t.total)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
          {v && (
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-medium">Últimas ventas</h2>
                <button type="button" onClick={() => onIr('ventas')} className="text-xs text-[#C8102E] hover:underline">
                  Ver ventas
                </button>
              </div>
              {v.ultimas.length === 0 ? (
                <p className="text-sm text-gray-400">Todavía no hay ventas.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {v.ultimas.map((u) => (
                    <li key={u.id} className={`flex justify-between gap-2 ${u.estado === 'anulada' ? 'text-gray-400' : ''}`}>
                      <span>
                        <span className="font-mono">{u.numero}</span> · {u.cliente}
                        <span className="block text-xs text-gray-500">
                          {new Date(u.fecha).toLocaleString('es-DO')}
                          {u.estado === 'anulada' && ' · anulada'}
                        </span>
                      </span>
                      <span className={`whitespace-nowrap font-medium ${u.estado === 'anulada' ? 'line-through' : ''}`}>
                        {dinero(u.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {inv && (
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-medium">Reponer pronto</h2>
              {inv.criticos.length === 0 ? (
                <p className="text-sm text-gray-400">Ningún producto en el mínimo.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {inv.criticos.map((c) => (
                    <li key={c.codigo} className="flex justify-between gap-2">
                      <span>
                        {c.nombre}
                        <span className="block font-mono text-xs text-gray-500">{c.codigo}</span>
                      </span>
                      <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium ${Number(c.existencia) <= 0 ? 'text-red-700' : 'text-amber-800'}`}>
                        {Number(c.existencia) <= 0 ? <PackageX size={12} /> : <AlertTriangle size={12} />}
                        {cantidad(c.existencia)} de mín. {cantidad(c.minimo)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}

      <p className="text-xs text-gray-400">
        Los montos excluyen las ventas anuladas. La ganancia es una estimación
        sin ITBIS: productos al costo promedio del momento de la venta, y
        servicios según su comisión % o su costo registrado (costo 0 si no
        tienen ninguno). Los indicadores contables y de caja llegarán con sus módulos.
      </p>
    </div>
  )
}
