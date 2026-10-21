import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AlertTriangle, ArrowLeft, Pencil, Plus, Power, Search, Trash2 } from 'lucide-react'
import { SesionVencida } from './api'
import {
  agregarEmpleadoNomina,
  anularAdelanto,
  anularNomina,
  cambiarCuota,
  crearEmpleado,
  crearNomina,
  darAdelanto,
  descartarNomina,
  detalleNomina,
  editarEmpleado,
  editarLineaNomina,
  estadoEmpleado,
  listarAdelantos,
  listarEmpleados,
  listarNominas,
  listarParametros,
  nuevoParametro,
  pagarNomina,
  prepararNomina,
  quitarLineaNomina,
} from './api-nomina'
import type {
  Adelanto,
  CambioLinea,
  DatosEmpleado,
  DetalleNomina,
  Empleado,
  EstadoNomina,
  FilaNomina,
  Frecuencia,
  HistorialParametro,
  LineaNomina,
  ParametrosNomina,
  PrepararNomina,
  TipoNomina,
} from './api-nomina'
import { AREA, BOTON_PELIGRO, BOTON_PRINCIPAL, BOTON_SECUNDARIO, CAMPO, CajaError, Ventana } from './componentes'
import { dinero, mensajeDe } from './formato'

// Nómina: empleados con sueldo mensual y su frecuencia de pago, nóminas que
// se preparan en borrador y se pagan desde la caja o el banco, adelantos y
// préstamos, regalía y vacaciones. Todavía sin TSS ni ISR (decisión del
// dueño: ningún empleado está inscrito).

type Props = {
  token: string
  permisos: string[]
  onSesionVencida: () => void
}

const NOMBRE_FRECUENCIA: Record<Frecuencia, string> = {
  semanal: 'Semanal',
  quincenal: 'Quincenal',
  mensual: 'Mensual',
}
const NOMBRE_TIPO: Record<TipoNomina, string> = {
  regular: 'Nómina',
  regalia: 'Regalía pascual',
  vacaciones: 'Vacaciones',
}
const ESTADO: Record<EstadoNomina, [string, string]> = {
  borrador: ['Borrador', 'bg-amber-100 text-amber-800'],
  pagada: ['Pagada', 'bg-green-100 text-green-800'],
  anulada: ['Anulada', 'bg-red-100 text-red-700'],
  descartada: ['Descartada', 'bg-gray-100 text-gray-600'],
}

// "2026-10-05" -> "05/10/2026"
const dma = (f: string | null) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '—')
const numero = (v: string) => v.replace(/\.?0+$/, '') || '0'
const MONTO = /^\d{1,9}(\.\d{1,2})?$/

// Suma exacta de montos en texto (en centavos, sin decimales flotantes).
const centavos = (v: string) => {
  const [e, d = ''] = v.split('.')
  return BigInt(e || '0') * 100n + BigInt((d + '00').slice(0, 2))
}
const textoMonto = (c: bigint) => `${c / 100n}.${String(c % 100n).padStart(2, '0')}`
const sumar = (...v: string[]) => textoMonto(v.reduce((a, x) => a + centavos(x), 0n))
const hayMonto = (v: string) => centavos(v) > 0n

function useManejo(onSesionVencida: () => void) {
  const [error, setError] = useState('')
  const manejar = useCallback(
    (e: unknown) => {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    },
    [onSesionVencida],
  )
  return { error, setError, manejar }
}

// Período propuesto según la frecuencia (hoy: la quincena, el mes o la semana).
function periodoDe(frecuencia: Frecuencia, hoy: string): [string, string] {
  const [a, m, d] = hoy.split('-').map(Number)
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate()
  const f = (dia: number) => `${hoy.slice(0, 8)}${String(dia).padStart(2, '0')}`
  if (frecuencia === 'mensual') return [f(1), f(ultimo)]
  if (frecuencia === 'quincenal') return d <= 15 ? [f(1), f(15)] : [f(16), f(ultimo)]
  const fecha = new Date(Date.UTC(a, m - 1, d))
  const lunes = new Date(fecha.getTime() - ((fecha.getUTCDay() + 6) % 7) * 86_400_000)
  const domingo = new Date(lunes.getTime() + 6 * 86_400_000)
  return [lunes.toISOString().slice(0, 10), domingo.toISOString().slice(0, 10)]
}

// ---------- Empleados ----------

const VACIO: DatosEmpleado = {
  nombre: '',
  documento: '',
  telefono: '',
  direccion: '',
  cargo: '',
  fechaIngreso: '',
  frecuencia: 'quincenal',
  sueldoMensual: '',
  formaPago: 'efectivo',
  cuentaEmpleado: '',
  notas: '',
}

function FormEmpleado({
  token,
  empleado,
  hoy,
  onListo,
  onSesionVencida,
}: {
  token: string
  empleado: Empleado | null
  hoy: string
  onListo: (mensaje: string) => void
  onSesionVencida: () => void
}) {
  const [d, setD] = useState<DatosEmpleado>(
    empleado
      ? {
          nombre: empleado.nombre,
          documento: empleado.documento ?? '',
          telefono: empleado.telefono ?? '',
          direccion: empleado.direccion ?? '',
          cargo: empleado.cargo ?? '',
          fechaIngreso: empleado.fecha_ingreso,
          frecuencia: empleado.frecuencia,
          sueldoMensual: empleado.sueldo_mensual,
          formaPago: empleado.forma_pago,
          cuentaEmpleado: empleado.cuenta_empleado ?? '',
          notas: empleado.notas ?? '',
        }
      : { ...VACIO, fechaIngreso: hoy },
  )
  const { error, setError, manejar } = useManejo(onSesionVencida)
  const [guardando, setGuardando] = useState(false)
  const cambiar = (c: Partial<DatosEmpleado>) => setD((x) => ({ ...x, ...c }))

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      if (empleado) {
        await editarEmpleado(token, empleado.id, d)
        onListo(`Se guardaron los cambios de ${d.nombre}.`)
      } else {
        const r = await crearEmpleado(token, d)
        onListo(`Empleado ${r.codigo} creado.`)
      }
    } catch (err) {
      manejar(err)
    } finally {
      setGuardando(false)
    }
  }

  const campo = (titulo: string, hijo: ReactNode, ancho = '') => (
    <label className={`flex flex-col gap-1 text-sm text-gray-600 ${ancho}`}>
      {titulo}
      {hijo}
    </label>
  )
  return (
    <form onSubmit={(e) => void guardar(e)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {campo('Nombre completo', <input className={CAMPO} value={d.nombre} onChange={(e) => cambiar({ nombre: e.target.value })} required />, 'sm:col-span-2')}
      {campo('Cédula o pasaporte', <input className={CAMPO} value={d.documento} onChange={(e) => cambiar({ documento: e.target.value })} />)}
      {campo('Teléfono', <input className={CAMPO} inputMode="tel" value={d.telefono} onChange={(e) => cambiar({ telefono: e.target.value })} />)}
      {campo('Cargo', <input className={CAMPO} value={d.cargo} onChange={(e) => cambiar({ cargo: e.target.value })} placeholder="Ej.: Cajera" />)}
      {campo('Fecha de entrada', <input className={CAMPO} type="date" value={d.fechaIngreso} onChange={(e) => cambiar({ fechaIngreso: e.target.value })} required />)}
      {campo(
        'Sueldo MENSUAL (RD$)',
        <input className={CAMPO} inputMode="decimal" value={d.sueldoMensual} onChange={(e) => cambiar({ sueldoMensual: e.target.value.replace(/[,\s]/g, '') })} placeholder="20000" required />,
      )}
      {campo(
        'Se le paga',
        <select className={CAMPO} value={d.frecuencia} onChange={(e) => cambiar({ frecuencia: e.target.value as Frecuencia })}>
          <option value="semanal">Cada semana</option>
          <option value="quincenal">Cada quincena</option>
          <option value="mensual">Cada mes</option>
        </select>,
      )}
      {campo(
        'Forma de pago',
        <select className={CAMPO} value={d.formaPago} onChange={(e) => cambiar({ formaPago: e.target.value as 'efectivo' | 'banco' })}>
          <option value="efectivo">Efectivo (de la caja)</option>
          <option value="banco">Transferencia (del banco)</option>
        </select>,
      )}
      {d.formaPago === 'banco' &&
        campo('Banco y cuenta del empleado', <input className={CAMPO} value={d.cuentaEmpleado} onChange={(e) => cambiar({ cuentaEmpleado: e.target.value })} placeholder="Ej.: Popular, ahorro 123456789" />)}
      {campo('Dirección', <input className={CAMPO} value={d.direccion} onChange={(e) => cambiar({ direccion: e.target.value })} />, 'sm:col-span-2')}
      {campo('Notas', <textarea className={AREA} rows={2} value={d.notas} onChange={(e) => cambiar({ notas: e.target.value })} />, 'sm:col-span-2')}
      <p className="text-xs text-gray-500 sm:col-span-2">
        El sistema divide el sueldo mensual: por quincena, la mitad; por semana, el mensual entre {''}
        4.33. Con el mensual también calcula las horas extra, la regalía y las vacaciones.
      </p>
      {error && (
        <div className="sm:col-span-2">
          <CajaError>{error}</CajaError>
        </div>
      )}
      <div className="sm:col-span-2">
        <button type="submit" disabled={guardando} className={BOTON_PRINCIPAL}>
          {guardando ? 'Guardando…' : empleado ? 'Guardar cambios' : 'Crear empleado'}
        </button>
      </div>
    </form>
  )
}

function FormEstadoEmpleado({
  token,
  empleado,
  hoy,
  onListo,
  onSesionVencida,
}: {
  token: string
  empleado: Empleado
  hoy: string
  onListo: (mensaje: string) => void
  onSesionVencida: () => void
}) {
  const desactivar = empleado.is_active
  const [motivo, setMotivo] = useState('')
  const [salida, setSalida] = useState(hoy)
  const { error, setError, manejar } = useManejo(onSesionVencida)
  const [guardando, setGuardando] = useState(false)
  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      await estadoEmpleado(token, empleado.id, !desactivar, motivo, desactivar ? salida : undefined)
      onListo(desactivar ? `${empleado.nombre} quedó inactivo.` : `${empleado.nombre} está activo otra vez.`)
    } catch (err) {
      manejar(err)
    } finally {
      setGuardando(false)
    }
  }
  return (
    <form onSubmit={(e) => void guardar(e)} className="flex flex-col gap-3">
      {desactivar && (
        <>
          <p className="text-sm text-gray-600">No se borra: queda en la historia y deja de salir en las nóminas nuevas.</p>
          {hayMonto(empleado.debe) && (
            <p className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" /> Todavía debe {dinero(empleado.debe)} de adelantos.
            </p>
          )}
          <label className="flex flex-col gap-1 text-sm text-gray-600">
            Fecha de salida
            <input className={CAMPO} type="date" value={salida} onChange={(e) => setSalida(e.target.value)} required />
          </label>
        </>
      )}
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Motivo
        <textarea className={AREA} rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={desactivar ? 'Ej.: Renunció' : 'Ej.: Volvió a trabajar'} />
      </label>
      {error && <CajaError>{error}</CajaError>}
      <button type="submit" disabled={guardando || motivo.trim().length < 5} className={desactivar ? BOTON_PELIGRO : BOTON_PRINCIPAL}>
        {guardando ? 'Guardando…' : desactivar ? 'Desactivar' : 'Activar'}
      </button>
    </form>
  )
}

function Empleados({ token, permisos, prep, onCambio, onSesionVencida }: Props & { prep: PrepararNomina; onCambio: () => void }) {
  const [texto, setTexto] = useState('')
  const [estado, setEstado] = useState<'activos' | 'inactivos' | 'todos'>('activos')
  const [filas, setFilas] = useState<Empleado[] | null>(null)
  const [modal, setModal] = useState<{ tipo: 'editar'; empleado: Empleado | null } | { tipo: 'estado'; empleado: Empleado } | null>(null)
  const [aviso, setAviso] = useState('')
  const { error, setError, manejar } = useManejo(onSesionVencida)
  const gestionar = permisos.includes('nomina.empleados')

  const cargar = useCallback(async () => {
    try {
      setFilas(await listarEmpleados(token, texto, estado))
      setError('')
    } catch (e) {
      manejar(e)
    }
  }, [token, texto, estado, manejar, setError])

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 250)
    return () => clearTimeout(t)
  }, [cargar])

  function listo(mensaje: string) {
    setModal(null)
    setAviso(mensaje)
    onCambio()
    void cargar()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
          <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por nombre, código, cargo, cédula o teléfono" className={`${CAMPO} w-full pl-9`} />
        </div>
        <select className={CAMPO} value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)} aria-label="Estado">
          <option value="activos">Activos</option>
          <option value="inactivos">Inactivos</option>
          <option value="todos">Todos</option>
        </select>
        {gestionar && (
          <button type="button" onClick={() => setModal({ tipo: 'editar', empleado: null })} className={BOTON_PRINCIPAL}>
            <Plus size={16} /> Nuevo empleado
          </button>
        )}
      </div>
      {aviso && <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{aviso}</div>}
      {error && <CajaError>{error}</CajaError>}
      <section className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        {!filas ? (
          <p className="p-4 text-sm text-gray-500">Cargando…</p>
        ) : filas.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">{texto ? 'Ningún empleado coincide con la búsqueda.' : 'Todavía no hay empleados. Cree el primero con "Nuevo empleado".'}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Código</th>
                <th className="px-3 py-2 font-medium">Nombre</th>
                <th className="px-3 py-2 font-medium">Cobra</th>
                <th className="px-3 py-2 text-right font-medium">Sueldo mensual</th>
                <th className="px-3 py-2 font-medium">Pago</th>
                <th className="px-3 py-2 text-right font-medium">Debe (adelantos)</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filas.map((e) => (
                <tr key={e.id} className={`border-t border-gray-100 ${e.is_active ? '' : 'text-gray-400'}`}>
                  <td className="px-3 py-2 font-mono text-xs">{e.codigo}</td>
                  <td className="px-3 py-2">
                    {e.nombre}
                    <span className="block text-xs text-gray-500">
                      {[e.cargo, e.telefono, `desde ${dma(e.fecha_ingreso)}`].filter(Boolean).join(' · ')}
                      {!e.is_active && ` · salió ${dma(e.fecha_salida)}`}
                    </span>
                  </td>
                  <td className="px-3 py-2">{NOMBRE_FRECUENCIA[e.frecuencia]}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{dinero(e.sueldo_mensual)}</td>
                  <td className="px-3 py-2">{e.forma_pago === 'banco' ? 'Banco' : 'Efectivo'}</td>
                  <td className={`px-3 py-2 text-right whitespace-nowrap ${hayMonto(e.debe) ? 'text-amber-700' : 'text-gray-400'}`}>{dinero(e.debe)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {gestionar && (
                      <>
                        <button type="button" onClick={() => setModal({ tipo: 'editar', empleado: e })} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" title="Editar" aria-label={`Editar ${e.nombre}`}>
                          <Pencil size={16} />
                        </button>
                        <button type="button" onClick={() => setModal({ tipo: 'estado', empleado: e })} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" title={e.is_active ? 'Desactivar' : 'Activar'} aria-label={e.is_active ? `Desactivar ${e.nombre}` : `Activar ${e.nombre}`}>
                          <Power size={16} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {modal?.tipo === 'editar' && (
        <Ventana titulo={modal.empleado ? `Editar ${modal.empleado.codigo}` : 'Nuevo empleado'} ancho="max-w-2xl" onCerrar={() => setModal(null)}>
          <FormEmpleado token={token} empleado={modal.empleado} hoy={prep.hoy} onListo={listo} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
      {modal?.tipo === 'estado' && (
        <Ventana titulo={modal.empleado.is_active ? `Desactivar a ${modal.empleado.nombre}` : `Activar a ${modal.empleado.nombre}`} onCerrar={() => setModal(null)}>
          <FormEstadoEmpleado token={token} empleado={modal.empleado} hoy={prep.hoy} onListo={listo} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
    </div>
  )
}

// ---------- Origen del dinero (caja o cuenta) ----------

function SelectorCaja({ prep, valor, onCambio }: { prep: PrepararNomina; valor: string; onCambio: (v: string) => void }) {
  const abiertas = prep.cajas.filter((c) => c.sesion_id)
  return (
    <label className="flex flex-col gap-1 text-sm text-gray-600">
      Caja (abierta)
      <select className={CAMPO} value={valor} onChange={(e) => onCambio(e.target.value)}>
        <option value="">— Seleccione —</option>
        {abiertas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </select>
      {abiertas.length === 0 && <span className="text-xs text-amber-700">No hay cajas abiertas: abra una en Caja.</span>}
    </label>
  )
}

function SelectorCuenta({ prep, valor, onCambio }: { prep: PrepararNomina; valor: string; onCambio: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-gray-600">
      Cuenta de banco (en pesos)
      <select className={CAMPO} value={valor} onChange={(e) => onCambio(e.target.value)}>
        <option value="">— Seleccione —</option>
        {prep.cuentas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </select>
    </label>
  )
}

// ---------- Adelantos ----------

function FormAdelanto({ token, prep, onListo, onSesionVencida }: { token: string; prep: PrepararNomina; onListo: (m: string) => void; onSesionVencida: () => void }) {
  const [empleados, setEmpleados] = useState<Empleado[]>([])
  const [empleadoId, setEmpleadoId] = useState('')
  const [monto, setMonto] = useState('')
  const [cuota, setCuota] = useState('')
  const [forma, setForma] = useState<'efectivo' | 'banco'>('efectivo')
  const [cajaId, setCajaId] = useState('')
  const [cuentaId, setCuentaId] = useState('')
  const [motivo, setMotivo] = useState('')
  const { error, setError, manejar } = useManejo(onSesionVencida)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    listarEmpleados(token, '', 'activos').then(setEmpleados, manejar)
  }, [token, manejar])

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      const r = await darAdelanto(token, { empleadoId, monto, cuota, forma, cajaId: forma === 'efectivo' ? cajaId : undefined, cuentaId: forma === 'banco' ? cuentaId : undefined, motivo })
      onListo(`Adelanto ${r.codigo} registrado.`)
    } catch (err) {
      manejar(err)
    } finally {
      setGuardando(false)
    }
  }
  const pagos = MONTO.test(monto) && MONTO.test(cuota) && hayMonto(cuota) ? (centavos(monto) + centavos(cuota) - 1n) / centavos(cuota) : null
  return (
    <form onSubmit={(e) => void guardar(e)} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Empleado
        <select className={CAMPO} value={empleadoId} onChange={(e) => setEmpleadoId(e.target.value)} required>
          <option value="">— Seleccione —</option>
          {empleados.map((x) => (
            <option key={x.id} value={x.id}>
              {x.nombre} ({x.codigo}){hayMonto(x.debe) ? ` · ya debe ${dinero(x.debe)}` : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Monto (RD$)
          <input className={CAMPO} inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value.replace(/[,\s]/g, ''))} required />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Se descuenta en cada pago
          <input className={CAMPO} inputMode="decimal" value={cuota} onChange={(e) => setCuota(e.target.value.replace(/[,\s]/g, ''))} required />
        </label>
      </div>
      {pagos !== null && <p className="text-xs text-gray-500">Se salda en {String(pagos)} pago{pagos === 1n ? '' : 's'}. La cuota se puede cambiar después.</p>}
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Se entrega en
        <select className={CAMPO} value={forma} onChange={(e) => setForma(e.target.value as 'efectivo' | 'banco')}>
          <option value="efectivo">Efectivo (de la caja)</option>
          <option value="banco">Transferencia (del banco)</option>
        </select>
      </label>
      {forma === 'efectivo' ? <SelectorCaja prep={prep} valor={cajaId} onCambio={setCajaId} /> : <SelectorCuenta prep={prep} valor={cuentaId} onCambio={setCuentaId} />}
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Motivo
        <input className={CAMPO} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: Préstamo para el colegio" required />
      </label>
      <p className="text-xs text-gray-500">No es un gasto: es dinero que el empleado le debe a la empresa y se le descuenta en la nómina.</p>
      {error && <CajaError>{error}</CajaError>}
      <button type="submit" disabled={guardando} className={BOTON_PRINCIPAL}>
        {guardando ? 'Guardando…' : 'Dar adelanto'}
      </button>
    </form>
  )
}

function Adelantos({ token, permisos, prep, onCambio, onSesionVencida }: Props & { prep: PrepararNomina; onCambio: () => void }) {
  const [estado, setEstado] = useState<'pendientes' | 'todos'>('pendientes')
  const [filas, setFilas] = useState<Adelanto[] | null>(null)
  const [modal, setModal] = useState<{ tipo: 'nuevo' } | { tipo: 'cuota' | 'anular'; adelanto: Adelanto } | null>(null)
  const [aviso, setAviso] = useState('')
  const [cuota, setCuota] = useState('')
  const [motivo, setMotivo] = useState('')
  const [cajaId, setCajaId] = useState('')
  const [guardando, setGuardando] = useState(false)
  const { error, setError, manejar } = useManejo(onSesionVencida)
  const puede = permisos.includes('nomina.adelantos')

  const cargar = useCallback(async () => {
    try {
      setFilas(await listarAdelantos(token, estado))
      setError('')
    } catch (e) {
      manejar(e)
    }
  }, [token, estado, manejar, setError])

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0)
    return () => clearTimeout(t)
  }, [cargar])

  function listo(mensaje: string) {
    setModal(null)
    setAviso(mensaje)
    onCambio()
    void cargar()
  }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (!modal || modal.tipo === 'nuevo') return
    setGuardando(true)
    setError('')
    try {
      if (modal.tipo === 'cuota') {
        await cambiarCuota(token, modal.adelanto.id, cuota)
        listo(`Cuota de ${modal.adelanto.codigo} cambiada.`)
      } else {
        await anularAdelanto(token, modal.adelanto.id, motivo, modal.adelanto.forma === 'efectivo' ? cajaId : undefined)
        listo(`${modal.adelanto.codigo} anulado: el dinero volvió.`)
      }
    } catch (err) {
      manejar(err)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className={CAMPO} value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)} aria-label="Cuáles">
          <option value="pendientes">Con saldo pendiente</option>
          <option value="todos">Todos (también saldados y anulados)</option>
        </select>
        {puede && (
          <button type="button" onClick={() => { setAviso(''); setError(''); setModal({ tipo: 'nuevo' }) }} className={`${BOTON_PRINCIPAL} ml-auto`}>
            <Plus size={16} /> Dar adelanto o préstamo
          </button>
        )}
      </div>
      {aviso && <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{aviso}</div>}
      {error && !modal && <CajaError>{error}</CajaError>}
      <section className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        {!filas ? (
          <p className="p-4 text-sm text-gray-500">Cargando…</p>
        ) : filas.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">No hay adelantos {estado === 'pendientes' ? 'pendientes' : ''}.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Adelanto</th>
                <th className="px-3 py-2 font-medium">Empleado</th>
                <th className="px-3 py-2 text-right font-medium">Monto</th>
                <th className="px-3 py-2 text-right font-medium">Cuota</th>
                <th className="px-3 py-2 text-right font-medium">Debe</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filas.map((a) => (
                <tr key={a.id} className={`border-t border-gray-100 ${a.estado === 'anulado' ? 'text-gray-400 line-through' : ''}`}>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs">{a.codigo}</span>
                    <span className="block text-xs text-gray-500">
                      {dma(a.fecha)} · {a.forma === 'banco' ? 'banco' : 'efectivo'} · {a.motivo}
                    </span>
                  </td>
                  <td className="px-3 py-2">{a.empleado}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{dinero(a.monto)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{dinero(a.cuota)}</td>
                  <td className="px-3 py-2 text-right font-medium whitespace-nowrap">{a.estado === 'anulado' ? 'Anulado' : dinero(a.saldo)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {puede && a.estado === 'activo' && hayMonto(a.saldo) && (
                      <>
                        <button type="button" onClick={() => { setCuota(a.cuota); setError(''); setModal({ tipo: 'cuota', adelanto: a }) }} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" title="Cambiar la cuota" aria-label={`Cambiar la cuota de ${a.codigo}`}>
                          <Pencil size={16} />
                        </button>
                        {a.saldo === a.monto && (
                          <button type="button" onClick={() => { setMotivo(''); setError(''); setModal({ tipo: 'anular', adelanto: a }) }} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" title="Anular (el dinero vuelve)" aria-label={`Anular ${a.codigo}`}>
                            <Trash2 size={16} />
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {modal?.tipo === 'nuevo' && (
        <Ventana titulo="Dar adelanto o préstamo" onCerrar={() => setModal(null)}>
          <FormAdelanto token={token} prep={prep} onListo={listo} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
      {(modal?.tipo === 'cuota' || modal?.tipo === 'anular') && (
        <Ventana titulo={modal.tipo === 'cuota' ? `Cuota de ${modal.adelanto.codigo}` : `Anular ${modal.adelanto.codigo}`} onCerrar={() => setModal(null)}>
          <form onSubmit={(e) => void guardar(e)} className="flex flex-col gap-3">
            <p className="text-sm text-gray-600">
              {modal.adelanto.empleado} debe {dinero(modal.adelanto.saldo)} de {dinero(modal.adelanto.monto)}.
            </p>
            {modal.tipo === 'cuota' ? (
              <label className="flex flex-col gap-1 text-sm text-gray-600">
                Se descuenta en cada pago (RD$)
                <input className={CAMPO} inputMode="decimal" value={cuota} onChange={(e) => setCuota(e.target.value.replace(/[,\s]/g, ''))} />
              </label>
            ) : (
              <>
                <p className="text-sm text-gray-600">El dinero vuelve {modal.adelanto.forma === 'efectivo' ? 'a la caja que elija' : 'a la cuenta de donde salió'}.</p>
                {modal.adelanto.forma === 'efectivo' && <SelectorCaja prep={prep} valor={cajaId} onCambio={setCajaId} />}
                <label className="flex flex-col gap-1 text-sm text-gray-600">
                  Motivo
                  <textarea className={AREA} rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: Lo devolvió completo" />
                </label>
              </>
            )}
            {error && <CajaError>{error}</CajaError>}
            <button type="submit" disabled={guardando || (modal.tipo === 'anular' && motivo.trim().length < 5)} className={modal.tipo === 'anular' ? BOTON_PELIGRO : BOTON_PRINCIPAL}>
              {guardando ? 'Guardando…' : modal.tipo === 'cuota' ? 'Guardar cuota' : 'Anular'}
            </button>
          </form>
        </Ventana>
      )}
    </div>
  )
}

// ---------- Preparar una nómina ----------

function FormNuevaNomina({ token, prep, onListo, onSesionVencida }: { token: string; prep: PrepararNomina; onListo: (id: string) => void; onSesionVencida: () => void }) {
  const [tipo, setTipo] = useState<TipoNomina>('regular')
  const [frecuencia, setFrecuencia] = useState<Frecuencia>('quincenal')
  const [[desde, hasta], setPeriodo] = useState<[string, string]>(periodoDe('quincenal', prep.hoy))
  const [empleados, setEmpleados] = useState<Empleado[]>([])
  const [marcados, setMarcados] = useState<string[]>([])
  const [notas, setNotas] = useState('')
  const { error, setError, manejar } = useManejo(onSesionVencida)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    listarEmpleados(token, '', 'activos').then(setEmpleados, manejar)
  }, [token, manejar])

  function cambiarTipo(t: TipoNomina) {
    setTipo(t)
    if (t === 'regular') setPeriodo(periodoDe(frecuencia, prep.hoy))
    else if (t === 'regalia') {
      setPeriodo([`${prep.hoy.slice(0, 4)}-01-01`, `${prep.hoy.slice(0, 4)}-12-20`])
      setMarcados(empleados.map((x) => x.id))
    } else {
      setPeriodo([prep.hoy, prep.hoy])
      setMarcados([])
    }
  }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      const r = await crearNomina(token, {
        tipo,
        frecuencia: tipo === 'regular' ? frecuencia : undefined,
        desde,
        hasta,
        empleadoIds: tipo === 'regular' ? undefined : marcados,
        notas: notas || undefined,
      })
      onListo(r.id)
    } catch (err) {
      manejar(err)
    } finally {
      setGuardando(false)
    }
  }
  const cuantos = (f: Frecuencia) => prep.empleadosPorFrecuencia.find((x) => x.frecuencia === f)?.empleados ?? 0
  return (
    <form onSubmit={(e) => void guardar(e)} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Qué se paga
        <select className={CAMPO} value={tipo} onChange={(e) => cambiarTipo(e.target.value as TipoNomina)}>
          <option value="regular">Nómina (sueldo del período)</option>
          <option value="regalia">Regalía pascual (salario de Navidad)</option>
          <option value="vacaciones">Vacaciones</option>
        </select>
      </label>
      {tipo === 'regular' && (
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Empleados que cobran
          <select
            className={CAMPO}
            value={frecuencia}
            onChange={(e) => {
              const f = e.target.value as Frecuencia
              setFrecuencia(f)
              setPeriodo(periodoDe(f, prep.hoy))
            }}
          >
            {(['semanal', 'quincenal', 'mensual'] as Frecuencia[]).map((f) => (
              <option key={f} value={f}>
                {`${f === 'semanal' ? 'Cada semana' : f === 'quincenal' ? 'Cada quincena' : 'Cada mes'} (${cuantos(f)} empleado${cuantos(f) === 1 ? '' : 's'})`}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          {tipo === 'vacaciones' ? 'Sale de vacaciones' : 'Desde'}
          <input className={CAMPO} type="date" value={desde} onChange={(e) => setPeriodo([e.target.value, hasta])} required />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          {tipo === 'vacaciones' ? 'Vuelve' : 'Hasta'}
          <input className={CAMPO} type="date" value={hasta} onChange={(e) => setPeriodo([desde, e.target.value])} required />
        </label>
      </div>
      {tipo !== 'regular' && (
        <fieldset className="flex flex-col gap-1 rounded-lg border border-gray-200 p-3 text-sm">
          <legend className="px-1 text-gray-600">Empleados</legend>
          {empleados.length === 0 && <p className="text-gray-500">No hay empleados activos.</p>}
          {empleados.map((x) => (
            <label key={x.id} className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4 accent-[#C8102E]" checked={marcados.includes(x.id)} onChange={() => setMarcados((m) => (m.includes(x.id) ? m.filter((y) => y !== x.id) : [...m, x.id]))} />
              {x.nombre} <span className="text-xs text-gray-500">({x.codigo}, desde {dma(x.fecha_ingreso)})</span>
            </label>
          ))}
        </fieldset>
      )}
      <p className="text-xs text-gray-500">
        {tipo === 'regular'
          ? 'Se crea en borrador con el sueldo de cada empleado y la cuota de sus adelantos. Después anota horas extra, comisiones, bonos y descuentos, y la paga.'
          : tipo === 'regalia'
            ? 'La regalía es la doceava parte de lo ganado en el año: un año completo = un sueldo mensual; si entró este año, la parte que le toca. Se puede corregir en el borrador.'
            : `Días según los años de trabajo (${numero(prep.parametros.vacaciones_dias)}, o ${numero(prep.parametros.vacaciones_dias_5)} con 5 años o más) por el salario diario (mensual ÷ ${numero(prep.parametros.dias_mes)}). Los días se pueden cambiar en el borrador.`}
      </p>
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Notas (opcional)
        <input className={CAMPO} value={notas} onChange={(e) => setNotas(e.target.value)} />
      </label>
      {error && <CajaError>{error}</CajaError>}
      <button type="submit" disabled={guardando || (tipo !== 'regular' && marcados.length === 0)} className={BOTON_PRINCIPAL}>
        {guardando ? 'Preparando…' : 'Preparar borrador'}
      </button>
    </form>
  )
}

// ---------- Una línea del borrador ----------

function FormLinea({ token, nomina, linea, onListo, onSesionVencida }: { token: string; nomina: DetalleNomina; linea: LineaNomina; onListo: () => void; onSesionVencida: () => void }) {
  const [d, setD] = useState<Required<CambioLinea>>({
    sueldo: linea.sueldo,
    dias: linea.dias ?? '',
    horasExtra: numero(linea.horasExtra),
    horasExtraAlto: numero(linea.horasExtraAlto),
    comisiones: numero(linea.comisiones),
    bonos: numero(linea.bonos),
    adelantos: numero(linea.adelantos),
    otrosDescuentos: numero(linea.otrosDescuentos),
    motivoDescuento: linea.motivoDescuento ?? '',
    formaPago: linea.formaPago,
    notas: linea.notas ?? '',
  })
  const { error, setError, manejar } = useManejo(onSesionVencida)
  const [guardando, setGuardando] = useState(false)
  const cambiar = (c: Partial<CambioLinea>) => setD((x) => ({ ...x, ...c }))
  const limpio = (v: string) => v.replace(/[,\s]/g, '')

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      const cambio: CambioLinea = { ...d }
      if (nomina.tipo !== 'vacaciones') delete cambio.dias
      // Si cambian los días de vacaciones, el monto lo calcula el servidor.
      if (nomina.tipo === 'vacaciones' && d.dias !== (linea.dias ?? '') && d.sueldo === linea.sueldo) delete cambio.sueldo
      await editarLineaNomina(token, nomina.id, linea.id, cambio)
      onListo()
    } catch (err) {
      manejar(err)
    } finally {
      setGuardando(false)
    }
  }
  const input = (titulo: string, k: keyof CambioLinea, ayuda?: string) => (
    <label className="flex flex-col gap-1 text-sm text-gray-600">
      {titulo}
      <input className={CAMPO} inputMode="decimal" value={d[k]} onChange={(e) => cambiar({ [k]: limpio(e.target.value) })} />
      {ayuda && <span className="text-xs text-gray-400">{ayuda}</span>}
    </label>
  )
  return (
    <form onSubmit={(e) => void guardar(e)} className="grid grid-cols-2 gap-3">
      <p className="col-span-2 text-sm text-gray-600">
        Sueldo mensual {dinero(linea.sueldoMensual)} · valor de la hora {dinero(linea.valorHora)}
        {hayMonto(linea.debe) && ` · debe ${dinero(linea.debe)} de adelantos`}
      </p>
      {nomina.tipo === 'vacaciones' && input('Días de vacaciones', 'dias')}
      {input(nomina.tipo === 'regular' ? 'Sueldo del período' : nomina.tipo === 'regalia' ? 'Regalía' : 'Pago de vacaciones', 'sueldo', nomina.tipo === 'regular' ? 'Rebájelo si faltó días sin permiso' : undefined)}
      {input('Horas extra (35 %)', 'horasExtra', 'De 44 a 68 horas en la semana')}
      {input('Horas extra (100 %)', 'horasExtraAlto', 'Pasadas las 68 horas')}
      {input('Comisiones', 'comisiones')}
      {input('Bonos', 'bonos')}
      {input('Descuento de adelantos', 'adelantos')}
      {input('Otros descuentos', 'otrosDescuentos')}
      {MONTO.test(d.otrosDescuentos) && hayMonto(d.otrosDescuentos) && (
        <label className="col-span-2 flex flex-col gap-1 text-sm text-gray-600">
          Motivo de los otros descuentos
          <input className={CAMPO} value={d.motivoDescuento} onChange={(e) => cambiar({ motivoDescuento: e.target.value })} placeholder="Ej.: Faltante de caja del 10/10" />
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Se le paga en
        <select className={CAMPO} value={d.formaPago} onChange={(e) => cambiar({ formaPago: e.target.value as 'efectivo' | 'banco' })}>
          <option value="efectivo">Efectivo</option>
          <option value="banco">Banco</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Notas
        <input className={CAMPO} value={d.notas} onChange={(e) => cambiar({ notas: e.target.value })} />
      </label>
      {error && (
        <div className="col-span-2">
          <CajaError>{error}</CajaError>
        </div>
      )}
      <div className="col-span-2">
        <button type="submit" disabled={guardando} className={BOTON_PRINCIPAL}>
          {guardando ? 'Calculando…' : 'Guardar y calcular'}
        </button>
      </div>
    </form>
  )
}

// ---------- Detalle de una nómina ----------

function Detalle({ token, permisos, prep, id, onVolver, onCambio, onSesionVencida }: Props & { prep: PrepararNomina; id: string; onVolver: () => void; onCambio: () => void }) {
  const [n, setN] = useState<DetalleNomina | null>(null)
  const [modal, setModal] = useState<{ tipo: 'linea'; linea: LineaNomina } | { tipo: 'pagar' | 'anular' | 'descartar' | 'agregar' } | null>(null)
  const [cajaId, setCajaId] = useState('')
  const [cuentaId, setCuentaId] = useState('')
  const [motivo, setMotivo] = useState('')
  const [empleados, setEmpleados] = useState<Empleado[]>([])
  const [agregar, setAgregar] = useState('')
  const [aviso, setAviso] = useState('')
  const [guardando, setGuardando] = useState(false)
  const { error, setError, manejar } = useManejo(onSesionVencida)

  const cargar = useCallback(async () => {
    try {
      setN(await detalleNomina(token, id))
    } catch (e) {
      manejar(e)
    }
  }, [token, id, manejar])

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0)
    return () => clearTimeout(t)
  }, [cargar])

  if (!n) return error ? <CajaError>{error}</CajaError> : <p className="text-sm text-gray-500">Cargando…</p>
  const borrador = n.estado === 'borrador'
  const preparar = permisos.includes('nomina.preparar')
  const pagar = permisos.includes('nomina.pagar')

  function abrir(m: typeof modal) {
    setError('')
    setAviso('')
    setMotivo('')
    setModal(m)
    if (m?.tipo === 'agregar')
      listarEmpleados(token, '', 'activos').then(
        (l) => setEmpleados(l.filter((x) => !n!.lineas.some((y) => y.empleadoId === x.id) && (!n!.frecuencia || x.frecuencia === n!.frecuencia))),
        manejar,
      )
  }

  async function accion(e: FormEvent) {
    e.preventDefault()
    if (!modal || !n) return
    setGuardando(true)
    setError('')
    try {
      if (modal.tipo === 'pagar') {
        const r = await pagarNomina(token, n.id, {
          cajaId: hayMonto(n.totales.efectivo) ? cajaId : undefined,
          cuentaId: hayMonto(n.totales.banco) ? cuentaId : undefined,
        })
        setAviso(`${r.codigo} pagada: ${dinero(r.total)}.`)
      } else if (modal.tipo === 'anular') {
        await anularNomina(token, n.id, motivo, hayMonto(n.totales.efectivo) ? cajaId : undefined)
        setAviso(`${n.codigo} anulada: el dinero volvió.`)
      } else if (modal.tipo === 'descartar') {
        await descartarNomina(token, n.id, motivo)
        setAviso(`${n.codigo} descartada.`)
      } else if (modal.tipo === 'agregar') {
        await agregarEmpleadoNomina(token, n.id, agregar)
      }
      setModal(null)
      onCambio()
      await cargar()
    } catch (err) {
      manejar(err)
    } finally {
      setGuardando(false)
    }
  }

  async function quitar(l: LineaNomina) {
    if (!window.confirm(`¿Quitar a ${l.nombre} de esta nómina?`)) return
    try {
      await quitarLineaNomina(token, n!.id, l.id)
      await cargar()
    } catch (e) {
      manejar(e)
    }
  }

  const [etiqueta, color] = ESTADO[n.estado]
  const t = n.totales
  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={onVolver} className="flex items-center gap-1 self-start text-sm text-gray-600 hover:underline">
        <ArrowLeft size={16} /> Volver a las nóminas
      </button>
      <section className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <h2 className="text-lg font-medium">
            {n.codigo} · {n.nombreTipo}
            {n.frecuencia && ` ${NOMBRE_FRECUENCIA[n.frecuencia].toLowerCase()}`}{' '}
            <span className={`ml-1 rounded-full px-2 py-0.5 align-middle text-xs ${color}`}>{etiqueta}</span>
          </h2>
          <p className="text-sm text-gray-600">
            Del {dma(n.desde)} al {dma(n.hasta)}
            {n.fecha_pago && ` · pagada el ${dma(n.fecha_pago)} por ${n.pagada_por}`}
            {n.notas && ` · ${n.notas}`}
          </p>
          {n.motivo_anulacion && <p className="text-sm text-red-700">Motivo: {n.motivo_anulacion}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {borrador && preparar && (
            <>
              <button type="button" onClick={() => abrir({ tipo: 'agregar' })} className={BOTON_SECUNDARIO}>
                <span className="inline-flex items-center gap-2"><Plus size={16} /> Agregar empleado</span>
              </button>
              <button type="button" onClick={() => abrir({ tipo: 'descartar' })} className={BOTON_PELIGRO}>
                Descartar
              </button>
            </>
          )}
          {borrador && pagar && (
            <button type="button" onClick={() => abrir({ tipo: 'pagar' })} disabled={n.lineas.length === 0} className={BOTON_PRINCIPAL}>
              Pagar {dinero(t.neto)}
            </button>
          )}
          {n.estado === 'pagada' && pagar && (
            <button type="button" onClick={() => abrir({ tipo: 'anular' })} className={BOTON_PELIGRO}>
              Anular
            </button>
          )}
        </div>
      </section>
      {aviso && <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{aviso}</div>}
      {error && !modal && <CajaError>{error}</CajaError>}
      {borrador && <p className="text-sm text-gray-500">Toque el lápiz de cada empleado para anotar horas extra, comisiones, bonos y descuentos. El sistema calcula el pago.</p>}

      <section className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">Empleado</th>
              <th className="px-3 py-2 text-right font-medium">{n.tipo === 'regular' ? 'Sueldo' : n.tipo === 'regalia' ? 'Regalía' : 'Vacaciones'}</th>
              <th className="px-3 py-2 text-right font-medium">Horas extra</th>
              <th className="px-3 py-2 text-right font-medium">Comisiones y bonos</th>
              <th className="px-3 py-2 text-right font-medium">Descuentos</th>
              <th className="px-3 py-2 text-right font-medium">A pagar</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {n.lineas.map((l) => {
              const horas = sumar(l.horasExtra, l.horasExtraAlto)
              const desc = sumar(l.adelantos, l.otrosDescuentos)
              const extras = sumar(l.comisiones, l.bonos)
              return (
                <tr key={l.id} className="border-t border-gray-100 align-top">
                  <td className="px-3 py-2">
                    {l.nombre}
                    <span className="block text-xs text-gray-500">
                      {l.codigo} · {l.formaPago === 'banco' ? 'banco' : 'efectivo'}
                      {l.dias && ` · ${numero(l.dias)} días`}
                      {l.notas && ` · ${l.notas}`}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{dinero(l.sueldo)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {hayMonto(horas) ? (
                      <>
                        {dinero(l.montoExtra)}
                        <span className="block text-xs text-gray-500">{numero(horas)} h</span>
                      </>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{hayMonto(extras) ? dinero(extras) : <span className="text-gray-400">—</span>}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {hayMonto(desc) ? (
                      <>
                        -{dinero(desc)}
                        <span className="block text-xs text-gray-500">
                          {hayMonto(l.adelantos) && `adelantos ${dinero(l.adelantos)}`}
                          {hayMonto(l.otrosDescuentos) && ` ${l.motivoDescuento ?? ''}`}
                        </span>
                      </>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-medium whitespace-nowrap">{dinero(l.neto)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {borrador && preparar && (
                      <>
                        <button type="button" onClick={() => abrir({ tipo: 'linea', linea: l })} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" title="Anotar extras y descuentos" aria-label={`Editar ${l.nombre}`}>
                          <Pencil size={16} />
                        </button>
                        <button type="button" onClick={() => void quitar(l)} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" title="Quitar de esta nómina" aria-label={`Quitar a ${l.nombre}`}>
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
            {n.lineas.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-gray-500">No hay empleados en esta nómina.</td>
              </tr>
            )}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50 font-medium">
            <tr>
              <td className="px-3 py-2">Total ({n.lineas.length})</td>
              <td className="px-3 py-2 text-right whitespace-nowrap">{dinero(t.sueldo)}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap">{dinero(t.extra)}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap">{dinero(sumar(t.comisiones, t.bonos))}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap">-{dinero(sumar(t.adelantos, t.otrosDescuentos))}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap">{dinero(t.neto)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </section>
      <p className="text-sm text-gray-600">
        En efectivo: <span className="font-medium">{dinero(t.efectivo)}</span> · Por banco: <span className="font-medium">{dinero(t.banco)}</span>
      </p>

      {modal?.tipo === 'linea' && (
        <Ventana titulo={modal.linea.nombre} ancho="max-w-xl" onCerrar={() => setModal(null)}>
          <FormLinea
            token={token}
            nomina={n}
            linea={modal.linea}
            onListo={() => {
              setModal(null)
              void cargar()
            }}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
      {modal && modal.tipo !== 'linea' && (
        <Ventana
          titulo={modal.tipo === 'pagar' ? `Pagar ${n.codigo}` : modal.tipo === 'anular' ? `Anular ${n.codigo}` : modal.tipo === 'descartar' ? `Descartar ${n.codigo}` : 'Agregar empleado'}
          onCerrar={() => setModal(null)}
        >
          <form onSubmit={(e) => void accion(e)} className="flex flex-col gap-3">
            {modal.tipo === 'pagar' && (
              <>
                <p className="text-sm text-gray-600">
                  Se pagan {dinero(t.neto)} a {n.lineas.filter((l) => hayMonto(l.neto)).length} empleado(s). Después de pagada ya no se cambia; solo se puede anular.
                </p>
                {hayMonto(t.efectivo) && (
                  <>
                    <p className="text-sm font-medium">Efectivo: {dinero(t.efectivo)}</p>
                    <SelectorCaja prep={prep} valor={cajaId} onCambio={setCajaId} />
                  </>
                )}
                {hayMonto(t.banco) && (
                  <>
                    <p className="text-sm font-medium">Por banco: {dinero(t.banco)}</p>
                    <SelectorCuenta prep={prep} valor={cuentaId} onCambio={setCuentaId} />
                  </>
                )}
              </>
            )}
            {modal.tipo === 'anular' && (
              <>
                <p className="text-sm text-gray-600">
                  El dinero vuelve{hayMonto(t.efectivo) ? ' (el efectivo, a la caja que elija)' : ''}, lo descontado de adelantos se vuelve a deber y la contabilidad se reversa.
                </p>
                {hayMonto(t.efectivo) && <SelectorCaja prep={prep} valor={cajaId} onCambio={setCajaId} />}
              </>
            )}
            {(modal.tipo === 'anular' || modal.tipo === 'descartar') && (
              <label className="flex flex-col gap-1 text-sm text-gray-600">
                Motivo
                <textarea className={AREA} rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
              </label>
            )}
            {modal.tipo === 'agregar' && (
              <label className="flex flex-col gap-1 text-sm text-gray-600">
                Empleado
                <select className={CAMPO} value={agregar} onChange={(e) => setAgregar(e.target.value)}>
                  <option value="">— Seleccione —</option>
                  {empleados.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nombre} ({x.codigo})
                    </option>
                  ))}
                </select>
                {empleados.length === 0 && <span className="text-xs text-gray-500">No hay más empleados que puedan entrar en esta nómina.</span>}
              </label>
            )}
            {error && <CajaError>{error}</CajaError>}
            <button
              type="submit"
              disabled={guardando || ((modal.tipo === 'anular' || modal.tipo === 'descartar') && motivo.trim().length < 5) || (modal.tipo === 'agregar' && !agregar)}
              className={modal.tipo === 'anular' || modal.tipo === 'descartar' ? BOTON_PELIGRO : BOTON_PRINCIPAL}
            >
              {guardando ? 'Guardando…' : modal.tipo === 'pagar' ? `Pagar ${dinero(t.neto)}` : modal.tipo === 'anular' ? 'Anular' : modal.tipo === 'descartar' ? 'Descartar' : 'Agregar'}
            </button>
          </form>
        </Ventana>
      )}
    </div>
  )
}

// ---------- Lista de nóminas ----------

function Nominas({ token, permisos, prep, version, onCambio, onSesionVencida }: Props & { prep: PrepararNomina; version: number; onCambio: () => void }) {
  const [estado, setEstado] = useState<'' | EstadoNomina>('')
  const [pagina, setPagina] = useState(1)
  const [datos, setDatos] = useState<{ filas: FilaNomina[]; total: number; porPagina: number } | null>(null)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [nueva, setNueva] = useState(false)
  const { error, setError, manejar } = useManejo(onSesionVencida)

  const cargar = useCallback(async () => {
    try {
      setDatos(await listarNominas(token, estado, pagina))
      setError('')
    } catch (e) {
      manejar(e)
    }
  }, [token, estado, pagina, manejar, setError])

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0)
    return () => clearTimeout(t)
  }, [cargar, version])

  if (abierta)
    return <Detalle token={token} permisos={permisos} prep={prep} id={abierta} onVolver={() => setAbierta(null)} onCambio={onCambio} onSesionVencida={onSesionVencida} />

  const paginas = datos ? Math.max(1, Math.ceil(datos.total / datos.porPagina)) : 1
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className={CAMPO} value={estado} onChange={(e) => { setEstado(e.target.value as typeof estado); setPagina(1) }} aria-label="Estado">
          <option value="">Todas</option>
          <option value="borrador">Borradores</option>
          <option value="pagada">Pagadas</option>
          <option value="anulada">Anuladas</option>
          <option value="descartada">Descartadas</option>
        </select>
        {permisos.includes('nomina.preparar') && (
          <button type="button" onClick={() => setNueva(true)} className={`${BOTON_PRINCIPAL} ml-auto`}>
            <Plus size={16} /> Preparar nómina
          </button>
        )}
      </div>
      {error && <CajaError>{error}</CajaError>}
      <section className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        {!datos ? (
          <p className="p-4 text-sm text-gray-500">Cargando…</p>
        ) : datos.filas.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">No hay nóminas. Primero cree los empleados y después use "Preparar nómina".</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Nómina</th>
                <th className="px-3 py-2 font-medium">Período</th>
                <th className="px-3 py-2 text-right font-medium">Empleados</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {datos.filas.map((f) => {
                const [etiqueta, color] = ESTADO[f.estado]
                return (
                  <tr key={f.id} onClick={() => setAbierta(f.id)} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs">{f.codigo}</span>
                      <span className="block">
                        {NOMBRE_TIPO[f.tipo]}
                        {f.frecuencia && ` ${NOMBRE_FRECUENCIA[f.frecuencia].toLowerCase()}`}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {dma(f.desde)} – {dma(f.hasta)}
                      {f.fecha_pago && <span className="block text-xs text-gray-500">pagada {dma(f.fecha_pago)}</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{f.empleados}</td>
                    <td className="px-3 py-2 text-right font-medium whitespace-nowrap">{dinero(f.total)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${color}`}>{etiqueta}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
      {paginas > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button type="button" className={BOTON_SECUNDARIO} disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
            Anterior
          </button>
          <span className="text-gray-500">
            Página {pagina} de {paginas}
          </span>
          <button type="button" className={BOTON_SECUNDARIO} disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>
            Siguiente
          </button>
        </div>
      )}
      {nueva && (
        <Ventana titulo="Preparar nómina" ancho="max-w-xl" onCerrar={() => setNueva(false)}>
          <FormNuevaNomina
            token={token}
            prep={prep}
            onListo={(id) => {
              setNueva(false)
              onCambio()
              setAbierta(id)
            }}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
    </div>
  )
}

// ---------- Valores de ley ----------

const PARAMETROS: [keyof ParametrosNomina, string, string][] = [
  ['dias_mes', 'Días del mes para el salario diario', 'Salario diario = sueldo mensual ÷ este número'],
  ['horas_dia', 'Horas de la jornada', 'Valor de la hora = salario diario ÷ este número'],
  ['semanas_mes', 'Semanas del mes', 'Pago semanal = sueldo mensual ÷ este número'],
  ['recargo_extra', 'Recargo de las horas extra (%)', 'De 44 a 68 horas en la semana'],
  ['recargo_extra_alto', 'Recargo pasadas las 68 horas (%)', 'Horas extra pasadas las 68 en la semana'],
  ['vacaciones_dias', 'Días de vacaciones', 'Con 1 a 5 años de trabajo'],
  ['vacaciones_dias_5', 'Días de vacaciones con 5 años o más', ''],
]

function Valores({ token, permisos, onSesionVencida }: Props) {
  const [datos, setDatos] = useState<{ hoy: string; vigentes: ParametrosNomina; historial: HistorialParametro[] } | null>(null)
  const [cambio, setCambio] = useState<{ clave: keyof ParametrosNomina; valor: string; vigenteDesde: string; motivo: string } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const { error, setError, manejar } = useManejo(onSesionVencida)

  const cargar = useCallback(async () => {
    try {
      setDatos(await listarParametros(token))
    } catch (e) {
      manejar(e)
    }
  }, [token, manejar])

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0)
    return () => clearTimeout(t)
  }, [cargar])

  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (!cambio) return
    setGuardando(true)
    setError('')
    try {
      await nuevoParametro(token, cambio)
      setCambio(null)
      await cargar()
    } catch (err) {
      manejar(err)
    } finally {
      setGuardando(false)
    }
  }

  if (!datos) return error ? <CajaError>{error}</CajaError> : <p className="text-sm text-gray-500">Cargando…</p>
  const puede = permisos.includes('nomina.parametros')
  return (
    <div className="flex flex-col gap-4">
      <p className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        Valores tomados del Código de Trabajo. Su contador debe revisarlos antes de usar el sistema real. Cada cambio rige desde la fecha que se indique; lo ya pagado no cambia.
      </p>
      <section className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">Valor</th>
              <th className="px-3 py-2 text-right font-medium">Hoy</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {PARAMETROS.map(([k, titulo, ayuda]) => (
              <tr key={k} className="border-t border-gray-100">
                <td className="px-3 py-2">
                  {titulo}
                  {ayuda && <span className="block text-xs text-gray-500">{ayuda}</span>}
                </td>
                <td className="px-3 py-2 text-right font-medium">{numero(datos.vigentes[k])}</td>
                <td className="px-3 py-2 text-right">
                  {puede && (
                    <button type="button" onClick={() => { setError(''); setCambio({ clave: k, valor: numero(datos.vigentes[k]), vigenteDesde: datos.hoy, motivo: '' }) }} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" title="Cambiar" aria-label={`Cambiar ${titulo}`}>
                      <Pencil size={16} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <details className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
        <summary className="cursor-pointer font-medium">Historial de cambios</summary>
        <ul className="mt-2 flex flex-col gap-1 text-gray-600">
          {datos.historial.map((h) => (
            <li key={`${h.clave}-${h.vigente_desde}`}>
              {PARAMETROS.find(([k]) => k === h.clave)?.[1]}: <span className="font-medium">{numero(h.valor)}</span> desde {dma(h.vigente_desde)} — {h.motivo}
              {h.usuario && ` (${h.usuario})`}
            </li>
          ))}
        </ul>
      </details>
      {cambio && (
        <Ventana titulo={PARAMETROS.find(([k]) => k === cambio.clave)?.[1] ?? ''} onCerrar={() => setCambio(null)}>
          <form onSubmit={(e) => void guardar(e)} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm text-gray-600">
              Valor nuevo
              <input className={CAMPO} inputMode="decimal" value={cambio.valor} onChange={(e) => setCambio({ ...cambio, valor: e.target.value.replace(/[,\s]/g, '') })} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-gray-600">
              Rige desde
              <input className={CAMPO} type="date" value={cambio.vigenteDesde} onChange={(e) => setCambio({ ...cambio, vigenteDesde: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-gray-600">
              Motivo
              <input className={CAMPO} value={cambio.motivo} onChange={(e) => setCambio({ ...cambio, motivo: e.target.value })} placeholder="Ej.: Revisado por el contador" />
            </label>
            {error && <CajaError>{error}</CajaError>}
            <button type="submit" disabled={guardando || cambio.motivo.trim().length < 5} className={BOTON_PRINCIPAL}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </form>
        </Ventana>
      )}
    </div>
  )
}

// ---------- Página ----------

type Seccion = 'nominas' | 'empleados' | 'adelantos' | 'valores'

export default function Nomina(props: Props) {
  const { token, onSesionVencida } = props
  const pestanas: [Seccion, string][] = [
    ['nominas', 'Nóminas'],
    ['empleados', 'Empleados'],
    ['adelantos', 'Adelantos y préstamos'],
    ['valores', 'Valores de ley'],
  ]
  const [seccion, setSeccion] = useState<Seccion>('nominas')
  const [prep, setPrep] = useState<PrepararNomina | null>(null)
  const [version, setVersion] = useState(0)
  const { error, setError, manejar } = useManejo(onSesionVencida)

  const cargar = useCallback(async () => {
    try {
      setPrep(await prepararNomina(token))
      setError('')
    } catch (e) {
      manejar(e)
    }
  }, [token, manejar, setError])

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0)
    return () => clearTimeout(t)
  }, [cargar, version])

  const cambio = () => setVersion((v) => v + 1)

  return (
    <div>
      <div className="mb-4">
        <h1 className="mb-1 text-xl font-medium">Nómina</h1>
        <p className="text-sm text-gray-500">Sueldos, horas extra, comisiones, adelantos, regalía y vacaciones. Todavía sin TSS ni ISR.</p>
      </div>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-gray-200">
        {pestanas.map(([id, nombre]) => (
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
      {error && <CajaError>{error}</CajaError>}
      {!prep ? (
        !error && <p className="text-sm text-gray-500">Cargando…</p>
      ) : seccion === 'nominas' ? (
        <Nominas {...props} prep={prep} version={version} onCambio={cambio} />
      ) : seccion === 'empleados' ? (
        <Empleados {...props} prep={prep} onCambio={cambio} />
      ) : seccion === 'adelantos' ? (
        <Adelantos {...props} prep={prep} onCambio={cambio} />
      ) : (
        <Valores {...props} />
      )}
    </div>
  )
}
