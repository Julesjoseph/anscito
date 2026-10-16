import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Ban, CheckCircle2, Lock, Plus, RefreshCw } from 'lucide-react'
import { SesionVencida } from './api'
import type { FilaCuenta } from './api'
import {
  cerrarConciliacion,
  crearConciliacion,
  descartarConciliacion,
  detalleConciliacion,
  editarConciliacion,
  listarConciliaciones,
  marcarConciliacion,
} from './api-conciliacion'
import type { DetalleConciliacion, FilaConciliacion } from './api-conciliacion'
import { BOTON_PELIGRO, BOTON_PRINCIPAL, BOTON_SECUNDARIO, CAMPO, CajaError, Ventana } from './componentes'
import { mensajeDe } from './formato'

// Conciliación bancaria: a una fecha de corte, el saldo del estado de cuenta
// contra el sistema. Se marcan los movimientos que aparecen en el estado; lo
// demás queda en tránsito. Se cierra cuando la diferencia es 0.

const NOMBRE_TIPO: Record<string, string> = {
  saldo_inicial: 'Saldo inicial',
  venta: 'Cobro de venta',
  devolucion: 'Devolución',
  transferencia_entrada: 'Transferencia (entra)',
  transferencia_salida: 'Transferencia (sale)',
  pago: 'Pago',
  cargo: 'Cargo del banco',
  interes: 'Intereses',
  ingreso: 'Ingreso',
  reverso: 'Reverso',
  remesa: 'Envío',
  san_cuota: 'Cuota SOL CASH',
  san_mano: 'Mano SOL CASH',
}

function fechaCorta(dia: string | null | undefined): string {
  if (!dia) return '—'
  const [a, m, d] = dia.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

function hoy(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function enMoneda(simbolo: string, v: string | null | undefined): string {
  if (v === null || v === undefined) return '—'
  const neg = v.startsWith('-')
  const [e, d = '00'] = (neg ? v.slice(1) : v).split('.')
  return `${neg ? '-' : ''}${simbolo}${e.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${d.padEnd(2, '0')}`
}

const MONTO = /^-?\d{1,12}(\.\d{1,2})?$/

type Props = {
  token: string
  cuentas: FilaCuenta[]
  puedeConciliar: boolean
  onCambio: () => void
  onSesionVencida: () => void
}

export default function Conciliacion({ token, cuentas, puedeConciliar, onCambio, onSesionVencida }: Props) {
  const [cuentaId, setCuentaId] = useState(cuentas.find((c) => c.is_active)?.id ?? '')
  const [lista, setLista] = useState<FilaConciliacion[] | null>(null)
  const [abiertaId, setAbiertaId] = useState<string | null>(null)
  const [nueva, setNueva] = useState(false)
  const [error, setError] = useState('')
  const cuenta = cuentas.find((c) => c.id === cuentaId)

  const cargar = useCallback(async () => {
    if (!cuentaId) return
    setError('')
    try {
      const l = await listarConciliaciones(token, cuentaId)
      setLista(l)
      setAbiertaId((actual) => actual ?? l.find((x) => x.estado === 'abierta')?.id ?? null)
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, cuentaId, onSesionVencida])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const hayAbierta = lista?.some((x) => x.estado === 'abierta') ?? false

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-500">
        Compare el sistema con el estado de cuenta del banco: escriba la fecha de corte y el saldo que dice el banco, y marque los
        movimientos que aparecen en el estado. Lo que no aparece queda “en tránsito”. Se cierra cuando la diferencia es 0.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Cuenta
          <select
            className={CAMPO}
            value={cuentaId}
            onChange={(e) => {
              setCuentaId(e.target.value)
              setAbiertaId(null)
              setLista(null)
            }}
          >
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre} ({c.moneda}){c.is_active ? '' : ' · inactiva'}
              </option>
            ))}
          </select>
        </label>
        {puedeConciliar && !hayAbierta && cuenta?.is_active && (
          <button type="button" className={BOTON_PRINCIPAL} onClick={() => setNueva(true)}>
            <Plus size={16} /> Nueva conciliación
          </button>
        )}
      </div>
      {error && <CajaError>{error}</CajaError>}

      {abiertaId && (
        <Detalle
          key={abiertaId}
          token={token}
          id={abiertaId}
          puedeConciliar={puedeConciliar}
          onCerrar={() => setAbiertaId(null)}
          onCambio={() => {
            void cargar()
            onCambio()
          }}
          onSesionVencida={onSesionVencida}
        />
      )}

      <section className="rounded-xl border border-gray-200 bg-white">
        <h2 className="border-b border-gray-100 px-4 py-3 font-medium">Historial</h2>
        {!lista ? (
          <p className="px-4 py-3 text-sm text-gray-500">Cargando…</p>
        ) : lista.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-500">Esta cuenta todavía no tiene conciliaciones.</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {lista.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span>
                  <span className="font-mono text-xs text-gray-500">{k.codigo}</span> · corte {fechaCorta(k.fecha_corte)} · banco{' '}
                  {enMoneda(cuenta?.simbolo ?? '', k.saldo_banco)}
                  {k.estado === 'cerrada' && (
                    <span className="text-gray-500">
                      {' '}
                      · en tránsito {enMoneda(cuenta?.simbolo ?? '', k.en_transito)} · cerró {k.cerrada_por}
                    </span>
                  )}
                  {k.estado === 'descartada' && <span className="text-gray-500"> · {k.motivo_descarte}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      k.estado === 'abierta' ? 'bg-amber-100 text-amber-800' : k.estado === 'cerrada' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {k.estado}
                  </span>
                  {k.id !== abiertaId && (
                    <button type="button" className="text-sm text-[#C8102E] hover:underline" onClick={() => setAbiertaId(k.id)}>
                      Ver
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {nueva && cuenta && (
        <FormNueva
          token={token}
          cuenta={cuenta}
          onCerrar={() => setNueva(false)}
          onListo={(id) => {
            setNueva(false)
            setAbiertaId(id)
            void cargar()
          }}
          onSesionVencida={onSesionVencida}
        />
      )}
    </div>
  )
}

function FormNueva({
  token,
  cuenta,
  onCerrar,
  onListo,
  onSesionVencida,
}: {
  token: string
  cuenta: FilaCuenta
  onCerrar: () => void
  onListo: (id: string) => void
  onSesionVencida: () => void
}) {
  const [fecha, setFecha] = useState(hoy())
  const [saldo, setSaldo] = useState('')
  const [notas, setNotas] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const valido = MONTO.test(saldo.trim().replace(/,/g, '')) && !!fecha

  async function guardar() {
    setGuardando(true)
    setError('')
    try {
      const r = await crearConciliacion(token, { cuentaId: cuenta.id, fechaCorte: fecha, saldoBanco: saldo.trim().replace(/,/g, ''), notas })
      onListo(r.id)
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Ventana titulo={`Nueva conciliación · ${cuenta.nombre}`} onCerrar={onCerrar}>
      <div className="flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1 text-gray-600">
          Fecha de corte (la del estado de cuenta)
          <input type="date" className={CAMPO} value={fecha} max={hoy()} onChange={(e) => setFecha(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-gray-600">
          Saldo según el estado de cuenta ({cuenta.simbolo})
          <input className={CAMPO} inputMode="decimal" value={saldo} onChange={(e) => setSaldo(e.target.value)} placeholder="0.00" />
          <span className="text-xs text-gray-400">Negativo si la cuenta está sobregirada.</span>
        </label>
        <label className="flex flex-col gap-1 text-gray-600">
          Notas (opcional)
          <input className={CAMPO} value={notas} maxLength={500} onChange={(e) => setNotas(e.target.value)} placeholder="Ej.: estado de cuenta de octubre" />
        </label>
        {error && <CajaError>{error}</CajaError>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON_SECUNDARIO} onClick={onCerrar}>
            Cancelar
          </button>
          <button type="button" className={BOTON_PRINCIPAL} disabled={!valido || guardando} onClick={() => void guardar()}>
            {guardando ? 'Creando…' : 'Empezar'}
          </button>
        </div>
      </div>
    </Ventana>
  )
}

function Detalle({
  token,
  id,
  puedeConciliar,
  onCerrar,
  onCambio,
  onSesionVencida,
}: {
  token: string
  id: string
  puedeConciliar: boolean
  onCerrar: () => void
  onCambio: () => void
  onSesionVencida: () => void
}) {
  const [d, setD] = useState<DetalleConciliacion | null>(null)
  const [saldo, setSaldo] = useState('')
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [descartar, setDescartar] = useState(false)
  const [motivo, setMotivo] = useState('')

  const cargar = useCallback(async () => {
    try {
      const x = await detalleConciliacion(token, id)
      setD(x)
      setSaldo(x.conciliacion.saldo_banco)
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, id, onSesionVencida])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function correr(f: () => Promise<unknown>) {
    setOcupado(true)
    setError('')
    setAviso('')
    try {
      await f()
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    } finally {
      setOcupado(false)
    }
  }

  if (!d) return error ? <CajaError>{error}</CajaError> : <p className="text-sm text-gray-500">Cargando…</p>
  const abierta = d.conciliacion.estado === 'abierta' && puedeConciliar
  const s = d.cuenta.simbolo
  const t = d.totales
  const cuadra = t.diferencia === '0.00'

  async function marcar(ids: string[], cotejado: boolean) {
    await correr(async () => {
      const r = await marcarConciliacion(token, id, ids.map((x) => ({ id: x, cotejado })))
      setD((prev) =>
        prev ? { ...prev, totales: r.totales, movimientos: prev.movimientos.map((m) => (ids.includes(m.id) ? { ...m, cotejado } : m)) } : prev,
      )
    })
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-medium">
            {d.conciliacion.codigo} · {d.cuenta.nombre} · corte {fechaCorta(d.conciliacion.fecha_corte)}
          </h2>
          {d.conciliacion.notas && <p className="text-xs text-gray-500">{d.conciliacion.notas}</p>}
        </div>
        <div className="flex gap-2">
          <button type="button" className={BOTON_SECUNDARIO} onClick={() => void cargar()} aria-label="Actualizar">
            <RefreshCw size={16} />
          </button>
          <button type="button" className={BOTON_SECUNDARIO} onClick={onCerrar}>
            Ocultar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <Dato nombre="Saldo del sistema" valor={enMoneda(s, t.saldoSistema)} />
        <Dato nombre="Entradas en tránsito" valor={`− ${enMoneda(s, t.transitoEntradas)}`} />
        <Dato nombre="Salidas en tránsito" valor={`+ ${enMoneda(s, t.transitoSalidas)}`} />
        <Dato nombre="Saldo ajustado" valor={enMoneda(s, t.saldoAjustado)} />
        {abierta ? (
          <label className="flex flex-col text-xs text-gray-500">
            Saldo del banco
            <span className="flex gap-1">
              <input className={`${CAMPO} h-8 w-28 text-sm`} inputMode="decimal" value={saldo} onChange={(e) => setSaldo(e.target.value)} />
              <button
                type="button"
                className="rounded-lg border border-gray-300 px-2 text-xs hover:bg-gray-50"
                disabled={ocupado || !MONTO.test(saldo.trim().replace(/,/g, '')) || saldo === d.conciliacion.saldo_banco}
                onClick={() =>
                  void correr(async () => {
                    await editarConciliacion(token, id, { saldoBanco: saldo.trim().replace(/,/g, ''), notas: d.conciliacion.notas ?? '' })
                    await cargar()
                  })
                }
              >
                Guardar
              </button>
            </span>
          </label>
        ) : (
          <Dato nombre="Saldo del banco" valor={enMoneda(s, t.saldoBanco)} />
        )}
        <div className={`flex flex-col rounded-lg px-2 py-1 ${cuadra ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          <span className="text-xs">Diferencia</span>
          <span className="font-medium">{enMoneda(s, t.diferencia)}</span>
        </div>
      </div>

      {!cuadra && abierta && (
        <p className="flex items-start gap-2 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          Si el banco tiene algo que el sistema no (un cargo, intereses…), regístrelo en Cuentas → Registrar y márquelo aquí.
        </p>
      )}
      {d.contable && d.contable.diferencia !== '0.00' && (
        <p className="text-xs text-gray-500">
          Contabilidad ({d.contable.cuenta}): RD${d.contable.saldoContable} · sistema en RD$: RD${d.contable.saldoSistemaDop} · diferencia
          RD${d.contable.diferencia} (puede ser la apertura o operaciones pendientes de contabilizar).
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr>
              <th className="py-1 pr-2">
                {abierta && d.movimientos.length > 0 && (
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[#C8102E]"
                    aria-label="Marcar todos"
                    checked={d.movimientos.every((m) => m.cotejado)}
                    onChange={(e) => void marcar(d.movimientos.map((m) => m.id), e.target.checked)}
                  />
                )}
              </th>
              <th className="py-1 pr-3">Fecha</th>
              <th className="py-1 pr-3">Movimiento</th>
              <th className="py-1 pr-3 text-right">Entra</th>
              <th className="py-1 text-right">Sale</th>
            </tr>
          </thead>
          <tbody>
            {d.movimientos.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-gray-500">
                  No hay movimientos por conciliar hasta esa fecha.
                </td>
              </tr>
            )}
            {d.movimientos.map((m) => (
              <tr key={m.id} className={`border-t border-gray-100 ${m.cotejado ? '' : 'bg-amber-50/40'}`}>
                <td className="py-1.5 pr-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[#C8102E]"
                    checked={m.cotejado}
                    disabled={!abierta || ocupado}
                    onChange={(e) => void marcar([m.id], e.target.checked)}
                    aria-label={`Aparece en el estado: movimiento ${m.id}`}
                  />
                </td>
                <td className="py-1.5 pr-3">{fechaCorta(m.fecha)}</td>
                <td className="py-1.5 pr-3">
                  {NOMBRE_TIPO[m.tipo] ?? m.tipo}
                  {m.venta && <span className="font-mono text-xs text-gray-500"> {m.venta}</span>}
                  {(m.motivo || m.referencia || m.beneficiario) && (
                    <div className="text-xs text-gray-500">{[m.beneficiario, m.referencia, m.motivo].filter(Boolean).join(' · ')}</div>
                  )}
                  {m.estado === 'por_confirmar' && <span className="text-xs text-amber-700"> · por confirmar</span>}
                </td>
                <td className="py-1.5 pr-3 text-right">{m.signo > 0 ? enMoneda(s, m.monto) : ''}</td>
                <td className="py-1.5 text-right">{m.signo < 0 ? enMoneda(s, m.monto) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">
        Marcado = aparece en el estado de cuenta. Sin marcar = en tránsito (pasa a la próxima conciliación). Al cerrar, lo marcado que
        estaba “por confirmar” queda confirmado.
      </p>

      {aviso && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <CheckCircle2 size={16} /> {aviso}
        </div>
      )}
      {error && <CajaError>{error}</CajaError>}
      {abierta && (
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BOTON_PELIGRO} disabled={ocupado} onClick={() => setDescartar(true)}>
            <Ban size={16} /> Descartar
          </button>
          <button
            type="button"
            className={BOTON_PRINCIPAL}
            disabled={ocupado || !cuadra}
            onClick={() =>
              void correr(async () => {
                const r = await cerrarConciliacion(token, id)
                await cargar()
                setAviso(`Conciliación cerrada.${r.confirmados ? ` ${r.confirmados} movimiento(s) quedaron confirmados.` : ''}`)
                onCambio()
              })
            }
          >
            <Lock size={16} /> Cerrar conciliación
          </button>
        </div>
      )}
      {descartar && (
        <Ventana titulo="Descartar la conciliación" onCerrar={() => setDescartar(false)}>
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-gray-600">La conciliación queda guardada como descartada (no se borra). Después puede empezar otra.</p>
            <label className="flex flex-col gap-1 text-gray-600">
              Motivo
              <input className={CAMPO} value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className={BOTON_SECUNDARIO} onClick={() => setDescartar(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className={BOTON_PELIGRO}
                disabled={ocupado || motivo.trim().length < 5}
                onClick={() =>
                  void correr(async () => {
                    await descartarConciliacion(token, id, motivo.trim())
                    setDescartar(false)
                    onCambio()
                    onCerrar()
                  })
                }
              >
                Descartar
              </button>
            </div>
          </div>
        </Ventana>
      )}
    </section>
  )
}

function Dato({ nombre, valor }: { nombre: string; valor: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-gray-500">{nombre}</span>
      <span>{valor}</span>
    </div>
  )
}
