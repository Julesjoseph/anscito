import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Minus,
  Printer,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  UserRound,
  Wallet,
} from 'lucide-react'
import {
  SesionVencida,
  anotarComprobante,
  anularVenta,
  buscarArticulos,
  buscarClientesVenta,
  detalleVenta,
  listarVentas,
  obtenerRecibo,
  prepararVenta,
  previsualizarVenta,
  registrarVenta,
} from './api'
import type {
  ArticuloVenta,
  ClienteVenta,
  DatosVenta,
  DetalleVenta,
  FiltrosVentas,
  FormatoRecibo,
  PaginaVentas,
  PrepararVenta,
  PrevisualizacionVenta,
} from './api'
import { cajaDeEstaComputadora, guardarCajaDeEstaComputadora } from './cajaLocal'
import {
  AREA,
  BOTON_PELIGRO,
  BOTON_PRINCIPAL,
  BOTON_SECUNDARIO,
  CAMPO,
  CajaError,
  Ventana,
} from './componentes'
import { cantidad as verCantidad, dinero, mensajeDe, porcentaje } from './formato'

type Props = {
  token: string
  permisos: string[]
  onSesionVencida: () => void
}

// ---------- Dinero y cantidades con enteros (vista previa) ----------

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const CANT = /^\d{1,11}(\.\d{1,3})?$/

function centavos(v: string): bigint {
  const [e, d = ''] = v.trim().split('.')
  return BigInt(e) * 100n + BigInt(d.padEnd(2, '0'))
}
function milesimas(v: string): bigint {
  const [e, d = ''] = v.trim().split('.')
  return BigInt(e) * 1000n + BigInt(d.padEnd(3, '0'))
}
function texto2(c: bigint): string {
  const neg = c < 0n
  const a = neg ? -c : c
  return `${neg ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`
}
// precio × cantidad, redondeado al centavo (igual que el servidor).
function bruto(precio: string, cant: string): bigint {
  return (2n * centavos(precio) * milesimas(cant) + 1000n) / 2000n
}
// Descuento en RD$ a partir de un %, redondeado hacia abajo para no pasar
// nunca del máximo.
function montoDescuento(brutoC: bigint, pct: string): bigint {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(pct.trim())) return 0n
  const [e, d = ''] = pct.trim().split('.')
  const centesimas = BigInt(e) * 100n + BigInt(d.padEnd(2, '0'))
  return (brutoC * centesimas) / 10000n
}

function hoy(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' })
}

// ---------- Imprimir el comprobante (PDF) ----------

const FORMATOS: [FormatoRecibo, string][] = [
  ['80', 'Rollo 80 mm'],
  ['58', 'Rollo 58 mm'],
  ['carta', 'Hoja carta'],
]

// Se recuerda el último tamaño usado en esta computadora.
function formatoGuardado(): FormatoRecibo {
  try {
    const f = localStorage.getItem('anscito.formatoRecibo')
    if (f === '80' || f === '58' || f === 'carta') return f
  } catch {
    // Sin almacenamiento disponible: se usa el de 80 mm.
  }
  return '80'
}

function BotonImprimir({
  token,
  ventaId,
  onSesionVencida,
}: {
  token: string
  ventaId: string
  onSesionVencida: () => void
}) {
  const [formato, setFormato] = useState<FormatoRecibo>(formatoGuardado)
  const [error, setError] = useState('')
  const [generando, setGenerando] = useState(false)

  async function imprimir() {
    setError('')
    setGenerando(true)
    try {
      localStorage.setItem('anscito.formatoRecibo', formato)
    } catch {
      // No pasa nada si no se puede recordar.
    }
    // La pestaña se abre en el mismo clic para que el navegador no la bloquee.
    const pestana = window.open('', '_blank')
    try {
      const pdf = await obtenerRecibo(token, ventaId, formato)
      const url = URL.createObjectURL(pdf)
      if (pestana) {
        pestana.location.href = url
      } else {
        // Si el navegador bloqueó la pestaña, se descarga el archivo.
        const a = document.createElement('a')
        a.href = url
        a.download = 'comprobante.pdf'
        a.click()
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      pestana?.close()
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    } finally {
      setGenerando(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={formato}
          onChange={(e) => setFormato(e.target.value as FormatoRecibo)}
          className="h-10 rounded-lg border border-gray-300 px-2 text-sm"
          aria-label="Tamaño del papel"
        >
          {FORMATOS.map(([id, nombre]) => (
            <option key={id} value={id}>
              {nombre}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void imprimir()} disabled={generando} className={`${BOTON_SECUNDARIO} inline-flex items-center gap-2`}>
          <Printer size={16} /> {generando ? 'Generando…' : 'Imprimir / PDF'}
        </button>
      </div>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}

// ---------- Nueva venta ----------

type Linea = { art: ArticuloVenta; cantidad: string; pct: string }

function NuevaVenta({
  token,
  onSesionVencida,
  onVerVenta,
}: Props & { onVerVenta: (id: string) => void }) {
  const [prep, setPrep] = useState<PrepararVenta | null>(null)
  const [buscar, setBuscar] = useState('')
  const [resultados, setResultados] = useState<ArticuloVenta[]>([])
  const [lineas, setLineas] = useState<Linea[]>([])
  const [cliente, setCliente] = useState<{ id: string; nombre: string } | null>(null)
  const [buscarCliente, setBuscarCliente] = useState('')
  const [clientes, setClientes] = useState<ClienteVenta[] | null>(null)
  const [formaId, setFormaId] = useState('')
  const [recibido, setRecibido] = useState('')
  const [referencia, setReferencia] = useState('')
  const [comprobante, setComprobante] = useState('')
  const [motivoDescuento, setMotivoDescuento] = useState('')
  const [notas, setNotas] = useState('')
  const [previa, setPrevia] = useState<{ clave: string; datos: PrevisualizacionVenta | null; error: string } | null>(null)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [hecha, setHecha] = useState<{ id: string; numero: string; total: string; devuelta: string | null } | null>(null)
  const [cajaId, setCajaId] = useState<string | null>(cajaDeEstaComputadora)
  // Última cuenta usada para transferencias en esta computadora.
  const [cuentaId, setCuentaId] = useState<string>(() => {
    try {
      return localStorage.getItem('anscito.cuentaVenta') ?? ''
    } catch {
      return ''
    }
  })

  const manejar = useCallback(
    (e: unknown) => {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    },
    [onSesionVencida],
  )

  useEffect(() => {
    let activo = true
    prepararVenta(token)
      .then((p) => {
        if (!activo) return
        setPrep(p)
        if (p.consumidorFinal) setCliente(p.consumidorFinal)
        if (p.formasPago[0]) setFormaId(p.formasPago[0].id)
      })
      .catch(manejar)
    return () => {
      activo = false
    }
  }, [token, manejar])

  // Vuelve a preguntar si la caja está abierta (por si se abrió en otra pantalla).
  async function revisarCaja() {
    try {
      const p = await prepararVenta(token)
      setPrep((antes) => (antes ? { ...antes, cajas: p.cajas } : p))
      setError('')
    } catch (e) {
      manejar(e)
    }
  }

  function elegirCaja(id: string) {
    guardarCajaDeEstaComputadora(id || null)
    setCajaId(id || null)
  }

  // Buscar artículos mientras se escribe.
  useEffect(() => {
    if (!buscar.trim()) return
    let activo = true
    const espera = setTimeout(() => {
      buscarArticulos(token, buscar)
        .then((r) => {
          if (activo) setResultados(r)
        })
        .catch(manejar)
    }, 250)
    return () => {
      activo = false
      clearTimeout(espera)
    }
  }, [token, buscar, manejar])

  const eligiendoCliente = clientes !== null
  useEffect(() => {
    if (!eligiendoCliente) return
    let activo = true
    const espera = setTimeout(() => {
      buscarClientesVenta(token, buscarCliente)
        .then((r) => {
          if (activo) setClientes(r)
        })
        .catch(manejar)
    }, 250)
    return () => {
      activo = false
      clearTimeout(espera)
    }
  }, [token, buscarCliente, eligiendoCliente, manejar])

  const maximo = prep?.descuentoMaximoPct ?? '0'
  const forma = prep?.formasPago.find((f) => f.id === formaId)
  const miCaja = prep?.cajas.find((c) => c.id === cajaId)
  // El efectivo solo se cobra con la caja de esta computadora abierta.
  const cajaLista = !forma?.usa_caja || (miCaja !== undefined && miCaja.sesion_id !== null)
  // Si solo hay una cuenta para ventas, se usa esa.
  const cuentaVenta =
    prep?.cuentasVenta.find((x) => x.id === cuentaId) ??
    (prep?.cuentasVenta.length === 1 ? prep.cuentasVenta[0] : undefined)
  const cuentaLista = !forma?.usa_cuenta || cuentaVenta !== undefined

  function elegirCuenta(id: string) {
    setCuentaId(id)
    try {
      localStorage.setItem('anscito.cuentaVenta', id)
    } catch {
      // No pasa nada si no se puede recordar.
    }
  }

  // Líneas listas para el servidor (con el descuento en RD$).
  const entrada = useMemo(
    () =>
      lineas.map((l) => {
        const valida = CANT.test(l.cantidad.trim()) && milesimas(l.cantidad) > 0n
        const desc = valida ? montoDescuento(bruto(l.art.precio, l.cantidad), l.pct) : 0n
        return {
          tipo: l.art.tipo,
          id: l.art.id,
          cantidad: l.cantidad.trim(),
          descuento: texto2(desc),
        }
      }),
    [lineas],
  )
  const hayDescuento = entrada.some((l) => l.descuento !== '0.00')
  const clave = JSON.stringify(entrada)

  // El servidor calcula los totales (vista previa, sin guardar).
  useEffect(() => {
    if (entrada.length === 0) return
    let activo = true
    const espera = setTimeout(() => {
      const datos: DatosVenta = {
        clienteId: cliente?.id ?? '',
        lineas: entrada,
        motivoDescuento: hayDescuento ? 'Vista previa' : '',
        pago: { formaPagoId: formaId },
        comprobanteFiscal: '',
        notas: '',
      }
      previsualizarVenta(token, datos)
        .then((r) => {
          if (activo) setPrevia({ clave, datos: r, error: '' })
        })
        .catch((e) => {
          if (!activo) return
          if (e instanceof SesionVencida) onSesionVencida()
          else setPrevia({ clave, datos: null, error: mensajeDe(e) })
        })
    }, 300)
    return () => {
      activo = false
      clearTimeout(espera)
    }
  }, [token, clave, entrada, hayDescuento, cliente?.id, formaId, onSesionVencida])

  const vigente = previa?.clave === clave ? previa : null
  const totales = vigente?.datos?.totales ?? null
  const devuelta =
    totales && forma?.calcula_devuelta && MONTO.test(recibido.trim())
      ? centavos(recibido) - centavos(totales.total)
      : null

  function agregar(a: ArticuloVenta) {
    setHecha(null)
    setError('')
    const i = lineas.findIndex((l) => l.art.tipo === a.tipo && l.art.id === a.id)
    if (i >= 0) {
      const l = lineas[i]
      const nueva = CANT.test(l.cantidad) ? (milesimas(l.cantidad) + 1000n) / 1000n : 1n
      setLineas(lineas.map((x, j) => (j === i ? { ...x, cantidad: String(nueva) } : x)))
    } else {
      setLineas([...lineas, { art: a, cantidad: '1', pct: '' }])
    }
    setBuscar('')
    setResultados([])
  }

  function cambiar(i: number, cambio: Partial<Linea>) {
    setLineas(lineas.map((l, j) => (j === i ? { ...l, ...cambio } : l)))
  }

  function sumar(i: number, delta: number) {
    const l = lineas[i]
    const actual = CANT.test(l.cantidad) ? Number(l.cantidad) : 0
    cambiar(i, { cantidad: String(Math.max(1, Math.round(actual) + delta)) })
  }

  function limpiar() {
    setLineas([])
    setRecibido('')
    setReferencia('')
    setComprobante('')
    setMotivoDescuento('')
    setNotas('')
    setPrevia(null)
    if (prep?.consumidorFinal) setCliente(prep.consumidorFinal)
  }

  async function cobrar(e: FormEvent) {
    e.preventDefault()
    if (!cliente || !forma) return
    setError('')
    setGuardando(true)
    try {
      const r = await registrarVenta(token, {
        clienteId: cliente.id,
        lineas: entrada,
        motivoDescuento,
        pago: {
          formaPagoId: forma.id,
          recibido: forma.calcula_devuelta ? recibido.trim() : undefined,
          referencia: referencia.trim() || undefined,
          cajaId: forma.usa_caja && miCaja ? miCaja.id : undefined,
          cuentaId: forma.usa_cuenta && cuentaVenta ? cuentaVenta.id : undefined,
        },
        comprobanteFiscal: comprobante,
        notas,
      })
      setHecha(r)
      limpiar()
    } catch (err) {
      manejar(err)
    } finally {
      setGuardando(false)
    }
  }

  const puedeCobrar =
    !guardando &&
    lineas.length > 0 &&
    totales !== null &&
    cliente !== null &&
    forma !== undefined &&
    cajaLista &&
    cuentaLista &&
    (!forma.calcula_devuelta || (devuelta !== null && devuelta >= 0n)) &&
    (!forma.requiere_referencia || referencia.trim() !== '') &&
    (!hayDescuento || motivoDescuento.trim().length >= 5)

  if (!prep) return error ? <CajaError>{error}</CajaError> : <div className="text-gray-500">Cargando…</div>

  return (
    <form onSubmit={cobrar} className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      {/* Artículos */}
      <div className="flex flex-col gap-4 xl:col-span-2">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={buscar}
            onChange={(e) => {
              setBuscar(e.target.value)
              if (!e.target.value.trim()) setResultados([])
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (resultados[0]) agregar(resultados[0])
              }
            }}
            placeholder="Buscar producto o servicio por código o nombre (Enter agrega el primero)"
            className={`${CAMPO} w-full pl-9`}
            autoFocus
          />
          {buscar.trim() && resultados.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
              {resultados.map((a) => {
                const agotado = a.tipo === 'producto' && Number(a.existencia) <= 0
                return (
                  <li key={`${a.tipo}:${a.id}`}>
                    <button
                      type="button"
                      disabled={agotado}
                      onClick={() => agregar(a)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-40"
                    >
                      <span>
                        <span className="font-mono text-xs text-gray-500">{a.codigo}</span> {a.nombre}
                        <span className="ml-2 text-xs text-gray-400">{a.tipo === 'servicio' ? 'Servicio' : `Stock: ${verCantidad(a.existencia)}`}</span>
                      </span>
                      <span className="whitespace-nowrap font-medium">
                        {dinero(a.precio)}
                        <span className="ml-1 text-xs font-normal text-gray-500">
                          {Number(a.tasa) === 0 ? 'exento' : a.precio_incluye_itbis ? 'ITBIS incl.' : `+ ITBIS ${porcentaje(a.tasa)}`}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {buscar.trim() && resultados.length === 0 && (
            <div className="mt-1 text-xs text-gray-500">
              Sin resultados. Solo aparecen productos activos con precio de venta, y servicios activos.
            </div>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          {lineas.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-sm text-gray-400">
              <ShoppingCart size={28} />
              Busque y agregue productos o servicios.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 text-left text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Artículo</th>
                  <th className="px-3 py-2 font-medium">Cantidad</th>
                  <th className="px-3 py-2 text-right font-medium">Precio</th>
                  {prep.puedeDescontar && <th className="px-3 py-2 font-medium">Desc. %</th>}
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => {
                  const calc = vigente?.datos?.lineas[i]
                  const excede = l.art.tipo === 'producto' && CANT.test(l.cantidad) && Number(l.cantidad) > Number(l.art.existencia)
                  const pctMal = l.pct.trim() !== '' && (!/^\d{1,3}(\.\d{1,2})?$/.test(l.pct.trim()) || Number(l.pct) > Number(maximo))
                  return (
                    <tr key={`${l.art.tipo}:${l.art.id}`} className="border-b border-gray-100 align-top last:border-0">
                      <td className="px-3 py-2">
                        <div className="font-medium">{l.art.nombre}</div>
                        <div className="text-xs text-gray-500">
                          <span className="font-mono">{l.art.codigo}</span> · {l.art.unidad}
                          {l.art.tipo === 'producto' && ` · stock ${verCantidad(l.art.existencia)}`}
                        </div>
                        {excede && <div className="text-xs text-red-600">Hay solo {verCantidad(l.art.existencia)}</div>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => sumar(i, -1)} className="rounded border border-gray-200 p-1 hover:bg-gray-50" aria-label="Uno menos">
                            <Minus size={12} />
                          </button>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={l.cantidad}
                            onChange={(e) => cambiar(i, { cantidad: e.target.value })}
                            className="h-8 w-16 rounded border border-gray-300 px-2 text-center"
                            aria-label="Cantidad"
                          />
                          <button type="button" onClick={() => sumar(i, 1)} className="rounded border border-gray-200 p-1 hover:bg-gray-50" aria-label="Uno más">
                            <Plus size={12} />
                          </button>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">{dinero(l.art.precio)}</td>
                      {prep.puedeDescontar && (
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={l.pct}
                            onChange={(e) => cambiar(i, { pct: e.target.value })}
                            placeholder="0"
                            className={`h-8 w-16 rounded border px-2 text-center ${pctMal ? 'border-red-400' : 'border-gray-300'}`}
                            aria-label="Descuento en porcentaje"
                          />
                          {calc && calc.descuento !== '0.00' && <div className="text-xs text-gray-500">−{dinero(calc.descuento)}</div>}
                          {pctMal && <div className="text-xs text-red-600">Máx. {Number(maximo)}%</div>}
                        </td>
                      )}
                      <td className="whitespace-nowrap px-3 py-2 text-right font-medium">{calc ? dinero(calc.total) : '…'}</td>
                      <td className="px-3 py-2 text-right">
                        <button type="button" onClick={() => setLineas(lineas.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600" aria-label="Quitar">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        {vigente?.error && <CajaError>{vigente.error}</CajaError>}
      </div>

      {/* Cobro */}
      <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4">
        {hecha && (
          <div className="flex flex-col gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 size={18} /> Venta {hecha.numero} registrada
            </div>
            <div>Total cobrado: {dinero(hecha.total)}</div>
            {hecha.devuelta !== null && <div className="text-lg font-medium">Devuelta: {dinero(hecha.devuelta)}</div>}
            <BotonImprimir token={token} ventaId={hecha.id} onSesionVencida={onSesionVencida} />
            <button type="button" onClick={() => onVerVenta(hecha.id)} className="self-start text-green-900 underline">
              Ver el detalle
            </button>
          </div>
        )}

        <div className="flex flex-col gap-1 text-sm text-gray-600">
          Cliente
          {clientes === null ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2">
              <span className="flex items-center gap-2 font-medium text-gray-900">
                <UserRound size={16} /> {cliente?.nombre ?? 'Sin cliente'}
              </span>
              <button type="button" onClick={() => setClientes([])} className="text-xs text-[#C8102E] hover:underline">
                Cambiar
              </button>
            </div>
          ) : (
            <div className="relative">
              <input
                type="search"
                value={buscarCliente}
                onChange={(e) => setBuscarCliente(e.target.value)}
                placeholder="Nombre o documento del cliente"
                className={`${CAMPO} w-full`}
                autoFocus
              />
              <ul className="mt-1 max-h-60 overflow-y-auto rounded-lg border border-gray-200">
                {clientes.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setCliente({ id: c.id, nombre: c.nombre })
                        setClientes(null)
                        setBuscarCliente('')
                      }}
                      className="w-full px-3 py-2 text-left hover:bg-gray-50"
                    >
                      <span className="font-medium text-gray-900">{c.nombre}</span>
                      {c.numero_documento && <span className="ml-2 font-mono text-xs text-gray-500">{c.numero_documento}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => setClientes(null)} className="mt-1 text-xs text-gray-500 hover:underline">
                Cancelar
              </button>
            </div>
          )}
        </div>

        <dl className="flex flex-col gap-1 border-y border-gray-100 py-3 text-sm">
          <div className="flex justify-between"><dt className="text-gray-500">Subtotal</dt><dd>{dinero(totales?.subtotal)}</dd></div>
          {totales && totales.descuento !== '0.00' && (
            <div className="flex justify-between text-amber-800"><dt>Descuento</dt><dd>−{dinero(totales.descuento)}</dd></div>
          )}
          <div className="flex justify-between"><dt className="text-gray-500">Base imponible</dt><dd>{dinero(totales?.base_imponible)}</dd></div>
          <div className="flex justify-between"><dt className="text-gray-500">ITBIS</dt><dd>{dinero(totales?.itbis)}</dd></div>
          <div className="mt-1 flex justify-between text-xl font-medium"><dt>Total</dt><dd>{dinero(totales?.total)}</dd></div>
        </dl>

        {hayDescuento && (
          <label className="flex flex-col gap-1 text-sm text-gray-600">
            Motivo del descuento
            <input type="text" value={motivoDescuento} onChange={(e) => setMotivoDescuento(e.target.value)} placeholder="Ej: cliente frecuente" className={CAMPO} />
          </label>
        )}

        <div className="flex flex-col gap-1 text-sm text-gray-600">
          Forma de pago
          <div className="flex gap-2">
            {prep.formasPago.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFormaId(f.id)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm ${formaId === f.id ? 'border-[#C8102E] bg-red-50 font-medium text-[#C8102E]' : 'border-gray-300 hover:bg-gray-50'}`}
              >
                {f.nombre}
              </button>
            ))}
          </div>
        </div>

        {forma?.usa_caja &&
          (miCaja?.sesion_id ? (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              <Wallet size={16} /> El efectivo entra a {miCaja.nombre} (abierta)
            </div>
          ) : (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <div className="flex gap-2">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                {miCaja
                  ? `${miCaja.nombre} está cerrada. Ábrala en el menú Caja para cobrar en efectivo.`
                  : 'Esta computadora no tiene caja asignada. Elija cuál es para cobrar en efectivo.'}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!miCaja && (
                  <select value="" onChange={(e) => elegirCaja(e.target.value)} className={`${CAMPO} h-9 bg-white`} aria-label="Caja de esta computadora">
                    <option value="">Elegir caja…</option>
                    {prep.cajas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                )}
                <button type="button" onClick={() => void revisarCaja()} className="text-xs underline">
                  Ya la abrí: revisar de nuevo
                </button>
              </div>
            </div>
          ))}
        {forma?.calcula_devuelta && (
          <label className="flex flex-col gap-1 text-sm text-gray-600">
            Recibido del cliente (RD$)
            <input type="text" inputMode="decimal" value={recibido} onChange={(e) => setRecibido(e.target.value)} placeholder="0.00" className={`${CAMPO} text-lg`} />
            {devuelta !== null && (
              <span className={`text-base font-medium ${devuelta < 0n ? 'text-red-600' : 'text-green-700'}`}>
                {devuelta < 0n ? `Faltan ${dinero(texto2(-devuelta))}` : `Devuelta: ${dinero(texto2(devuelta))}`}
              </span>
            )}
          </label>
        )}
        {forma?.usa_cuenta &&
          (prep.cuentasVenta.length === 0 ? (
            <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              No hay cuentas que reciban ventas. En Bancos, edite una cuenta en RD$ y marque “Recibe transferencias de ventas”.
            </div>
          ) : (
            <label className="flex flex-col gap-1 text-sm text-gray-600">
              ¿A qué cuenta llegó?
              <select value={cuentaVenta?.id ?? ''} onChange={(e) => elegirCuenta(e.target.value)} className={CAMPO}>
                <option value="">Seleccione…</option>
                {prep.cuentasVenta.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nombre}
                  </option>
                ))}
              </select>
              <span className="text-xs text-gray-500">Queda “por confirmar” hasta verla en el estado de cuenta.</span>
            </label>
          ))}
        {forma?.requiere_referencia && (
          <label className="flex flex-col gap-1 text-sm text-gray-600">
            Referencia de la {forma.nombre.toLowerCase()}
            <input type="text" value={referencia} onChange={(e) => setReferencia(e.target.value)} className={CAMPO} />
          </label>
        )}

        <details className="text-sm text-gray-600">
          <summary className="cursor-pointer">Comprobante fiscal y notas (opcional)</summary>
          <div className="mt-2 flex flex-col gap-2">
            <input type="text" value={comprobante} onChange={(e) => setComprobante(e.target.value.toUpperCase())} placeholder="NCF o e-CF emitido (se puede anotar después)" className={`${CAMPO} font-mono`} />
            <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} placeholder="Notas" className={AREA} />
          </div>
        </details>

        {error && <CajaError>{error}</CajaError>}

        <button type="submit" disabled={!puedeCobrar} className={`${BOTON_PRINCIPAL} h-12 text-base`}>
          {guardando ? 'Registrando…' : `Cobrar ${totales ? dinero(totales.total) : ''}`}
        </button>
        {lineas.length > 0 && (
          <button type="button" onClick={limpiar} className="text-xs text-gray-500 hover:underline">
            Vaciar la venta
          </button>
        )}
        <p className="text-xs text-gray-500">
          El número interno (V-000001…) no es un comprobante fiscal: el NCF o
          e-CF se emite en su sistema actual. Confirme con su contador cómo deben
          quedar documentadas sus ventas.
        </p>
      </div>
    </form>
  )
}

// ---------- Detalle ----------

function VerDetalle({
  token,
  id,
  permisos,
  onCambio,
  onSesionVencida,
}: {
  token: string
  id: string
  permisos: string[]
  onCambio: () => void
  onSesionVencida: () => void
}) {
  const [d, setD] = useState<DetalleVenta | null>(null)
  const [error, setError] = useState('')
  const [comprobante, setComprobante] = useState('')
  const [anulando, setAnulando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const r = await detalleVenta(token, id)
      setD(r)
      setComprobante(r.comprobante_fiscal ?? '')
      setError('')
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, id, onSesionVencida])

  useEffect(() => {
    const espera = setTimeout(() => void cargar(), 0)
    return () => clearTimeout(espera)
  }, [cargar])

  async function guardarComprobante() {
    setGuardando(true)
    try {
      await anotarComprobante(token, id, comprobante)
      await cargar()
      onCambio()
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    } finally {
      setGuardando(false)
    }
  }

  async function anular(e: FormEvent) {
    e.preventDefault()
    setGuardando(true)
    try {
      await anularVenta(token, id, motivo, cajaDeEstaComputadora())
      setAnulando(false)
      await cargar()
      onCambio()
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    } finally {
      setGuardando(false)
    }
  }

  if (!d) return error ? <CajaError>{error}</CajaError> : <div className="text-gray-500">Cargando…</div>
  const completada = d.estado === 'completada'

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-mono text-lg font-medium">{d.numero_texto}</div>
          <div className="text-gray-500">{new Date(d.fecha).toLocaleString('es-DO')} · {d.sucursal} · {d.vendedor}</div>
          <div>
            Cliente: <span className="font-medium">{d.cliente}</span>
            {d.cliente_documento && <span className="ml-2 font-mono text-xs text-gray-500">{d.cliente_documento}</span>}
          </div>
        </div>
        <span className={`rounded-md px-2 py-0.5 text-xs ${completada ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {completada ? 'Completada' : 'Anulada'}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">Artículo</th>
              <th className="px-3 py-2 text-right font-medium">Cant.</th>
              <th className="px-3 py-2 text-right font-medium">Precio</th>
              <th className="px-3 py-2 text-right font-medium">Desc.</th>
              <th className="px-3 py-2 text-right font-medium">ITBIS</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {d.lineas.map((l) => (
              <tr key={l.id} className="border-b border-gray-100 last:border-0">
                <td className="px-3 py-2">
                  {l.descripcion}
                  <div className="font-mono text-xs text-gray-500">{l.codigo}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{verCantidad(l.cantidad)} {l.unidad.toLowerCase()}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{dinero(l.precio_unitario)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{l.descuento !== '0.00' ? `−${dinero(l.descuento)}` : '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {Number(l.tasa) === 0 ? 'Exento' : dinero(l.itbis)}
                  {Number(l.tasa) > 0 && <div className="text-xs text-gray-500">{porcentaje(l.tasa)}</div>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-medium">{dinero(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          {d.pagos.map((p, i) => (
            <div key={i}>
              <span className="font-medium">{p.forma_pago}</span> {dinero(p.monto)}
              {p.recibido && <div className="text-gray-500">Recibido {dinero(p.recibido)} · Devuelta {dinero(p.devuelta)}</div>}
              {p.referencia && <div className="text-gray-500">Referencia: {p.referencia}</div>}
            </div>
          ))}
          {d.motivo_descuento && <div className="text-amber-800">Descuento: {d.motivo_descuento}</div>}
          {d.notas && <div className="text-gray-500">Notas: {d.notas}</div>}
        </div>
        <dl className="flex flex-col gap-1">
          <div className="flex justify-between"><dt className="text-gray-500">Subtotal</dt><dd>{dinero(d.subtotal)}</dd></div>
          {d.descuento !== '0.00' && <div className="flex justify-between"><dt className="text-gray-500">Descuento</dt><dd>−{dinero(d.descuento)}</dd></div>}
          <div className="flex justify-between"><dt className="text-gray-500">Base imponible</dt><dd>{dinero(d.base_imponible)}</dd></div>
          <div className="flex justify-between"><dt className="text-gray-500">ITBIS</dt><dd>{dinero(d.itbis)}</dd></div>
          <div className="flex justify-between text-base font-medium"><dt>Total</dt><dd>{dinero(d.total)}</dd></div>
        </dl>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-gray-600">
          Comprobante fiscal (NCF / e-CF)
          <input
            type="text"
            value={comprobante}
            onChange={(e) => setComprobante(e.target.value.toUpperCase())}
            disabled={!completada || !permisos.includes('ventas.comprobante')}
            className={`${CAMPO} font-mono disabled:bg-gray-100`}
          />
        </label>
        {completada && permisos.includes('ventas.comprobante') && comprobante !== (d.comprobante_fiscal ?? '') && (
          <button type="button" onClick={() => void guardarComprobante()} disabled={guardando} className={BOTON_SECUNDARIO}>
            Guardar comprobante
          </button>
        )}
      </div>

      <BotonImprimir token={token} ventaId={id} onSesionVencida={onSesionVencida} />

      {!completada && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
          Anulada el {d.anulada_en && new Date(d.anulada_en).toLocaleString('es-DO')} por {d.anulada_por_usuario}. Motivo: {d.motivo_anulacion}. La mercancía volvió al inventario.
        </div>
      )}

      {error && <CajaError>{error}</CajaError>}

      {completada && permisos.includes('ventas.anular') && !anulando && (
        <button type="button" onClick={() => setAnulando(true)} className={`${BOTON_PELIGRO} self-start`}>
          <Ban size={16} /> Anular venta
        </button>
      )}
      {anulando && (
        <form onSubmit={anular} className="flex flex-col gap-3 rounded-lg border border-red-200 p-3">
          <div className="flex gap-2 text-red-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            La venta no se borra: queda como "Anulada" con su motivo, y los productos vuelven al inventario. Las ventas de días anteriores solo las anula quien tenga el permiso especial.
          </div>
          <div className="flex gap-2 text-gray-600">
            <Wallet size={16} className="mt-0.5 shrink-0" />
            Si se cobró en efectivo, el dinero se le devuelve al cliente desde la caja de esta computadora, que debe estar abierta. Si fue por transferencia, la devolución sale de la misma cuenta (por confirmar).
          </div>
          <label className="flex flex-col gap-1 text-gray-600">
            Motivo de la anulación
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} className={AREA} />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAnulando(false)} className={BOTON_SECUNDARIO}>
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className={BOTON_PELIGRO}>
              <AlertTriangle size={16} /> {guardando ? 'Anulando…' : 'Anular venta'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// ---------- Historial ----------

function Historial({
  token,
  onSesionVencida,
  abrir,
  version,
}: Props & { abrir: (id: string) => void; version: number }) {
  const [datos, setDatos] = useState<PaginaVentas | null>(null)
  const [filtros, setFiltros] = useState<FiltrosVentas>({ texto: '', desde: hoy(), hasta: hoy(), estado: 'todas', pagina: 1 })
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    try {
      setDatos(await listarVentas(token, filtros))
      setError('')
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, filtros, onSesionVencida])

  useEffect(() => {
    const espera = setTimeout(() => void cargar(), 300)
    return () => clearTimeout(espera)
  }, [cargar, version])

  const cambiar = (c: Partial<FiltrosVentas>) => setFiltros({ ...filtros, ...c, pagina: 1 })
  const filas = datos?.filas ?? []
  const ultima = datos ? Math.max(1, Math.ceil(datos.total / datos.porPagina)) : 1

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm text-gray-600">
          Buscar
          <input type="search" value={filtros.texto} onChange={(e) => cambiar({ texto: e.target.value })} placeholder="Número, cliente o comprobante" className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Desde
          <input type="date" value={filtros.desde} onChange={(e) => cambiar({ desde: e.target.value })} className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Hasta
          <input type="date" value={filtros.hasta} onChange={(e) => cambiar({ hasta: e.target.value })} className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Estado
          <select value={filtros.estado} onChange={(e) => cambiar({ estado: e.target.value as FiltrosVentas['estado'] })} className={CAMPO}>
            <option value="todas">Todas</option>
            <option value="completadas">Completadas</option>
            <option value="anuladas">Anuladas</option>
          </select>
        </label>
      </div>

      {datos && (
        <div className="mb-4 flex flex-wrap gap-4 rounded-xl border border-gray-200 bg-white p-4 text-sm">
          <div><div className="text-gray-500">Ventas completadas</div><div className="text-xl font-medium">{datos.resumen.cantidad}</div></div>
          <div><div className="text-gray-500">Total vendido</div><div className="text-xl font-medium">{dinero(datos.resumen.total)}</div></div>
          <div><div className="text-gray-500">ITBIS cobrado</div><div className="text-xl font-medium">{dinero(datos.resumen.itbis)}</div></div>
          <div className="self-end text-xs text-gray-400">Las anuladas no suman.</div>
        </div>
      )}

      {error && <div className="mb-4"><CajaError>{error}</CajaError></div>}
      {datos && filas.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">No hay ventas en ese período.</div>
      )}
      {filas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 text-left text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Número</th>
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Pago</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Comprobante</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className={`border-b border-gray-100 last:border-0 ${f.estado === 'anulada' ? 'text-gray-400' : ''}`}>
                  <td className="whitespace-nowrap px-4 py-3 font-mono">{f.numero_texto}</td>
                  <td className="whitespace-nowrap px-4 py-3">{new Date(f.fecha).toLocaleString('es-DO')}<div className="text-xs text-gray-500">{f.vendedor}</div></td>
                  <td className="px-4 py-3">{f.cliente}</td>
                  <td className="px-4 py-3">{f.forma_pago}</td>
                  <td className={`whitespace-nowrap px-4 py-3 text-right font-medium ${f.estado === 'anulada' ? 'line-through' : ''}`}>{dinero(f.total)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{f.comprobante_fiscal ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-md px-2 py-0.5 text-xs ${f.estado === 'completada' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                      {f.estado === 'completada' ? 'Completada' : 'Anulada'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => abrir(f.id)} className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900">
                      <Eye size={14} /> Ver
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {datos && datos.total > datos.porPagina && (
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" disabled={datos.pagina <= 1} onClick={() => setFiltros({ ...filtros, pagina: filtros.pagina - 1 })} className={`${BOTON_SECUNDARIO} inline-flex items-center gap-1 disabled:opacity-40`}>
            <ChevronLeft size={16} /> Anterior
          </button>
          <button type="button" disabled={datos.pagina >= ultima} onClick={() => setFiltros({ ...filtros, pagina: filtros.pagina + 1 })} className={`${BOTON_SECUNDARIO} inline-flex items-center gap-1 disabled:opacity-40`}>
            Siguiente <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}

// ---------- Página ----------

export default function Ventas(props: Props) {
  const puedeVender = props.permisos.includes('ventas.crear')
  const puedeVer = props.permisos.includes('ventas.ver')
  const [seccion, setSeccion] = useState<'nueva' | 'historial'>(puedeVender ? 'nueva' : 'historial')
  const [detalle, setDetalle] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  return (
    <div>
      <div className="mb-4">
        <h1 className="mb-1 text-xl font-medium">Ventas</h1>
        <p className="text-sm text-gray-500">Registre ventas de productos y servicios; el inventario se descuenta solo.</p>
      </div>
      {puedeVender && puedeVer && (
        <div className="mb-4 flex gap-1 border-b border-gray-200">
          {(
            [
              ['nueva', 'Nueva venta'],
              ['historial', 'Historial'],
            ] as const
          ).map(([id, nombre]) => (
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
      )}
      {seccion === 'nueva' && puedeVender ? (
        <NuevaVenta {...props} onVerVenta={(id) => setDetalle(id)} />
      ) : (
        <Historial {...props} abrir={(id) => setDetalle(id)} version={version} />
      )}
      {detalle && (
        <Ventana titulo="Detalle de la venta" ancho="max-w-3xl" onCerrar={() => setDetalle(null)}>
          <VerDetalle
            token={props.token}
            id={detalle}
            permisos={props.permisos}
            onCambio={() => setVersion((v) => v + 1)}
            onSesionVencida={props.onSesionVencida}
          />
        </Ventana>
      )}
    </div>
  )
}
