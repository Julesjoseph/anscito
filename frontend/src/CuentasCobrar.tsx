import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AlertTriangle, Ban, BadgeDollarSign, HandCoins, Receipt, RefreshCw, Search, ShieldCheck, UserPlus } from 'lucide-react'
import {
  SesionVencida,
  anularAbono,
  autorizarCreditoHoy,
  buscarClientesCxc,
  clienteCxc,
  configurarCreditoCliente,
  listarClientesCxc,
  nuevaTasaRecargo,
  pdfAbono,
  perdonarRecargo,
  prepararCxc,
  registrarAbono,
  ticketAbono,
} from './api'
import type { ClienteCxc, CuentaCxc, FilaClienteCxc, PrepararCxc } from './api'
import BotonesImprimir from './BotonesImprimir'
import { cajaDeEstaComputadora } from './cajaLocal'
import { BOTON_PELIGRO, BOTON_PRINCIPAL, BOTON_SECUNDARIO, CAMPO, CajaError, Ventana } from './componentes'
import { dinero, mensajeDe } from './formato'

// Cuentas por Cobrar: clientes con crédito, lo que deben (con recargo por
// atraso), abonos con recibo, perdón de recargos y el % de recargo.

type Props = {
  token: string
  permisos: string[]
  onSesionVencida: () => void
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

export default function CuentasCobrar({ token, permisos, onSesionVencida }: Props) {
  const gestionar = permisos.includes('cxc.gestionar')
  const [pestana, setPestana] = useState<'clientes' | 'credito' | 'recargo'>('clientes')
  const [prep, setPrep] = useState<PrepararCxc | null>(null)
  const [error, setError] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const cargarPrep = useCallback(async () => {
    try {
      setPrep(await prepararCxc(token))
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
        <h1 className="text-2xl font-medium">Cuentas por cobrar</h1>
        <p className="text-sm text-gray-500">
          Lo que le deben sus clientes por ventas a crédito: abonos, recargos por atraso y estado de cada cliente.
          {prep && ` Recargo vigente: ${prep.recargoVigente.replace(/\.?0+$/, '')}% por cada mes completo de atraso.`}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 border-b border-gray-200">
        {(
          [
            ['clientes', 'Clientes', true],
            ['credito', 'Dar crédito', gestionar],
            ['recargo', 'Recargo por atraso', gestionar],
          ] as const
        )
          .filter(([, , ver]) => ver)
          .map(([id, nombre]) => (
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
      ) : pestana === 'clientes' ? (
        <Lista key={version} token={token} onAbrir={setAbierto} onSesionVencida={onSesionVencida} />
      ) : pestana === 'credito' ? (
        <DarCredito token={token} onListo={(id) => { setVersion((v) => v + 1); setAbierto(id) }} onSesionVencida={onSesionVencida} />
      ) : (
        <Recargo token={token} prep={prep} onCambio={() => void cargarPrep()} onSesionVencida={onSesionVencida} />
      )}
      {abierto && prep && (
        <ClienteVista
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

// ---------- Lista de clientes ----------

function Lista({ token, onAbrir, onSesionVencida }: { token: string; onAbrir: (id: string) => void; onSesionVencida: () => void }) {
  const [texto, setTexto] = useState('')
  const [solo, setSolo] = useState('deudores')
  const [filas, setFilas] = useState<FilaClienteCxc[] | null>(null)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    setError('')
    try {
      setFilas((await listarClientesCxc(token, { texto, solo })).filas)
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, texto, solo, onSesionVencida])

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 250)
    return () => clearTimeout(t)
  }, [cargar])

  const total = (filas ?? []).reduce((a, f) => a + centavos(f.total), 0n)
  const vencido = (filas ?? []).reduce((a, f) => a + centavos(f.vencido), 0n)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search size={16} className="absolute top-3 left-3 text-gray-400" />
          <input className={`${CAMPO} w-full pl-9`} type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Cliente, código o documento" />
        </div>
        <select className={CAMPO} value={solo} onChange={(e) => setSolo(e.target.value)} aria-label="Mostrar">
          <option value="deudores">Los que deben</option>
          <option value="vencidos">Con facturas vencidas</option>
          <option value="">Todos los que tienen crédito</option>
        </select>
        <button type="button" className={BOTON_SECUNDARIO} onClick={() => void cargar()}>
          <span className="flex items-center gap-2">
            <RefreshCw size={16} /> Actualizar
          </span>
        </button>
      </div>
      {filas && filas.length > 0 && (
        <p className="text-sm text-gray-600">
          Por cobrar: <strong>{dinero(texto2(total))}</strong> · vencido: <strong className="text-red-700">{dinero(texto2(vencido))}</strong>
        </p>
      )}
      {error && <CajaError>{error}</CajaError>}
      {!filas ? (
        !error && <p className="text-sm text-gray-500">Cargando…</p>
      ) : filas.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">No hay clientes en esta lista.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 text-right font-medium">Límite</th>
                <th className="px-3 py-2 text-right font-medium">Debe</th>
                <th className="px-3 py-2 text-right font-medium">Recargo</th>
                <th className="px-3 py-2 text-right font-medium">Vencido</th>
                <th className="px-3 py-2 text-right font-medium">Disponible</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50" onClick={() => onAbrir(f.id)}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{f.nombre}</div>
                    <div className="text-xs text-gray-500">
                      {[f.codigo, f.numero_documento, f.telefono].filter(Boolean).join(' · ') || '—'}
                      {!f.credito_activo && ' · sin crédito activo'}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{f.limite ? dinero(f.limite) : '—'}</td>
                  <td className="px-3 py-2 text-right font-medium whitespace-nowrap">{dinero(f.total)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{f.recargo === '0.00' ? '—' : dinero(f.recargo)}</td>
                  <td className={`px-3 py-2 text-right whitespace-nowrap ${f.cuentas_vencidas > 0 ? 'font-medium text-red-700' : 'text-gray-400'}`}>
                    {f.cuentas_vencidas > 0 ? dinero(f.vencido) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{f.disponible ? dinero(f.disponible) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------- Un cliente ----------

type Accion =
  | { tipo: 'abonar' }
  | { tipo: 'credito' }
  | { tipo: 'autorizar' }
  | { tipo: 'perdonar'; cuenta: CuentaCxc }
  | { tipo: 'anular'; abono: ClienteCxc['abonos'][number] }
  | { tipo: 'recibo'; id: string; codigo: string }

function ClienteVista({
  token,
  prep,
  id,
  permisos,
  onCerrar,
  onSesionVencida,
}: {
  token: string
  prep: PrepararCxc
  id: string
  permisos: string[]
  onCerrar: () => void
  onSesionVencida: () => void
}) {
  const [d, setD] = useState<ClienteCxc | null>(null)
  const [error, setError] = useState('')
  const [accion, setAccion] = useState<Accion | null>(null)

  const cargar = useCallback(async () => {
    try {
      setD(await clienteCxc(token, id))
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

  if (!d)
    return (
      <Ventana titulo="Cliente" onCerrar={onCerrar} ancho="max-w-4xl">
        {error ? <CajaError>{error}</CajaError> : <p className="text-sm text-gray-500">Cargando…</p>}
      </Ventana>
    )

  const t = d.totales
  const pendientes = d.cuentas.filter((k) => k.total_pendiente !== '0.00')

  return (
    <Ventana titulo={d.cliente.nombre} onCerrar={onCerrar} ancho="max-w-4xl">
      <div className="flex flex-col gap-4 text-sm">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(
            [
              ['Límite', d.credito ? dinero(d.credito.limite) : 'Sin crédito', ''],
              ['Debe (capital)', dinero(t.capital), ''],
              ['Recargo', dinero(t.recargo), t.recargo !== '0.00' ? 'text-amber-700' : ''],
              ['Vencido', dinero(t.vencido), t.cuentas_vencidas > 0 ? 'text-red-700' : ''],
              ['Disponible', d.disponible ? dinero(d.disponible) : '—', 'text-green-700'],
            ] as const
          ).map(([titulo, valor, color]) => (
            <div key={titulo} className="rounded-lg border border-gray-200 p-2">
              <div className="text-xs text-gray-500">{titulo}</div>
              <div className={`font-medium ${color}`}>{valor}</div>
            </div>
          ))}
        </div>
        <div className="text-base">
          Total que debe hoy: <strong>{dinero(t.total)}</strong>
          {d.credito && <span className="text-sm text-gray-500"> · plazo normal {d.credito.plazo_dias} días{d.credito.is_active ? '' : ' · crédito desactivado'}</span>}
        </div>
        {d.autorizacionHoy && (
          <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-green-800">
            <ShieldCheck size={16} /> Autorizado hoy para una venta a crédito por {d.autorizacionHoy.por}: {d.autorizacionHoy.motivo}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {permisos.includes('cxc.abonar') && t.total !== '0.00' && (
            <button type="button" className={BOTON_PRINCIPAL} onClick={() => setAccion({ tipo: 'abonar' })}>
              <HandCoins size={16} /> Recibir abono
            </button>
          )}
          {permisos.includes('cxc.gestionar') && (
            <button type="button" className={BOTON_SECUNDARIO} onClick={() => setAccion({ tipo: 'credito' })}>
              {d.credito ? 'Cambiar límite o plazo' : 'Darle crédito'}
            </button>
          )}
          {permisos.includes('cxc.autorizar') && t.cuentas_vencidas > 0 && !d.autorizacionHoy && (
            <button type="button" className={BOTON_SECUNDARIO} onClick={() => setAccion({ tipo: 'autorizar' })}>
              <span className="flex items-center gap-2">
                <ShieldCheck size={16} /> Autorizar una venta hoy
              </span>
            </button>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <div className="font-medium">Facturas a crédito</div>
          {pendientes.length === 0 ? (
            <p className="text-gray-500">No debe ninguna factura.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-xs text-gray-500">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Venta</th>
                    <th className="py-1 pr-2 font-medium">Vence</th>
                    <th className="py-1 pr-2 text-right font-medium">Monto</th>
                    <th className="py-1 pr-2 text-right font-medium">Pagado</th>
                    <th className="py-1 pr-2 text-right font-medium">Recargo</th>
                    <th className="py-1 pr-2 text-right font-medium">Debe</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pendientes.map((k) => (
                    <tr key={k.id} className="border-t border-gray-100 align-top">
                      <td className="py-1.5 pr-2">
                        {k.venta}
                        <div className="text-xs text-gray-500">{fechaCorta(k.fecha)}</div>
                      </td>
                      <td className={`py-1.5 pr-2 whitespace-nowrap ${k.vencida ? 'text-red-700' : ''}`}>
                        {fechaCorta(k.vencimiento)}
                        {k.vencida && <div className="text-xs">{k.dias_atraso} días de atraso</div>}
                      </td>
                      <td className="py-1.5 pr-2 text-right whitespace-nowrap">{dinero(k.monto)}</td>
                      <td className="py-1.5 pr-2 text-right whitespace-nowrap">{dinero(k.capital_pagado)}</td>
                      <td className="py-1.5 pr-2 text-right whitespace-nowrap" title={k.recargos.map((r) => `${fechaCorta(r.fecha)}: ${r.pct.replace(/\.?0+$/, '')}% de ${r.base} = ${r.monto}`).join('\n')}>
                        {k.recargo_pendiente === '0.00' ? '—' : dinero(k.recargo_pendiente)}
                        {k.recargo_perdonado !== '0.00' && <div className="text-xs text-gray-500">perdonado {dinero(k.recargo_perdonado)}</div>}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-medium whitespace-nowrap">{dinero(k.total_pendiente)}</td>
                      <td className="py-1.5 text-right">
                        {permisos.includes('cxc.perdonar') && k.recargo_pendiente !== '0.00' && (
                          <button type="button" className="text-xs text-[#C8102E] hover:underline" onClick={() => setAccion({ tipo: 'perdonar', cuenta: k })}>
                            Perdonar recargo
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {d.abonos.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="font-medium">Abonos</div>
            {d.abonos.map((b) => (
              <div key={b.id} className={`flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 py-1.5 ${b.estado === 'anulado' ? 'text-gray-400' : ''}`}>
                <span>
                  {b.codigo} · {fechaCorta(b.fecha)} · {b.forma === 'efectivo' ? 'Efectivo' : `Transferencia${b.referencia ? ` ${b.referencia}` : ''}`} · {b.usuario}
                  {b.estado === 'anulado' && <span className="block text-xs">Anulado: {b.motivo_anulacion}</span>}
                </span>
                <span className="flex items-center gap-3">
                  <strong>{dinero(b.total)}</strong>
                  <button type="button" className="text-gray-400 hover:text-gray-700" aria-label={`Recibo ${b.codigo}`} title="Recibo" onClick={() => setAccion({ tipo: 'recibo', id: b.id, codigo: b.codigo })}>
                    <Receipt size={15} />
                  </button>
                  {permisos.includes('cxc.anular_abono') && b.estado === 'activo' && (
                    <button type="button" className="text-gray-400 hover:text-red-700" aria-label={`Anular ${b.codigo}`} title="Anular" onClick={() => setAccion({ tipo: 'anular', abono: b })}>
                      <Ban size={15} />
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {accion?.tipo === 'abonar' && (
        <FormAbono token={token} prep={prep} d={d} onCerrar={() => setAccion(null)} onHecho={() => void cargar()} onSesionVencida={onSesionVencida} />
      )}
      {accion?.tipo === 'credito' && (
        <Ventana titulo={`Crédito de ${d.cliente.nombre}`} onCerrar={() => setAccion(null)}>
          <FormCredito token={token} id={d.cliente.id} actual={d.credito} onListo={listo} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
      {accion?.tipo === 'autorizar' && (
        <ConMotivo
          titulo="Autorizar una venta a crédito hoy"
          texto={`${d.cliente.nombre} tiene ${t.cuentas_vencidas} factura(s) vencida(s). Con esta autorización, cualquier cajero le puede hacer UNA venta a crédito hoy (dentro de su límite).`}
          boton="Autorizar"
          onCerrar={() => setAccion(null)}
          onEnviar={(motivo) => autorizarCreditoHoy(token, d.cliente.id, motivo)}
          onListo={listo}
          onSesionVencida={onSesionVencida}
        />
      )}
      {accion?.tipo === 'perdonar' && (
        <FormPerdon token={token} cuenta={accion.cuenta} onCerrar={() => setAccion(null)} onListo={listo} onSesionVencida={onSesionVencida} />
      )}
      {accion?.tipo === 'anular' && (
        <FormAnularAbono token={token} prep={prep} abono={accion.abono} onCerrar={() => setAccion(null)} onListo={listo} onSesionVencida={onSesionVencida} />
      )}
      {accion?.tipo === 'recibo' && (
        <Ventana titulo={`Recibo ${accion.codigo}`} onCerrar={() => setAccion(null)}>
          <BotonesImprimir
            texto="Imprimir recibo"
            nombrePdf={`${accion.codigo}.pdf`}
            cargarTicket={() => ticketAbono(token, accion.id)}
            cargarPdf={(formato) => pdfAbono(token, accion.id, formato)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
    </Ventana>
  )
}

function SelectorDinero({
  prep,
  forma,
  setForma,
  cajaId,
  setCajaId,
  cuentaId,
  setCuentaId,
  referencia,
  setReferencia,
  textoCaja,
}: {
  prep: PrepararCxc
  forma: 'efectivo' | 'transferencia'
  setForma: (f: 'efectivo' | 'transferencia') => void
  cajaId: string
  setCajaId: (v: string) => void
  cuentaId: string
  setCuentaId: (v: string) => void
  referencia: string
  setReferencia: (v: string) => void
  textoCaja: string
}) {
  return (
    <>
      <div className="flex gap-4 text-sm">
        {(['efectivo', 'transferencia'] as const).map((f) => (
          <label key={f} className="flex items-center gap-2">
            <input type="radio" checked={forma === f} onChange={() => setForma(f)} />
            {f === 'efectivo' ? 'Efectivo' : 'Transferencia'}
          </label>
        ))}
      </div>
      {forma === 'efectivo' ? (
        <Campo etiqueta={textoCaja}>
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
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo etiqueta="Cuenta donde llegó">
            <select className={CAMPO} value={cuentaId} onChange={(e) => setCuentaId(e.target.value)}>
              <option value="">Seleccione…</option>
              {prep.cuentas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Referencia">
            <input className={CAMPO} value={referencia} maxLength={60} onChange={(e) => setReferencia(e.target.value)} />
          </Campo>
        </div>
      )}
    </>
  )
}

function FormAbono({
  token,
  prep,
  d,
  onCerrar,
  onHecho,
  onSesionVencida,
}: {
  token: string
  prep: PrepararCxc
  d: ClienteCxc
  onCerrar: () => void
  onHecho: () => void
  onSesionVencida: () => void
}) {
  const local = cajaDeEstaComputadora()
  const [monto, setMonto] = useState('')
  const [forma, setForma] = useState<'efectivo' | 'transferencia'>('efectivo')
  const [cajaId, setCajaId] = useState(prep.cajas.some((c) => c.id === local && c.sesion_id) ? (local ?? '') : '')
  const [cuentaId, setCuentaId] = useState('')
  const [referencia, setReferencia] = useState('')
  const [elegir, setElegir] = useState(false)
  const [reparto, setReparto] = useState<Record<string, string>>({})
  const [hecho, setHecho] = useState<{ id: string; codigo: string; aplicado: { venta: string; recargo: string; capital: string }[]; debeAhora: string } | null>(null)
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  const pendientes = d.cuentas.filter((k) => k.total_pendiente !== '0.00')
  const sumaReparto = Object.values(reparto).reduce((a, v) => a + centavos(v), 0n)
  const montoC = centavos(monto)

  if (hecho)
    return (
      <Ventana titulo={`Abono ${hecho.codigo}`} onCerrar={onCerrar}>
        <div className="flex flex-col gap-3 text-sm">
          <div className="font-medium text-green-700">Abono registrado.</div>
          {hecho.aplicado.map((a) => (
            <div key={a.venta} className="flex justify-between">
              <span>{a.venta}</span>
              <span>
                {a.recargo !== '0.00' && `recargo ${dinero(a.recargo)} · `}capital {dinero(a.capital)}
              </span>
            </div>
          ))}
          <div className="font-medium">Debe ahora: {dinero(hecho.debeAhora)}</div>
          <BotonesImprimir
            texto="Imprimir recibo"
            nombrePdf={`${hecho.codigo}.pdf`}
            cargarTicket={() => ticketAbono(token, hecho.id)}
            cargarPdf={(formato) => pdfAbono(token, hecho.id, formato)}
            onSesionVencida={onSesionVencida}
          />
        </div>
      </Ventana>
    )

  return (
    <Ventana titulo={`Abono de ${d.cliente.nombre}`} onCerrar={onCerrar} ancho="max-w-xl">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          void enviar(async () => {
            const r = await registrarAbono(token, {
              clienteId: d.cliente.id,
              monto: monto.trim(),
              forma,
              cajaId: forma === 'efectivo' ? cajaId : undefined,
              cuentaId: forma === 'transferencia' ? cuentaId : undefined,
              referencia: referencia.trim() || undefined,
              distribucion: elegir
                ? Object.entries(reparto)
                    .filter(([, v]) => centavos(v) > 0n)
                    .map(([cuentaId2, v]) => ({ cuentaId: cuentaId2, monto: v.trim() }))
                : undefined,
            })
            setHecho(r)
          }, onHecho)
        }}
      >
        <p className="text-sm text-gray-600">
          Debe hoy <strong>{dinero(d.totales.total)}</strong>
          {d.totales.recargo !== '0.00' && ` (incluye ${dinero(d.totales.recargo)} de recargo)`}.
        </p>
        <Campo etiqueta="Monto del abono (RD$)">
          <input className={`${CAMPO} text-lg`} value={monto} inputMode="decimal" onChange={(e) => setMonto(e.target.value)} autoFocus />
        </Campo>
        <SelectorDinero
          prep={prep}
          forma={forma}
          setForma={setForma}
          cajaId={cajaId}
          setCajaId={setCajaId}
          cuentaId={cuentaId}
          setCuentaId={setCuentaId}
          referencia={referencia}
          setReferencia={setReferencia}
          textoCaja="Caja donde entra el dinero"
        />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={elegir} onChange={(e) => setElegir(e.target.checked)} />
          El cliente elige a qué facturas va (si no, a lo más viejo primero, empezando por el recargo)
        </label>
        {elegir && (
          <div className="flex flex-col gap-1 rounded-lg bg-gray-50 p-3 text-sm">
            {pendientes.map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-2">
                <span>
                  {k.venta} · debe {dinero(k.total_pendiente)}
                  {k.vencida && <span className="text-red-700"> · vencida</span>}
                </span>
                <input
                  className={`${CAMPO} w-32`}
                  value={reparto[k.id] ?? ''}
                  inputMode="decimal"
                  placeholder="0.00"
                  onChange={(e) => setReparto({ ...reparto, [k.id]: e.target.value })}
                />
              </div>
            ))}
            <div className={`text-right ${sumaReparto === montoC ? 'text-green-700' : 'text-amber-700'}`}>
              Repartido {dinero(texto2(sumaReparto))} de {dinero(texto2(montoC))}
            </div>
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
              montoC > centavos(d.totales.total) ||
              (forma === 'efectivo' ? !cajaId : !cuentaId || !referencia.trim()) ||
              (elegir && sumaReparto !== montoC)
            }
          >
            <BadgeDollarSign size={16} /> {guardando ? 'Registrando…' : 'Registrar abono'}
          </button>
        </div>
      </form>
    </Ventana>
  )
}

function FormCredito({
  token,
  id,
  actual,
  onListo,
  onSesionVencida,
}: {
  token: string
  id: string
  actual: { limite: string; plazo_dias: number; is_active: boolean } | null
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [limite, setLimite] = useState(actual?.limite ?? '')
  const [plazo, setPlazo] = useState(String(actual?.plazo_dias ?? 30))
  const [activo, setActivo] = useState(actual?.is_active ?? true)
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void enviar(() => configurarCreditoCliente(token, id, { limite: limite.trim(), plazoDias: plazo.trim(), activo }), onListo)
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Límite de crédito (RD$)">
          <input className={CAMPO} value={limite} inputMode="decimal" onChange={(e) => setLimite(e.target.value)} autoFocus />
        </Campo>
        <Campo etiqueta="Plazo normal (días)">
          <input className={CAMPO} value={plazo} inputMode="numeric" onChange={(e) => setPlazo(e.target.value)} />
        </Campo>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
        Crédito activo (si lo quita, no se le vende más a crédito; lo que debe sigue igual)
      </label>
      <p className="text-xs text-gray-500">El límite es un tope: ninguna venta a crédito puede pasarlo.</p>
      {error && <CajaError>{error}</CajaError>}
      <button type="submit" className={BOTON_PRINCIPAL} disabled={guardando || !MONTO.test(limite.trim())}>
        {guardando ? 'Guardando…' : 'Guardar'}
      </button>
    </form>
  )
}

function ConMotivo({
  titulo,
  texto,
  boton,
  onCerrar,
  onEnviar,
  onListo,
  onSesionVencida,
  peligro = false,
  extra,
}: {
  titulo: string
  texto: string
  boton: string
  onCerrar: () => void
  onEnviar: (motivo: string) => Promise<unknown>
  onListo: () => void
  onSesionVencida: () => void
  peligro?: boolean
  extra?: ReactNode
}) {
  const [motivo, setMotivo] = useState('')
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  return (
    <Ventana titulo={titulo} onCerrar={onCerrar}>
      <form
        className="flex flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault()
          void enviar(() => onEnviar(motivo.trim()), onListo)
        }}
      >
        <p>{texto}</p>
        {extra}
        <Campo etiqueta="Motivo">
          <input className={CAMPO} value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} autoFocus />
        </Campo>
        {error && <CajaError>{error}</CajaError>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON_SECUNDARIO} onClick={onCerrar}>
            Volver
          </button>
          <button type="submit" className={peligro ? BOTON_PELIGRO : BOTON_PRINCIPAL} disabled={guardando || motivo.trim().length < 5}>
            {peligro && <AlertTriangle size={16} />}
            {guardando ? 'Un momento…' : boton}
          </button>
        </div>
      </form>
    </Ventana>
  )
}

function FormPerdon({
  token,
  cuenta,
  onCerrar,
  onListo,
  onSesionVencida,
}: {
  token: string
  cuenta: CuentaCxc
  onCerrar: () => void
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [monto, setMonto] = useState(cuenta.recargo_pendiente)
  return (
    <ConMotivo
      titulo={`Perdonar recargo de ${cuenta.venta}`}
      texto={`Recargo pendiente: ${dinero(cuenta.recargo_pendiente)}. Puede perdonarlo todo o una parte. Queda en la auditoría.`}
      boton="Perdonar"
      extra={
        <Campo etiqueta="Cuánto perdonar (RD$)">
          <input className={CAMPO} value={monto} inputMode="decimal" onChange={(e) => setMonto(e.target.value)} />
        </Campo>
      }
      onCerrar={onCerrar}
      onEnviar={(motivo) => perdonarRecargo(token, cuenta.id, { monto: monto.trim(), motivo })}
      onListo={onListo}
      onSesionVencida={onSesionVencida}
    />
  )
}

function FormAnularAbono({
  token,
  prep,
  abono,
  onCerrar,
  onListo,
  onSesionVencida,
}: {
  token: string
  prep: PrepararCxc
  abono: ClienteCxc['abonos'][number]
  onCerrar: () => void
  onListo: () => void
  onSesionVencida: () => void
}) {
  const local = cajaDeEstaComputadora()
  const [cajaId, setCajaId] = useState(prep.cajas.some((c) => c.id === local && c.sesion_id) ? (local ?? '') : '')
  return (
    <ConMotivo
      titulo={`Anular ${abono.codigo}`}
      texto={`Se devuelven ${dinero(abono.total)} al cliente y la deuda vuelve a como estaba antes del abono.`}
      boton="Anular abono"
      peligro
      extra={
        abono.forma === 'efectivo' ? (
          <Campo etiqueta="Caja de donde sale la devolución">
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
        ) : (
          <p className="text-gray-600">Se registra un reverso en la cuenta donde llegó la transferencia.</p>
        )
      }
      onCerrar={onCerrar}
      onEnviar={(motivo) => anularAbono(token, abono.id, { motivo, cajaId: abono.forma === 'efectivo' ? cajaId : undefined })}
      onListo={onListo}
      onSesionVencida={onSesionVencida}
    />
  )
}

// ---------- Dar crédito ----------

function DarCredito({ token, onListo, onSesionVencida }: { token: string; onListo: (id: string) => void; onSesionVencida: () => void }) {
  const [texto, setTexto] = useState('')
  const [lista, setLista] = useState<{ id: string; codigo: string | null; nombre: string; numero_documento: string | null; telefono: string | null }[]>([])
  const [elegido, setElegido] = useState<{ id: string; nombre: string } | null>(null)

  useEffect(() => {
    const t = texto.trim()
    if (t.length < 2) {
      setLista([])
      return
    }
    let vigente = true
    const espera = setTimeout(() => {
      buscarClientesCxc(token, t)
        .then((r) => vigente && setLista(r))
        .catch((e) => {
          if (e instanceof SesionVencida) onSesionVencida()
        })
    }, 300)
    return () => {
      vigente = false
      clearTimeout(espera)
    }
  }, [texto, token, onSesionVencida])

  return (
    <div className="flex max-w-xl flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="flex items-center gap-2 font-medium">
        <UserPlus size={18} /> Darle crédito a un cliente
      </h2>
      {elegido ? (
        <>
          <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
            <span className="font-medium">{elegido.nombre}</span>
            <button type="button" className="text-xs underline" onClick={() => setElegido(null)}>
              Cambiar
            </button>
          </div>
          <FormCredito token={token} id={elegido.id} actual={null} onListo={() => onListo(elegido.id)} onSesionVencida={onSesionVencida} />
        </>
      ) : (
        <>
          <div className="relative">
            <Search size={16} className="absolute top-3 left-3 text-gray-400" />
            <input className={`${CAMPO} w-full pl-9`} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar cliente por nombre, código SCITO, documento o teléfono" autoFocus />
          </div>
          {lista.length > 0 && (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {lista.map((c) => (
                <li key={c.id}>
                  <button type="button" className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-gray-50" onClick={() => setElegido(c)}>
                    <span className="font-medium">{c.nombre}</span>
                    <span className="text-xs text-gray-500">{[c.codigo, c.numero_documento, c.telefono].filter(Boolean).join(' · ') || '—'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-500">Si ya tiene crédito, aquí se cambia su límite o su plazo.</p>
        </>
      )}
    </div>
  )
}

// ---------- Recargo por atraso ----------

function Recargo({ token, prep, onCambio, onSesionVencida }: { token: string; prep: PrepararCxc; onCambio: () => void; onSesionVencida: () => void }) {
  const [pct, setPct] = useState('')
  const [desde, setDesde] = useState(prep.hoy)
  const [ok, setOk] = useState(false)
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  return (
    <div className="flex max-w-xl flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
      <p>
        Se cobra el <strong>{prep.recargoVigente.replace(/\.?0+$/, '')}%</strong> del capital pendiente por cada mes completo de atraso,
        sin interés sobre interés. El administrador puede perdonarlo en cada factura.
      </p>
      <div className="flex flex-col gap-1">
        <div className="font-medium">Historial</div>
        {prep.tasas.map((t) => (
          <div key={t.desde} className="flex justify-between border-t border-gray-100 py-1">
            <span>Desde {fechaCorta(t.desde)}</span>
            <span>{t.porcentaje.replace(/\.?0+$/, '')}%</span>
          </div>
        ))}
      </div>
      <form
        className="flex flex-col gap-3 border-t border-gray-200 pt-3"
        onSubmit={(e) => {
          e.preventDefault()
          setOk(false)
          void enviar(() => nuevaTasaRecargo(token, { porcentaje: pct.trim(), vigenteDesde: desde }), () => {
            setOk(true)
            setPct('')
            onCambio()
          })
        }}
      >
        <div className="font-medium">Cambiar el porcentaje</div>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Nuevo % por mes">
            <input className={CAMPO} value={pct} inputMode="decimal" onChange={(e) => setPct(e.target.value)} placeholder="5" />
          </Campo>
          <Campo etiqueta="Desde">
            <input type="date" className={CAMPO} value={desde} min={prep.hoy} onChange={(e) => setDesde(e.target.value)} />
          </Campo>
        </div>
        <p className="text-xs text-gray-500">Los meses ya cumplidos se quedan con el % que había ese día.</p>
        {error && <CajaError>{error}</CajaError>}
        {ok && <p className="text-green-700">Guardado.</p>}
        <button type="submit" className={`${BOTON_PRINCIPAL} self-start`} disabled={guardando || !/^\d{1,3}(\.\d{1,2})?$/.test(pct.trim())}>
          Guardar
        </button>
      </form>
    </div>
  )
}
