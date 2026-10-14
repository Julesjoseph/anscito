import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Landmark,
  Pencil,
  Plus,
  Power,
  Smartphone,
  Undo2,
  XCircle,
} from 'lucide-react'
import {
  SesionVencida,
  confirmarMovimiento,
  crearCuenta,
  editarCuenta,
  estadoCuenta,
  listarCuentas,
  movimientosCuenta,
  pendientesBancos,
  prepararBancos,
  registrarMovimientoCuenta,
  reversarMovimiento,
  saldoInicialCuenta,
  transferirDinero,
} from './api'
import type {
  DatosCuenta,
  EstadoMovimiento,
  FilaCuenta,
  FiltrosMovimientosCuenta,
  MovimientoCuenta,
  PaginaMovimientosCuenta,
  PrepararBancos,
} from './api'
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
const TASA = /^\d{1,10}(\.\d{1,8})?$/

const NOMBRE_TIPO: Record<string, string> = {
  saldo_inicial: 'Saldo inicial',
  venta: 'Cobro de venta',
  devolucion: 'Devolución de venta',
  transferencia_entrada: 'Transferencia recibida',
  transferencia_salida: 'Transferencia enviada',
  pago: 'Pago',
  cargo: 'Cargo del banco',
  interes: 'Intereses',
  ingreso: 'Otro ingreso',
  reverso: 'Reverso',
  remesa: 'Envío a Haití',
  san_cuota: 'Cuota de SOL CASH',
  san_mano: 'Mano de SOL CASH entregada',
  compra: 'Pago de compra',
  abono_credito: 'Abono de crédito',
}

const CAMBIADO_POR: [string, string][] = [
  ['casa_cambio', 'Casa de cambio'],
  ['agente', 'Agente o MonCash/NatCash'],
  ['banco', 'El banco'],
  ['otro', 'Otro'],
]

// "1234.5" en la moneda de la cuenta: RD$1,234.50, US$1,234.50, HTG 1,234.50.
function enMoneda(simbolo: string, monto: string | null | undefined): string {
  const t = dinero(monto)
  if (t === '—') return t
  const neg = t.startsWith('RD$-')
  const sinSimbolo = t.slice(neg ? 4 : 3)
  const s = simbolo === 'HTG' ? 'HTG ' : simbolo
  return `${neg ? '−' : ''}${s}${sinSimbolo}`
}

function positivo(v: string): boolean {
  return MONTO.test(v.trim()) && !/^0+(\.0+)?$/.test(v.trim())
}

function fecha(iso: string | null): string {
  if (!iso) return '—'
  // Las fechas del banco vienen como AAAA-MM-DD (sin hora).
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [a, m, d] = iso.split('-')
    return `${d}/${m}/${a}`
  }
  return new Date(iso).toLocaleDateString('es-DO')
}

function hoy(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date())
}

function EstadoEtiqueta({ estado }: { estado: EstadoMovimiento }) {
  if (estado === 'confirmado')
    return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Confirmado</span>
  if (estado === 'por_confirmar')
    return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Por confirmar</span>
  return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">No llegó</span>
}

function detalleMovimiento(m: MovimientoCuenta): string {
  const partes = [
    m.envio,
    m.venta,
    m.transferencia && `${m.transferencia} ${m.tipo === 'transferencia_salida' ? 'a' : 'de'} ${m.contraparte ?? ''}`,
    m.categoria,
    m.beneficiario,
    m.comprobante,
    m.referencia && `Ref. ${m.referencia}`,
    m.motivo,
  ]
  return partes.filter(Boolean).join(' · ')
}

// Guarda, maneja la sesión vencida y muestra el error.
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

// ---------- Crear / editar cuenta ----------

function FormCuenta({
  token,
  cuenta,
  prep,
  onListo,
  onSesionVencida,
}: {
  token: string
  cuenta: FilaCuenta | null
  prep: PrepararBancos
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [codigo, setCodigo] = useState('')
  const [tipo, setTipo] = useState<'banco' | 'billetera'>(cuenta?.tipo ?? 'banco')
  const [moneda, setMoneda] = useState(cuenta?.moneda ?? 'DOP')
  const [entidad, setEntidad] = useState(cuenta?.entidad ?? '')
  const [nombre, setNombre] = useState(cuenta?.nombre ?? '')
  const [tipoCuenta, setTipoCuenta] = useState(cuenta?.tipo_cuenta ?? 'corriente')
  const [digitos, setDigitos] = useState(cuenta?.ultimos_digitos ?? '')
  const [recibeVentas, setRecibeVentas] = useState(cuenta?.recibe_ventas ?? false)
  const { error, guardando, enviar } = useEnviar(onSesionVencida)

  function guardar(e: FormEvent) {
    e.preventDefault()
    const datos: DatosCuenta = {
      entidad,
      nombre,
      tipoCuenta: tipo === 'banco' ? tipoCuenta : '',
      ultimosDigitos: digitos.trim(),
      recibeVentas: moneda === 'DOP' && recibeVentas,
    }
    void enviar(
      () =>
        cuenta
          ? editarCuenta(token, cuenta.id, datos)
          : crearCuenta(token, { ...datos, codigo, tipo, moneda }),
      onListo,
    )
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-3 text-sm">
      {!cuenta && (
        <>
          <div className="flex gap-2">
            {(
              [
                ['banco', 'Cuenta de banco', Landmark],
                ['billetera', 'MonCash / NatCash', Smartphone],
              ] as const
            ).map(([id, texto, Icono]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTipo(id)
                  if (id === 'billetera') setMoneda('HTG')
                }}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 ${tipo === id ? 'border-[#C8102E] bg-red-50 font-medium text-[#C8102E]' : 'border-gray-300 hover:bg-gray-50'}`}
              >
                <Icono size={16} /> {texto}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-gray-600">
              Código
              <input type="text" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} placeholder={tipo === 'banco' ? 'POPULAR-CTE' : 'MONCASH'} className={`${CAMPO} font-mono`} />
            </label>
            <label className="flex flex-col gap-1 text-gray-600">
              Moneda
              <select value={moneda} onChange={(e) => setMoneda(e.target.value)} className={CAMPO}>
                {prep.monedas.map((m) => (
                  <option key={m.codigo} value={m.codigo}>
                    {m.simbolo} · {m.nombre}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-gray-500">El código, el tipo y la moneda no se pueden cambiar después.</p>
        </>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-gray-600">
          {tipo === 'banco' ? 'Banco' : 'Servicio'}
          <input type="text" value={entidad} onChange={(e) => setEntidad(e.target.value)} placeholder={tipo === 'banco' ? 'Banco Popular' : 'MonCash'} className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1 text-gray-600">
          Nombre de la cuenta
          <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={tipo === 'banco' ? 'Popular corriente' : 'MonCash negocio'} className={CAMPO} />
        </label>
        {tipo === 'banco' && (
          <label className="flex flex-col gap-1 text-gray-600">
            Tipo de cuenta
            <select value={tipoCuenta} onChange={(e) => setTipoCuenta(e.target.value as 'corriente' | 'ahorro')} className={CAMPO}>
              <option value="corriente">Corriente</option>
              <option value="ahorro">Ahorro</option>
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-gray-600">
          Últimos 4 dígitos (opcional)
          <input type="text" inputMode="numeric" maxLength={4} value={digitos} onChange={(e) => setDigitos(e.target.value.replace(/\D/g, ''))} placeholder="1234" className={`${CAMPO} font-mono`} />
        </label>
      </div>
      <p className="text-xs text-gray-500">Por seguridad, no se guarda el número completo de la cuenta.</p>
      {moneda === 'DOP' && (
        <label className="flex items-center gap-2 text-gray-700">
          <input type="checkbox" checked={recibeVentas} onChange={(e) => setRecibeVentas(e.target.checked)} />
          Recibe transferencias de ventas (aparece al cobrar)
        </label>
      )}
      {error && <CajaError>{error}</CajaError>}
      <button type="submit" disabled={guardando || !entidad.trim() || !nombre.trim() || (!cuenta && !codigo.trim())} className={BOTON_PRINCIPAL}>
        {guardando ? 'Guardando…' : cuenta ? 'Guardar' : 'Crear cuenta'}
      </button>
    </form>
  )
}

function FormEstadoCuenta({
  token,
  cuenta,
  onListo,
  onSesionVencida,
}: {
  token: string
  cuenta: FilaCuenta
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  const desactivar = cuenta.is_active
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void enviar(() => estadoCuenta(token, cuenta.id, !desactivar, desactivar ? motivo : undefined), onListo)
      }}
      className="flex flex-col gap-3 text-sm"
    >
      <p className="text-gray-600">
        {desactivar
          ? `${cuenta.nombre} dejará de aparecer para cobrar y transferir. Solo se puede desactivar si está en cero y sin nada por confirmar. Sus movimientos se conservan.`
          : `${cuenta.nombre} volverá a estar disponible.`}
      </p>
      {desactivar && (
        <label className="flex flex-col gap-1 text-gray-600">
          Motivo
          <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} className={CAMPO} autoFocus />
        </label>
      )}
      {error && <CajaError>{error}</CajaError>}
      <button type="submit" disabled={guardando || (desactivar && motivo.trim().length < 5)} className={desactivar ? BOTON_PELIGRO : BOTON_PRINCIPAL}>
        {desactivar && <AlertTriangle size={16} />}
        {guardando ? 'Guardando…' : desactivar ? 'Desactivar' : 'Activar'}
      </button>
    </form>
  )
}

// ---------- Saldo inicial ----------

function CampoTasa({ moneda, tasa, setTasa }: { moneda: string; tasa: string; setTasa: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-gray-600">
      Tasa del día (RD$ por 1 {moneda})
      <input type="text" inputMode="decimal" value={tasa} onChange={(e) => setTasa(e.target.value)} placeholder={moneda === 'HTG' ? '0.46' : '60.50'} className={CAMPO} />
    </label>
  )
}

function FormSaldoInicial({
  token,
  cuenta,
  onListo,
  onSesionVencida,
}: {
  token: string
  cuenta: FilaCuenta
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [monto, setMonto] = useState('')
  const [tasa, setTasa] = useState('')
  const [dia, setDia] = useState(hoy())
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  const extranjera = cuenta.moneda !== 'DOP'
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void enviar(() => saldoInicialCuenta(token, cuenta.id, { monto: monto.trim(), tasa: extranjera ? tasa.trim() : undefined, fecha: dia }), onListo)
      }}
      className="flex flex-col gap-3 text-sm"
    >
      <p className="text-gray-600">
        Escriba cuánto tenía {cuenta.nombre} el día que empieza a usar el sistema (según el estado de cuenta). Solo se registra una vez.
      </p>
      <label className="flex flex-col gap-1 text-gray-600">
        Saldo ({cuenta.simbolo})
        <input type="text" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" className={`${CAMPO} text-lg`} autoFocus />
      </label>
      {extranjera && <CampoTasa moneda={cuenta.moneda} tasa={tasa} setTasa={setTasa} />}
      <label className="flex flex-col gap-1 text-gray-600">
        Fecha del saldo
        <input type="date" value={dia} max={hoy()} onChange={(e) => setDia(e.target.value)} className={CAMPO} />
      </label>
      {error && <CajaError>{error}</CajaError>}
      <button type="submit" disabled={guardando || !positivo(monto) || (extranjera && !TASA.test(tasa.trim()))} className={BOTON_PRINCIPAL}>
        {guardando ? 'Guardando…' : 'Registrar saldo inicial'}
      </button>
    </form>
  )
}

// ---------- Pago, cargo, interés u otro ingreso ----------

function FormMovimiento({
  token,
  cuenta,
  prep,
  onListo,
  onSesionVencida,
}: {
  token: string
  cuenta: FilaCuenta
  prep: PrepararBancos
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [tipo, setTipo] = useState<'pago' | 'cargo' | 'interes' | 'ingreso'>('pago')
  const [monto, setMonto] = useState('')
  const [tasa, setTasa] = useState('')
  const [dia, setDia] = useState(hoy())
  const [categoria, setCategoria] = useState('')
  const [beneficiario, setBeneficiario] = useState('')
  const [comprobante, setComprobante] = useState('')
  const [referencia, setReferencia] = useState('')
  const [motivo, setMotivo] = useState('')
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  const extranjera = cuenta.moneda !== 'DOP'

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void enviar(
          () =>
            registrarMovimientoCuenta(token, cuenta.id, {
              tipo,
              monto: monto.trim(),
              tasa: extranjera ? tasa.trim() : undefined,
              fecha: dia,
              categoriaGastoId: tipo === 'pago' ? categoria : undefined,
              beneficiario: beneficiario.trim() || undefined,
              comprobante: comprobante.trim() || undefined,
              referencia: referencia.trim() || undefined,
              motivo,
            }),
          onListo,
        )
      }}
      className="flex flex-col gap-3 text-sm"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            ['pago', 'Pago'],
            ['cargo', 'Cargo del banco'],
            ['interes', 'Intereses'],
            ['ingreso', 'Otro ingreso'],
          ] as const
        ).map(([id, texto]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTipo(id)}
            className={`rounded-lg border px-3 py-2 ${tipo === id ? 'border-[#C8102E] bg-red-50 font-medium text-[#C8102E]' : 'border-gray-300 hover:bg-gray-50'}`}
          >
            {texto}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500">
        {tipo === 'pago'
          ? 'Algo que se pagó desde la cuenta: luz, alquiler, un proveedor… (resta).'
          : tipo === 'cargo'
            ? 'Lo que cobra el banco: comisiones, impuesto 0.15%, mantenimiento (resta).'
            : tipo === 'interes'
              ? 'Intereses que pagó el banco (suma).'
              : 'Dinero que entra y no viene de una venta. Si es capital del dueño o dinero de terceros, dígalo en el motivo (suma).'}{' '}
        Disponible: {enMoneda(cuenta.simbolo, cuenta.disponible)}.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-gray-600">
          Monto ({cuenta.simbolo})
          <input type="text" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" className={`${CAMPO} text-lg`} autoFocus />
        </label>
        <label className="flex flex-col gap-1 text-gray-600">
          Fecha (según el banco)
          <input type="date" value={dia} max={hoy()} onChange={(e) => setDia(e.target.value)} className={CAMPO} />
        </label>
        {extranjera && <CampoTasa moneda={cuenta.moneda} tasa={tasa} setTasa={setTasa} />}
        {tipo === 'pago' && (
          <label className="flex flex-col gap-1 text-gray-600">
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
        )}
        {tipo === 'pago' && (
          <label className="flex flex-col gap-1 text-gray-600">
            A quién se pagó (opcional)
            <input type="text" value={beneficiario} onChange={(e) => setBeneficiario(e.target.value)} placeholder="EDESUR" className={CAMPO} />
          </label>
        )}
        {tipo === 'pago' && (
          <label className="flex flex-col gap-1 text-gray-600">
            Comprobante (opcional)
            <input type="text" value={comprobante} onChange={(e) => setComprobante(e.target.value.toUpperCase())} placeholder="NCF o factura" className={`${CAMPO} font-mono`} />
          </label>
        )}
        <label className="flex flex-col gap-1 text-gray-600">
          Referencia del banco (opcional)
          <input type="text" value={referencia} onChange={(e) => setReferencia(e.target.value)} className={CAMPO} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-gray-600">
        Motivo
        <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={tipo === 'cargo' ? 'Ej: impuesto 0.15% de la transferencia' : 'Ej: luz de septiembre'} className={CAMPO} />
      </label>
      {error && <CajaError>{error}</CajaError>}
      <button
        type="submit"
        disabled={guardando || !positivo(monto) || motivo.trim().length < 5 || (tipo === 'pago' && !categoria) || (extranjera && !TASA.test(tasa.trim()))}
        className={BOTON_PRINCIPAL}
      >
        {guardando ? 'Guardando…' : 'Registrar'}
      </button>
    </form>
  )
}

// ---------- Confirmar contra el estado de cuenta ----------

function FormConfirmar({
  token,
  mov,
  onListo,
  onSesionVencida,
}: {
  token: string
  mov: MovimientoCuenta
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [resultado, setResultado] = useState<'confirmado' | 'no_llego'>('confirmado')
  const [dia, setDia] = useState(hoy())
  const [motivo, setMotivo] = useState('')
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void enviar(
          () =>
            confirmarMovimiento(token, mov.id, {
              resultado,
              fechaBanco: resultado === 'confirmado' ? dia : undefined,
              motivo: motivo.trim() || undefined,
            }),
          onListo,
        )
      }}
      className="flex flex-col gap-3 text-sm"
    >
      <div className="rounded-lg bg-gray-50 p-3">
        <div className="font-medium">
          {NOMBRE_TIPO[mov.tipo] ?? mov.tipo}: {mov.signo > 0 ? '+' : '−'}
          {enMoneda(mov.simbolo, mov.monto)}
        </div>
        <div className="text-gray-500">{mov.cuenta} · {fecha(mov.fecha)}</div>
        <div className="text-gray-500">{detalleMovimiento(mov)}</div>
      </div>
      <p className="text-gray-600">¿Aparece este movimiento en el estado de cuenta del banco?</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => setResultado('confirmado')} className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 ${resultado === 'confirmado' ? 'border-green-600 bg-green-50 font-medium text-green-800' : 'border-gray-300 hover:bg-gray-50'}`}>
          <CheckCircle2 size={16} /> Sí, aparece
        </button>
        <button type="button" onClick={() => setResultado('no_llego')} className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 ${resultado === 'no_llego' ? 'border-red-600 bg-red-50 font-medium text-red-800' : 'border-gray-300 hover:bg-gray-50'}`}>
          <XCircle size={16} /> No llegó
        </button>
      </div>
      {resultado === 'confirmado' ? (
        <label className="flex flex-col gap-1 text-gray-600">
          Fecha en el estado de cuenta
          <input type="date" value={dia} max={hoy()} onChange={(e) => setDia(e.target.value)} className={CAMPO} />
        </label>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-gray-600">
            Motivo (obligatorio)
            <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: no aparece en el estado de cuenta" className={CAMPO} />
          </label>
          <p className="flex gap-2 text-xs text-red-700">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            Deja de contar en el saldo y no se puede deshacer. Si es una venta, revísela: el cliente no pagó.
          </p>
        </>
      )}
      {error && <CajaError>{error}</CajaError>}
      <button type="submit" disabled={guardando || (resultado === 'no_llego' && motivo.trim().length < 5)} className={resultado === 'confirmado' ? BOTON_PRINCIPAL : BOTON_PELIGRO}>
        {guardando ? 'Guardando…' : resultado === 'confirmado' ? 'Confirmar' : 'Marcar "No llegó"'}
      </button>
    </form>
  )
}

function FormReversar({
  token,
  mov,
  onListo,
  onSesionVencida,
}: {
  token: string
  mov: MovimientoCuenta
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void enviar(() => reversarMovimiento(token, mov.id, motivo), onListo)
      }}
      className="flex flex-col gap-3 text-sm"
    >
      <p className="text-gray-600">
        El movimiento no se borra: se agrega otro igual con el signo contrario (
        {mov.signo > 0 ? '−' : '+'}
        {enMoneda(mov.simbolo, mov.monto)}). Úselo solo si se registró por error.
      </p>
      <label className="flex flex-col gap-1 text-gray-600">
        Motivo
        <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} className={CAMPO} autoFocus />
      </label>
      {error && <CajaError>{error}</CajaError>}
      <button type="submit" disabled={guardando || motivo.trim().length < 5} className={BOTON_PELIGRO}>
        <Undo2 size={16} /> {guardando ? 'Reversando…' : 'Reversar'}
      </button>
    </form>
  )
}

// ---------- Lista de movimientos (de una cuenta o pendientes) ----------

function TablaMovimientos({
  filas,
  mostrarCuenta,
  permisos,
  onConfirmar,
  onReversar,
}: {
  filas: MovimientoCuenta[]
  mostrarCuenta: boolean
  permisos: string[]
  onConfirmar: (m: MovimientoCuenta) => void
  onReversar: (m: MovimientoCuenta) => void
}) {
  const puedeConfirmar = permisos.includes('bancos.confirmar')
  const puedeReversar = permisos.includes('bancos.gestionar')
  const reversable = (m: MovimientoCuenta) =>
    puedeReversar &&
    m.estado === 'confirmado' &&
    !m.reversado &&
    !m.de_envios &&
    !['reverso', 'venta', 'devolucion', 'transferencia_entrada', 'transferencia_salida'].includes(m.tipo)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-gray-500">
          <tr>
            <th className="py-1 pr-2 font-medium">Fecha</th>
            {mostrarCuenta && <th className="py-1 pr-2 font-medium">Cuenta</th>}
            <th className="py-1 pr-2 font-medium">Tipo</th>
            <th className="py-1 pr-2 font-medium">Detalle</th>
            <th className="py-1 pr-2 text-right font-medium">Monto</th>
            <th className="py-1 pr-2 font-medium">Estado</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {filas.map((m) => (
            <tr key={m.id} className={`border-t border-gray-100 align-top ${m.estado === 'no_llego' || m.reversado ? 'text-gray-400' : ''}`}>
              <td className="py-1.5 pr-2 whitespace-nowrap">{fecha(m.fecha)}</td>
              {mostrarCuenta && <td className="py-1.5 pr-2">{m.cuenta}</td>}
              <td className="py-1.5 pr-2">{NOMBRE_TIPO[m.tipo] ?? m.tipo}{m.reversado && <span className="block text-xs">(reversado)</span>}</td>
              <td className="py-1.5 pr-2 text-gray-600">
                {detalleMovimiento(m)}
                {m.moneda !== 'DOP' && <span className="block text-xs text-gray-400">≈ {dinero(m.monto_dop)} a {m.tasa.replace(/\.?0+$/, '')}</span>}
                {m.estado === 'no_llego' && m.motivo_confirmacion && <span className="block text-xs text-red-700">No llegó: {m.motivo_confirmacion}</span>}
                <span className="block text-xs text-gray-400">{m.usuario}</span>
              </td>
              <td className={`py-1.5 pr-2 text-right whitespace-nowrap font-medium ${m.signo > 0 ? 'text-green-700' : 'text-red-700'}`}>
                {m.signo > 0 ? '+' : '−'}
                {enMoneda(m.simbolo, m.monto)}
              </td>
              <td className="py-1.5 pr-2"><EstadoEtiqueta estado={m.estado} /></td>
              <td className="py-1.5 text-right whitespace-nowrap">
                {m.estado === 'por_confirmar' && puedeConfirmar && (
                  <button type="button" onClick={() => onConfirmar(m)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">
                    Confirmar
                  </button>
                )}
                {reversable(m) && (
                  <button type="button" onClick={() => onReversar(m)} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" aria-label="Reversar" title="Reversar">
                    <Undo2 size={14} />
                  </button>
                )}
              </td>
            </tr>
          ))}
          {filas.length === 0 && (
            <tr><td colSpan={7} className="py-6 text-center text-gray-400">No hay movimientos.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function VerCuenta({
  token,
  id,
  permisos,
  version,
  onAccion,
  onSesionVencida,
}: {
  token: string
  id: string
  permisos: string[]
  version: number
  onAccion: (a: { tipo: 'confirmar' | 'reversar'; mov: MovimientoCuenta }) => void
  onSesionVencida: () => void
}) {
  const [filtros, setFiltros] = useState<FiltrosMovimientosCuenta>({ desde: '', hasta: '', estado: 'todos', pagina: 1 })
  const [datos, setDatos] = useState<PaginaMovimientosCuenta | null>(null)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    try {
      setDatos(await movimientosCuenta(token, id, filtros))
      setError('')
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, id, filtros, onSesionVencida])

  useEffect(() => {
    const espera = setTimeout(() => void cargar(), 0)
    return () => clearTimeout(espera)
  }, [cargar, version])

  if (!datos) return error ? <CajaError>{error}</CajaError> : <div className="text-gray-500">Cargando…</div>
  const c = datos.cuenta
  const paginas = Math.max(1, Math.ceil(datos.total / datos.porPagina))

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="grid grid-cols-3 gap-2 rounded-lg bg-gray-50 p-3">
        <div><div className="text-xs text-gray-500">Confirmado</div><div className="font-medium">{enMoneda(c.simbolo, c.confirmado)}</div></div>
        <div><div className="text-xs text-gray-500">Por confirmar</div><div className="font-medium text-amber-800">{enMoneda(c.simbolo, c.por_confirmar)}</div></div>
        <div><div className="text-xs text-gray-500">Disponible</div><div className="font-medium">{enMoneda(c.simbolo, c.disponible)}</div></div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
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
          <select value={filtros.estado} onChange={(e) => setFiltros({ ...filtros, estado: e.target.value as FiltrosMovimientosCuenta['estado'], pagina: 1 })} className={CAMPO}>
            <option value="todos">Todos</option>
            <option value="confirmado">Confirmados</option>
            <option value="por_confirmar">Por confirmar</option>
            <option value="no_llego">No llegaron</option>
          </select>
        </label>
      </div>
      {error && <CajaError>{error}</CajaError>}
      <TablaMovimientos
        filas={datos.filas}
        mostrarCuenta={false}
        permisos={permisos}
        onConfirmar={(mov) => onAccion({ tipo: 'confirmar', mov })}
        onReversar={(mov) => onAccion({ tipo: 'reversar', mov })}
      />
      {paginas > 1 && (
        <div className="flex items-center justify-end gap-2">
          <button type="button" disabled={filtros.pagina <= 1} onClick={() => setFiltros({ ...filtros, pagina: filtros.pagina - 1 })} className="rounded-lg p-2 hover:bg-gray-100 disabled:opacity-40" aria-label="Página anterior"><ChevronLeft size={16} /></button>
          Página {filtros.pagina} de {paginas}
          <button type="button" disabled={filtros.pagina >= paginas} onClick={() => setFiltros({ ...filtros, pagina: filtros.pagina + 1 })} className="rounded-lg p-2 hover:bg-gray-100 disabled:opacity-40" aria-label="Página siguiente"><ChevronRight size={16} /></button>
        </div>
      )}
    </div>
  )
}

// ---------- Transferir ----------

// "c:<id>" = cuenta, "k:<id>" = caja (efectivo, en RD$).
function FormTransferencia({
  token,
  prep,
  onListo,
  onSesionVencida,
}: {
  token: string
  prep: PrepararBancos
  onListo: (numero: string) => void
  onSesionVencida: () => void
}) {
  const [origen, setOrigen] = useState('')
  const [destino, setDestino] = useState('')
  const [montoSale, setMontoSale] = useState('')
  const [montoEntra, setMontoEntra] = useState('')
  const [tasa, setTasa] = useState('')
  const [cambiadoPor, setCambiadoPor] = useState('')
  const [referencia, setReferencia] = useState('')
  const [motivo, setMotivo] = useState('')
  const [dia, setDia] = useState(hoy())
  const { error, guardando, enviar } = useEnviar(onSesionVencida)

  const cajas = prep.cajas.filter((c) => c.sesion_id)
  const lado = (v: string) => {
    if (v.startsWith('c:')) {
      const c = prep.cuentas.find((x) => x.id === v.slice(2))
      return c ? { moneda: c.moneda, simbolo: c.simbolo, nombre: c.nombre } : null
    }
    if (v.startsWith('k:')) {
      const c = cajas.find((x) => x.id === v.slice(2))
      return c ? { moneda: 'DOP', simbolo: 'RD$', nombre: c.nombre } : null
    }
    return null
  }
  const o = lado(origen)
  const d = lado(destino)
  const cambia = o !== null && d !== null && o.moneda !== d.moneda
  const pideTasa = cambia && o?.moneda !== 'DOP' && d?.moneda !== 'DOP'
  const valido =
    o !== null &&
    d !== null &&
    origen !== destino &&
    !(origen.startsWith('k:') && destino.startsWith('k:')) &&
    positivo(montoSale) &&
    (!cambia || (positivo(montoEntra) && cambiadoPor !== '')) &&
    (!pideTasa || TASA.test(tasa.trim()))

  const opciones = (
    <>
      <option value="">Seleccione…</option>
      <optgroup label="Cuentas">
        {prep.cuentas.map((c) => (
          <option key={c.id} value={`c:${c.id}`}>
            {c.nombre} ({c.simbolo})
          </option>
        ))}
      </optgroup>
      {cajas.length > 0 && (
        <optgroup label="Efectivo de caja (abierta)">
          {cajas.map((c) => (
            <option key={c.id} value={`k:${c.id}`}>
              {c.nombre} (RD$)
            </option>
          ))}
        </optgroup>
      )}
    </>
  )

  function guardar(e: FormEvent) {
    e.preventDefault()
    void enviar(async () => {
      const r = await transferirDinero(token, {
        origenCuentaId: origen.startsWith('c:') ? origen.slice(2) : undefined,
        origenCajaId: origen.startsWith('k:') ? origen.slice(2) : undefined,
        destinoCuentaId: destino.startsWith('c:') ? destino.slice(2) : undefined,
        destinoCajaId: destino.startsWith('k:') ? destino.slice(2) : undefined,
        montoSale: montoSale.trim(),
        montoEntra: cambia ? montoEntra.trim() : undefined,
        tasa: pideTasa ? tasa.trim() : undefined,
        cambiadoPor: cambia ? cambiadoPor : undefined,
        referencia: referencia.trim() || undefined,
        motivo: motivo.trim() || undefined,
        fecha: dia,
      })
      setMontoSale('')
      setMontoEntra('')
      setReferencia('')
      setMotivo('')
      onListo(r.numero)
    }, () => undefined)
  }

  return (
    <form onSubmit={guardar} className="flex max-w-2xl flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
      <p className="text-gray-600">
        Para mover dinero propio: de un banco a otro, depositar efectivo de la caja, traer efectivo a la caja o
        <span className="font-medium"> recargar MonCash / NatCash</span>. No es un gasto: el dinero sigue siendo del negocio.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-gray-600">
          Sale de
          <select value={origen} onChange={(e) => setOrigen(e.target.value)} className={CAMPO}>{opciones}</select>
        </label>
        <label className="flex flex-col gap-1 text-gray-600">
          Entra a
          <select value={destino} onChange={(e) => setDestino(e.target.value)} className={CAMPO}>{opciones}</select>
        </label>
        <label className="flex flex-col gap-1 text-gray-600">
          Monto que sale {o && `(${o.simbolo})`}
          <input type="text" inputMode="decimal" value={montoSale} onChange={(e) => setMontoSale(e.target.value)} placeholder="0.00" className={`${CAMPO} text-lg`} />
        </label>
        {cambia && (
          <label className="flex flex-col gap-1 text-gray-600">
            Monto que entra ({d?.simbolo})
            <input type="text" inputMode="decimal" value={montoEntra} onChange={(e) => setMontoEntra(e.target.value)} placeholder="0.00" className={`${CAMPO} text-lg`} />
          </label>
        )}
        {cambia && (
          <label className="flex flex-col gap-1 text-gray-600">
            ¿Quién hizo el cambio de moneda?
            <select value={cambiadoPor} onChange={(e) => setCambiadoPor(e.target.value)} className={CAMPO}>
              <option value="">Seleccione…</option>
              {CAMBIADO_POR.map(([id, texto]) => (
                <option key={id} value={id}>
                  {texto}
                </option>
              ))}
            </select>
          </label>
        )}
        {pideTasa && o && <CampoTasa moneda={o.moneda} tasa={tasa} setTasa={setTasa} />}
        <label className="flex flex-col gap-1 text-gray-600">
          Fecha
          <input type="date" value={dia} max={hoy()} onChange={(e) => setDia(e.target.value)} className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1 text-gray-600">
          Referencia (opcional)
          <input type="text" value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Boleta o número de la transferencia" className={CAMPO} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-gray-600">
        Nota (opcional)
        <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Ej: recarga MonCash para envíos" className={AREA} />
      </label>
      {cambia && (
        <p className="text-xs text-gray-500">
          Si la casa de cambio o el agente cobró comisión aparte, regístrela como un pago con la categoría
          “Comisión de cambio de moneda”. Lo que entra con cambio de moneda queda por confirmar.
        </p>
      )}
      {origen.startsWith('k:') && (
        <p className="text-xs text-gray-500">El efectivo sale de la caja ahora; en la cuenta queda por confirmar hasta verlo en el estado de cuenta.</p>
      )}
      {error && <CajaError>{error}</CajaError>}
      <button type="submit" disabled={guardando || !valido} className={`${BOTON_PRINCIPAL} self-start`}>
        <ArrowRightLeft size={16} /> {guardando ? 'Transfiriendo…' : 'Transferir'}
      </button>
    </form>
  )
}

// ---------- Página ----------

type Modal =
  | { tipo: 'cuenta'; cuenta: FilaCuenta | null }
  | { tipo: 'estado'; cuenta: FilaCuenta }
  | { tipo: 'saldo'; cuenta: FilaCuenta }
  | { tipo: 'movimiento'; cuenta: FilaCuenta }
  | { tipo: 'ver'; cuenta: FilaCuenta }

export default function Bancos({ token, permisos, onSesionVencida }: Props) {
  const [seccion, setSeccion] = useState<'cuentas' | 'pendientes' | 'transferir'>('cuentas')
  const [prep, setPrep] = useState<PrepararBancos | null>(null)
  const [cuentas, setCuentas] = useState<FilaCuenta[] | null>(null)
  const [pendientes, setPendientes] = useState<{ porConfirmar: MovimientoCuenta[]; noLlegaron: MovimientoCuenta[] } | null>(null)
  const [error, setError] = useState('')
  const [modal, setModal] = useState<Modal | null>(null)
  const [accion, setAccion] = useState<{ tipo: 'confirmar' | 'reversar'; mov: MovimientoCuenta } | null>(null)
  const [version, setVersion] = useState(0)
  const [aviso, setAviso] = useState('')
  const gestionar = permisos.includes('bancos.gestionar')
  // Las cuentas desactivadas se ocultan salvo que se pidan.
  const [verInactivas, setVerInactivas] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const [p, c, pe] = await Promise.all([prepararBancos(token), listarCuentas(token), pendientesBancos(token)])
      setPrep(p)
      setCuentas(c)
      setPendientes(pe)
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

  const cambio = () => setVersion((v) => v + 1)
  function listoModal() {
    setModal(null)
    cambio()
  }

  if (!cuentas || !prep) return error ? <CajaError>{error}</CajaError> : <div className="text-gray-500">Cargando…</div>
  const activas = cuentas.filter((c) => c.is_active)
  const inactivas = cuentas.length - activas.length
  const visibles = gestionar && verInactivas ? cuentas : activas
  const nPendientes = pendientes?.porConfirmar.length ?? 0

  // Totales por moneda (cuentas activas).
  const porMoneda = prep.monedas
    .map((m) => {
      const de = activas.filter((c) => c.moneda === m.codigo)
      const suma = (campo: 'confirmado' | 'por_confirmar') =>
        de.reduce((s, c) => {
          const [e, d = '00'] = c[campo].replace('-', '').split('.')
          const v = BigInt(e) * 100n + BigInt(d.padEnd(2, '0'))
          return s + (c[campo].startsWith('-') ? -v : v)
        }, 0n)
      const texto = (v: bigint) => `${v < 0n ? '-' : ''}${(v < 0n ? -v : v) / 100n}.${String((v < 0n ? -v : v) % 100n).padStart(2, '0')}`
      return { ...m, cuentas: de.length, confirmado: texto(suma('confirmado')), porConfirmar: texto(suma('por_confirmar')) }
    })
    .filter((m) => m.cuentas > 0)

  return (
    <div>
      <div className="mb-4">
        <h1 className="mb-1 text-xl font-medium">Bancos</h1>
        <p className="text-sm text-gray-500">
          Cuentas de banco y billeteras MonCash / NatCash. Lo que entra por ventas o depósitos queda “por confirmar” hasta verlo en el estado de cuenta.
        </p>
      </div>
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {(
          [
            ['cuentas', 'Cuentas', true],
            ['pendientes', `Por confirmar${nPendientes ? ` (${nPendientes})` : ''}`, true],
            ['transferir', 'Transferir', permisos.includes('bancos.transferir')],
          ] as const
        )
          .filter(([, , ver]) => ver)
          .map(([id, nombre]) => (
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
      {error && <div className="mb-3"><CajaError>{error}</CajaError></div>}
      {aviso && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <CheckCircle2 size={16} /> {aviso}
        </div>
      )}

      {seccion === 'cuentas' && (
        <div className="flex flex-col gap-4">
          {porMoneda.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {porMoneda.map((m) => (
                <div key={m.codigo} className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="text-sm text-gray-500">{m.nombre} · {m.cuentas} cuenta{m.cuentas === 1 ? '' : 's'}</div>
                  <div className="text-2xl font-medium">{enMoneda(m.simbolo, m.confirmado)}</div>
                  <div className="text-xs text-gray-500">Confirmado{m.porConfirmar !== '0.00' && ` · por confirmar ${enMoneda(m.simbolo, m.porConfirmar)}`}</div>
                </div>
              ))}
            </div>
          )}
          {(pendientes?.noLlegaron.length ?? 0) > 0 && (
            <button type="button" onClick={() => setSeccion('pendientes')} className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-left text-sm text-red-800">
              <AlertTriangle size={16} /> {pendientes?.noLlegaron.length} movimiento(s) marcados “No llegó”. Revíselos.
            </button>
          )}
          {gestionar && (
            <div className="flex items-center justify-end gap-3">
          {gestionar && inactivas > 0 && (
            <button type="button" onClick={() => setVerInactivas(!verInactivas)} className="text-sm text-gray-500 hover:underline">
              {verInactivas ? 'Ocultar inactivas' : `Mostrar inactivas (${inactivas})`}
            </button>
          )}
              <button type="button" onClick={() => setModal({ tipo: 'cuenta', cuenta: null })} className={BOTON_SECUNDARIO}>
                <span className="inline-flex items-center gap-2"><Plus size={16} /> Nueva cuenta</span>
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibles.map((c) => (
              <div key={c.id} className={`flex flex-col gap-3 rounded-xl border bg-white p-4 ${c.is_active ? 'border-gray-200' : 'border-dashed border-gray-300 opacity-70'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 font-medium">
                      {c.tipo === 'banco' ? <Landmark size={18} className="text-gray-500" /> : <Smartphone size={18} className="text-gray-500" />}
                      {c.nombre}
                    </div>
                    <div className="text-xs text-gray-500">
                      {c.entidad}
                      {c.tipo_cuenta && ` · ${c.tipo_cuenta === 'corriente' ? 'Corriente' : 'Ahorro'}`}
                      {c.ultimos_digitos && ` · ****${c.ultimos_digitos}`}
                      {c.recibe_ventas && ' · recibe ventas'}
                    </div>
                  </div>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{c.is_active ? c.simbolo : 'Inactiva'}</span>
                </div>
                <div>
                  <div className="text-2xl font-medium">{enMoneda(c.simbolo, c.confirmado)}</div>
                  <div className="text-xs text-gray-500">
                    Confirmado
                    {c.pendientes > 0 && <span className="text-amber-800"> · por confirmar {enMoneda(c.simbolo, c.por_confirmar)} ({c.pendientes})</span>}
                    {c.moneda !== 'DOP' && c.disponible !== '0.00' && <span> · vale ≈ {dinero(c.disponible_dop)}</span>}
                    {c.no_llegaron > 0 && <span className="text-red-700"> · {c.no_llegaron} no llegó</span>}
                  </div>
                </div>
                {c.is_active && !c.tiene_saldo_inicial && gestionar && (
                  <button type="button" onClick={() => setModal({ tipo: 'saldo', cuenta: c })} className="self-start text-xs text-[#C8102E] hover:underline">
                    Registrar el saldo inicial
                  </button>
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setModal({ tipo: 'ver', cuenta: c })} className={BOTON_SECUNDARIO}>
                    <span className="inline-flex items-center gap-2"><Eye size={16} /> Movimientos</span>
                  </button>
                  {c.is_active && permisos.includes('bancos.movimientos') && (
                    <button type="button" onClick={() => setModal({ tipo: 'movimiento', cuenta: c })} className={BOTON_PRINCIPAL}>
                      <Plus size={16} /> Registrar
                    </button>
                  )}
                  {gestionar && (
                    <>
                      <button type="button" onClick={() => setModal({ tipo: 'cuenta', cuenta: c })} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label={`Editar ${c.nombre}`} title="Editar">
                        <Pencil size={16} />
                      </button>
                      <button type="button" onClick={() => setModal({ tipo: 'estado', cuenta: c })} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label={c.is_active ? `Desactivar ${c.nombre}` : `Activar ${c.nombre}`} title={c.is_active ? 'Desactivar' : 'Activar'}>
                        <Power size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {visibles.length === 0 && (
              <p className="text-sm text-gray-500">Todavía no hay cuentas. {gestionar ? 'Cree la primera con “Nueva cuenta”.' : ''}</p>
            )}
          </div>
        </div>
      )}

      {seccion === 'pendientes' && pendientes && (
        <div className="flex flex-col gap-4">
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="mb-1 font-medium">Por confirmar</h2>
            <p className="mb-3 text-sm text-gray-500">Compare con el estado de cuenta del banco o de MonCash y confirme lo que aparece.</p>
            <TablaMovimientos filas={pendientes.porConfirmar} mostrarCuenta permisos={permisos} onConfirmar={(mov) => setAccion({ tipo: 'confirmar', mov })} onReversar={() => undefined} />
          </section>
          {pendientes.noLlegaron.length > 0 && (
            <section className="rounded-xl border border-red-200 bg-white p-4">
              <h2 className="mb-1 flex items-center gap-2 font-medium text-red-800"><AlertTriangle size={16} /> No llegaron</h2>
              <p className="mb-3 text-sm text-gray-500">No cuentan en el saldo. Si es una venta, el cliente no pagó: anúlela o cóbrela de otra forma.</p>
              <TablaMovimientos filas={pendientes.noLlegaron} mostrarCuenta permisos={permisos} onConfirmar={() => undefined} onReversar={() => undefined} />
            </section>
          )}
        </div>
      )}

      {seccion === 'transferir' && (
        <FormTransferencia
          token={token}
          prep={prep}
          onSesionVencida={onSesionVencida}
          onListo={(numero) => {
            setAviso(`Transferencia ${numero} registrada.`)
            setTimeout(() => setAviso(''), 6000)
            cambio()
          }}
        />
      )}

      {modal?.tipo === 'cuenta' && (
        <Ventana titulo={modal.cuenta ? `Editar ${modal.cuenta.nombre}` : 'Nueva cuenta'} ancho="max-w-xl" onCerrar={() => setModal(null)}>
          <FormCuenta token={token} cuenta={modal.cuenta} prep={prep} onListo={listoModal} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
      {modal?.tipo === 'estado' && (
        <Ventana titulo={modal.cuenta.is_active ? `Desactivar ${modal.cuenta.nombre}` : `Activar ${modal.cuenta.nombre}`} onCerrar={() => setModal(null)}>
          <FormEstadoCuenta token={token} cuenta={modal.cuenta} onListo={listoModal} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
      {modal?.tipo === 'saldo' && (
        <Ventana titulo={`Saldo inicial · ${modal.cuenta.nombre}`} onCerrar={() => setModal(null)}>
          <FormSaldoInicial token={token} cuenta={modal.cuenta} onListo={listoModal} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
      {modal?.tipo === 'movimiento' && (
        <Ventana titulo={`Registrar en ${modal.cuenta.nombre}`} ancho="max-w-xl" onCerrar={() => setModal(null)}>
          <FormMovimiento token={token} cuenta={modal.cuenta} prep={prep} onListo={listoModal} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
      {modal?.tipo === 'ver' && (
        <Ventana titulo={`${modal.cuenta.nombre} · movimientos`} ancho="max-w-4xl" onCerrar={() => setModal(null)}>
          <VerCuenta token={token} id={modal.cuenta.id} permisos={permisos} version={version} onAccion={setAccion} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
      {accion && (
        <Ventana titulo={accion.tipo === 'confirmar' ? 'Confirmar con el estado de cuenta' : 'Reversar movimiento'} onCerrar={() => setAccion(null)}>
          {accion.tipo === 'confirmar' ? (
            <FormConfirmar token={token} mov={accion.mov} onListo={() => { setAccion(null); cambio() }} onSesionVencida={onSesionVencida} />
          ) : (
            <FormReversar token={token} mov={accion.mov} onListo={() => { setAccion(null); cambio() }} onSesionVencida={onSesionVencida} />
          )}
        </Ventana>
      )}
    </div>
  )
}
