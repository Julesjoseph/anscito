import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, Ban, CalendarClock, CheckCircle2, PackagePlus, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react'
import {
  SesionVencida,
  anularCompra,
  buscarProductosCompra,
  catalogosInventario,
  crearProducto,
  crearTercero,
  buscarProveedoresCompra,
  detalleCompra,
  listarCompras,
  prepararCompras,
  registrarCompra,
  tiposDocumento,
} from './api'
import type {
  AvisoGastoFijo,
  CatalogosInventario,
  DetalleCompra,
  FilaCompra,
  PrepararCompras,
  ProductoCompra,
  ProveedorCompra,
  TipoDocumento,
} from './api'
import { cajaDeEstaComputadora } from './cajaLocal'
import { AREA, BOTON_PELIGRO, BOTON_PRINCIPAL, BOTON_SECUNDARIO, CAMPO, CajaError, SelectorLinea, Ventana } from './componentes'
import { cantidad as verCantidad, dinero, mensajeDe } from './formato'

// Compras: facturas de proveedor. Los productos entran al inventario; de
// contado se paga en el momento (caja o banco) y a crédito queda pendiente.

type Props = {
  token: string
  permisos: string[]
  onSesionVencida: () => void
  // Gasto fijo que se registra (viene del botón de Cuentas por Pagar).
  gastoFijo?: AvisoGastoFijo | null
  onGastoFijoUsado?: () => void
}

const MONTO = /^\d{1,12}(\.\d{1,2})?$/

// Dinero con enteros (centavos) para sumar en pantalla sin errores.
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

// Cantidad (hasta 3 decimales) × costo (2 decimales), redondeado a centavos.
function subtotal(cantidad: string, costo: string): bigint {
  const q = cantidad.trim()
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(q) || !MONTO.test(costo.trim())) return 0n
  const [e, d = ''] = q.split('.')
  const milesimas = BigInt(e) * 1000n + BigInt((d + '000').slice(0, 3))
  return (milesimas * centavos(costo) + 500n) / 1000n
}

function fechaCorta(dia: string | null | undefined): string {
  if (!dia) return '—'
  const [a, m, d] = dia.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function mesTexto(fecha: string): string {
  const [a, m] = fecha.split('-')
  return `${MESES[Number(m) - 1]} ${a}`
}

function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number)
  const x = new Date(Date.UTC(a, m - 1, d + dias))
  return x.toISOString().slice(0, 10)
}

export default function Compras({ token, permisos, onSesionVencida, gastoFijo = null, onGastoFijoUsado }: Props) {
  const puedeRegistrar = permisos.includes('compras.registrar')
  const [pestana, setPestana] = useState<'nueva' | 'lista'>(puedeRegistrar ? 'nueva' : 'lista')
  const [prep, setPrep] = useState<PrepararCompras | null>(null)
  const [error, setError] = useState('')
  const [abierta, setAbierta] = useState<string | null>(null)

  useEffect(() => {
    prepararCompras(token)
      .then(setPrep)
      .catch((e) => {
        if (e instanceof SesionVencida) onSesionVencida()
        else setError(mensajeDe(e))
      })
  }, [token, onSesionVencida])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-medium">Reg. Facturas de Compras y Gastos</h1>
        <p className="text-sm text-gray-500">
          Facturas de proveedor (mercancía, servicios y gastos): los productos entran al inventario y el pago sale de la caja o
          del banco, o queda a crédito.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 border-b border-gray-200">
        {(
          [
            ['nueva', 'Nueva factura', puedeRegistrar],
            ['lista', 'Facturas', true],
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
      ) : pestana === 'nueva' ? (
        <NuevaFactura
          token={token}
          prep={prep}
          permisos={permisos}
          gastoFijo={gastoFijo}
          onGastoFijoUsado={onGastoFijoUsado}
          onVer={setAbierta}
          onSesionVencida={onSesionVencida}
        />
      ) : (
        <Lista token={token} onVer={setAbierta} onSesionVencida={onSesionVencida} />
      )}
      {abierta && prep && (
        <VerCompra
          token={token}
          prep={prep}
          id={abierta}
          puedeAnular={permisos.includes('compras.anular')}
          onCerrar={() => setAbierta(null)}
          onSesionVencida={onSesionVencida}
        />
      )}
    </div>
  )
}

// ---------- Buscador (proveedor o producto) ----------

function Buscador<T extends { id: string }>({
  placeholder,
  buscar,
  mostrar,
  onElegir,
  onSesionVencida,
}: {
  placeholder: string
  buscar: (texto: string) => Promise<T[]>
  mostrar: (x: T) => { titulo: string; detalle: string }
  onElegir: (x: T) => void
  onSesionVencida: () => void
}) {
  const [texto, setTexto] = useState('')
  const [lista, setLista] = useState<T[]>([])
  useEffect(() => {
    const t = texto.trim()
    if (t.length < 2) {
      setLista([])
      return
    }
    let vigente = true
    const espera = setTimeout(() => {
      buscar(t)
        .then((r) => vigente && setLista(r))
        .catch((e) => {
          if (e instanceof SesionVencida) onSesionVencida()
        })
    }, 300)
    return () => {
      vigente = false
      clearTimeout(espera)
    }
  }, [texto, buscar, onSesionVencida])
  return (
    <div className="relative">
      <Search size={16} className="absolute top-3 left-3 text-gray-400" />
      <input
        className={`${CAMPO} w-full pl-9`}
        value={texto}
        placeholder={placeholder}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          // Enter (lo manda el lector de código de barras al final) elige el
          // primero que aparezca, en vez de enviar el formulario de la factura.
          if (e.key !== 'Enter') return
          e.preventDefault()
          const t = texto.trim()
          if (t.length < 2) return
          buscar(t)
            .then((r) => {
              if (r[0]) {
                onElegir(r[0])
                setTexto('')
                setLista([])
              } else setLista([])
            })
            .catch((err) => {
              if (err instanceof SesionVencida) onSesionVencida()
            })
        }}
      />
      {lista.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow">
          {lista.map((x) => {
            const m = mostrar(x)
            return (
              <li key={x.id}>
                <button
                  type="button"
                  className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-gray-50"
                  onClick={() => {
                    onElegir(x)
                    setTexto('')
                    setLista([])
                  }}
                >
                  <span className="font-medium">{m.titulo}</span>
                  <span className="text-xs text-gray-500">{m.detalle}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ---------- Nueva factura ----------

type LineaForm = { producto: ProductoCompra; cantidad: string; costo: string }

function NuevaFactura({
  token,
  prep,
  permisos,
  gastoFijo,
  onGastoFijoUsado,
  onVer,
  onSesionVencida,
}: {
  token: string
  prep: PrepararCompras
  permisos: string[]
  gastoFijo: AvisoGastoFijo | null
  onGastoFijoUsado?: () => void
  onVer: (id: string) => void
  onSesionVencida: () => void
}) {
  const puedeProveedor = permisos.includes('proveedores.crear') && permisos.includes('proveedores.ver')
  const puedeProducto = permisos.includes('inventario.crear') && permisos.includes('inventario.ver')
  const [nuevoProveedor, setNuevoProveedor] = useState(false)
  const [nuevoProducto, setNuevoProducto] = useState(false)
  const local = cajaDeEstaComputadora()
  const [gasto, setGasto] = useState<AvisoGastoFijo | null>(gastoFijo)
  const [proveedor, setProveedor] = useState<ProveedorCompra | null>(
    gastoFijo
      ? { id: gastoFijo.proveedor_id, nombre: gastoFijo.proveedor, nombre_comercial: null, numero_documento: null, dias_credito: null }
      : null,
  )
  const [ncf, setNcf] = useState('')
  const [fecha, setFecha] = useState(prep.hoy)
  const [tipoGasto, setTipoGasto] = useState(gastoFijo?.tipo_gasto ?? '09')
  const [unidad, setUnidad] = useState('')
  const [lineas, setLineas] = useState<LineaForm[]>([])
  const [otrosBienes, setOtrosBienes] = useState('')
  const [servicios, setServicios] = useState(gastoFijo?.monto ?? '')
  const [itbis, setItbis] = useState(gastoFijo?.itbis ?? '')
  const [itbisRetenido, setItbisRetenido] = useState('')
  const [isrRetenido, setIsrRetenido] = useState('')
  const [tipoRetencion, setTipoRetencion] = useState('')
  const [condicion, setCondicion] = useState<'contado' | 'credito'>(gastoFijo ? 'credito' : 'contado')
  const [vencimiento, setVencimiento] = useState(gastoFijo?.fecha ?? '')
  const [forma, setForma] = useState<'efectivo' | 'banco'>('efectivo')
  const [cajaId, setCajaId] = useState(prep.cajas.some((c) => c.id === local && c.sesion_id) ? (local ?? '') : '')
  const [cuentaId, setCuentaId] = useState('')
  const [referencia, setReferencia] = useState('')
  const [descripcion, setDescripcion] = useState(gastoFijo ? `${gastoFijo.nombre} (${mesTexto(gastoFijo.fecha)})` : '')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [hecha, setHecha] = useState<{ id: string; codigo: string; total: string; aPagar: string } | null>(null)

  const buscarProv = useCallback((t: string) => buscarProveedoresCompra(token, t), [token])
  const buscarProd = useCallback((t: string) => buscarProductosCompra(token, t), [token])

  // Totales en pantalla (el servidor vuelve a calcular todo).
  const subLineas = lineas.reduce((a, l) => a + subtotal(l.cantidad, l.costo), 0n)
  const bienes = subLineas + centavos(otrosBienes)
  const total = bienes + centavos(servicios) + centavos(itbis)
  const aPagar = total - centavos(itbisRetenido) - centavos(isrRetenido)

  function elegirProveedor(p: ProveedorCompra) {
    setProveedor(p)
    if (condicion === 'credito' && !vencimiento) setVencimiento(sumarDias(fecha, p.dias_credito ?? 0))
  }

  function quitarGasto() {
    setGasto(null)
    onGastoFijoUsado?.()
  }

  function limpiar() {
    if (gasto) quitarGasto()
    setProveedor(null)
    setNcf('')
    setLineas([])
    setOtrosBienes('')
    setServicios('')
    setItbis('')
    setItbisRetenido('')
    setIsrRetenido('')
    setVencimiento('')
    setReferencia('')
    setDescripcion('')
  }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (!proveedor) return
    setError('')
    setGuardando(true)
    try {
      const r = await registrarCompra(token, {
        proveedorId: proveedor.id,
        ncf,
        fechaComprobante: fecha,
        tipoGasto,
        condicion,
        vencimiento: condicion === 'credito' ? vencimiento : undefined,
        lineas: lineas.map((l) => ({ productoId: l.producto.id, cantidad: l.cantidad.trim(), costoUnitario: l.costo.trim() })),
        otrosBienes,
        servicios,
        itbis,
        itbisRetenido,
        isrRetenido,
        tipoRetencionIsr: centavos(isrRetenido) > 0n ? tipoRetencion : undefined,
        descripcion,
        notas: '',
        gastoFijoId: gasto?.id,
        gastoFijoMes: gasto ? gasto.fecha.slice(0, 7) : undefined,
        unidadNegocioId: unidad || undefined,
        pago:
          condicion === 'contado'
            ? { forma, cajaId: forma === 'efectivo' ? cajaId : undefined, cuentaId: forma === 'banco' ? cuentaId : undefined, referencia: referencia.trim() || undefined }
            : undefined,
      })
      setHecha(r)
      limpiar()
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <>
    <form onSubmit={(e) => void guardar(e)} className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="flex flex-col gap-4 xl:col-span-2">
        {hecha && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            <span className="flex items-center gap-2 font-medium">
              <CheckCircle2 size={18} /> Factura {hecha.codigo} registrada · total {dinero(hecha.total)}
            </span>
            <button type="button" className="underline" onClick={() => onVer(hecha.id)}>
              Ver el detalle
            </button>
          </div>
        )}

        {gasto && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span className="flex items-center gap-2">
              <CalendarClock size={18} /> Factura del gasto fijo <strong>{gasto.nombre}</strong> de {mesTexto(gasto.fecha)} (vence{' '}
              {fechaCorta(gasto.fecha)}). Al registrarla, se apaga su aviso.
            </span>
            <button type="button" className="flex items-center gap-1 text-xs underline" onClick={quitarGasto}>
              <X size={14} /> No es de este gasto fijo
            </button>
          </div>
        )}

        <section className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="font-medium">1. Proveedor y comprobante</h2>
          {proveedor ? (
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
              <span>
                <span className="font-medium">{proveedor.nombre}</span>
                <span className="block text-xs text-gray-500">
                  {proveedor.numero_documento ?? 'Sin RNC/cédula'}
                  {proveedor.dias_credito ? ` · ${proveedor.dias_credito} días de crédito` : ''}
                </span>
              </span>
              <button
                type="button"
                className="text-xs text-[#C8102E] hover:underline"
                onClick={() => {
                  setProveedor(null)
                  if (gasto) quitarGasto()
                }}
              >
                Cambiar
              </button>
            </div>
          ) : (
            <Buscador
              placeholder="Buscar proveedor por nombre o RNC"
              buscar={buscarProv}
              mostrar={(p) => ({ titulo: p.nombre, detalle: p.numero_documento ?? 'Sin RNC/cédula' })}
              onElegir={elegirProveedor}
              onSesionVencida={onSesionVencida}
            />
          )}
          {!proveedor && puedeProveedor && (
            <button type="button" className="flex items-center gap-1 self-start text-sm text-[#C8102E] hover:underline" onClick={() => setNuevoProveedor(true)}>
              <Plus size={16} /> Nuevo proveedor (si no está en la lista)
            </button>
          )}
          {proveedor && !proveedor.numero_documento && (
            <p className="text-xs text-amber-700">Este proveedor no tiene RNC o cédula: la factura no podrá ir al reporte 606.</p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm text-gray-600">
              NCF (opcional)
              <input className={`${CAMPO} font-mono`} value={ncf} onChange={(e) => setNcf(e.target.value.toUpperCase())} placeholder="B0100000123" maxLength={20} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-gray-600">
              Fecha de la factura
              <input type="date" className={CAMPO} value={fecha} max={prep.hoy} onChange={(e) => setFecha(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-gray-600">
              Tipo de gasto (606)
              <select className={CAMPO} value={tipoGasto} onChange={(e) => setTipoGasto(e.target.value)}>
                {prep.tiposGasto.map((t) => (
                  <option key={t.codigo} value={t.codigo}>
                    {t.codigo} · {t.nombre}
                  </option>
                ))}
              </select>
            </label>
            <SelectorLinea unidades={prep.unidadesNegocio} valor={unidad} setValor={setUnidad} />
          </div>
          {!ncf.trim() && <p className="text-xs text-gray-500">Sin NCF la factura no va al 606 ni se puede rebajar su ITBIS.</p>}
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="font-medium">2. Productos para el inventario (opcional)</h2>
          <Buscador
            placeholder="Buscar producto por nombre o código"
            buscar={buscarProd}
            mostrar={(p) => ({ titulo: `${p.nombre} (${p.codigo})`, detalle: `Costo actual ${dinero(p.costo)} · ${p.unidad}` })}
            onElegir={(p) => setLineas([...lineas, { producto: p, cantidad: '1', costo: p.costo }])}
            onSesionVencida={onSesionVencida}
          />
          {puedeProducto && (
            <button type="button" className="flex items-center gap-1 self-start text-sm text-[#C8102E] hover:underline" onClick={() => setNuevoProducto(true)}>
              <Plus size={16} /> Nuevo producto (si todavía no está registrado)
            </button>
          )}
          {lineas.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-gray-500">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Producto</th>
                    <th className="py-1 pr-2 font-medium">Cantidad</th>
                    <th className="py-1 pr-2 font-medium">Costo por unidad (sin ITBIS)</th>
                    <th className="py-1 pr-2 text-right font-medium">Subtotal</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((l, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="py-1.5 pr-2">
                        {l.producto.nombre}
                        <span className="block text-xs text-gray-500">{l.producto.unidad}</span>
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          className={`${CAMPO} w-24`}
                          value={l.cantidad}
                          inputMode="decimal"
                          onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)))}
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          className={`${CAMPO} w-32`}
                          value={l.costo}
                          inputMode="decimal"
                          onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, costo: e.target.value } : x)))}
                        />
                      </td>
                      <td className="py-1.5 pr-2 text-right whitespace-nowrap">{dinero(texto2(subtotal(l.cantidad, l.costo)))}</td>
                      <td className="py-1.5">
                        <button type="button" className="text-gray-400 hover:text-red-700" aria-label={`Quitar ${l.producto.nombre}`} onClick={() => setLineas(lineas.filter((_, j) => j !== i))}>
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="font-medium">3. Otros montos de la factura (sin ITBIS)</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm text-gray-600">
              Otros bienes (RD$)
              <input className={CAMPO} value={otrosBienes} inputMode="decimal" onChange={(e) => setOtrosBienes(e.target.value)} placeholder="0.00" />
              <span className="text-xs text-gray-500">Cosas que no van al inventario (sillas, materiales…)</span>
            </label>
            <label className="flex flex-col gap-1 text-sm text-gray-600">
              Servicios (RD$)
              <input className={CAMPO} value={servicios} inputMode="decimal" onChange={(e) => setServicios(e.target.value)} placeholder="0.00" />
              <span className="text-xs text-gray-500">Luz, internet, alquiler, reparaciones…</span>
            </label>
            <label className="flex flex-col gap-1 text-sm text-gray-600">
              ITBIS de la factura (RD$)
              <input className={CAMPO} value={itbis} inputMode="decimal" onChange={(e) => setItbis(e.target.value)} placeholder="0.00" />
              <span className="text-xs text-gray-500">Cópielo de la factura</span>
            </label>
          </div>
          <details className="text-sm text-gray-600">
            <summary className="cursor-pointer">Retenciones (si usted le retiene al proveedor)</summary>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                ITBIS retenido (RD$)
                <input className={CAMPO} value={itbisRetenido} inputMode="decimal" onChange={(e) => setItbisRetenido(e.target.value)} placeholder="0.00" />
              </label>
              <label className="flex flex-col gap-1">
                ISR retenido (RD$)
                <input className={CAMPO} value={isrRetenido} inputMode="decimal" onChange={(e) => setIsrRetenido(e.target.value)} placeholder="0.00" />
              </label>
              {centavos(isrRetenido) > 0n && (
                <label className="flex flex-col gap-1 sm:col-span-2">
                  Tipo de retención del ISR (lo pide el 606)
                  <select className={CAMPO} value={tipoRetencion} onChange={(e) => setTipoRetencion(e.target.value)}>
                    <option value="">Seleccione…</option>
                    {prep.tiposRetencionIsr.map((t) => (
                      <option key={t.codigo} value={t.codigo}>
                        {t.codigo} · {t.nombre}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <p className="mt-1 text-xs text-amber-700">Cuándo y cuánto retener lo decide su contador.</p>
          </details>
          <label className="flex flex-col gap-1 text-sm text-gray-600">
            Descripción (opcional)
            <textarea className={AREA} rows={2} value={descripcion} maxLength={300} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej.: Factura de luz de octubre" />
          </label>
        </section>
      </div>

      <section className="flex h-fit flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 xl:sticky xl:top-4">
        <h2 className="font-medium">4. Pago</h2>
        <div className="flex gap-4 text-sm">
          {(['contado', 'credito'] as const).map((c) => (
            <label key={c} className="flex items-center gap-2">
              <input
                type="radio"
                checked={condicion === c}
                onChange={() => {
                  setCondicion(c)
                  if (c === 'credito' && !vencimiento) setVencimiento(sumarDias(fecha, proveedor?.dias_credito ?? 0))
                }}
              />
              {c === 'contado' ? 'Contado (pago ahora)' : 'Crédito (pago después)'}
            </label>
          ))}
        </div>
        {condicion === 'contado' ? (
          <>
            <div className="flex gap-4 text-sm">
              {(['efectivo', 'banco'] as const).map((f) => (
                <label key={f} className="flex items-center gap-2">
                  <input type="radio" checked={forma === f} onChange={() => setForma(f)} />
                  {f === 'efectivo' ? 'Efectivo (caja)' : 'Banco / transferencia'}
                </label>
              ))}
            </div>
            {forma === 'efectivo' ? (
              <label className="flex flex-col gap-1 text-sm text-gray-600">
                Caja de donde sale el dinero
                <select className={CAMPO} value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
                  <option value="">Seleccione…</option>
                  {prep.cajas.map((c) => (
                    <option key={c.id} value={c.id} disabled={!c.sesion_id}>
                      {c.nombre}
                      {c.sesion_id ? '' : ' (cerrada)'}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <label className="flex flex-col gap-1 text-sm text-gray-600">
                  Cuenta de donde sale el dinero
                  <select className={CAMPO} value={cuentaId} onChange={(e) => setCuentaId(e.target.value)}>
                    <option value="">Seleccione…</option>
                    {prep.cuentas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-600">
                  Referencia (opcional)
                  <input className={CAMPO} value={referencia} maxLength={60} onChange={(e) => setReferencia(e.target.value)} />
                </label>
              </>
            )}
          </>
        ) : (
          <label className="flex flex-col gap-1 text-sm text-gray-600">
            Vence el
            <input type="date" className={CAMPO} value={vencimiento} min={fecha} onChange={(e) => setVencimiento(e.target.value)} />
            <span className="text-xs text-gray-500">Se paga después desde Cuentas por Pagar.</span>
          </label>
        )}

        <dl className="flex flex-col gap-1 border-t border-gray-100 pt-3 text-sm">
          <div className="flex justify-between"><dt className="text-gray-500">Bienes</dt><dd>{dinero(texto2(bienes))}</dd></div>
          <div className="flex justify-between"><dt className="text-gray-500">Servicios</dt><dd>{dinero(texto2(centavos(servicios)))}</dd></div>
          <div className="flex justify-between"><dt className="text-gray-500">ITBIS</dt><dd>{dinero(texto2(centavos(itbis)))}</dd></div>
          <div className="flex justify-between font-medium"><dt>Total de la factura</dt><dd>{dinero(texto2(total))}</dd></div>
          {aPagar !== total && (
            <div className="flex justify-between text-gray-500"><dt>− Retenciones</dt><dd>{dinero(texto2(total - aPagar))}</dd></div>
          )}
          <div className="flex justify-between text-lg font-medium"><dt>{condicion === 'contado' ? 'Paga ahora' : 'Queda debiendo'}</dt><dd>{dinero(texto2(aPagar))}</dd></div>
        </dl>
        {error && <CajaError>{error}</CajaError>}
        <button type="submit" className={`${BOTON_PRINCIPAL} h-12`} disabled={guardando || !proveedor || total <= 0n || aPagar < 0n || (centavos(isrRetenido) > 0n && !tipoRetencion)}>
          <PackagePlus size={18} /> {guardando ? 'Registrando…' : 'Registrar factura'}
        </button>
      </section>
    </form>
    {nuevoProveedor && (
      <Ventana titulo="Nuevo proveedor" onCerrar={() => setNuevoProveedor(false)}>
        <FormProveedor
          token={token}
          onListo={(p) => {
            setNuevoProveedor(false)
            elegirProveedor(p)
          }}
          onSesionVencida={onSesionVencida}
        />
      </Ventana>
    )}
    {nuevoProducto && (
      <Ventana titulo="Nuevo producto" onCerrar={() => setNuevoProducto(false)} ancho="max-w-lg">
        <FormProducto
          token={token}
          onListo={(p) => {
            setNuevoProducto(false)
            setLineas([...lineas, { producto: p, cantidad: '1', costo: p.costo }])
          }}
          onSesionVencida={onSesionVencida}
        />
      </Ventana>
    )}
    </>
  )
}

// ---------- Proveedor nuevo desde la factura ----------

function FormProveedor({
  token,
  onListo,
  onSesionVencida,
}: {
  token: string
  onListo: (p: ProveedorCompra) => void
  onSesionVencida: () => void
}) {
  const [tipos, setTipos] = useState<TipoDocumento[]>([])
  const [tipoId, setTipoId] = useState('')
  const [numero, setNumero] = useState('')
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [dias, setDias] = useState('')
  const [contribuyente, setContribuyente] = useState(true)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    tiposDocumento('proveedores', token)
      .then((t) => {
        setTipos(t)
        setTipoId(t.find((x) => x.codigo === 'rnc')?.id ?? '')
      })
      .catch((e) => {
        if (e instanceof SesionVencida) onSesionVencida()
        else setError(mensajeDe(e))
      })
  }, [token, onSesionVencida])

  const tipo = tipos.find((t) => t.id === tipoId)

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      const r = await crearTercero('proveedores', token, {
        tipoDocumentoId: numero.trim() ? tipoId : '',
        numeroDocumento: numero,
        nombre,
        nombreComercial: '',
        esContribuyente: contribuyente && !!numero.trim(),
        direccion: '',
        telefono,
        whatsapp: '',
        correo: '',
        notas: 'Registrado desde Compras',
        puedeCredito: false,
        personaContacto: '',
        diasCredito: dias,
      })
      onListo({
        id: r.id,
        nombre: nombre.trim(),
        nombre_comercial: null,
        numero_documento: numero.trim() ? numero.replace(/[\s.\-/]/g, '').toUpperCase() : null,
        dias_credito: dias.trim() ? Number(dias) : null,
      })
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={(e) => void guardar(e)} className="flex flex-col gap-3 text-sm">
      <label className="flex flex-col gap-1 text-gray-600">
        Nombre o razón social
        <input className={CAMPO} value={nombre} maxLength={150} onChange={(e) => setNombre(e.target.value)} autoFocus />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-gray-600">
          Documento
          <select className={CAMPO} value={tipoId} onChange={(e) => setTipoId(e.target.value)}>
            {tipos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-gray-600">
          Número (recomendado)
          <input className={`${CAMPO} font-mono`} value={numero} inputMode="numeric" onChange={(e) => setNumero(e.target.value)} />
          {tipo && <span className="text-xs text-gray-500">{tipo.ayuda}</span>}
        </label>
        <label className="flex flex-col gap-1 text-gray-600">
          Teléfono (opcional)
          <input className={CAMPO} value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="809-555-1234" />
        </label>
        <label className="flex flex-col gap-1 text-gray-600">
          Días de crédito (opcional)
          <input className={CAMPO} value={dias} inputMode="numeric" onChange={(e) => setDias(e.target.value)} placeholder="Ej.: 30" />
        </label>
      </div>
      <label className="flex items-center gap-2 text-gray-700">
        <input type="checkbox" checked={contribuyente} onChange={(e) => setContribuyente(e.target.checked)} />
        Es contribuyente (da factura con NCF)
      </label>
      {!numero.trim() && <p className="text-xs text-amber-700">Sin RNC o cédula, sus facturas no podrán ir al reporte 606.</p>}
      {error && <CajaError>{error}</CajaError>}
      <button type="submit" className={BOTON_PRINCIPAL} disabled={guardando || !nombre.trim()}>
        {guardando ? 'Guardando…' : 'Guardar y usar en esta factura'}
      </button>
      <p className="text-xs text-gray-500">El proveedor queda también en la lista de Proveedores.</p>
    </form>
  )
}

// ---------- Producto nuevo desde la factura ----------

function FormProducto({
  token,
  onListo,
  onSesionVencida,
}: {
  token: string
  onListo: (p: ProductoCompra) => void
  onSesionVencida: () => void
}) {
  const [cat, setCat] = useState<CatalogosInventario | null>(null)
  const [nombre, setNombre] = useState('')
  const [categoriaId, setCategoriaId] = useState('')
  const [unidadId, setUnidadId] = useState('')
  const [impuestoId, setImpuestoId] = useState('')
  const [costo, setCosto] = useState('')
  const [precio, setPrecio] = useState('')
  const [incluye, setIncluye] = useState(false)
  const [minimo, setMinimo] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    catalogosInventario(token)
      .then((c) => {
        setCat(c)
        setUnidadId(c.unidades.find((u) => u.codigo === 'unidad')?.id ?? c.unidades[0]?.id ?? '')
        setImpuestoId(c.impuestos.find((i) => i.codigo === 'itbis')?.id ?? c.impuestos[0]?.id ?? '')
      })
      .catch((e) => {
        if (e instanceof SesionVencida) onSesionVencida()
        else setError(mensajeDe(e))
      })
  }, [token, onSesionVencida])

  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (!cat) return
    setError('')
    setGuardando(true)
    try {
      const r = await crearProducto(token, {
        nombre,
        categoriaId,
        unidadId,
        costo,
        impuestoId,
        precioVenta: precio,
        precioIncluyeItbis: incluye,
        stockMinimo: minimo,
      })
      const u = cat.unidades.find((x) => x.id === unidadId)
      onListo({
        id: r.id,
        codigo: r.codigo,
        nombre: nombre.trim(),
        costo: costo.trim(),
        unidad: u?.nombre ?? '',
        permite_decimales: u?.permite_decimales ?? false,
      })
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    } finally {
      setGuardando(false)
    }
  }

  if (!cat) return error ? <CajaError>{error}</CajaError> : <p className="text-sm text-gray-500">Cargando…</p>

  return (
    <form onSubmit={(e) => void guardar(e)} className="flex flex-col gap-3 text-sm">
      <label className="flex flex-col gap-1 text-gray-600">
        Nombre del producto
        <input className={CAMPO} value={nombre} maxLength={150} onChange={(e) => setNombre(e.target.value)} autoFocus />
      </label>
      <label className="flex flex-col gap-1 text-gray-600">
        Categoría
        <select className={CAMPO} value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
          <option value="">Seleccione…</option>
          {cat.categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.unidad_negocio} · {c.nombre}
            </option>
          ))}
        </select>
        {cat.categorias.length === 0 && <span className="text-xs text-amber-700">No hay categorías: créelas primero en Categorías.</span>}
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-gray-600">
          Unidad
          <select className={CAMPO} value={unidadId} onChange={(e) => setUnidadId(e.target.value)}>
            {cat.unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-gray-600">
          Impuesto al vender
          <select className={CAMPO} value={impuestoId} onChange={(e) => setImpuestoId(e.target.value)}>
            {cat.impuestos.map((i) => (
              <option key={i.id} value={i.id}>
                {i.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-gray-600">
          Costo por unidad (sin ITBIS)
          <input className={CAMPO} value={costo} inputMode="decimal" onChange={(e) => setCosto(e.target.value)} placeholder="0.00" />
        </label>
        <label className="flex flex-col gap-1 text-gray-600">
          Precio de venta (opcional)
          <input className={CAMPO} value={precio} inputMode="decimal" onChange={(e) => setPrecio(e.target.value)} placeholder="0.00" />
        </label>
        <label className="flex flex-col gap-1 text-gray-600">
          Stock mínimo (opcional)
          <input className={CAMPO} value={minimo} inputMode="decimal" onChange={(e) => setMinimo(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-gray-700">
          <input type="checkbox" checked={incluye} onChange={(e) => setIncluye(e.target.checked)} />
          El precio ya incluye ITBIS
        </label>
      </div>
      <p className="text-xs text-gray-500">Se crea con existencia 0: la cantidad entra con esta factura.</p>
      {error && <CajaError>{error}</CajaError>}
      <button type="submit" className={BOTON_PRINCIPAL} disabled={guardando || !nombre.trim() || !categoriaId || !MONTO.test(costo.trim())}>
        {guardando ? 'Guardando…' : 'Guardar y agregar a la factura'}
      </button>
    </form>
  )
}

// ---------- Lista ----------

function Lista({ token, onVer, onSesionVencida }: { token: string; onVer: (id: string) => void; onSesionVencida: () => void }) {
  const [f, setF] = useState({ texto: '', desde: '', hasta: '', estado: '', pagina: 1 })
  const [datos, setDatos] = useState<{ filas: FilaCompra[]; total: number; porPagina: number } | null>(null)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    setError('')
    try {
      setDatos(await listarCompras(token, f))
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
  const cambiar = (x: Partial<typeof f>) => setF({ ...f, ...x, pagina: x.pagina ?? 1 })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <input className={`${CAMPO} min-w-0 flex-1 sm:max-w-xs`} type="search" value={f.texto} onChange={(e) => cambiar({ texto: e.target.value })} placeholder="Proveedor, RNC, NCF o número" />
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Desde
          <input type="date" className={CAMPO} value={f.desde} onChange={(e) => cambiar({ desde: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Hasta
          <input type="date" className={CAMPO} value={f.hasta} onChange={(e) => cambiar({ hasta: e.target.value })} />
        </label>
        <select className={CAMPO} value={f.estado} onChange={(e) => cambiar({ estado: e.target.value })} aria-label="Estado">
          <option value="">Todas</option>
          <option value="pendientes">Con saldo pendiente</option>
          <option value="registradas">Registradas</option>
          <option value="anuladas">Anuladas</option>
        </select>
        <button type="button" className={BOTON_SECUNDARIO} onClick={() => void cargar()}>
          <span className="flex items-center gap-2">
            <RefreshCw size={16} /> Actualizar
          </span>
        </button>
      </div>
      {error && <CajaError>{error}</CajaError>}
      {!datos ? (
        !error && <p className="text-sm text-gray-500">Cargando…</p>
      ) : datos.filas.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">No hay facturas con esos filtros.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Factura</th>
                <th className="px-3 py-2 font-medium">Proveedor</th>
                <th className="px-3 py-2 font-medium">NCF</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 text-right font-medium">Saldo</th>
                <th className="px-3 py-2 font-medium">Vence</th>
              </tr>
            </thead>
            <tbody>
              {datos.filas.map((x) => (
                <tr key={x.id} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50" onClick={() => onVer(x.id)}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="font-medium">{x.codigo}</div>
                    <div className="text-xs text-gray-500">{fechaCorta(x.fecha)}</div>
                  </td>
                  <td className="px-3 py-2">{x.proveedor}</td>
                  <td className="px-3 py-2 font-mono text-xs">{x.ncf ?? '—'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{dinero(x.total)}</td>
                  <td className={`px-3 py-2 text-right whitespace-nowrap ${x.estado === 'anulada' ? 'text-gray-400' : x.saldo !== '0.00' ? 'font-medium text-amber-700' : 'text-green-700'}`}>
                    {x.estado === 'anulada' ? 'Anulada' : x.saldo === '0.00' ? 'Pagada' : dinero(x.saldo)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{x.condicion === 'credito' ? fechaCorta(x.vencimiento) : 'Contado'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {datos && paginas > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button type="button" className={BOTON_SECUNDARIO} disabled={f.pagina <= 1} onClick={() => cambiar({ pagina: f.pagina - 1 })}>
            Anterior
          </button>
          <span>
            Página {f.pagina} de {paginas}
          </span>
          <button type="button" className={BOTON_SECUNDARIO} disabled={f.pagina >= paginas} onClick={() => cambiar({ pagina: f.pagina + 1 })}>
            Siguiente
          </button>
        </div>
      )}
    </div>
  )
}

// ---------- Detalle y anulación ----------

function VerCompra({
  token,
  prep,
  id,
  puedeAnular,
  onCerrar,
  onSesionVencida,
}: {
  token: string
  prep: PrepararCompras
  id: string
  puedeAnular: boolean
  onCerrar: () => void
  onSesionVencida: () => void
}) {
  const local = cajaDeEstaComputadora()
  const [d, setD] = useState<DetalleCompra | null>(null)
  const [error, setError] = useState('')
  const [anulando, setAnulando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [cajaId, setCajaId] = useState(prep.cajas.some((c) => c.id === local && c.sesion_id) ? (local ?? '') : '')
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      setD(await detalleCompra(token, id))
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, id, onSesionVencida])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Solo el pago de contado vuelve a la caja al anular (los de Cuentas por Pagar se anulan allá).
  const pagoEfectivo = d?.pagos.some((p) => p.forma === 'efectivo' && !p.comprobante) ?? false

  async function anular(e: FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      await anularCompra(token, id, { motivo, cajaId: pagoEfectivo ? cajaId : undefined })
      setAnulando(false)
      await cargar()
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Ventana titulo={d ? `Factura ${d.codigo}` : 'Factura'} onCerrar={onCerrar} ancho="max-w-3xl">
      {!d ? (
        error ? <CajaError>{error}</CajaError> : <p className="text-sm text-gray-500">Cargando…</p>
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          {d.estado === 'anulada' && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
              Anulada el {d.anulada_en && new Date(d.anulada_en).toLocaleString('es-DO')} por {d.anulada_por_usuario}. Motivo: {d.motivo_anulacion}
            </div>
          )}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            <div><dt className="text-xs text-gray-500">Proveedor</dt><dd>{d.proveedor} {d.proveedor_documento && <span className="text-gray-500">· {d.proveedor_documento}</span>}</dd></div>
            <div><dt className="text-xs text-gray-500">NCF</dt><dd className="font-mono">{d.ncf ?? 'Sin NCF'}</dd></div>
            <div><dt className="text-xs text-gray-500">Fecha</dt><dd>{fechaCorta(d.fecha)}</dd></div>
            <div><dt className="text-xs text-gray-500">Tipo de gasto</dt><dd>{d.tipo_gasto} · {d.tipo_gasto_nombre}</dd></div>
            <div><dt className="text-xs text-gray-500">Condición</dt><dd>{d.condicion === 'contado' ? 'Contado' : `Crédito · vence ${fechaCorta(d.vence)}`}</dd></div>
            <div><dt className="text-xs text-gray-500">Registró</dt><dd>{d.registrada_por} · {new Date(d.created_at).toLocaleString('es-DO')}</dd></div>
            {d.descripcion && <div className="sm:col-span-2"><dt className="text-xs text-gray-500">Descripción</dt><dd>{d.descripcion}</dd></div>}
          </dl>

          {d.lineas.length > 0 && (
            <table className="w-full text-left">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th className="py-1 pr-2 font-medium">Producto</th>
                  <th className="py-1 pr-2 text-right font-medium">Cantidad</th>
                  <th className="py-1 pr-2 text-right font-medium">Costo</th>
                  <th className="py-1 text-right font-medium">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {d.lineas.map((l) => (
                  <tr key={l.id} className="border-t border-gray-100">
                    <td className="py-1 pr-2">{l.nombre} <span className="text-xs text-gray-500">({l.codigo})</span></td>
                    <td className="py-1 pr-2 text-right">{verCantidad(l.cantidad)} {l.unidad.toLowerCase()}</td>
                    <td className="py-1 pr-2 text-right">{dinero(l.costo_unitario)}</td>
                    <td className="py-1 text-right">{dinero(l.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <dl className="ml-auto flex w-full max-w-xs flex-col gap-1">
            <div className="flex justify-between"><dt className="text-gray-500">Bienes</dt><dd>{dinero(d.monto_bienes)}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Servicios</dt><dd>{dinero(d.monto_servicios)}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">ITBIS</dt><dd>{dinero(d.itbis)}</dd></div>
            <div className="flex justify-between font-medium"><dt>Total</dt><dd>{dinero(d.total)}</dd></div>
            {d.itbis_retenido !== '0.00' && <div className="flex justify-between text-gray-500"><dt>− ITBIS retenido</dt><dd>{dinero(d.itbis_retenido)}</dd></div>}
            {d.isr_retenido !== '0.00' && <div className="flex justify-between text-gray-500"><dt>− ISR retenido</dt><dd>{dinero(d.isr_retenido)}</dd></div>}
            <div className="flex justify-between"><dt className="text-gray-500">A pagar</dt><dd>{dinero(d.a_pagar)}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Pagado</dt><dd>{dinero(d.pagado)}</dd></div>
            <div className={`flex justify-between text-base font-medium ${d.saldo === '0.00' ? 'text-green-700' : 'text-amber-700'}`}><dt>Saldo</dt><dd>{dinero(d.saldo)}</dd></div>
          </dl>

          {d.pagos.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="font-medium">Pagos</div>
              {d.pagos.map((p) => (
                <div key={p.id} className={`flex justify-between gap-2 ${p.vigente ? 'text-gray-600' : 'text-gray-400 line-through'}`}>
                  <span>
                    {p.comprobante ? `${p.comprobante} · ` : ''}
                    {fechaCorta(p.fecha)} · {p.forma === 'efectivo' ? 'Efectivo' : 'Banco'} · {p.origen ?? ''}{p.referencia ? ` · ref. ${p.referencia}` : ''} · {p.usuario}
                    {!p.vigente && ' (pago anulado)'}
                  </span>
                  <span>{dinero(p.monto)}</span>
                </div>
              ))}
            </div>
          )}

          {error && <CajaError>{error}</CajaError>}

          {puedeAnular && d.estado === 'registrada' &&
            (anulando ? (
              <form onSubmit={(e) => void anular(e)} className="flex flex-col gap-2 rounded-lg border border-red-200 p-3">
                <p className="flex items-center gap-2 text-red-800">
                  <AlertTriangle size={16} /> La mercancía sale del inventario y el dinero pagado vuelve a donde salió.
                </p>
                <input className={CAMPO} value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo de la anulación" autoFocus />
                {pagoEfectivo && (
                  <select className={CAMPO} value={cajaId} onChange={(e) => setCajaId(e.target.value)} aria-label="Caja donde vuelve el efectivo">
                    <option value="">Caja donde vuelve el efectivo…</option>
                    {prep.cajas.map((c) => (
                      <option key={c.id} value={c.id} disabled={!c.sesion_id}>
                        {c.nombre}
                        {c.sesion_id ? '' : ' (cerrada)'}
                      </option>
                    ))}
                  </select>
                )}
                <div className="flex gap-2">
                  <button type="submit" className={BOTON_PELIGRO} disabled={guardando || motivo.trim().length < 5 || (pagoEfectivo && !cajaId)}>
                    <Ban size={16} /> {guardando ? 'Anulando…' : 'Anular factura'}
                  </button>
                  <button type="button" className={BOTON_SECUNDARIO} onClick={() => setAnulando(false)}>
                    Volver
                  </button>
                </div>
              </form>
            ) : (
              <button type="button" className={`${BOTON_PELIGRO} self-start`} onClick={() => setAnulando(true)}>
                <Ban size={16} /> Anular
              </button>
            ))}
        </div>
      )}
    </Ventana>
  )
}
