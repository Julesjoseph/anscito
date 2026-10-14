import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AlertTriangle, Ban, BellRing, CalendarClock, FilePlus2, HandCoins, Pencil, Plus, Receipt, RefreshCw, Search } from 'lucide-react'
import {
  SesionVencida,
  alertasCxp,
  anularPagoProveedor,
  buscarProveedoresCxp,
  configurarDiasCxp,
  guardarGastoFijo,
  listarGastosFijos,
  pagarProveedor,
  pdfPagoProveedor,
  prepararCxp,
  proveedorCxp,
  proveedoresCxp,
  ticketPagoProveedor,
} from './api'
import type { AlertasCxp, AvisoGastoFijo, DetalleProveedorCxp, GastoFijo, PagoCxp, PrepararCxp, ProveedorCxp } from './api'
import BotonesImprimir from './BotonesImprimir'
import { cajaDeEstaComputadora } from './cajaLocal'
import { BOTON_PELIGRO, BOTON_PRINCIPAL, BOTON_SECUNDARIO, CAMPO, CajaError, Ventana } from './componentes'
import { dinero, mensajeDe } from './formato'

// Cuentas por Pagar: lo que se le debe a cada proveedor (facturas a crédito),
// pagos con comprobante PP, su anulación, avisos de vencimiento y gastos fijos.

type Props = {
  token: string
  permisos: string[]
  onSesionVencida: () => void
  // Abre "Reg. Facturas de Compras y Gastos" lleno con el gasto fijo.
  onRegistrarGasto: (aviso: AvisoGastoFijo) => void
}

const MONTO = /^\d{1,12}(\.\d{1,2})?$/

function centavos(v: string): bigint {
  const t = v.trim()
  if (!MONTO.test(t)) return 0n
  const [e, d = ''] = t.split('.')
  return BigInt(e || '0') * 100n + BigInt((d + '00').slice(0, 2))
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

function cuando(dias: number): string {
  if (dias === 0) return 'vence hoy'
  if (dias === 1) return 'vence mañana'
  if (dias > 1) return `vence en ${dias} días`
  return `venció hace ${-dias} día${dias === -1 ? '' : 's'}`
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
  return { error, guardando, enviar }
}

function Campo({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-gray-600">
      {etiqueta}
      {children}
    </label>
  )
}

export default function CuentasPagar({ token, permisos, onSesionVencida, onRegistrarGasto }: Props) {
  const [pestana, setPestana] = useState<'proveedores' | 'gastos'>('proveedores')
  const [prep, setPrep] = useState<PrepararCxp | null>(null)
  const [error, setError] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const cargarPrep = useCallback(async () => {
    try {
      setPrep(await prepararCxp(token))
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, onSesionVencida])

  useEffect(() => {
    void cargarPrep()
  }, [cargarPrep])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-medium">Cuentas por pagar</h1>
        <p className="text-sm text-gray-500">
          Lo que se le debe a cada proveedor por facturas a crédito: pagos (completos o en parte), avisos de vencimiento y gastos
          fijos del mes.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 border-b border-gray-200">
        {(
          [
            ['proveedores', 'Por pagar'],
            ['gastos', 'Gastos fijos'],
          ] as const
        ).map(([id, nombre]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPestana(id)}
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
      ) : pestana === 'proveedores' ? (
        <>
          <Avisos
            key={`a${version}`}
            token={token}
            puedeRegistrar={permisos.includes('compras.registrar')}
            onAbrir={setAbierto}
            onRegistrarGasto={onRegistrarGasto}
            onSesionVencida={onSesionVencida}
          />
          <Lista key={`l${version}`} token={token} onAbrir={setAbierto} onSesionVencida={onSesionVencida} />
        </>
      ) : (
        <GastosFijos
          token={token}
          prep={prep}
          puedeEditar={permisos.includes('cxp.gastos_fijos')}
          onCambioDias={() => void cargarPrep()}
          onSesionVencida={onSesionVencida}
        />
      )}
      {abierto && prep && (
        <ProveedorVista
          token={token}
          prep={prep}
          id={abierto}
          permisos={permisos}
          onCerrar={() => {
            setAbierto(null)
            setVersion((v) => v + 1)
          }}
          onSesionVencida={onSesionVencida}
        />
      )}
    </div>
  )
}

// ---------- Avisos ----------

function Avisos({
  token,
  puedeRegistrar,
  onAbrir,
  onRegistrarGasto,
  onSesionVencida,
}: {
  token: string
  puedeRegistrar: boolean
  onAbrir: (id: string) => void
  onRegistrarGasto: (aviso: AvisoGastoFijo) => void
  onSesionVencida: () => void
}) {
  const [a, setA] = useState<AlertasCxp | null>(null)

  useEffect(() => {
    alertasCxp(token)
      .then(setA)
      .catch((e) => {
        if (e instanceof SesionVencida) onSesionVencida()
      })
  }, [token, onSesionVencida])

  if (!a) return null
  const facturas = [...a.vencidas, ...a.porVencer]
  if (facturas.length === 0 && a.gastosFijos.length === 0) return null

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
      <h2 className="flex items-center gap-2 font-medium text-amber-900">
        <BellRing size={18} /> Avisos (vencidas y lo que vence en los próximos {a.dias} días)
      </h2>
      {facturas.map((f) => (
        <button
          key={f.id}
          type="button"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-left hover:bg-gray-50"
          onClick={() => onAbrir(f.proveedor_id)}
        >
          <span>
            <span className="font-medium">{f.proveedor}</span> · {f.codigo}
            {f.ncf ? ` · ${f.ncf}` : ''}
          </span>
          <span className={f.vencida ? 'font-medium text-red-700' : 'text-amber-800'}>
            {dinero(f.saldo)} · {f.vencida ? `vencida hace ${f.dias_atraso} días` : cuando(f.dias_para_vencer)}
          </span>
        </button>
      ))}
      {a.gastosFijos.map((g) => (
        <div key={`${g.id}-${g.fecha}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2">
          <span className="flex items-center gap-2">
            <CalendarClock size={16} className="text-amber-700" />
            <span>
              <span className="font-medium">{g.nombre}</span> · {g.proveedor}
              {g.monto ? ` · ${dinero(g.monto)}` : ''}
              <span className={`block text-xs ${g.dias < 0 ? 'text-red-700' : 'text-gray-500'}`}>
                {fechaCorta(g.fecha)} · {cuando(g.dias)} · falta registrar la factura
              </span>
            </span>
          </span>
          {puedeRegistrar && (
            <button type="button" className={BOTON_SECUNDARIO} onClick={() => onRegistrarGasto(g)}>
              <span className="flex items-center gap-2">
                <FilePlus2 size={16} /> Registrar factura
              </span>
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ---------- Lista de proveedores ----------

function Lista({ token, onAbrir, onSesionVencida }: { token: string; onAbrir: (id: string) => void; onSesionVencida: () => void }) {
  const [filas, setFilas] = useState<ProveedorCxp[] | null>(null)
  const [texto, setTexto] = useState('')
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    setError('')
    try {
      setFilas(await proveedoresCxp(token))
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, onSesionVencida])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const t = texto.trim().toLowerCase()
  const vistas = (filas ?? []).filter((f) => !t || f.nombre.toLowerCase().includes(t))
  const total = vistas.reduce((a, f) => a + centavos(f.debe), 0n)
  const vencido = vistas.reduce((a, f) => a + centavos(f.vencido), 0n)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search size={16} className="absolute top-3 left-3 text-gray-400" />
          <input className={`${CAMPO} w-full pl-9`} type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar proveedor" />
        </div>
        <button type="button" className={BOTON_SECUNDARIO} onClick={() => void cargar()}>
          <span className="flex items-center gap-2">
            <RefreshCw size={16} /> Actualizar
          </span>
        </button>
      </div>
      {vistas.length > 0 && (
        <p className="text-sm text-gray-600">
          Por pagar: <strong>{dinero(texto2(total))}</strong> · vencido: <strong className="text-red-700">{dinero(texto2(vencido))}</strong>
        </p>
      )}
      {error && <CajaError>{error}</CajaError>}
      {!filas ? (
        !error && <p className="text-sm text-gray-500">Cargando…</p>
      ) : vistas.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
          {filas.length === 0 ? 'No se le debe nada a ningún proveedor.' : 'Ningún proveedor coincide con la búsqueda.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Proveedor</th>
                <th className="px-3 py-2 text-right font-medium">Facturas</th>
                <th className="px-3 py-2 text-right font-medium">Se le debe</th>
                <th className="px-3 py-2 text-right font-medium">Vencido</th>
              </tr>
            </thead>
            <tbody>
              {vistas.map((f) => (
                <tr key={f.id} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50" onClick={() => onAbrir(f.id)}>
                  <td className="px-3 py-2 font-medium">{f.nombre}</td>
                  <td className="px-3 py-2 text-right">{f.facturas}</td>
                  <td className="px-3 py-2 text-right font-medium whitespace-nowrap">{dinero(f.debe)}</td>
                  <td className={`px-3 py-2 text-right whitespace-nowrap ${f.vencido !== '0.00' ? 'font-medium text-red-700' : 'text-gray-400'}`}>
                    {f.vencido !== '0.00' ? dinero(f.vencido) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------- Un proveedor ----------

type Accion = { tipo: 'pagar' } | { tipo: 'anular'; pago: PagoCxp } | { tipo: 'comprobante'; id: string; codigo: string }

function ProveedorVista({
  token,
  prep,
  id,
  permisos,
  onCerrar,
  onSesionVencida,
}: {
  token: string
  prep: PrepararCxp
  id: string
  permisos: string[]
  onCerrar: () => void
  onSesionVencida: () => void
}) {
  const [d, setD] = useState<DetalleProveedorCxp | null>(null)
  const [error, setError] = useState('')
  const [accion, setAccion] = useState<Accion | null>(null)

  const cargar = useCallback(async () => {
    try {
      setD(await proveedorCxp(token, id))
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, id, onSesionVencida])

  useEffect(() => {
    void cargar()
  }, [cargar])

  if (!d)
    return (
      <Ventana titulo="Proveedor" onCerrar={onCerrar} ancho="max-w-4xl">
        {error ? <CajaError>{error}</CajaError> : <p className="text-sm text-gray-500">Cargando…</p>}
      </Ventana>
    )

  return (
    <Ventana titulo={d.proveedor.nombre} onCerrar={onCerrar} ancho="max-w-4xl">
      <div className="flex flex-col gap-4 text-sm">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {(
            [
              ['Se le debe', dinero(d.totales.debe), ''],
              ['Vencido', dinero(d.totales.vencido), d.totales.vencido !== '0.00' ? 'text-red-700' : ''],
              ['Días de crédito', d.proveedor.dias_credito ? `${d.proveedor.dias_credito} días` : '—', ''],
            ] as const
          ).map(([titulo, valor, color]) => (
            <div key={titulo} className="rounded-lg border border-gray-200 p-2">
              <div className="text-xs text-gray-500">{titulo}</div>
              <div className={`font-medium ${color}`}>{valor}</div>
            </div>
          ))}
        </div>
        {permisos.includes('cxp.pagar') && d.totales.debe !== '0.00' && (
          <div>
            <button type="button" className={BOTON_PRINCIPAL} onClick={() => setAccion({ tipo: 'pagar' })}>
              <HandCoins size={16} /> Pagar
            </button>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <div className="font-medium">Facturas pendientes</div>
          {d.facturas.length === 0 ? (
            <p className="text-gray-500">No se le debe ninguna factura.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-xs text-gray-500">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Factura</th>
                    <th className="py-1 pr-2 font-medium">Vence</th>
                    <th className="py-1 pr-2 text-right font-medium">A pagar</th>
                    <th className="py-1 pr-2 text-right font-medium">Pagado</th>
                    <th className="py-1 text-right font-medium">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {d.facturas.map((f) => (
                    <tr key={f.id} className="border-t border-gray-100 align-top">
                      <td className="py-1.5 pr-2">
                        {f.codigo}
                        <div className="text-xs text-gray-500">
                          {f.ncf ?? 'Sin NCF'} · {fechaCorta(f.fecha)}
                        </div>
                      </td>
                      <td className={`py-1.5 pr-2 whitespace-nowrap ${f.vencida ? 'text-red-700' : f.por_vencer ? 'text-amber-700' : ''}`}>
                        {fechaCorta(f.vencimiento)}
                        {f.vencida && <div className="text-xs">{f.dias_atraso} días de atraso</div>}
                      </td>
                      <td className="py-1.5 pr-2 text-right whitespace-nowrap">{dinero(f.a_pagar)}</td>
                      <td className="py-1.5 pr-2 text-right whitespace-nowrap">{f.pagado === '0.00' ? '—' : dinero(f.pagado)}</td>
                      <td className="py-1.5 text-right font-medium whitespace-nowrap">{dinero(f.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {d.pagos.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="font-medium">Pagos</div>
            {d.pagos.map((p) => (
              <div key={p.id} className={`flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 py-1.5 ${p.estado === 'anulado' ? 'text-gray-400' : ''}`}>
                <span>
                  {p.codigo} · {fechaCorta(p.fecha)} · {p.forma === 'efectivo' ? 'Efectivo' : `Banco${p.referencia ? ` ${p.referencia}` : ''}`} · {p.usuario}
                  {p.estado === 'anulado' && <span className="block text-xs">Anulado: {p.motivo_anulacion}</span>}
                </span>
                <span className="flex items-center gap-3">
                  <strong className={p.estado === 'anulado' ? 'line-through' : ''}>{dinero(p.total)}</strong>
                  <button
                    type="button"
                    className="text-gray-400 hover:text-gray-700"
                    aria-label={`Comprobante ${p.codigo}`}
                    title="Comprobante"
                    onClick={() => setAccion({ tipo: 'comprobante', id: p.id, codigo: p.codigo })}
                  >
                    <Receipt size={15} />
                  </button>
                  {permisos.includes('cxp.anular_pago') && p.estado === 'activo' && (
                    <button type="button" className="text-gray-400 hover:text-red-700" aria-label={`Anular ${p.codigo}`} title="Anular" onClick={() => setAccion({ tipo: 'anular', pago: p })}>
                      <Ban size={15} />
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {accion?.tipo === 'pagar' && (
        <FormPago token={token} prep={prep} d={d} onCerrar={() => setAccion(null)} onHecho={() => void cargar()} onSesionVencida={onSesionVencida} />
      )}
      {accion?.tipo === 'anular' && (
        <FormAnularPago
          token={token}
          prep={prep}
          pago={accion.pago}
          onCerrar={() => setAccion(null)}
          onListo={() => {
            setAccion(null)
            void cargar()
          }}
          onSesionVencida={onSesionVencida}
        />
      )}
      {accion?.tipo === 'comprobante' && (
        <Ventana titulo={`Comprobante ${accion.codigo}`} onCerrar={() => setAccion(null)}>
          <BotonesImprimir
            texto="Imprimir comprobante"
            nombrePdf={`${accion.codigo}.pdf`}
            cargarTicket={() => ticketPagoProveedor(token, accion.id)}
            cargarPdf={(formato) => pdfPagoProveedor(token, accion.id, formato)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
    </Ventana>
  )
}

function SelectorCaja({ prep, cajaId, setCajaId, etiqueta }: { prep: PrepararCxp; cajaId: string; setCajaId: (v: string) => void; etiqueta: string }) {
  return (
    <Campo etiqueta={etiqueta}>
      <select className={CAMPO} value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
        <option value="">Seleccione…</option>
        {prep.cajas.map((c) => (
          <option key={c.id} value={c.id} disabled={!c.sesion_id}>
            {c.nombre}
            {c.sesion_id ? '' : ' (cerrada)'}
          </option>
        ))}
      </select>
    </Campo>
  )
}

function FormPago({
  token,
  prep,
  d,
  onCerrar,
  onHecho,
  onSesionVencida,
}: {
  token: string
  prep: PrepararCxp
  d: DetalleProveedorCxp
  onCerrar: () => void
  onHecho: () => void
  onSesionVencida: () => void
}) {
  const local = cajaDeEstaComputadora()
  const [monto, setMonto] = useState('')
  const [forma, setForma] = useState<'efectivo' | 'banco'>('efectivo')
  const [cajaId, setCajaId] = useState(prep.cajas.some((c) => c.id === local && c.sesion_id) ? (local ?? '') : '')
  const [cuentaId, setCuentaId] = useState('')
  const [referencia, setReferencia] = useState('')
  const [elegir, setElegir] = useState(false)
  const [reparto, setReparto] = useState<Record<string, string>>({})
  const [hecho, setHecho] = useState<Awaited<ReturnType<typeof pagarProveedor>> | null>(null)
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  const sumaReparto = Object.values(reparto).reduce((a, v) => a + centavos(v), 0n)
  const montoC = centavos(monto)
  const pasaSaldo = d.facturas.some((f) => centavos(reparto[f.id] ?? '') > centavos(f.saldo))

  if (hecho)
    return (
      <Ventana titulo={`Pago ${hecho.codigo}`} onCerrar={onCerrar}>
        <div className="flex flex-col gap-3 text-sm">
          <div className="font-medium text-green-700">Pago registrado.</div>
          {hecho.aplicado.map((a) => (
            <div key={a.factura} className="flex justify-between">
              <span>
                {a.factura}
                {a.ncf ? ` · ${a.ncf}` : ''}
              </span>
              <span>{dinero(a.monto)}</span>
            </div>
          ))}
          <div className="font-medium">Se le debe ahora: {dinero(hecho.debeAhora)}</div>
          <BotonesImprimir
            texto="Imprimir comprobante"
            nombrePdf={`${hecho.codigo}.pdf`}
            cargarTicket={() => ticketPagoProveedor(token, hecho.id)}
            cargarPdf={(formato) => pdfPagoProveedor(token, hecho.id, formato)}
            onSesionVencida={onSesionVencida}
          />
        </div>
      </Ventana>
    )

  return (
    <Ventana titulo={`Pagar a ${d.proveedor.nombre}`} onCerrar={onCerrar} ancho="max-w-xl">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          void enviar(async () => {
            setHecho(
              await pagarProveedor(token, {
                proveedorId: d.proveedor.id,
                monto: monto.trim(),
                forma,
                cajaId: forma === 'efectivo' ? cajaId : undefined,
                cuentaId: forma === 'banco' ? cuentaId : undefined,
                referencia: referencia.trim() || undefined,
                distribucion: elegir
                  ? Object.entries(reparto)
                      .filter(([, v]) => centavos(v) > 0n)
                      .map(([compraId, v]) => ({ compraId, monto: v.trim() }))
                  : undefined,
              }),
            )
          }, onHecho)
        }}
      >
        <p className="text-sm text-gray-600">
          Se le debe <strong>{dinero(d.totales.debe)}</strong>
          {d.totales.vencido !== '0.00' && (
            <>
              {' '}
              (vencido <span className="text-red-700">{dinero(d.totales.vencido)}</span>)
            </>
          )}
          .
        </p>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Campo etiqueta="Monto a pagar (RD$)">
              <input className={`${CAMPO} text-lg`} value={monto} inputMode="decimal" onChange={(e) => setMonto(e.target.value)} autoFocus />
            </Campo>
          </div>
          <button type="button" className={BOTON_SECUNDARIO} onClick={() => setMonto(d.totales.debe)}>
            Todo
          </button>
        </div>
        <div className="flex gap-4 text-sm">
          {(['efectivo', 'banco'] as const).map((f) => (
            <label key={f} className="flex items-center gap-2">
              <input type="radio" checked={forma === f} onChange={() => setForma(f)} />
              {f === 'efectivo' ? 'Efectivo (caja)' : 'Banco (transferencia o cheque)'}
            </label>
          ))}
        </div>
        {forma === 'efectivo' ? (
          <SelectorCaja prep={prep} cajaId={cajaId} setCajaId={setCajaId} etiqueta="Caja de donde sale el dinero" />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo etiqueta="Cuenta de donde sale">
              <select className={CAMPO} value={cuentaId} onChange={(e) => setCuentaId(e.target.value)}>
                <option value="">Seleccione…</option>
                {prep.cuentas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Referencia o No. de cheque">
              <input className={CAMPO} value={referencia} maxLength={60} onChange={(e) => setReferencia(e.target.value)} />
            </Campo>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={elegir} onChange={(e) => setElegir(e.target.checked)} />
          Elegir a qué facturas va (si no, a la más vieja primero)
        </label>
        {elegir && (
          <div className="flex flex-col gap-1 rounded-lg bg-gray-50 p-3 text-sm">
            {d.facturas.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-2">
                <span>
                  {f.codigo}
                  {f.ncf ? ` · ${f.ncf}` : ''} · saldo {dinero(f.saldo)}
                  {f.vencida && <span className="text-red-700"> · vencida</span>}
                </span>
                <span className="flex items-center gap-1">
                  <button type="button" className="text-xs text-[#C8102E] hover:underline" onClick={() => setReparto({ ...reparto, [f.id]: f.saldo })}>
                    Todo
                  </button>
                  <input
                    className={`${CAMPO} w-28`}
                    value={reparto[f.id] ?? ''}
                    inputMode="decimal"
                    placeholder="0.00"
                    onChange={(e) => setReparto({ ...reparto, [f.id]: e.target.value })}
                  />
                </span>
              </div>
            ))}
            <div className="flex justify-between">
              <button type="button" className="text-xs underline" onClick={() => setMonto(texto2(sumaReparto))}>
                Usar lo repartido como monto
              </button>
              <span className={sumaReparto === montoC ? 'text-green-700' : 'text-amber-700'}>
                Repartido {dinero(texto2(sumaReparto))} de {dinero(texto2(montoC))}
              </span>
            </div>
            {pasaSaldo && <p className="text-red-700">A una factura se le pone más que su saldo.</p>}
          </div>
        )}
        {error && <CajaError>{error}</CajaError>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON_SECUNDARIO} onClick={onCerrar}>
            Cancelar
          </button>
          <button
            type="submit"
            className={BOTON_PRINCIPAL}
            disabled={
              guardando ||
              montoC <= 0n ||
              montoC > centavos(d.totales.debe) ||
              (forma === 'efectivo' ? !cajaId : !cuentaId) ||
              (elegir && (sumaReparto !== montoC || pasaSaldo))
            }
          >
            <HandCoins size={16} /> {guardando ? 'Registrando…' : 'Registrar pago'}
          </button>
        </div>
      </form>
    </Ventana>
  )
}

function FormAnularPago({
  token,
  prep,
  pago,
  onCerrar,
  onListo,
  onSesionVencida,
}: {
  token: string
  prep: PrepararCxp
  pago: PagoCxp
  onCerrar: () => void
  onListo: () => void
  onSesionVencida: () => void
}) {
  const local = cajaDeEstaComputadora()
  const [cajaId, setCajaId] = useState(prep.cajas.some((c) => c.id === local && c.sesion_id) ? (local ?? '') : '')
  const [motivo, setMotivo] = useState('')
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  return (
    <Ventana titulo={`Anular ${pago.codigo}`} onCerrar={onCerrar}>
      <form
        className="flex flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault()
          void enviar(() => anularPagoProveedor(token, pago.id, { motivo: motivo.trim(), cajaId: pago.forma === 'efectivo' ? cajaId : undefined }), onListo)
        }}
      >
        <p>
          Los {dinero(pago.total)} vuelven {pago.forma === 'efectivo' ? 'a la caja' : 'a la cuenta de donde salieron'} y las facturas
          vuelven a deber lo que se había pagado. Queda en la auditoría.
        </p>
        {pago.forma === 'efectivo' && <SelectorCaja prep={prep} cajaId={cajaId} setCajaId={setCajaId} etiqueta="Caja donde vuelve el dinero" />}
        <Campo etiqueta="Motivo">
          <input className={CAMPO} value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} autoFocus />
        </Campo>
        {error && <CajaError>{error}</CajaError>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON_SECUNDARIO} onClick={onCerrar}>
            Volver
          </button>
          <button
            type="submit"
            className={BOTON_PELIGRO}
            disabled={guardando || motivo.trim().length < 5 || (pago.forma === 'efectivo' && !cajaId)}
          >
            <AlertTriangle size={16} />
            {guardando ? 'Un momento…' : 'Anular pago'}
          </button>
        </div>
      </form>
    </Ventana>
  )
}

// ---------- Gastos fijos ----------

function GastosFijos({
  token,
  prep,
  puedeEditar,
  onCambioDias,
  onSesionVencida,
}: {
  token: string
  prep: PrepararCxp
  puedeEditar: boolean
  onCambioDias: () => void
  onSesionVencida: () => void
}) {
  const [lista, setLista] = useState<GastoFijo[] | null>(null)
  const [error, setError] = useState('')
  const [editando, setEditando] = useState<GastoFijo | 'nuevo' | null>(null)
  const [dias, setDias] = useState(String(prep.diasAlerta))
  const [diasOk, setDiasOk] = useState(false)
  const guardarDias = useEnviar(onSesionVencida)

  const cargar = useCallback(async () => {
    try {
      setLista(await listarGastosFijos(token))
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, onSesionVencida])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-600">
        Gastos que llegan todos los meses (alquiler, luz, internet…). El sistema avisa {prep.diasAlerta} días antes del día de pago
        hasta que se registre la factura de ese mes. No se crea ninguna factura sola.
      </p>
      {puedeEditar && (
        <div className="flex flex-wrap items-end gap-3">
          <button type="button" className={BOTON_PRINCIPAL} onClick={() => setEditando('nuevo')}>
            <Plus size={16} /> Nuevo gasto fijo
          </button>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              setDiasOk(false)
              void guardarDias.enviar(() => configurarDiasCxp(token, dias.trim()), () => {
                setDiasOk(true)
                onCambioDias()
              })
            }}
          >
            <Campo etiqueta="Avisar con (días antes)">
              <input className={`${CAMPO} w-24`} value={dias} inputMode="numeric" onChange={(e) => setDias(e.target.value)} />
            </Campo>
            <button type="submit" className={BOTON_SECUNDARIO} disabled={guardarDias.guardando || !/^\d{1,2}$/.test(dias.trim())}>
              Guardar
            </button>
            {diasOk && <span className="pb-2 text-sm text-green-700">Guardado.</span>}
          </form>
        </div>
      )}
      {guardarDias.error && <CajaError>{guardarDias.error}</CajaError>}
      {error && <CajaError>{error}</CajaError>}
      {!lista ? (
        !error && <p className="text-sm text-gray-500">Cargando…</p>
      ) : lista.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">Todavía no hay gastos fijos.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Gasto</th>
                <th className="px-3 py-2 font-medium">Proveedor</th>
                <th className="px-3 py-2 font-medium">Día</th>
                <th className="px-3 py-2 text-right font-medium">Monto</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((g) => (
                <tr key={g.id} className={`border-t border-gray-100 ${g.is_active ? '' : 'text-gray-400'}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{g.nombre}</div>
                    <div className="text-xs text-gray-500">
                      {g.tipo_gasto_nombre}
                      {g.is_active ? '' : ' · desactivado'}
                    </div>
                  </td>
                  <td className="px-3 py-2">{g.proveedor}</td>
                  <td className="px-3 py-2 whitespace-nowrap">Día {g.dia_mes}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {g.monto ? dinero(g.monto) : <span className="text-gray-400">Cambia cada mes</span>}
                    {g.itbis && g.itbis !== '0.00' && <div className="text-xs text-gray-500">+ ITBIS {dinero(g.itbis)}</div>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {puedeEditar && (
                      <button type="button" className="text-gray-400 hover:text-gray-700" aria-label={`Editar ${g.nombre}`} title="Editar" onClick={() => setEditando(g)}>
                        <Pencil size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editando && (
        <FormGastoFijo
          token={token}
          prep={prep}
          gasto={editando === 'nuevo' ? null : editando}
          onCerrar={() => setEditando(null)}
          onListo={() => {
            setEditando(null)
            void cargar()
          }}
          onSesionVencida={onSesionVencida}
        />
      )}
    </div>
  )
}

function FormGastoFijo({
  token,
  prep,
  gasto,
  onCerrar,
  onListo,
  onSesionVencida,
}: {
  token: string
  prep: PrepararCxp
  gasto: GastoFijo | null
  onCerrar: () => void
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [nombre, setNombre] = useState(gasto?.nombre ?? '')
  const [proveedor, setProveedor] = useState<{ id: string; nombre: string } | null>(gasto ? { id: gasto.proveedor_id, nombre: gasto.proveedor } : null)
  const [buscar, setBuscar] = useState('')
  const [opciones, setOpciones] = useState<{ id: string; nombre: string; numero_documento: string | null }[]>([])
  const [tipoGasto, setTipoGasto] = useState(gasto?.tipo_gasto ?? '02')
  const [dia, setDia] = useState(gasto ? String(gasto.dia_mes) : '')
  const [monto, setMonto] = useState(gasto?.monto ?? '')
  const [itbis, setItbis] = useState(gasto?.itbis ?? '')
  const [notas, setNotas] = useState(gasto?.notas ?? '')
  const [activo, setActivo] = useState(gasto?.is_active ?? true)
  const { error, guardando, enviar } = useEnviar(onSesionVencida)

  useEffect(() => {
    const t = buscar.trim()
    if (t.length < 2) {
      setOpciones([])
      return
    }
    let vigente = true
    const espera = setTimeout(() => {
      buscarProveedoresCxp(token, t)
        .then((r) => vigente && setOpciones(r))
        .catch((e) => {
          if (e instanceof SesionVencida) onSesionVencida()
        })
    }, 300)
    return () => {
      vigente = false
      clearTimeout(espera)
    }
  }, [buscar, token, onSesionVencida])

  return (
    <Ventana titulo={gasto ? `Editar ${gasto.nombre}` : 'Nuevo gasto fijo'} onCerrar={onCerrar} ancho="max-w-xl">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!proveedor) return
          void enviar(
            () =>
              guardarGastoFijo(token, gasto?.id ?? null, {
                nombre: nombre.trim(),
                proveedorId: proveedor.id,
                tipoGasto,
                diaMes: dia.trim(),
                monto: monto.trim(),
                itbis: itbis.trim(),
                notas: notas.trim(),
                activo,
              }),
            onListo,
          )
        }}
      >
        <Campo etiqueta="Nombre">
          <input className={CAMPO} value={nombre} maxLength={100} onChange={(e) => setNombre(e.target.value)} placeholder="Alquiler del local" autoFocus />
        </Campo>
        <div className="flex flex-col gap-1 text-sm text-gray-600">
          Proveedor
          {proveedor ? (
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
              <span className="font-medium text-gray-900">{proveedor.nombre}</span>
              <button type="button" className="text-xs text-[#C8102E] hover:underline" onClick={() => setProveedor(null)}>
                Cambiar
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search size={16} className="absolute top-3 left-3 text-gray-400" />
                <input className={`${CAMPO} w-full pl-9`} value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por nombre o RNC" />
              </div>
              {opciones.length > 0 && (
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                  {opciones.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-gray-50"
                        onClick={() => {
                          setProveedor(p)
                          setBuscar('')
                        }}
                      >
                        <span className="font-medium text-gray-900">{p.nombre}</span>
                        <span className="text-xs text-gray-500">{p.numero_documento ?? 'Sin RNC/cédula'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <span className="text-xs text-gray-500">Si no aparece, créelo en Proveedores.</span>
            </>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo etiqueta="Tipo de gasto (606)">
            <select className={CAMPO} value={tipoGasto} onChange={(e) => setTipoGasto(e.target.value)}>
              {prep.tiposGasto.map((t) => (
                <option key={t.codigo} value={t.codigo}>
                  {t.codigo} · {t.nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Día del mes en que vence">
            <input className={CAMPO} value={dia} inputMode="numeric" onChange={(e) => setDia(e.target.value)} placeholder="1 a 31" />
          </Campo>
          <Campo etiqueta="Monto sin ITBIS (si es fijo)">
            <input className={CAMPO} value={monto} inputMode="decimal" onChange={(e) => setMonto(e.target.value)} placeholder="Vacío si cambia" />
          </Campo>
          <Campo etiqueta="ITBIS (si es fijo)">
            <input className={CAMPO} value={itbis} inputMode="decimal" onChange={(e) => setItbis(e.target.value)} placeholder="0.00" />
          </Campo>
        </div>
        <p className="text-xs text-gray-500">Si pone 31 (o 30), en los meses más cortos se usa el último día del mes.</p>
        <Campo etiqueta="Notas">
          <input className={CAMPO} value={notas} maxLength={300} onChange={(e) => setNotas(e.target.value)} />
        </Campo>
        {gasto && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
            Activo (si lo quita, deja de avisar)
          </label>
        )}
        {error && <CajaError>{error}</CajaError>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON_SECUNDARIO} onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className={BOTON_PRINCIPAL} disabled={guardando || !proveedor || nombre.trim().length < 2 || !/^\d{1,2}$/.test(dia.trim())}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Ventana>
  )
}
