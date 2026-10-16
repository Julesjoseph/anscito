import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AlertTriangle, Ban, BookOpen, CheckCircle2, Lock, Pencil, Plus, Power, RefreshCw, Search, Trash2, Unlock } from 'lucide-react'
import {
  SesionVencida,
  anularAsientoContable,
  balanzaComprobacion,
  cambiarCuentaDe,
  cambiarLineaContable,
  cambiarReglaContable,
  catalogoCuentas,
  clasificarPendiente,
  crearAsientoContable,
  crearCuentaContable,
  descartarPendiente,
  detalleAsiento,
  editarCuentaContable,
  estadoCuentaContable,
  fijarFechaInicioContable,
  gananciaPorLinea,
  listarAsientos,
  pendientesContables,
  periodosContables,
  prepararContabilidad,
  reabrirMesContable,
  reglasContables,
  reintentarPendiente,
  reintentarPendientes,
  validarCuentaContable,
} from './api'
import type {
  Balanza,
  CuentaContable,
  CuentaDe,
  DetalleAsiento,
  FilaAsiento,
  LineaAsientoEntrada,
  PendienteContable,
  PorLinea,
  PrepararContabilidad,
  ReglasContables,
  ResultadoContable,
} from './api'
import { BOTON_PELIGRO, BOTON_PRINCIPAL, BOTON_SECUNDARIO, CAMPO, CajaError, Ventana } from './componentes'
import { dinero, mensajeDe } from './formato'
import { Estados, Mayor } from './Libros'
import CierreMes from './CierreMes'

// Contabilidad: catálogo de cuentas, asientos (manuales, de apertura y
// automáticos), reglas (qué cuenta usa cada operación), pendientes, meses
// (cerrar y reabrir) y balanza de comprobación. Todo en RD$.

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

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

const NOMBRE_TIPO: Record<string, string> = {
  activo: 'Activo',
  pasivo: 'Pasivo',
  capital: 'Capital',
  ingreso: 'Ingreso',
  costo: 'Costo',
  gasto: 'Gasto',
}

const NOMBRE_ORIGEN: Record<string, string> = {
  manual: 'Manual',
  apertura: 'Apertura',
  reverso: 'Reverso',
  venta: 'Venta',
  cxc_abono: 'Abono de crédito',
  compra: 'Compra',
  compra_pago: 'Pago de contado',
  cxp_pago: 'Pago a proveedor',
  caja_mov: 'Movimiento de caja',
  caja_mov_usd: 'Movimiento de caja (US$)',
  caja_cierre: 'Cierre de caja',
  cuenta_mov: 'Movimiento de banco',
  transferencia: 'Transferencia',
  san_recibo: 'Cobro de SOL CASH',
  san_entrega: 'Mano de SOL CASH',
  remesa: 'Envío (SCITO TRANSFER)',
  remesa_entrega: 'Entrega de un agente',
  remesa_pago: 'Comisión de un agente',
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

export default function Contabilidad({ token, permisos, onSesionVencida }: Props) {
  const [pestana, setPestana] = useState<'catalogo' | 'asientos' | 'mayor' | 'estados' | 'reglas' | 'pendientes' | 'lineas' | 'meses' | 'balanza'>('catalogo')
  const [prep, setPrep] = useState<PrepararContabilidad | null>(null)
  const [cuentas, setCuentas] = useState<CuentaContable[] | null>(null)
  const [error, setError] = useState('')
  const [nuevo, setNuevo] = useState<'manual' | 'apertura' | null>(null)
  const [version, setVersion] = useState(0)

  const cargar = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([prepararContabilidad(token), catalogoCuentas(token)])
      setPrep(p)
      setCuentas(c)
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, onSesionVencida])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const pendientes = (cuentas ?? []).filter((c) => !c.validada && c.is_active).length
  const puedeAsientos = permisos.includes('contabilidad.asientos')

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-medium">Contabilidad</h1>
        <p className="text-sm text-gray-500">
          Catálogo de cuentas, asientos (libro diario), cierres de mes y balanza de comprobación. Montos en RD$.
        </p>
      </div>
      {error && <CajaError>{error}</CajaError>}
      {prep && cuentas && (
        <>
          {pendientes > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              El catálogo es una base sugerida: {pendientes} cuenta(s) están pendientes de que su contador las revise y
              valide. Las reglas contables deben confirmarse con él antes de usarse para impuestos o estados oficiales.
            </div>
          )}
          <Inicio
            token={token}
            prep={prep}
            puedeFijar={permisos.includes('contabilidad.cerrar')}
            puedeAsientos={puedeAsientos}
            onApertura={() => setNuevo('apertura')}
            onCambio={() => void cargar()}
            onSesionVencida={onSesionVencida}
          />
        </>
      )}
      <div className="flex flex-wrap gap-2 border-b border-gray-200">
        {(
          [
            ['catalogo', 'Catálogo de cuentas'],
            ['asientos', 'Asientos (diario)'],
            ['mayor', 'Libro mayor'],
            ['estados', 'Estados financieros'],
            ['reglas', 'Reglas'],
            ['pendientes', 'Pendientes'],
            ['lineas', 'Por línea de negocio'],
            ['meses', 'Meses'],
            ['balanza', 'Balanza'],
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
            {id === 'pendientes' && (prep?.pendientes ?? 0) > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-xs text-amber-800">{prep?.pendientes}</span>
            )}
          </button>
        ))}
      </div>
      {!prep || !cuentas ? (
        !error && <p className="text-sm text-gray-500">Cargando…</p>
      ) : pestana === 'catalogo' ? (
        <Catalogo token={token} cuentas={cuentas} puedeEditar={permisos.includes('contabilidad.catalogo')} onCambio={() => void cargar()} onSesionVencida={onSesionVencida} />
      ) : pestana === 'asientos' ? (
        <Asientos
          key={version}
          token={token}
          prep={prep}
          puedeNuevo={puedeAsientos && prep.fechaInicio !== null}
          puedeAnular={permisos.includes('contabilidad.anular')}
          onNuevo={() => setNuevo('manual')}
          onCambio={() => void cargar()}
          onSesionVencida={onSesionVencida}
        />
      ) : pestana === 'mayor' ? (
        <Mayor token={token} hoy={prep.hoy} cuentas={cuentas} onSesionVencida={onSesionVencida} />
      ) : pestana === 'estados' ? (
        <Estados token={token} hoy={prep.hoy} puedeCerrar={permisos.includes('contabilidad.cerrar')} onSesionVencida={onSesionVencida} />
      ) : pestana === 'reglas' ? (
        <Reglas token={token} cuentas={cuentas} puedeEditar={permisos.includes('contabilidad.catalogo')} onSesionVencida={onSesionVencida} />
      ) : pestana === 'pendientes' ? (
        <Pendientes
          token={token}
          cuentas={cuentas}
          hayInicio={prep.fechaInicio !== null}
          puedeAsientos={puedeAsientos}
          puedeDescartar={permisos.includes('contabilidad.anular')}
          onCambio={() => void cargar()}
          onSesionVencida={onSesionVencida}
        />
      ) : pestana === 'lineas' ? (
        <PorLineaNegocio token={token} hoy={prep.hoy} onSesionVencida={onSesionVencida} />
      ) : pestana === 'meses' ? (
        <Meses token={token} puedeCerrar={permisos.includes('contabilidad.cerrar')} onSesionVencida={onSesionVencida} />
      ) : (
        <VerBalanza token={token} hoy={prep.hoy} onSesionVencida={onSesionVencida} />
      )}
      {nuevo && prep && cuentas && (
        <FormAsiento
          token={token}
          prep={prep}
          cuentas={cuentas}
          apertura={nuevo === 'apertura'}
          onCerrar={() => setNuevo(null)}
          onListo={() => {
            setNuevo(null)
            setVersion((v) => v + 1)
            void cargar()
          }}
          onSesionVencida={onSesionVencida}
        />
      )}
    </div>
  )
}

// ---------- Fecha de inicio y apertura ----------

function Inicio({
  token,
  prep,
  puedeFijar,
  puedeAsientos,
  onApertura,
  onCambio,
  onSesionVencida,
}: {
  token: string
  prep: PrepararContabilidad
  puedeFijar: boolean
  puedeAsientos: boolean
  onApertura: () => void
  onCambio: () => void
  onSesionVencida: () => void
}) {
  const [fecha, setFecha] = useState(prep.fechaInicio ?? '')
  const { error, guardando, enviar } = useEnviar(onSesionVencida)

  if (prep.fechaInicio)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm">
        <span>
          La contabilidad empieza el <strong>{fechaCorta(prep.fechaInicio)}</strong>.{' '}
          {prep.hayApertura ? (
            <span className="text-green-700">Asiento de apertura registrado.</span>
          ) : (
            <span className="text-amber-700">Falta el asiento de apertura (los saldos con que empieza).</span>
          )}
        </span>
        {!prep.hayApertura && puedeAsientos && (
          <button type="button" className={BOTON_PRINCIPAL} onClick={onApertura}>
            <BookOpen size={16} /> Registrar apertura
          </button>
        )}
      </div>
    )

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        void enviar(() => fijarFechaInicioContable(token, fecha), onCambio)
      }}
    >
      <div className="font-medium">¿Desde qué fecha lleva la contabilidad en el sistema?</div>
      <p className="text-gray-600">
        Ese día se registra el asiento de apertura con lo que hay: caja, bancos, inventario, lo que le deben y lo que debe.
        Antes de esa fecha no se registran asientos. Una vez que haya asientos, la fecha no se cambia.
      </p>
      {puedeFijar ? (
        <div className="flex flex-wrap items-end gap-2">
          <Campo etiqueta="Fecha de inicio">
            <input type="date" className={CAMPO} value={fecha} max={prep.hoy} onChange={(e) => setFecha(e.target.value)} />
          </Campo>
          <button type="submit" className={BOTON_PRINCIPAL} disabled={guardando || !fecha}>
            {guardando ? 'Guardando…' : 'Guardar fecha'}
          </button>
        </div>
      ) : (
        <p className="text-amber-700">Pídale al administrador o al contador que fije la fecha de inicio.</p>
      )}
      {error && <CajaError>{error}</CajaError>}
    </form>
  )
}

// ---------- Catálogo ----------

type AccionCuenta = { tipo: 'nueva'; padre: CuentaContable } | { tipo: 'editar'; cuenta: CuentaContable } | { tipo: 'estado'; cuenta: CuentaContable }

function Catalogo({
  token,
  cuentas,
  puedeEditar,
  onCambio,
  onSesionVencida,
}: {
  token: string
  cuentas: CuentaContable[]
  puedeEditar: boolean
  onCambio: () => void
  onSesionVencida: () => void
}) {
  const [texto, setTexto] = useState('')
  const [solo, setSolo] = useState<'' | 'pendientes' | 'inactivas'>('')
  const [accion, setAccion] = useState<AccionCuenta | null>(null)
  const [error, setError] = useState('')

  const t = texto.trim().toLowerCase()
  const visibles = cuentas.filter(
    (c) =>
      (solo === 'inactivas' ? !c.is_active : c.is_active) &&
      (solo !== 'pendientes' || !c.validada) &&
      (!t || c.codigo.startsWith(t) || c.nombre.toLowerCase().includes(t)),
  )

  async function validar(c: CuentaContable) {
    setError('')
    try {
      await validarCuentaContable(token, c.id, !c.validada)
      onCambio()
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search size={16} className="absolute top-3 left-3 text-gray-400" />
          <input className={`${CAMPO} w-full pl-9`} type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Código o nombre" />
        </div>
        <select className={CAMPO} value={solo} onChange={(e) => setSolo(e.target.value as typeof solo)} aria-label="Mostrar">
          <option value="">Activas</option>
          <option value="pendientes">Pendientes de validar</option>
          <option value="inactivas">Desactivadas</option>
        </select>
      </div>
      {error && <CajaError>{error}</CajaError>}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">Cuenta</th>
              <th className="px-3 py-2 font-medium">Tipo</th>
              <th className="px-3 py-2 text-right font-medium">Saldo</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {visibles.map((c) => (
              <tr key={c.id} className={`border-t border-gray-100 ${c.acepta_movimientos ? '' : 'bg-gray-50/60'}`}>
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-2" style={{ paddingLeft: `${(c.nivel - 1) * 16}px` }}>
                    <span className={`font-mono text-xs ${c.acepta_movimientos ? 'text-gray-500' : 'font-semibold text-gray-700'}`}>{c.codigo}</span>
                    <span className={c.acepta_movimientos ? '' : 'font-medium'}>{c.nombre}</span>
                    {!c.validada && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">pendiente</span>}
                  </div>
                </td>
                <td className="px-3 py-1.5 text-xs whitespace-nowrap text-gray-500">
                  {NOMBRE_TIPO[c.tipo]} · {c.naturaleza}
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  {c.acepta_movimientos ? (c.tiene_movimientos ? dinero(c.saldo) : <span className="text-gray-300">—</span>) : ''}
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  {puedeEditar && (
                    <span className="inline-flex items-center gap-2">
                      {!c.acepta_movimientos && c.is_active && (
                        <button type="button" className="text-gray-400 hover:text-gray-700" title="Agregar cuenta debajo" aria-label={`Agregar cuenta debajo de ${c.codigo}`} onClick={() => setAccion({ tipo: 'nueva', padre: c })}>
                          <Plus size={15} />
                        </button>
                      )}
                      <button type="button" className="text-gray-400 hover:text-gray-700" title="Editar" aria-label={`Editar ${c.codigo}`} onClick={() => setAccion({ tipo: 'editar', cuenta: c })}>
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        className={c.validada ? 'text-green-600 hover:text-gray-500' : 'text-gray-300 hover:text-green-600'}
                        title={c.validada ? 'Validada (clic para volver a pendiente)' : 'Marcar como validada por el contador'}
                        aria-label={`Validar ${c.codigo}`}
                        onClick={() => void validar(c)}
                      >
                        <CheckCircle2 size={15} />
                      </button>
                      <button type="button" className="text-gray-400 hover:text-red-700" title={c.is_active ? 'Desactivar' : 'Activar'} aria-label={`Activar o desactivar ${c.codigo}`} onClick={() => setAccion({ tipo: 'estado', cuenta: c })}>
                        <Power size={15} />
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {accion?.tipo === 'nueva' && (
        <FormCuenta token={token} padre={accion.padre} onCerrar={() => setAccion(null)} onListo={() => { setAccion(null); onCambio() }} onSesionVencida={onSesionVencida} />
      )}
      {accion?.tipo === 'editar' && (
        <FormCuenta token={token} cuenta={accion.cuenta} onCerrar={() => setAccion(null)} onListo={() => { setAccion(null); onCambio() }} onSesionVencida={onSesionVencida} />
      )}
      {accion?.tipo === 'estado' && (
        <FormEstadoCuenta token={token} cuenta={accion.cuenta} onCerrar={() => setAccion(null)} onListo={() => { setAccion(null); onCambio() }} onSesionVencida={onSesionVencida} />
      )}
    </div>
  )
}

function FormCuenta({
  token,
  padre,
  cuenta,
  onCerrar,
  onListo,
  onSesionVencida,
}: {
  token: string
  padre?: CuentaContable
  cuenta?: CuentaContable
  onCerrar: () => void
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [codigo, setCodigo] = useState(cuenta?.codigo ?? padre?.codigo ?? '')
  const [nombre, setNombre] = useState(cuenta?.nombre ?? '')
  const [naturaleza, setNaturaleza] = useState<string>(cuenta?.naturaleza ?? padre?.naturaleza ?? 'deudora')
  const [acepta, setAcepta] = useState(cuenta?.acepta_movimientos ?? true)
  const [notas, setNotas] = useState(cuenta?.notas ?? '')
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  const bloqueada = cuenta?.tiene_movimientos === true

  return (
    <Ventana titulo={cuenta ? `Editar ${cuenta.codigo}` : `Nueva cuenta debajo de ${padre?.codigo} ${padre?.nombre}`} onCerrar={onCerrar}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          void enviar(
            () =>
              cuenta
                ? editarCuentaContable(token, cuenta.id, { nombre: nombre.trim(), naturaleza, aceptaMovimientos: acepta, notas: notas.trim() })
                : crearCuentaContable(token, { codigo: codigo.trim(), nombre: nombre.trim(), padreId: padre?.id ?? '', naturaleza, aceptaMovimientos: acepta, notas: notas.trim() }),
            onListo,
          )
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Campo etiqueta="Código">
            <input className={`${CAMPO} font-mono`} value={codigo} disabled={!!cuenta} inputMode="numeric" onChange={(e) => setCodigo(e.target.value)} autoFocus={!cuenta} />
          </Campo>
          <div className="sm:col-span-2">
            <Campo etiqueta="Nombre">
              <input className={CAMPO} value={nombre} maxLength={150} onChange={(e) => setNombre(e.target.value)} autoFocus={!!cuenta} />
            </Campo>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo etiqueta="Naturaleza">
            <select className={CAMPO} value={naturaleza} disabled={bloqueada} onChange={(e) => setNaturaleza(e.target.value)}>
              <option value="deudora">Deudora (aumenta con débitos)</option>
              <option value="acreedora">Acreedora (aumenta con créditos)</option>
            </select>
          </Campo>
          <label className="flex items-center gap-2 pt-6 text-sm text-gray-700">
            <input type="checkbox" checked={acepta} disabled={bloqueada} onChange={(e) => setAcepta(e.target.checked)} />
            Acepta movimientos (cuenta de detalle)
          </label>
        </div>
        {bloqueada && <p className="text-xs text-gray-500">Ya tiene asientos: solo se cambian el nombre y las notas.</p>}
        {!cuenta && padre && <p className="text-xs text-gray-500">El código empieza con {padre.codigo}. El tipo es el de arriba ({NOMBRE_TIPO[padre.tipo]}).</p>}
        <Campo etiqueta="Notas">
          <input className={CAMPO} value={notas} maxLength={500} onChange={(e) => setNotas(e.target.value)} />
        </Campo>
        {error && <CajaError>{error}</CajaError>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON_SECUNDARIO} onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className={BOTON_PRINCIPAL} disabled={guardando || nombre.trim().length < 2 || !/^\d+$/.test(codigo.trim())}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Ventana>
  )
}

function FormEstadoCuenta({
  token,
  cuenta,
  onCerrar,
  onListo,
  onSesionVencida,
}: {
  token: string
  cuenta: CuentaContable
  onCerrar: () => void
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  const activar = !cuenta.is_active
  return (
    <Ventana titulo={`${activar ? 'Activar' : 'Desactivar'} ${cuenta.codigo} ${cuenta.nombre}`} onCerrar={onCerrar}>
      <form
        className="flex flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault()
          void enviar(() => estadoCuentaContable(token, cuenta.id, activar, motivo.trim()), onListo)
        }}
      >
        {!activar && <p>Solo se desactiva si su saldo es 0 y no tiene cuentas activas debajo. No se borra: queda en el historial.</p>}
        <Campo etiqueta={activar ? 'Motivo (opcional)' : 'Motivo'}>
          <input className={CAMPO} value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} autoFocus />
        </Campo>
        {error && <CajaError>{error}</CajaError>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON_SECUNDARIO} onClick={onCerrar}>
            Volver
          </button>
          <button type="submit" className={activar ? BOTON_PRINCIPAL : BOTON_PELIGRO} disabled={guardando || (!activar && motivo.trim().length < 5)}>
            <Power size={16} /> {guardando ? 'Un momento…' : activar ? 'Activar' : 'Desactivar'}
          </button>
        </div>
      </form>
    </Ventana>
  )
}

// ---------- Asientos ----------

function Asientos({
  token,
  prep,
  puedeNuevo,
  puedeAnular,
  onNuevo,
  onCambio,
  onSesionVencida,
}: {
  token: string
  prep: PrepararContabilidad
  puedeNuevo: boolean
  puedeAnular: boolean
  onNuevo: () => void
  onCambio: () => void
  onSesionVencida: () => void
}) {
  const [f, setF] = useState({ desde: '', hasta: '', texto: '', origen: '', pagina: 1 })
  const [datos, setDatos] = useState<{ filas: FilaAsiento[]; total: number; porPagina: number } | null>(null)
  const [error, setError] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setError('')
    try {
      setDatos(await listarAsientos(token, f))
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, f, onSesionVencida])

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 250)
    return () => clearTimeout(t)
  }, [cargar])

  const paginas = datos ? Math.max(1, Math.ceil(datos.total / datos.porPagina)) : 1

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Campo etiqueta="Desde">
          <input type="date" className={CAMPO} value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value, pagina: 1 })} />
        </Campo>
        <Campo etiqueta="Hasta">
          <input type="date" className={CAMPO} value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value, pagina: 1 })} />
        </Campo>
        <Campo etiqueta="Origen">
          <select className={CAMPO} value={f.origen} onChange={(e) => setF({ ...f, origen: e.target.value, pagina: 1 })}>
            <option value="">Todos</option>
            <option value="manual">Manuales</option>
            <option value="apertura">Apertura</option>
            <option value="reverso">Reversos</option>
            <option value="venta">Ventas</option>
            <option value="cxc_abono">Abonos de crédito</option>
            <option value="compra">Compras</option>
            <option value="compra_pago">Pagos de contado</option>
            <option value="cxp_pago">Pagos a proveedores</option>
            <option value="caja_mov">Movimientos de caja</option>
            <option value="caja_cierre">Cierres de caja</option>
            <option value="cuenta_mov">Movimientos de banco</option>
            <option value="transferencia">Transferencias</option>
            <option value="san_recibo">Cobros de SOL CASH</option>
            <option value="san_entrega">Manos de SOL CASH</option>
            <option value="remesa">Envíos</option>
            <option value="remesa_entrega">Entregas de agentes</option>
            <option value="remesa_pago">Comisiones de agentes</option>
          </select>
        </Campo>
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search size={16} className="absolute top-3 left-3 text-gray-400" />
          <input className={`${CAMPO} w-full pl-9`} type="search" value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value, pagina: 1 })} placeholder="AS-000001, concepto o documento" />
        </div>
        <button type="button" className={BOTON_SECUNDARIO} onClick={() => void cargar()} aria-label="Actualizar">
          <RefreshCw size={16} />
        </button>
        {puedeNuevo && (
          <button type="button" className={BOTON_PRINCIPAL} onClick={onNuevo}>
            <Plus size={16} /> Nuevo asiento
          </button>
        )}
      </div>
      {!prep.fechaInicio && <p className="text-sm text-amber-700">Primero fije la fecha de inicio de la contabilidad.</p>}
      {error && <CajaError>{error}</CajaError>}
      {!datos ? (
        !error && <p className="text-sm text-gray-500">Cargando…</p>
      ) : datos.filas.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">No hay asientos con estos filtros.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Asiento</th>
                <th className="px-3 py-2 font-medium">Fecha</th>
                <th className="px-3 py-2 font-medium">Concepto</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {datos.filas.map((a) => (
                <tr key={a.id} className={`cursor-pointer border-t border-gray-100 hover:bg-gray-50 ${a.estado === 'anulado' ? 'text-gray-400' : ''}`} onClick={() => setAbierto(a.id)}>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">
                    {a.codigo}
                    <div className="font-sans text-xs text-gray-500">
                      {NOMBRE_ORIGEN[a.origen] ?? a.origen}
                      {a.estado === 'anulado' && ' · anulado'}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{fechaCorta(a.fecha)}</td>
                  <td className="px-3 py-2">
                    {a.concepto}
                    {a.documento && <span className="text-xs text-gray-500"> · {a.documento}</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-medium whitespace-nowrap">{dinero(a.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {datos && paginas > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button type="button" className={BOTON_SECUNDARIO} disabled={f.pagina <= 1} onClick={() => setF({ ...f, pagina: f.pagina - 1 })}>
            Anterior
          </button>
          <span>
            Página {f.pagina} de {paginas}
          </span>
          <button type="button" className={BOTON_SECUNDARIO} disabled={f.pagina >= paginas} onClick={() => setF({ ...f, pagina: f.pagina + 1 })}>
            Siguiente
          </button>
        </div>
      )}
      {abierto && (
        <VerAsiento
          token={token}
          id={abierto}
          puedeAnular={puedeAnular}
          onCerrar={() => setAbierto(null)}
          onAnulado={() => {
            void cargar()
            onCambio()
          }}
          onSesionVencida={onSesionVencida}
        />
      )}
    </div>
  )
}

function VerAsiento({
  token,
  id,
  puedeAnular,
  onCerrar,
  onAnulado,
  onSesionVencida,
}: {
  token: string
  id: string
  puedeAnular: boolean
  onCerrar: () => void
  onAnulado: () => void
  onSesionVencida: () => void
}) {
  const [d, setD] = useState<DetalleAsiento | null>(null)
  const [error, setError] = useState('')
  const [anulando, setAnulando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [hecho, setHecho] = useState('')
  const enviarAnular = useEnviar(onSesionVencida)

  const cargar = useCallback(async () => {
    try {
      setD(await detalleAsiento(token, id))
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
      <Ventana titulo="Asiento" onCerrar={onCerrar} ancho="max-w-3xl">
        {error ? <CajaError>{error}</CajaError> : <p className="text-sm text-gray-500">Cargando…</p>}
      </Ventana>
    )

  const totalD = d.lineas.reduce((a, l) => a + centavos(l.debito), 0n)
  const totalC = d.lineas.reduce((a, l) => a + centavos(l.credito), 0n)

  return (
    <Ventana titulo={`Asiento ${d.codigo}`} onCerrar={onCerrar} ancho="max-w-3xl">
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2">
          <div>
            <div className="font-medium">{d.concepto}</div>
            <div className="text-gray-500">
              {fechaCorta(d.fecha)} · {NOMBRE_ORIGEN[d.origen] ?? d.origen}
              {d.documento ? ` · ${d.documento}` : ''} · {d.usuario}
            </div>
            {d.reverso_de_codigo && <div className="text-gray-500">Reverso de {d.reverso_de_codigo}</div>}
          </div>
          {d.estado === 'anulado' && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-red-800">
              Anulado{d.reversado_por_codigo ? ` con ${d.reversado_por_codigo}` : ''}: {d.motivo_anulacion}
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-xs text-gray-500">
              <tr>
                <th className="py-1 pr-2 font-medium">Cuenta</th>
                <th className="py-1 pr-2 font-medium">Detalle</th>
                <th className="py-1 pr-2 text-right font-medium">Débito</th>
                <th className="py-1 text-right font-medium">Crédito</th>
              </tr>
            </thead>
            <tbody>
              {d.lineas.map((l) => (
                <tr key={l.id} className="border-t border-gray-100 align-top">
                  <td className="py-1.5 pr-2">
                    <span className="font-mono text-xs text-gray-500">{l.codigo}</span> {l.cuenta}
                  </td>
                  <td className="py-1.5 pr-2 text-gray-600">{[l.descripcion, l.tercero, l.unidad_negocio].filter(Boolean).join(' · ')}</td>
                  <td className="py-1.5 pr-2 text-right whitespace-nowrap">{l.debito !== '0.00' ? dinero(l.debito) : ''}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">{l.credito !== '0.00' ? dinero(l.credito) : ''}</td>
                </tr>
              ))}
              <tr className="border-t border-gray-300 font-medium">
                <td className="py-1.5 pr-2" colSpan={2}>
                  Totales
                </td>
                <td className="py-1.5 pr-2 text-right">{dinero(texto2(totalD))}</td>
                <td className="py-1.5 text-right">{dinero(texto2(totalC))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {hecho && <p className="text-green-700">{hecho}</p>}
        {puedeAnular && d.estado === 'activo' && d.origen !== 'reverso' && !anulando && (
          <button type="button" className={`${BOTON_SECUNDARIO} self-start`} onClick={() => setAnulando(true)}>
            <span className="flex items-center gap-2">
              <Ban size={16} /> Anular
            </span>
          </button>
        )}
        {anulando && (
          <form
            className="flex flex-col gap-2 rounded-lg border border-red-200 p-3"
            onSubmit={(e) => {
              e.preventDefault()
              void enviarAnular.enviar(async () => {
                const r = await anularAsientoContable(token, d.id, motivo.trim())
                setHecho(`Anulado con el asiento ${r.reverso} del ${fechaCorta(r.fechaReverso)}.`)
              }, () => {
                setAnulando(false)
                void cargar()
                onAnulado()
              })
            }}
          >
            <p>
              Se registra un asiento de reverso (débitos y créditos al revés). Si el mes del asiento está cerrado, el reverso va con la
              fecha de hoy.
            </p>
            <Campo etiqueta="Motivo">
              <input className={CAMPO} value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} autoFocus />
            </Campo>
            {enviarAnular.error && <CajaError>{enviarAnular.error}</CajaError>}
            <div className="flex justify-end gap-2">
              <button type="button" className={BOTON_SECUNDARIO} onClick={() => setAnulando(false)}>
                Volver
              </button>
              <button type="submit" className={BOTON_PELIGRO} disabled={enviarAnular.guardando || motivo.trim().length < 5}>
                <AlertTriangle size={16} /> {enviarAnular.guardando ? 'Anulando…' : 'Anular asiento'}
              </button>
            </div>
          </form>
        )}
      </div>
    </Ventana>
  )
}

const LINEA_VACIA: LineaAsientoEntrada = { cuentaId: '', debito: '', credito: '', descripcion: '', unidadNegocioId: '' }

function FormAsiento({
  token,
  prep,
  cuentas,
  apertura,
  onCerrar,
  onListo,
  onSesionVencida,
}: {
  token: string
  prep: PrepararContabilidad
  cuentas: CuentaContable[]
  apertura: boolean
  onCerrar: () => void
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [fecha, setFecha] = useState(apertura ? (prep.fechaInicio ?? '') : prep.hoy)
  const [concepto, setConcepto] = useState(apertura ? 'Asiento de apertura: saldos iniciales' : '')
  const [lineas, setLineas] = useState<LineaAsientoEntrada[]>([{ ...LINEA_VACIA }, { ...LINEA_VACIA }])
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  const detalle = useMemo(() => cuentas.filter((c) => c.acepta_movimientos && c.is_active), [cuentas])

  const totalD = lineas.reduce((a, l) => a + centavos(l.debito), 0n)
  const totalC = lineas.reduce((a, l) => a + centavos(l.credito), 0n)
  const lineasOk = lineas.every(
    (l) => l.cuentaId && (MONTO.test(l.debito.trim()) ? 1 : 0) + (MONTO.test(l.credito.trim()) ? 1 : 0) === 1 && centavos(l.debito) + centavos(l.credito) > 0n,
  )
  const cuadra = totalD > 0n && totalD === totalC

  const poner = (i: number, cambio: Partial<LineaAsientoEntrada>) => setLineas(lineas.map((l, j) => (j === i ? { ...l, ...cambio } : l)))

  return (
    <Ventana titulo={apertura ? 'Asiento de apertura' : 'Nuevo asiento'} onCerrar={onCerrar} ancho="max-w-5xl">
      <form
        className="flex flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault()
          void enviar(
            () =>
              crearAsientoContable(token, {
                fecha,
                concepto: concepto.trim(),
                apertura,
                lineas: lineas.map((l) => ({ ...l, debito: l.debito.trim(), credito: l.credito.trim() })),
              }),
            onListo,
          )
        }}
      >
        {apertura && (
          <p className="text-gray-600">
            Escriba lo que había el {fechaCorta(prep.fechaInicio)}: lo que tiene (caja, bancos, inventario, lo que le deben) al
            débito; lo que debe (proveedores, préstamos, cuotas de SOL CASH por entregar) y el capital al crédito. Pídale a su
            contador que revise estos saldos.
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Campo etiqueta="Fecha">
            <input type="date" className={CAMPO} value={fecha} disabled={apertura} min={prep.fechaInicio ?? undefined} max={prep.hoy} onChange={(e) => setFecha(e.target.value)} />
          </Campo>
          <div className="sm:col-span-3">
            <Campo etiqueta="Concepto">
              <input className={CAMPO} value={concepto} maxLength={300} onChange={(e) => setConcepto(e.target.value)} autoFocus={!apertura} />
            </Campo>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-xs text-gray-500">
              <tr>
                <th className="py-1 pr-2 font-medium">Cuenta</th>
                <th className="py-1 pr-2 font-medium">Detalle</th>
                <th className="py-1 pr-2 font-medium">Línea de negocio</th>
                <th className="py-1 pr-2 font-medium">Débito</th>
                <th className="py-1 pr-2 font-medium">Crédito</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i} className="align-top">
                  <td className="py-1 pr-2">
                    <select className={`${CAMPO} w-64`} value={l.cuentaId} onChange={(e) => poner(i, { cuentaId: e.target.value })} aria-label={`Cuenta de la línea ${i + 1}`}>
                      <option value="">Seleccione…</option>
                      {detalle.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.codigo} {c.nombre}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <input className={`${CAMPO} w-44`} value={l.descripcion} maxLength={300} onChange={(e) => poner(i, { descripcion: e.target.value })} aria-label={`Detalle de la línea ${i + 1}`} />
                  </td>
                  <td className="py-1 pr-2">
                    <select className={`${CAMPO} w-40`} value={l.unidadNegocioId} onChange={(e) => poner(i, { unidadNegocioId: e.target.value })} aria-label={`Línea de negocio de la línea ${i + 1}`}>
                      <option value="">—</option>
                      {prep.unidadesNegocio.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.nombre}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <input className={`${CAMPO} w-28`} value={l.debito} inputMode="decimal" placeholder="0.00" onChange={(e) => poner(i, { debito: e.target.value, credito: e.target.value ? '' : l.credito })} aria-label={`Débito de la línea ${i + 1}`} />
                  </td>
                  <td className="py-1 pr-2">
                    <input className={`${CAMPO} w-28`} value={l.credito} inputMode="decimal" placeholder="0.00" onChange={(e) => poner(i, { credito: e.target.value, debito: e.target.value ? '' : l.debito })} aria-label={`Crédito de la línea ${i + 1}`} />
                  </td>
                  <td className="py-1">
                    {lineas.length > 2 && (
                      <button type="button" className="p-2 text-gray-400 hover:text-red-700" aria-label={`Quitar la línea ${i + 1}`} onClick={() => setLineas(lineas.filter((_, j) => j !== i))}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-gray-300 font-medium">
                <td className="py-2 pr-2" colSpan={3}>
                  <button type="button" className="flex items-center gap-1 text-xs text-[#C8102E] hover:underline" onClick={() => setLineas([...lineas, { ...LINEA_VACIA }])}>
                    <Plus size={14} /> Otra línea
                  </button>
                </td>
                <td className="py-2 pr-2">{dinero(texto2(totalD))}</td>
                <td className="py-2 pr-2">{dinero(texto2(totalC))}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <div className={`font-medium ${cuadra ? 'text-green-700' : 'text-amber-700'}`}>
          {cuadra ? 'Cuadra: débitos = créditos.' : `No cuadra: diferencia ${dinero(texto2(totalD > totalC ? totalD - totalC : totalC - totalD))}.`}
        </div>
        {error && <CajaError>{error}</CajaError>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON_SECUNDARIO} onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className={BOTON_PRINCIPAL} disabled={guardando || !cuadra || !lineasOk || concepto.trim().length < 3 || !fecha}>
            {guardando ? 'Guardando…' : 'Registrar asiento'}
          </button>
        </div>
      </form>
    </Ventana>
  )
}

// ---------- Meses ----------

function Meses({ token, puedeCerrar, onSesionVencida }: { token: string; puedeCerrar: boolean; onSesionVencida: () => void }) {
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof periodosContables>> | null>(null)
  const [error, setError] = useState('')
  const [reabrir, setReabrir] = useState<{ anio: number; mes: number } | null>(null)
  const [cerrar, setCerrar] = useState<{ anio: number; mes: number } | null>(null)
  const [motivo, setMotivo] = useState('')
  const accion = useEnviar(onSesionVencida)

  const cargar = useCallback(async () => {
    try {
      setDatos(await periodosContables(token))
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, onSesionVencida])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Meses desde el inicio hasta el actual (el más reciente arriba).
  const meses = useMemo(() => {
    if (!datos?.fechaInicio) return []
    const [ai, mi] = datos.fechaInicio.split('-').map(Number)
    const hoy = new Date()
    const af = hoy.getFullYear()
    const mf = hoy.getMonth() + 1
    const r: { anio: number; mes: number; estado: 'abierto' | 'cerrado'; terminado: boolean; cerrado_por: string | null; cerrado_en: string | null }[] = []
    for (let a = ai, m = mi; a < af || (a === af && m <= mf); m === 12 ? ((a += 1), (m = 1)) : (m += 1)) {
      const p = datos.periodos.find((x) => x.anio === a && x.mes === m)
      r.push({ anio: a, mes: m, estado: p?.estado ?? 'abierto', terminado: a < af || m < mf, cerrado_por: p?.cerrado_por ?? null, cerrado_en: p?.cerrado_en ?? null })
    }
    return r.reverse()
  }, [datos])

  if (error) return <CajaError>{error}</CajaError>
  if (!datos) return <p className="text-sm text-gray-500">Cargando…</p>
  if (!datos.fechaInicio) return <p className="text-sm text-gray-500">Primero fije la fecha de inicio de la contabilidad.</p>

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-gray-600">
        Un mes cerrado no acepta asientos. Al cerrar, el sistema revisa el mes: lo grave (operaciones sin contabilizar, cajas
        abiertas, el mes anterior abierto) no deja cerrar; lo demás avisa y pide un motivo. Reabrir pide un motivo y queda en la
        auditoría.
      </p>
      {accion.error && <CajaError>{accion.error}</CajaError>}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left">
          <tbody>
            {meses.map((m) => (
              <tr key={`${m.anio}-${m.mes}`} className="border-t border-gray-100 first:border-0">
                <td className="px-3 py-2 font-medium capitalize">
                  {MESES[m.mes - 1]} {m.anio}
                </td>
                <td className="px-3 py-2">
                  {m.estado === 'cerrado' ? (
                    <span className="inline-flex items-center gap-1 text-gray-700">
                      <Lock size={14} /> Cerrado{m.cerrado_por ? ` por ${m.cerrado_por}` : ''}
                    </span>
                  ) : m.terminado ? (
                    <span className="text-amber-700">Abierto (ya terminó)</span>
                  ) : (
                    <span className="text-green-700">Mes en curso</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {puedeCerrar && m.estado === 'abierto' && m.terminado && (
                    <button type="button" className={BOTON_SECUNDARIO} disabled={accion.guardando} onClick={() => setCerrar({ anio: m.anio, mes: m.mes })}>
                      <span className="flex items-center gap-2">
                        <Lock size={14} /> Cerrar
                      </span>
                    </button>
                  )}
                  {puedeCerrar && m.estado === 'cerrado' && (
                    <button type="button" className={BOTON_SECUNDARIO} onClick={() => { setReabrir({ anio: m.anio, mes: m.mes }); setMotivo('') }}>
                      <span className="flex items-center gap-2">
                        <Unlock size={14} /> Reabrir
                      </span>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cerrar && (
        <CierreMes
          token={token}
          anio={cerrar.anio}
          mes={cerrar.mes}
          onCerrar={() => setCerrar(null)}
          onListo={() => {
            setCerrar(null)
            void cargar()
          }}
          onSesionVencida={onSesionVencida}
        />
      )}
      {reabrir && (
        <Ventana titulo={`Reabrir ${MESES[reabrir.mes - 1]} ${reabrir.anio}`} onCerrar={() => setReabrir(null)}>
          <form
            className="flex flex-col gap-3 text-sm"
            onSubmit={(e) => {
              e.preventDefault()
              void accion.enviar(() => reabrirMesContable(token, reabrir.anio, reabrir.mes, motivo.trim()), () => {
                setReabrir(null)
                void cargar()
              })
            }}
          >
            <p>El mes vuelve a aceptar asientos. Queda en la auditoría con el motivo.</p>
            <Campo etiqueta="Motivo">
              <input className={CAMPO} value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} autoFocus />
            </Campo>
            {accion.error && <CajaError>{accion.error}</CajaError>}
            <div className="flex justify-end gap-2">
              <button type="button" className={BOTON_SECUNDARIO} onClick={() => setReabrir(null)}>
                Volver
              </button>
              <button type="submit" className={BOTON_PELIGRO} disabled={accion.guardando || motivo.trim().length < 5}>
                <Unlock size={16} /> Reabrir
              </button>
            </div>
          </form>
        </Ventana>
      )}
    </div>
  )
}

// ---------- Balanza de comprobación ----------

function VerBalanza({ token, hoy, onSesionVencida }: { token: string; hoy: string; onSesionVencida: () => void }) {
  const [hasta, setHasta] = useState(hoy)
  const [b, setB] = useState<Balanza | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let vigente = true
    balanzaComprobacion(token, hasta)
      .then((r) => vigente && setB(r))
      .catch((e) => {
        if (!vigente) return
        if (e instanceof SesionVencida) onSesionVencida()
        else setError(mensajeDe(e))
      })
    return () => {
      vigente = false
    }
  }, [token, hasta, onSesionVencida])

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <Campo etiqueta="Al día">
          <input type="date" className={CAMPO} value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </Campo>
        {b && (
          <span className={`pb-2 font-medium ${b.totales.cuadra ? 'text-green-700' : 'text-red-700'}`}>
            {b.totales.cuadra ? 'Cuadra: débitos = créditos' : 'No cuadra'}
          </span>
        )}
      </div>
      {error && <CajaError>{error}</CajaError>}
      {b && b.filas.length === 0 && <p className="text-gray-500">Todavía no hay asientos hasta esa fecha.</p>}
      {b && b.filas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Cuenta</th>
                <th className="px-3 py-2 text-right font-medium">Débitos</th>
                <th className="px-3 py-2 text-right font-medium">Créditos</th>
                <th className="px-3 py-2 text-right font-medium">Saldo deudor</th>
                <th className="px-3 py-2 text-right font-medium">Saldo acreedor</th>
              </tr>
            </thead>
            <tbody>
              {b.filas.map((f) => (
                <tr key={f.codigo} className="border-t border-gray-100">
                  <td className="px-3 py-1.5">
                    <span className="font-mono text-xs text-gray-500">{f.codigo}</span> {f.nombre}
                  </td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">{dinero(f.debitos)}</td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">{dinero(f.creditos)}</td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">{f.saldo_deudor !== '0.00' ? dinero(f.saldo_deudor) : ''}</td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">{f.saldo_acreedor !== '0.00' ? dinero(f.saldo_acreedor) : ''}</td>
                </tr>
              ))}
              <tr className="border-t border-gray-300 font-medium">
                <td className="px-3 py-2">Totales</td>
                <td className="px-3 py-2 text-right">{dinero(b.totales.debitos)}</td>
                <td className="px-3 py-2 text-right">{dinero(b.totales.creditos)}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500">
        Suma todos los asientos hasta esa fecha. Un asiento anulado y su reverso se cancelan entre sí.
      </p>
    </div>
  )
}

// ---------- Reglas: qué cuenta usa cada operación ----------

function SelectorCuenta({ cuentas, valor, setValor }: { cuentas: CuentaContable[]; valor: string; setValor: (v: string) => void }) {
  const detalle = useMemo(() => cuentas.filter((c) => c.acepta_movimientos && c.is_active), [cuentas])
  return (
    <select className={CAMPO} value={valor} onChange={(e) => setValor(e.target.value)} aria-label="Cuenta contable">
      <option value="">Seleccione la cuenta…</option>
      {detalle.map((c) => (
        <option key={c.id} value={c.id}>
          {c.codigo} · {c.nombre}
        </option>
      ))}
    </select>
  )
}

type FilaRegla = { llave: string; nombre: string; descripcion?: string; cuentaId: string | null; codigo: string | null; cuenta: string | null; extra?: string }

function TablaCuentas({ titulo, ayuda, filas, puedeEditar, onCambiar }: { titulo: string; ayuda: string; filas: FilaRegla[]; puedeEditar: boolean; onCambiar: (f: FilaRegla) => void }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h2 className="font-medium">{titulo}</h2>
        <p className="text-xs text-gray-500">{ayuda}</p>
      </div>
      <ul className="divide-y divide-gray-100">
        {filas.map((f) => (
          <li key={f.llave} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="font-medium">{f.nombre}</div>
              {f.descripcion && <div className="text-xs text-gray-500">{f.descripcion}</div>}
              {f.extra && <div className="text-xs text-gray-400">{f.extra}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {f.codigo ? (
                <span className="text-right">
                  <span className="font-mono text-xs text-gray-500">{f.codigo}</span> {f.cuenta}
                </span>
              ) : (
                <span className="text-amber-700">Sin cuenta contable</span>
              )}
              {puedeEditar && (
                <button type="button" className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50" onClick={() => onCambiar(f)} aria-label={`Cambiar la cuenta de ${f.nombre}`}>
                  <Pencil size={14} />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

type CambioCuenta = { tipo: 'regla' | 'categoria' | 'tipo_gasto' | 'banco'; fila: FilaRegla }

function Reglas({ token, cuentas, puedeEditar, onSesionVencida }: { token: string; cuentas: CuentaContable[]; puedeEditar: boolean; onSesionVencida: () => void }) {
  const [datos, setDatos] = useState<ReglasContables | null>(null)
  const [error, setError] = useState('')
  const [cambio, setCambio] = useState<CambioCuenta | null>(null)

  const cargar = useCallback(async () => {
    try {
      setDatos(await reglasContables(token))
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, onSesionVencida])

  useEffect(() => {
    void cargar()
  }, [cargar])

  if (error) return <CajaError>{error}</CajaError>
  if (!datos) return <p className="text-sm text-gray-500">Cargando…</p>

  const de = (x: CuentaDe): FilaRegla => ({ llave: x.id, nombre: x.nombre, cuentaId: x.cuenta_id, codigo: x.codigo, cuenta: x.cuenta })
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        Estas reglas deciden a qué cuenta va cada operación automática (ventas, compras, caja, bancos, SOL CASH y envíos). Son
        una propuesta: su contador debe revisarlas. Un cambio vale para las operaciones nuevas; los asientos ya registrados no
        cambian.
      </div>
      <LineasFijas token={token} datos={datos} puedeEditar={puedeEditar} onCambio={() => void cargar()} onSesionVencida={onSesionVencida} />
      <TablaCuentas
        titulo="Reglas generales"
        ayuda="Cada papel del dinero apunta a una cuenta del catálogo."
        filas={datos.reglas.map((r) => ({
          llave: r.clave,
          nombre: r.nombre,
          descripcion: r.descripcion,
          cuentaId: r.cuenta_id,
          codigo: r.codigo,
          cuenta: r.cuenta,
          extra: r.cambiada_por ? `Cambiada por ${r.cambiada_por} el ${fechaCorta(r.updated_at)}` : undefined,
        }))}
        puedeEditar={puedeEditar}
        onCambiar={(fila) => setCambio({ tipo: 'regla', fila })}
      />
      <TablaCuentas titulo="Categorías de gasto (Caja y Bancos)" ayuda="Cuenta de gasto de cada categoría." filas={datos.categorias.map(de)} puedeEditar={puedeEditar} onCambiar={(fila) => setCambio({ tipo: 'categoria', fila })} />
      <TablaCuentas titulo="Tipos de gasto 606 (Compras)" ayuda="Cuenta de gasto de cada tipo de la DGII (lo que no va al inventario)." filas={datos.tiposGasto.map(de)} puedeEditar={puedeEditar} onCambiar={(fila) => setCambio({ tipo: 'tipo_gasto', fila })} />
      <TablaCuentas titulo="Cuentas de banco y billeteras" ayuda="Cuenta contable de cada cuenta de banco, MonCash o NatCash." filas={datos.bancos.map(de)} puedeEditar={puedeEditar} onCambiar={(fila) => setCambio({ tipo: 'banco', fila })} />
      {cambio && (
        <FormCambioCuenta
          token={token}
          cuentas={cuentas}
          cambio={cambio}
          onCerrar={() => setCambio(null)}
          onListo={() => {
            setCambio(null)
            void cargar()
          }}
          onSesionVencida={onSesionVencida}
        />
      )}
    </div>
  )
}

function FormCambioCuenta({
  token,
  cuentas,
  cambio,
  onCerrar,
  onListo,
  onSesionVencida,
}: {
  token: string
  cuentas: CuentaContable[]
  cambio: CambioCuenta
  onCerrar: () => void
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [cuentaId, setCuentaId] = useState(cambio.fila.cuentaId ?? '')
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  return (
    <Ventana titulo="Cambiar la cuenta" onCerrar={onCerrar} ancho="max-w-lg">
      <form
        className="flex flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault()
          void enviar(
            () => (cambio.tipo === 'regla' ? cambiarReglaContable(token, cambio.fila.llave, cuentaId) : cambiarCuentaDe(token, cambio.tipo, cambio.fila.llave, cuentaId)),
            onListo,
          )
        }}
      >
        <div>
          <div className="font-medium">{cambio.fila.nombre}</div>
          {cambio.fila.descripcion && <div className="text-xs text-gray-500">{cambio.fila.descripcion}</div>}
          <div className="mt-1 text-xs text-gray-500">Ahora: {cambio.fila.codigo ? `${cambio.fila.codigo} · ${cambio.fila.cuenta}` : 'sin cuenta'}</div>
        </div>
        <Campo etiqueta="Nueva cuenta">
          <SelectorCuenta cuentas={cuentas} valor={cuentaId} setValor={setCuentaId} />
        </Campo>
        <p className="text-xs text-gray-500">Vale para las operaciones nuevas. El cambio queda en la auditoría.</p>
        {error && <CajaError>{error}</CajaError>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON_SECUNDARIO} onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className={BOTON_PRINCIPAL} disabled={guardando || !cuentaId || cuentaId === cambio.fila.cuentaId}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Ventana>
  )
}

// ---------- Pendientes: operaciones que no se pudieron contabilizar ----------

type AccionPendiente = { tipo: 'clasificar' | 'descartar'; p: PendienteContable }

function Pendientes({
  token,
  cuentas,
  hayInicio,
  puedeAsientos,
  puedeDescartar,
  onCambio,
  onSesionVencida,
}: {
  token: string
  cuentas: CuentaContable[]
  hayInicio: boolean
  puedeAsientos: boolean
  puedeDescartar: boolean
  onCambio: () => void
  onSesionVencida: () => void
}) {
  const [estado, setEstado] = useState<'pendiente' | 'resuelto' | 'descartado'>('pendiente')
  const [lista, setLista] = useState<PendienteContable[] | null>(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [accion, setAccion] = useState<AccionPendiente | null>(null)

  const cargar = useCallback(async () => {
    try {
      setLista(await pendientesContables(token, estado))
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, estado, onSesionVencida])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function correr(f: () => Promise<string>) {
    setOcupado(true)
    setError('')
    setAviso('')
    try {
      setAviso(await f())
      await cargar()
      onCambio()
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    } finally {
      setOcupado(false)
    }
  }

  const resultado = (r: ResultadoContable) =>
    r.resultado === 'hecho' ? 'Listo: se registró el asiento.' : r.resultado === 'omitido' ? 'No había nada que registrar.' : `Sigue pendiente: ${r.error ?? ''}`

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-500">
        Operaciones que se guardaron pero no se pudieron contabilizar solas: falta una cuenta, el mes está cerrado o hay que
        decir qué fue (ingresos y retiros “otro”). Corrija la causa y reintente, escoja la cuenta o descártela con una nota.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Campo etiqueta="Mostrar">
          <select className={CAMPO} value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)}>
            <option value="pendiente">Pendientes</option>
            <option value="resuelto">Resueltos</option>
            <option value="descartado">Descartados</option>
          </select>
        </Campo>
        <button type="button" className={BOTON_SECUNDARIO} onClick={() => void cargar()} aria-label="Actualizar">
          <RefreshCw size={16} />
        </button>
        {estado === 'pendiente' && puedeAsientos && hayInicio && (lista?.length ?? 0) > 0 && (
          <button
            type="button"
            className={BOTON_PRINCIPAL}
            disabled={ocupado}
            onClick={() =>
              void correr(async () => {
                const r = await reintentarPendientes(token)
                return `Reintento: ${r.hecho} contabilizada(s), ${r.pendiente} siguen pendientes${r.omitido ? `, ${r.omitido} sin nada que registrar` : ''}.`
              })
            }
          >
            <RefreshCw size={16} /> Reintentar todos
          </button>
        )}
      </div>
      {!hayInicio && <p className="text-sm text-amber-700">Primero fije la fecha de inicio de la contabilidad.</p>}
      {aviso && <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{aviso}</div>}
      {error && <CajaError>{error}</CajaError>}
      {!lista ? (
        <p className="text-sm text-gray-500">Cargando…</p>
      ) : lista.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500">
          <CheckCircle2 size={18} className="text-green-600" />
          {estado === 'pendiente' ? 'No hay operaciones pendientes de contabilizar.' : 'No hay nada aquí.'}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {lista.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">
                  {p.que}
                  {p.documento && <span className="ml-2 font-mono text-xs text-gray-500">{p.documento}</span>}
                </span>
                <span className="text-xs text-gray-500">{fechaCorta(p.fecha)}</span>
              </div>
              {p.detalle && <div className="text-gray-700">{p.detalle}</div>}
              <div className={p.estado === 'pendiente' ? 'text-amber-800' : 'text-gray-500'}>
                {p.estado === 'pendiente' ? <AlertTriangle size={14} className="mr-1 inline" /> : null}
                {p.error}
              </div>
              {p.estado !== 'pendiente' && (
                <div className="text-xs text-gray-500">
                  {p.estado === 'resuelto' ? 'Resuelto' : 'Descartado'}
                  {p.resuelto_por ? ` por ${p.resuelto_por}` : ''} el {fechaCorta(p.resuelto_en)}
                  {p.asiento ? ` · asiento ${p.asiento}` : ''}
                  {p.clasificada ? ` · cuenta ${p.clasificada}` : ''}
                  {p.nota ? ` · ${p.nota}` : ''}
                </div>
              )}
              {p.estado === 'pendiente' && hayInicio && (
                <div className="flex flex-wrap gap-2">
                  {puedeAsientos && (
                    <button
                      type="button"
                      className={`${BOTON_SECUNDARIO} flex items-center gap-2`}
                      disabled={ocupado}
                      onClick={() => void correr(async () => resultado(await reintentarPendiente(token, p.id)))}
                    >
                      <RefreshCw size={14} /> Reintentar
                    </button>
                  )}
                  {puedeAsientos && p.clasificable && (
                    <button type="button" className={BOTON_PRINCIPAL} disabled={ocupado} onClick={() => setAccion({ tipo: 'clasificar', p })}>
                      <BookOpen size={14} /> Escoger la cuenta
                    </button>
                  )}
                  {puedeDescartar && (
                    <button type="button" className={BOTON_PELIGRO} disabled={ocupado} onClick={() => setAccion({ tipo: 'descartar', p })}>
                      <Ban size={14} /> Descartar
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {accion && (
        <FormPendiente
          token={token}
          cuentas={cuentas}
          accion={accion}
          onCerrar={() => setAccion(null)}
          onListo={(texto) => {
            setAccion(null)
            setAviso(texto)
            void cargar()
            onCambio()
          }}
          onSesionVencida={onSesionVencida}
        />
      )}
    </div>
  )
}

function FormPendiente({
  token,
  cuentas,
  accion,
  onCerrar,
  onListo,
  onSesionVencida,
}: {
  token: string
  cuentas: CuentaContable[]
  accion: AccionPendiente
  onCerrar: () => void
  onListo: (aviso: string) => void
  onSesionVencida: () => void
}) {
  const [cuentaId, setCuentaId] = useState('')
  const [nota, setNota] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const clasificar = accion.tipo === 'clasificar'
  const p = accion.p

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setGuardando(true)
    setError('')
    try {
      if (clasificar) {
        const r = await clasificarPendiente(token, p.id, cuentaId, nota.trim())
        onListo(r.resultado === 'hecho' ? 'Listo: se registró el asiento con la cuenta escogida.' : `Se guardó la cuenta, pero sigue pendiente: ${r.error ?? ''}`)
      } else {
        await descartarPendiente(token, p.id, nota.trim())
        onListo('Descartado: esta operación no se contabilizará.')
      }
    } catch (e2) {
      if (e2 instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e2))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Ventana titulo={clasificar ? 'Escoger la cuenta' : 'Descartar'} onCerrar={onCerrar} ancho="max-w-lg">
      <form className="flex flex-col gap-3 text-sm" onSubmit={(e) => void guardar(e)}>
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <div className="font-medium">
            {p.que} {p.documento && <span className="font-mono text-xs text-gray-500">{p.documento}</span>}
          </div>
          {p.detalle && <div className="text-gray-700">{p.detalle}</div>}
          <div className="text-xs text-gray-500">{fechaCorta(p.fecha)}</div>
        </div>
        {clasificar ? (
          <>
            <p className="text-gray-600">
              ¿A qué cuenta va? Por ejemplo: <em>Otros ingresos</em> si es un ingreso que no es venta, <em>Capital</em> si es
              dinero del dueño o una cuenta por pagar si es dinero de otra persona.
            </p>
            <Campo etiqueta="Cuenta">
              <SelectorCuenta cuentas={cuentas} valor={cuentaId} setValor={setCuentaId} />
            </Campo>
          </>
        ) : (
          <p className="text-gray-600">
            La operación sigue guardada, pero no tendrá asiento automático. Úselo solo si ya se registró a mano o si no debe ir a
            la contabilidad.
          </p>
        )}
        <Campo etiqueta={clasificar ? 'Nota (por qué esa cuenta)' : 'Motivo'}>
          <input className={CAMPO} value={nota} maxLength={300} onChange={(e) => setNota(e.target.value)} placeholder={clasificar ? 'Ej.: reembolso de un cliente' : 'Ej.: ya registrado en el asiento AS-000120'} />
        </Campo>
        {error && <CajaError>{error}</CajaError>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON_SECUNDARIO} onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className={clasificar ? BOTON_PRINCIPAL : BOTON_PELIGRO} disabled={guardando || nota.trim().length < 5 || (clasificar && !cuentaId)}>
            {guardando ? 'Guardando…' : clasificar ? 'Guardar y contabilizar' : 'Descartar'}
          </button>
        </div>
      </form>
    </Ventana>
  )
}

// ---------- Ganancia por línea de negocio ----------

function PorLineaNegocio({ token, hoy, onSesionVencida }: { token: string; hoy: string; onSesionVencida: () => void }) {
  const [desde, setDesde] = useState(`${hoy.slice(0, 7)}-01`)
  const [hasta, setHasta] = useState(hoy)
  const [datos, setDatos] = useState<PorLinea | null>(null)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    setError('')
    try {
      setDatos(await gananciaPorLinea(token, desde, hasta))
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, desde, hasta, onSesionVencida])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const negativo = (v: string) => v.startsWith('-')

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-500">
        Lo que gana cada línea: sus ingresos menos sus costos y sus gastos propios. Los gastos de todo el negocio (alquiler,
        luz, sueldos…) no se reparten: aparecen aparte en “Gastos generales”. Sale de los asientos contables.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Campo etiqueta="Desde">
          <input type="date" className={CAMPO} value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />
        </Campo>
        <Campo etiqueta="Hasta">
          <input type="date" className={CAMPO} value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} />
        </Campo>
        <button type="button" className={BOTON_SECUNDARIO} onClick={() => void cargar()} aria-label="Actualizar">
          <RefreshCw size={16} />
        </button>
      </div>
      {error && <CajaError>{error}</CajaError>}
      {!datos ? (
        !error && <p className="text-sm text-gray-500">Cargando…</p>
      ) : datos.lineas.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500">No hay asientos en esas fechas.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">Línea de negocio</th>
                <th className="px-3 py-2 text-right">Ingresos</th>
                <th className="px-3 py-2 text-right">Costos</th>
                <th className="px-3 py-2 text-right">Gastos</th>
                <th className="px-3 py-2 text-right">Ganancia</th>
              </tr>
            </thead>
            <tbody>
              {datos.lineas.map((l) => {
                const k = l.unidadId ?? 'generales'
                return (
                  <Fragment key={k}>
                    <tr className={`cursor-pointer border-t border-gray-100 hover:bg-gray-50 ${l.unidadId ? '' : 'bg-gray-50/60'}`} onClick={() => setAbierta(abierta === k ? null : k)}>
                      <td className="px-3 py-2 font-medium">
                        <span className="mr-1 text-gray-400">{abierta === k ? '▾' : '▸'}</span>
                        {l.unidad}
                      </td>
                      <td className="px-3 py-2 text-right">{dinero(l.ingresos)}</td>
                      <td className="px-3 py-2 text-right">{dinero(l.costos)}</td>
                      <td className="px-3 py-2 text-right">{dinero(l.gastos)}</td>
                      <td className={`px-3 py-2 text-right font-medium ${negativo(l.resultado) ? 'text-red-700' : 'text-green-700'}`}>{dinero(l.resultado)}</td>
                    </tr>
                    {abierta === k &&
                      l.cuentas.map((x) => (
                        <tr key={`${k}-${x.codigo}`} className="text-xs text-gray-600">
                          <td className="py-1 pr-3 pl-8">
                            <span className="font-mono text-gray-400">{x.codigo}</span> {x.cuenta}
                          </td>
                          <td className="px-3 py-1 text-right">{x.tipo === 'ingreso' ? dinero(x.monto) : ''}</td>
                          <td className="px-3 py-1 text-right">{x.tipo === 'costo' ? dinero(x.monto) : ''}</td>
                          <td className="px-3 py-1 text-right">{x.tipo === 'gasto' ? dinero(x.monto) : ''}</td>
                          <td />
                        </tr>
                      ))}
                  </Fragment>
                )
              })}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 font-medium">
              <tr>
                <td className="px-3 py-2">Ganancia del negocio</td>
                <td className="px-3 py-2 text-right">{dinero(datos.total.ingresos)}</td>
                <td className="px-3 py-2 text-right">{dinero(datos.total.costos)}</td>
                <td className="px-3 py-2 text-right">{dinero(datos.total.gastos)}</td>
                <td className={`px-3 py-2 text-right ${negativo(datos.total.resultado) ? 'text-red-700' : 'text-green-700'}`}>{dinero(datos.total.resultado)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500">Toque una línea para ver sus cuentas. Las cifras dependen de las reglas contables, que su contador debe validar.</p>
    </div>
  )
}

function LineasFijas({ token, datos, puedeEditar, onCambio, onSesionVencida }: { token: string; datos: ReglasContables; puedeEditar: boolean; onCambio: () => void; onSesionVencida: () => void }) {
  const [error, setError] = useState('')
  async function cambiar(clave: string, unidadId: string) {
    setError('')
    try {
      await cambiarLineaContable(token, clave, unidadId)
      onCambio()
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h2 className="font-medium">Líneas de negocio de SOL CASH y SCITO TRANSFER</h2>
        <p className="text-xs text-gray-500">A qué línea van sus comisiones y moras (y la comisión de los agentes).</p>
      </div>
      <ul className="divide-y divide-gray-100">
        {datos.lineas.map((l) => (
          <li key={l.clave} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="font-medium">{l.nombre}</span>
            {puedeEditar ? (
              <select className={CAMPO} value={l.unidad_id ?? ''} onChange={(e) => void cambiar(l.clave, e.target.value)} aria-label={l.nombre}>
                {!l.unidad_id && <option value="">Sin línea (va a generales)</option>}
                {datos.unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </select>
            ) : (
              <span>{l.unidad ?? <span className="text-amber-700">Sin línea</span>}</span>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <div className="px-4 pb-3">
          <CajaError>{error}</CajaError>
        </div>
      )}
    </section>
  )
}
