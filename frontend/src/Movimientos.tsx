import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  SesionVencida,
  ajustarInventario,
  calcularMonto,
  corregirCosto,
  kardexProducto,
  registrarEntrada,
  registrarSalida,
} from './api'
import type { FilaProducto, Kardex } from './api'
import {
  AREA,
  BOTON_PELIGRO,
  BOTON_PRINCIPAL,
  BOTON_SECUNDARIO,
  CAMPO,
  CajaError,
} from './componentes'
import { cantidad, dinero, mensajeDe } from './formato'
import { montoValido } from './itbis'
import VistaItbis from './VistaItbis'

// Ventanas de movimientos de inventario: entrada, salida, ajuste y kárdex.
// Todo lo que se muestra antes de guardar es una vista previa: el servidor
// recalcula existencia y costo promedio al registrar.

type PropsMov = {
  token: string
  fila: FilaProducto
  verCostos: boolean
  onListo: (mensaje: string) => void
  onCancelar: () => void
  onSesionVencida: () => void
}

const CANTIDAD = /^\d{1,11}(\.\d{1,3})?$/

const CAUSAS: [string, string][] = [
  ['dano', 'Daño'],
  ['vencido', 'Vencido'],
  ['consumo_interno', 'Consumo interno'],
  ['devolucion_proveedor', 'Devolución a proveedor'],
  ['otro', 'Otro'],
]

const NOMBRE_TIPO: Record<string, string> = {
  inicial: 'Existencia inicial',
  entrada: 'Entrada',
  salida: 'Salida',
  ajuste_entrada: 'Ajuste (+) por conteo',
  ajuste_salida: 'Ajuste (−) por conteo',
  venta: 'Venta',
  anulacion_venta: 'Devolución por venta anulada',
}

// Cantidades en milésimas (enteros) para las vistas previas.
function milesimas(v: string): bigint | null {
  const t = v.trim()
  if (!CANTIDAD.test(t)) return null
  const [e, d = ''] = t.split('.')
  return BigInt(e) * 1000n + BigInt(d.padEnd(3, '0'))
}

function deMilesimas(m: bigint): string {
  const neg = m < 0n
  const a = neg ? -m : m
  return `${neg ? '-' : ''}${a / 1000n}.${(a % 1000n).toString().padStart(3, '0')}`
}

function centavos(v: string): bigint {
  const [e, d = ''] = v.trim().split('.')
  return BigInt(e) * 100n + BigInt(d.padEnd(2, '0'))
}

function errorCantidad(v: string, fila: FilaProducto, permitirCero = false): string {
  const m = milesimas(v)
  if (v.trim() === '') return ''
  if (m === null) return 'Use solo números y punto (ej: 10 o 2.5)'
  if (!permitirCero && m === 0n) return 'Debe ser mayor que 0'
  if (!fila.permite_decimales && m % 1000n !== 0n) {
    return `La unidad "${fila.unidad}" no admite decimales`
  }
  return ''
}

function useEnvio(onSesionVencida: () => void) {
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  async function enviar(accion: () => Promise<void>) {
    setError('')
    setGuardando(true)
    try {
      await accion()
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    } finally {
      setGuardando(false)
    }
  }
  return { error, guardando, enviar }
}

function Cabecera({ fila }: { fila: FilaProducto }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
      <span className="font-mono font-medium text-gray-900">{fila.codigo}</span> ·{' '}
      {fila.nombre}
      <div>
        En stock ahora:{' '}
        <span className="font-medium text-gray-900">
          {cantidad(fila.existencia)} {fila.unidad.toLowerCase()}
        </span>
      </div>
    </div>
  )
}

function Despues({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
      {children}
    </div>
  )
}

function Botones({
  guardando,
  texto,
  onCancelar,
  peligro = false,
}: {
  guardando: boolean
  texto: string
  onCancelar: () => void
  peligro?: boolean
}) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onCancelar} className={BOTON_SECUNDARIO}>
        Cancelar
      </button>
      <button
        type="submit"
        disabled={guardando}
        className={peligro ? BOTON_PELIGRO : BOTON_PRINCIPAL}
      >
        {peligro && <AlertTriangle size={16} />}
        {guardando ? 'Guardando…' : texto}
      </button>
    </div>
  )
}

// ---------- Entrada ----------

export function FormEntrada({
  token,
  fila,
  verCostos,
  onListo,
  onCancelar,
  onSesionVencida,
}: PropsMov) {
  const [cant, setCant] = useState('')
  const [modo, setModo] = useState<'total' | 'unidad'>('total')
  const [escrito, setEscrito] = useState('')
  const [proveedor, setProveedor] = useState('')
  const [factura, setFactura] = useState('')
  const [nota, setNota] = useState('')
  const { error, guardando, enviar } = useEnvio(onSesionVencida)

  const verificar = useCallback(
    (monto: string, incluye: boolean) =>
      calcularMonto(token, { monto, impuestoId: fila.impuesto_id, incluyeItbis: incluye }),
    [token, fila.impuesto_id],
  )

  const mCant = milesimas(cant)
  const mExist = milesimas(fila.existencia) ?? 0n
  const despues = mCant !== null ? deMilesimas(mExist + mCant) : null

  // Costo por unidad: el escrito, o total ÷ cantidad (vista previa; el
  // servidor hace el cálculo definitivo con el mismo redondeo).
  let costo = ''
  if (montoValido(escrito)) {
    if (modo === 'unidad') costo = escrito.trim()
    else if (mCant && mCant > 0n) {
      const num = centavos(escrito) * 1000n
      const r = (2n * num + mCant) / (2n * mCant)
      costo = `${r / 100n}.${(r % 100n).toString().padStart(2, '0')}`
    }
  }

  // Vista previa del costo promedio (el servidor calcula el definitivo).
  let promedio: string | null = null
  if (verCostos && fila.costo && mCant && mCant > 0n && montoValido(costo)) {
    const cNuevo = centavos(costo)
    if (mExist <= 0n) {
      promedio = `${cNuevo / 100n}.${(cNuevo % 100n).toString().padStart(2, '0')}`
    } else {
      const num = mExist * centavos(fila.costo) + mCant * cNuevo
      const den = mExist + mCant
      const r = (2n * num + den) / (2n * den)
      promedio = `${r / 100n}.${(r % 100n).toString().padStart(2, '0')}`
    }
  }

  function guardar(e: FormEvent) {
    e.preventDefault()
    void enviar(async () => {
      const r = await registrarEntrada(token, fila.id, {
        cantidad: cant.trim(),
        ...(modo === 'unidad'
          ? { costoUnitario: escrito.trim() }
          : { costoTotal: escrito.trim() }),
        proveedor,
        referencia: factura,
        nota,
      })
      onListo(
        `Entrada registrada en ${fila.codigo}. Ahora hay ${cantidad(r.existencia)} ${fila.unidad.toLowerCase()}.`,
      )
    })
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <Cabecera fila={fila} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Cantidad que llegó ({fila.unidad.toLowerCase()})
          <input
            type="text"
            inputMode="decimal"
            value={cant}
            onChange={(e) => setCant(e.target.value)}
            className={CAMPO}
            autoFocus
          />
          {errorCantidad(cant, fila) && (
            <span className="text-xs text-red-600">{errorCantidad(cant, fila)}</span>
          )}
        </label>
        <div className="flex flex-col gap-1 text-sm text-gray-600">
          <div className="flex gap-3">
            {(
              [
                ['total', 'Total de la factura'],
                ['unidad', `Costo por ${fila.unidad.toLowerCase()}`],
              ] as const
            ).map(([id, nombre]) => (
              <label key={id} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="modo-costo"
                  checked={modo === id}
                  onChange={() => setModo(id)}
                  className="accent-[#C8102E]"
                />
                {nombre}
              </label>
            ))}
          </div>
          <input
            type="text"
            inputMode="decimal"
            value={escrito}
            onChange={(e) => setEscrito(e.target.value)}
            placeholder={
              modo === 'total'
                ? 'Subtotal de la factura, sin ITBIS'
                : 'Costo de una unidad, sin ITBIS'
            }
            aria-label="Costo sin ITBIS"
            className={CAMPO}
          />
          {modo === 'total' && costo && mCant && (
            <span className="text-xs text-gray-700">
              {dinero(escrito.trim())} ÷ {cantidad(cant)} ={' '}
              <span className="font-medium">{dinero(costo)}</span> por{' '}
              {fila.unidad.toLowerCase()}
            </span>
          )}
        </div>
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Proveedor (opcional)
          <input
            type="text"
            value={proveedor}
            onChange={(e) => setProveedor(e.target.value)}
            className={CAMPO}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          No. de factura / NCF (opcional)
          <input
            type="text"
            value={factura}
            onChange={(e) => setFactura(e.target.value)}
            className={CAMPO}
          />
        </label>
      </div>

      {fila.tasa !== null && costo !== '' && (
        <VistaItbis
          titulo="Costo por unidad, como en la factura del proveedor"
          etiquetas={['Costo (sin ITBIS)', 'ITBIS', 'Costo con ITBIS']}
          monto={costo}
          tasa={fila.tasa}
          incluye={false}
          verificar={verificar}
          onSesionVencida={onSesionVencida}
        />
      )}

      {despues && (
        <Despues>
          Después de guardar habrá{' '}
          <span className="font-medium">
            {cantidad(despues)} {fila.unidad.toLowerCase()}
          </span>
          {promedio && (
            <>
              {' '}
              y el costo promedio pasará de {dinero(fila.costo)} a{' '}
              <span className="font-medium">{dinero(promedio)}</span>
            </>
          )}
          .
        </Despues>
      )}

      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Nota (opcional)
        <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} className={AREA} />
      </label>

      <p className="text-xs text-gray-500">
        El costo promedio se calcula con lo que había y lo que entra. El método
        de costeo debe confirmarlo su contador.
      </p>
      {error && <CajaError>{error}</CajaError>}
      <Botones guardando={guardando} texto="Registrar entrada" onCancelar={onCancelar} />
    </form>
  )
}

// ---------- Salida ----------

export function FormSalida({
  token,
  fila,
  onListo,
  onCancelar,
  onSesionVencida,
}: PropsMov) {
  const [cant, setCant] = useState('')
  const [causa, setCausa] = useState('')
  const [motivo, setMotivo] = useState('')
  const [referencia, setReferencia] = useState('')
  const { error, guardando, enviar } = useEnvio(onSesionVencida)

  const mCant = milesimas(cant)
  const mExist = milesimas(fila.existencia) ?? 0n
  const excede = mCant !== null && mCant > mExist

  function guardar(e: FormEvent) {
    e.preventDefault()
    void enviar(async () => {
      const r = await registrarSalida(token, fila.id, {
        cantidad: cant.trim(),
        causa,
        motivo,
        referencia,
      })
      onListo(
        `Salida registrada en ${fila.codigo}. Ahora hay ${cantidad(r.existencia)} ${fila.unidad.toLowerCase()}.`,
      )
    })
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <Cabecera fila={fila} />
      <p className="text-xs text-gray-500">
        Para daños, vencidos, consumo interno o devoluciones. Las ventas se
        descontarán solas cuando exista el módulo de Ventas.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Cantidad que sale ({fila.unidad.toLowerCase()})
          <input
            type="text"
            inputMode="decimal"
            value={cant}
            onChange={(e) => setCant(e.target.value)}
            className={CAMPO}
            autoFocus
          />
          {errorCantidad(cant, fila) && (
            <span className="text-xs text-red-600">{errorCantidad(cant, fila)}</span>
          )}
          {excede && (
            <span className="text-xs text-red-600">
              No puede salir más de lo que hay ({cantidad(fila.existencia)})
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Causa
          <select value={causa} onChange={(e) => setCausa(e.target.value)} className={CAMPO}>
            <option value="">Seleccione…</option>
            {CAUSAS.map(([id, nombre]) => (
              <option key={id} value={id}>
                {nombre}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Motivo (qué pasó)
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={2}
          placeholder="Ej: botellas rotas al descargar"
          className={AREA}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Referencia (opcional)
        <input
          type="text"
          value={referencia}
          onChange={(e) => setReferencia(e.target.value)}
          placeholder="Ej: nota de devolución"
          className={CAMPO}
        />
      </label>
      {mCant !== null && !excede && mCant > 0n && (
        <Despues>
          Después de guardar quedarán{' '}
          <span className="font-medium">
            {cantidad(deMilesimas(mExist - mCant))} {fila.unidad.toLowerCase()}
          </span>
          .
        </Despues>
      )}
      {error && <CajaError>{error}</CajaError>}
      <Botones guardando={guardando} texto="Registrar salida" onCancelar={onCancelar} peligro />
    </form>
  )
}

// ---------- Ajuste por conteo físico ----------

export function FormAjuste({
  token,
  fila,
  onListo,
  onCancelar,
  onSesionVencida,
}: PropsMov) {
  const [conteo, setConteo] = useState('')
  const [motivo, setMotivo] = useState('')
  const { error, guardando, enviar } = useEnvio(onSesionVencida)

  const mConteo = milesimas(conteo)
  const mExist = milesimas(fila.existencia) ?? 0n
  const diferencia = mConteo !== null ? mConteo - mExist : null

  function guardar(e: FormEvent) {
    e.preventDefault()
    void enviar(async () => {
      const r = await ajustarInventario(token, fila.id, { conteo: conteo.trim(), motivo })
      onListo(
        `Ajuste registrado en ${fila.codigo}. Ahora hay ${cantidad(r.existencia)} ${fila.unidad.toLowerCase()}.`,
      )
    })
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <Cabecera fila={fila} />
      <p className="text-sm text-gray-600">
        Cuente lo que hay físicamente y escriba ese número. El sistema registra
        la diferencia como un ajuste, con su motivo. No se borra nada.
      </p>
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Cantidad contada ({fila.unidad.toLowerCase()})
        <input
          type="text"
          inputMode="decimal"
          value={conteo}
          onChange={(e) => setConteo(e.target.value)}
          className={CAMPO}
          autoFocus
        />
        {errorCantidad(conteo, fila, true) && (
          <span className="text-xs text-red-600">{errorCantidad(conteo, fila, true)}</span>
        )}
      </label>
      {diferencia !== null && (
        <Despues>
          {diferencia === 0n ? (
            'Coincide con lo registrado: no hace falta ajustar.'
          ) : (
            <>
              Diferencia:{' '}
              <span
                className={`font-medium ${diferencia < 0n ? 'text-red-700' : 'text-green-700'}`}
              >
                {diferencia > 0n ? '+' : ''}
                {cantidad(deMilesimas(diferencia))} {fila.unidad.toLowerCase()}
              </span>{' '}
              ({diferencia > 0n ? 'hay más de lo registrado' : 'falta mercancía'}).
            </>
          )}
        </Despues>
      )}
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Motivo
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={2}
          placeholder="Ej: conteo físico de fin de mes"
          className={AREA}
        />
      </label>
      {error && <CajaError>{error}</CajaError>}
      <Botones guardando={guardando} texto="Registrar ajuste" onCancelar={onCancelar} peligro />
    </form>
  )
}

// ---------- Corregir costo ----------

export function FormCorregirCosto({
  token,
  fila,
  onListo,
  onCancelar,
  onSesionVencida,
}: PropsMov) {
  const [costo, setCosto] = useState('')
  const [motivo, setMotivo] = useState('')
  const { error, guardando, enviar } = useEnvio(onSesionVencida)

  function guardar(e: FormEvent) {
    e.preventDefault()
    void enviar(async () => {
      const r = await corregirCosto(token, fila.id, { costo: costo.trim(), motivo })
      onListo(`Costo de ${fila.codigo} corregido a ${dinero(r.costo)}.`)
    })
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <Cabecera fila={fila} />
      <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>
          El costo normalmente lo calculan las entradas (costo promedio). Use
          esto solo para corregir un error, por ejemplo una entrada registrada
          con el costo equivocado. Quedará en la auditoría y en el kárdex con su
          motivo.
        </span>
      </div>
      <div className="text-sm text-gray-600">
        Costo actual: <span className="font-medium text-gray-900">{dinero(fila.costo)}</span> por{' '}
        {fila.unidad.toLowerCase()} (sin ITBIS)
      </div>
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Costo correcto por {fila.unidad.toLowerCase()} (DOP, sin ITBIS)
        <input
          type="text"
          inputMode="decimal"
          value={costo}
          onChange={(e) => setCosto(e.target.value)}
          className={CAMPO}
          autoFocus
        />
        {costo.trim() !== '' && !montoValido(costo) && (
          <span className="text-xs text-red-600">Use solo números y punto, con hasta 2 decimales</span>
        )}
      </label>
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Motivo de la corrección
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={3}
          placeholder="Ej: la entrada se registró con el total como si fuera el costo por unidad"
          className={AREA}
        />
      </label>
      {error && <CajaError>{error}</CajaError>}
      <Botones guardando={guardando} texto="Corregir costo" onCancelar={onCancelar} peligro />
    </form>
  )
}

// ---------- Kárdex ----------

export function VerKardex({
  token,
  fila,
  onSesionVencida,
}: {
  token: string
  fila: FilaProducto
  onSesionVencida: () => void
}) {
  const [datos, setDatos] = useState<Kardex | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let activo = true
    kardexProducto(token, fila.id)
      .then((d) => {
        if (activo) setDatos(d)
      })
      .catch((e) => {
        if (!activo) return
        if (e instanceof SesionVencida) onSesionVencida()
        else setError(mensajeDe(e))
      })
    return () => {
      activo = false
    }
  }, [token, fila.id, onSesionVencida])

  if (error) return <CajaError>{error}</CajaError>
  if (!datos) return <div className="text-gray-500">Cargando…</div>

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm text-gray-600">
        <span className="font-mono font-medium text-gray-900">{datos.producto.codigo}</span> ·{' '}
        {datos.producto.nombre} · En stock:{' '}
        <span className="font-medium text-gray-900">
          {cantidad(fila.existencia)} {datos.producto.unidad.toLowerCase()}
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">Fecha</th>
              <th className="px-3 py-2 font-medium">Movimiento</th>
              <th className="px-3 py-2 text-right font-medium">Cantidad</th>
              <th className="px-3 py-2 text-right font-medium">Saldo</th>
              {datos.verCostos && (
                <th className="px-3 py-2 text-right font-medium">Costo unit.</th>
              )}
              {datos.verCostos && (
                <th className="px-3 py-2 text-right font-medium">Costo prom.</th>
              )}
              <th className="px-3 py-2 font-medium">Detalle</th>
              <th className="px-3 py-2 font-medium">Usuario</th>
            </tr>
          </thead>
          <tbody>
            {datos.movimientos.map((m) => (
              <tr key={m.id} className="border-b border-gray-100 align-top last:border-0">
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                  {new Date(m.fecha).toLocaleString('es-DO')}
                </td>
                <td className="whitespace-nowrap px-3 py-2">{NOMBRE_TIPO[m.tipo] ?? m.tipo}</td>
                <td
                  className={`whitespace-nowrap px-3 py-2 text-right font-medium ${
                    m.signo < 0 ? 'text-red-700' : 'text-green-700'
                  }`}
                >
                  {m.signo < 0 ? '−' : '+'}
                  {cantidad(m.cantidad)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{cantidad(m.saldo)}</td>
                {datos.verCostos && (
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {dinero(m.costo_unitario)}
                  </td>
                )}
                {datos.verCostos && (
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {dinero(m.costo_promedio ?? m.costo_unitario)}
                  </td>
                )}
                <td className="px-3 py-2 text-xs text-gray-600">
                  {[m.causa, m.proveedor, m.referencia, m.motivo].filter(Boolean).join(' · ')}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{m.usuario}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {datos.correcciones.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <div className="mb-1 font-medium text-amber-900">Correcciones de costo</div>
          <ul className="flex flex-col gap-1 text-amber-900">
            {datos.correcciones.map((c) => (
              <li key={c.fecha}>
                {new Date(c.fecha).toLocaleString('es-DO')} · {dinero(c.anterior)} →{' '}
                <span className="font-medium">{dinero(c.nuevo)}</span> · {c.motivo} ·{' '}
                {c.usuario}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-gray-500">
        El kárdex muestra todos los movimientos del producto, del más reciente
        al más antiguo. Ninguno se puede borrar ni modificar.
      </p>
    </div>
  )
}
