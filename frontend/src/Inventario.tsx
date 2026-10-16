import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ArrowDownToLine,
  ArrowUpFromLine,
  History,
  MoreHorizontal,
  PackageX,
  Scale,
  Wrench,
  ChevronLeft,
  ChevronRight,
  Info,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Search,
} from 'lucide-react'
import {
  SesionVencida,
  calcularMonto,
  cambiarEstadoProducto,
  catalogosInventario,
  crearProducto,
  editarProducto,
  listarProductos,
} from './api'
import type {
  CatalogosInventario,
  FilaProducto,
  FiltrosProductos,
  PaginaProductos,
} from './api'
import Categorias from './Categorias'
import {
  AREA,
  BOTON_PELIGRO,
  BOTON_PRINCIPAL,
  BOTON_SECUNDARIO,
  CAMPO,
  CajaError,
  Ventana,
} from './componentes'
import { cantidad, dinero, mensajeDe, porcentaje } from './formato'
import { montoValido } from './itbis'
import VistaItbis from './VistaItbis'
import {
  FormAjuste,
  FormCorregirCosto,
  FormEntrada,
  FormSalida,
  VerKardex,
} from './Movimientos'

type Props = {
  token: string
  permisos: string[]
  onSesionVencida: () => void
}

type Modal =
  | { tipo: 'crear' }
  | { tipo: 'editar'; fila: FilaProducto }
  | { tipo: 'estado'; fila: FilaProducto }
  | { tipo: 'entrada'; fila: FilaProducto }
  | { tipo: 'salida'; fila: FilaProducto }
  | { tipo: 'ajuste'; fila: FilaProducto }
  | { tipo: 'kardex'; fila: FilaProducto }
  | { tipo: 'costo'; fila: FilaProducto }
  | null

const AVISO_FISCAL =
  'El costo se registra sin ITBIS. Que un producto sea "Exento" no significa que quede libre de obligaciones fiscales: confirme con su contador qué productos llevan ITBIS y el tratamiento del ITBIS pagado en compras.'

const CANTIDAD = /^\d{1,11}(\.\d{1,3})?$/

function itbisTexto(tasa: string | null): string {
  if (tasa === null) return '—'
  return Number(tasa) === 0 ? 'Exento' : porcentaje(tasa)
}

// ---------- Formulario crear / editar ----------

function FormProducto({
  token,
  catalogos,
  fila,
  verCostos,
  minimoPorDefecto,
  onListo,
  onCancelar,
  onSesionVencida,
}: {
  token: string
  catalogos: CatalogosInventario
  fila?: FilaProducto
  verCostos: boolean
  minimoPorDefecto: string
  onListo: (codigo?: string) => void
  onCancelar: () => void
  onSesionVencida: () => void
}) {
  const [nombre, setNombre] = useState(fila?.nombre ?? '')
  const [categoriaId, setCategoriaId] = useState(fila?.categoria_id ?? '')
  const [unidadId, setUnidadId] = useState(fila?.unidad_id ?? '')
  const [existencia, setExistencia] = useState('')
  const [costo, setCosto] = useState(fila?.costo ?? '')
  const [impuestoId, setImpuestoId] = useState(fila?.impuesto_id ?? '')
  const [precio, setPrecio] = useState(fila?.precio_venta ?? '')
  const [incluye, setIncluye] = useState(fila?.precio_incluye_itbis ?? false)
  const [stockMinimo, setStockMinimo] = useState(
    fila?.stock_minimo ? cantidad(fila.stock_minimo) : '',
  )
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  // Al crear, el costo siempre se escribe; al editar, solo con ver_costos.
  const mostrarCosto = !fila || verCostos
  // Con movimientos, el costo lo calculan las entradas (se corrige aparte).
  const costoBloqueado =
    fila !== undefined &&
    (Number(fila.existencia_inicial) > 0 ||
      Number(fila.entradas) > 0 ||
      Number(fila.salidas) > 0)
  const categoria = catalogos.categorias.find((c) => c.id === categoriaId)
  const unidad = catalogos.unidades.find((u) => u.id === unidadId)
  const impuesto = catalogos.impuestos.find((i) => i.id === impuestoId)

  const verificar = useCallback(
    (monto: string, conItbis: boolean) =>
      calcularMonto(token, { monto, impuestoId, incluyeItbis: conItbis }),
    [token, impuestoId],
  )

  function cantidadMal(v: string): string {
    if (v.trim() === '') return ''
    if (!CANTIDAD.test(v.trim())) return 'Use solo números y punto (ej: 10 o 2.5)'
    if (unidad && !unidad.permite_decimales && v.includes('.') && !/\.0*$/.test(v.trim())) {
      return `La unidad "${unidad.nombre}" no admite decimales`
    }
    return ''
  }

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    const datos = {
      nombre,
      categoriaId,
      unidadId,
      costo: mostrarCosto ? costo.trim() : (fila?.costo ?? '0'),
      impuestoId,
      precioVenta: precio.trim(),
      precioIncluyeItbis: incluye,
      stockMinimo: stockMinimo.trim(),
    }
    try {
      if (fila) {
        await editarProducto(token, fila.id, datos)
        onListo()
      } else {
        const r = await crearProducto(token, {
          ...datos,
          existenciaInicial: existencia.trim(),
        })
        onListo(r.codigo)
      }
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    } finally {
      setGuardando(false)
    }
  }

  // Categorías agrupadas por unidad de negocio.
  const grupos = new Map<string, typeof catalogos.categorias>()
  for (const c of catalogos.categorias) {
    grupos.set(c.unidad_negocio, [...(grupos.get(c.unidad_negocio) ?? []), c])
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      {fila ? (
        <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
          <div>
            Código <span className="font-mono font-medium text-gray-900">{fila.codigo}</span>{' '}
            · no se puede cambiar.
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              En stock:{' '}
              <span className="font-medium text-gray-900">
                {cantidad(fila.existencia)} {fila.unidad.toLowerCase()}
              </span>
            </span>
            <span>Existencia inicial: {cantidad(fila.existencia_inicial)}</span>
            <span>Mínimo: {cantidad(fila.minimo)}</span>
            {fila.alerta === 'agotado' && (
              <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">
                <PackageX size={12} /> Agotado
              </span>
            )}
            {fila.alerta === 'bajo' && (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                <AlertTriangle size={12} /> Stock bajo
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500">
            El stock no se escribe a mano: cambia solo con las entradas,
            salidas y ventas que se registren.
          </div>
        </div>
      ) : (
        <div className="flex gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
          <Info size={16} className="mt-0.5 shrink-0" />
          <span>
            El código se genera al guardar
            {categoria?.proximo && (
              <>
                {' '}
                (próximo en esta categoría:{' '}
                <span className="font-mono font-medium text-gray-900">
                  {categoria.proximo}
                </span>
                )
              </>
            )}
            .
          </span>
        </div>
      )}

      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Nombre del producto
        <input
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej: Cuaderno 100 hojas"
          className={CAMPO}
        />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Categoría
          <select
            value={categoriaId}
            onChange={(e) => {
              setCategoriaId(e.target.value)
              // El impuesto sugerido por la categoría (se puede cambiar).
              const sugerido = catalogos.categorias.find((c) => c.id === e.target.value)?.impuesto_id
              if (sugerido && catalogos.impuestos.some((i) => i.id === sugerido)) setImpuestoId(sugerido)
            }}
            className={CAMPO}
          >
            <option value="">Seleccione…</option>
            {[...grupos.entries()].map(([unidadNegocio, lista]) => (
              <optgroup key={unidadNegocio} label={unidadNegocio}>
                {lista.map((c) => (
                  <option
                    key={c.id}
                    value={c.id}
                    disabled={!fila && !c.prefijo}
                  >
                    {c.nombre}
                    {c.prefijo ? ` (${c.prefijo})` : ' (sin prefijo)'}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {!fila && !catalogos.categorias.some((c) => c.prefijo) ? (
            <span className="text-xs text-amber-700">
              {catalogos.categorias.length === 0
                ? 'Todavía no hay categorías activas. '
                : 'Ninguna categoría tiene prefijo todavía. '}
              Créela o edítela en la pestaña Categorías (o en el menú
              Categorías) y asígnele un prefijo, por ejemplo BEB.
            </span>
          ) : (
            !fila &&
            catalogos.categorias.some((c) => !c.prefijo) && (
              <span className="text-xs text-gray-400">
                Las categorías sin prefijo no se pueden usar hasta asignarles
                uno en la pestaña Categorías.
              </span>
            )
          )}
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Unidad
          <select
            value={unidadId}
            onChange={(e) => setUnidadId(e.target.value)}
            className={CAMPO}
          >
            <option value="">Seleccione…</option>
            {catalogos.unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
                {u.permite_decimales ? ' (admite decimales)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!fila && (
          <label className="flex flex-col gap-1 text-sm text-gray-600">
            Existencia inicial (opcional)
            <input
              type="text"
              inputMode="decimal"
              value={existencia}
              onChange={(e) => setExistencia(e.target.value)}
              placeholder="0"
              className={CAMPO}
            />
            {cantidadMal(existencia) && (
              <span className="text-xs text-red-600">{cantidadMal(existencia)}</span>
            )}
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Stock mínimo (opcional)
          <input
            type="text"
            inputMode="decimal"
            value={stockMinimo}
            onChange={(e) => setStockMinimo(e.target.value)}
            placeholder={`Vacío = ${minimoPorDefecto}`}
            className={CAMPO}
          />
          <span className="text-xs text-gray-400">
            Alerta cuando queden esta cantidad o menos.
          </span>
          {cantidadMal(stockMinimo) && (
            <span className="text-xs text-red-600">{cantidadMal(stockMinimo)}</span>
          )}
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          ITBIS
          <select
            value={impuestoId}
            onChange={(e) => setImpuestoId(e.target.value)}
            className={CAMPO}
          >
            <option value="">Seleccione…</option>
            {catalogos.impuestos.map((i) => (
              <option key={i.id} value={i.id}>
                {i.nombre} ({porcentaje(i.tasa)})
              </option>
            ))}
          </select>
        </label>
        {mostrarCosto && (
          <label className="flex flex-col gap-1 text-sm text-gray-600">
            Costo (DOP, sin ITBIS)
            <input
              type="text"
              inputMode="decimal"
              value={costo}
              onChange={(e) => setCosto(e.target.value)}
              disabled={costoBloqueado}
              placeholder="0.00"
              className={`${CAMPO} disabled:bg-gray-100 disabled:text-gray-500`}
            />
            {costoBloqueado && (
              <span className="text-xs text-gray-500">
                Es el costo promedio: lo calculan las entradas. Si hay un error,
                use "Corregir costo" en el menú ⋯ del producto.
              </span>
            )}
            {costo.trim() !== '' && !montoValido(costo) && (
              <span className="text-xs text-red-600">
                Use solo números y punto, con hasta 2 decimales
              </span>
            )}
          </label>
        )}
      </div>

      {mostrarCosto && impuesto && (
        <VistaItbis
          titulo="Costo como en la factura del proveedor"
          etiquetas={['Costo (sin ITBIS)', 'ITBIS', 'Costo con ITBIS']}
          monto={costo}
          tasa={impuesto.tasa}
          incluye={false}
          verificar={verificar}
          onSesionVencida={onSesionVencida}
        />
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Precio de venta (opcional)
          <input
            type="text"
            inputMode="decimal"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            placeholder="0.00"
            className={CAMPO}
          />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={incluye}
            onChange={(e) => setIncluye(e.target.checked)}
            className="h-4 w-4 accent-[#C8102E]"
          />
          El precio ya incluye ITBIS
        </label>
      </div>

      {impuesto && precio.trim() !== '' && (
        <VistaItbis
          titulo="Precio para el cliente"
          etiquetas={['Base', 'ITBIS', 'Total cliente']}
          monto={precio}
          tasa={impuesto.tasa}
          incluye={incluye}
          verificar={verificar}
          onSesionVencida={onSesionVencida}
        />
      )}

      <p className="text-xs text-gray-500">{AVISO_FISCAL}</p>

      {error && <CajaError>{error}</CajaError>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className={BOTON_SECUNDARIO}>
          Cancelar
        </button>
        <button type="submit" disabled={guardando} className={BOTON_PRINCIPAL}>
          {guardando ? 'Guardando…' : fila ? 'Guardar cambios' : 'Crear producto'}
        </button>
      </div>
    </form>
  )
}

// ---------- Producto creado: muestra el código asignado ----------

function CodigoAsignado({
  codigo,
  onOtro,
  onCerrar,
}: {
  codigo: string
  onOtro: () => void
  onCerrar: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-2 text-center">
      <CheckCircle2 size={40} className="text-green-600" />
      <div>
        <div className="text-sm text-gray-500">Producto creado con el código</div>
        <div className="mt-1 font-mono text-3xl font-medium tracking-wider">
          {codigo}
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onCerrar} className={BOTON_SECUNDARIO}>
          Listo
        </button>
        <button type="button" onClick={onOtro} className={BOTON_PRINCIPAL}>
          <Plus size={16} />
          Crear otro
        </button>
      </div>
    </div>
  )
}

// ---------- Activar / desactivar ----------

function ConfirmarEstado({
  token,
  fila,
  onListo,
  onCancelar,
  onSesionVencida,
}: {
  token: string
  fila: FilaProducto
  onListo: () => void
  onCancelar: () => void
  onSesionVencida: () => void
}) {
  const activar = !fila.is_active
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function confirmar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      await cambiarEstadoProducto(token, fila.id, activar, motivo.trim() || undefined)
      onListo()
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={confirmar} className="flex flex-col gap-4">
      <p className="text-sm text-gray-600">
        {activar
          ? `¿Activar ${fila.codigo} - ${fila.nombre}?`
          : `¿Desactivar ${fila.codigo} - ${fila.nombre}? Dejará de aparecer en la lista, pero no se borra: conserva su código y su historial.`}
      </p>
      {!activar && (
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Motivo
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            className={AREA}
          />
        </label>
      )}
      {error && <CajaError>{error}</CajaError>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className={BOTON_SECUNDARIO}>
          Cancelar
        </button>
        <button
          type="submit"
          disabled={guardando}
          className={activar ? BOTON_PRINCIPAL : BOTON_PELIGRO}
        >
          {!activar && <AlertTriangle size={16} />}
          {guardando ? 'Guardando…' : activar ? 'Activar' : 'Desactivar'}
        </button>
      </div>
    </form>
  )
}

// ---------- Acciones de cada producto ----------

function Acciones({
  fila,
  permisos,
  puedeEditar,
  onAbrir,
}: {
  fila: FilaProducto
  permisos: string[]
  puedeEditar: boolean
  onAbrir: (m: Modal) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const activo = fila.is_active
  const entradas = activo && permisos.includes('inventario.entradas')
  const salidas = activo && permisos.includes('inventario.salidas')
  const ajustar = activo && permisos.includes('inventario.ajustar')
  const corregir = ajustar && permisos.includes('inventario.ver_costos')
  const estado = permisos.includes('inventario.desactivar')

  function elegir(m: Modal) {
    setAbierto(false)
    onAbrir(m)
  }

  const opcion =
    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50'

  return (
    <div className="relative inline-flex items-center gap-1">
      {entradas && (
        <button
          type="button"
          onClick={() => onAbrir({ tipo: 'entrada', fila })}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          title="Registrar mercancía recibida"
        >
          <ArrowDownToLine size={14} className="text-green-700" /> Entrada
        </button>
      )}
      {salidas && (
        <button
          type="button"
          onClick={() => onAbrir({ tipo: 'salida', fila })}
          disabled={Number(fila.existencia) <= 0}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          title="Registrar daño, vencido, consumo o devolución"
        >
          <ArrowUpFromLine size={14} className="text-red-700" /> Salida
        </button>
      )}
      <button
        type="button"
        onClick={() => setAbierto(!abierto)}
        className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
        aria-label={`Más acciones de ${fila.codigo}`}
      >
        <MoreHorizontal size={18} />
      </button>
      {abierto && (
        <>
          {/* Capa invisible: un clic fuera cierra el menú. */}
          <button
            type="button"
            aria-label="Cerrar menú"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setAbierto(false)}
          />
          <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
            <button type="button" className={opcion} onClick={() => elegir({ tipo: 'kardex', fila })}>
              <History size={14} /> Ver kárdex (historial)
            </button>
            {ajustar && (
              <button type="button" className={opcion} onClick={() => elegir({ tipo: 'ajuste', fila })}>
                <Scale size={14} /> Ajustar por conteo
              </button>
            )}
            {corregir && (
              <button type="button" className={opcion} onClick={() => elegir({ tipo: 'costo', fila })}>
                <Wrench size={14} /> Corregir costo
              </button>
            )}
            {puedeEditar && (
              <button type="button" className={opcion} onClick={() => elegir({ tipo: 'editar', fila })}>
                <Pencil size={14} /> Editar producto
              </button>
            )}
            {estado && (
              <button type="button" className={opcion} onClick={() => elegir({ tipo: 'estado', fila })}>
                {activo ? <PowerOff size={14} /> : <Power size={14} />}
                {activo ? 'Desactivar' : 'Activar'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ---------- Pestaña Productos ----------

function Productos({ token, permisos, onSesionVencida }: Props) {
  const [catalogos, setCatalogos] = useState<CatalogosInventario | null>(null)
  const [datos, setDatos] = useState<PaginaProductos | null>(null)
  const [filtros, setFiltros] = useState<FiltrosProductos>({
    texto: '',
    categoriaId: '',
    estado: 'activos',
    soloAlertas: false,
    pagina: 1,
  })
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [modal, setModal] = useState<Modal>(null)
  const [creado, setCreado] = useState<string | null>(null)

  const puedeCrear = permisos.includes('inventario.crear')
  const puedeEditar = permisos.includes('inventario.editar')
  const hayAcciones = true // el kárdex lo puede ver todo el que ve el inventario
  const [mostrarGanancia, setMostrarGanancia] = useState(false)
  const verCostos = permisos.includes('inventario.ver_costos')

  const manejar = useCallback(
    (e: unknown) => {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    },
    [onSesionVencida],
  )

  const cargar = useCallback(async () => {
    try {
      setDatos(await listarProductos(token, filtros))
      setError('')
    } catch (e) {
      manejar(e)
    }
  }, [token, filtros, manejar])

  const cargarCatalogos = useCallback(() => {
    catalogosInventario(token).then(setCatalogos).catch(manejar)
  }, [token, manejar])

  useEffect(() => {
    const espera = setTimeout(cargarCatalogos, 0)
    return () => clearTimeout(espera)
  }, [cargarCatalogos])

  // Espera a que el usuario deje de escribir antes de buscar.
  useEffect(() => {
    const espera = setTimeout(() => void cargar(), 300)
    return () => clearTimeout(espera)
  }, [cargar])

  function cambiarFiltro(cambio: Partial<FiltrosProductos>) {
    setFiltros({ ...filtros, ...cambio, pagina: 1 })
  }

  function terminado(mensaje: string) {
    setModal(null)
    setAviso(mensaje)
    void cargar()
  }

  function abrir(m: Modal) {
    setAviso('')
    setCreado(null)
    setModal(m)
  }

  const filas = datos?.filas ?? []
  const desde = datos ? (datos.pagina - 1) * datos.porPagina + 1 : 0
  const hasta = datos ? desde + filas.length - 1 : 0
  const ultimaPagina = datos ? Math.max(1, Math.ceil(datos.total / datos.porPagina)) : 1

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="search"
            value={filtros.texto}
            onChange={(e) => cambiarFiltro({ texto: e.target.value })}
            placeholder="Buscar por código o nombre"
            className={`${CAMPO} w-full pl-9`}
          />
        </div>
        <select
          value={filtros.categoriaId}
          onChange={(e) => cambiarFiltro({ categoriaId: e.target.value })}
          className={CAMPO}
          aria-label="Categoría"
        >
          <option value="">Todas las categorías</option>
          {catalogos?.categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.unidad_negocio} · {c.nombre}
            </option>
          ))}
        </select>
        <select
          value={filtros.estado}
          onChange={(e) =>
            cambiarFiltro({ estado: e.target.value as FiltrosProductos['estado'] })
          }
          className={CAMPO}
          aria-label="Estado"
        >
          <option value="activos">Activos</option>
          <option value="inactivos">Inactivos</option>
          <option value="todos">Todos</option>
        </select>
        <button
          type="button"
          onClick={() => setMostrarGanancia(!mostrarGanancia)}
          className={`${BOTON_SECUNDARIO} ${mostrarGanancia ? 'border-[#C8102E] text-[#C8102E]' : ''}`}
        >
          {mostrarGanancia ? 'Ocultar precios y ganancia' : 'Mostrar precios y ganancia'}
        </button>
        {puedeCrear && (
          <button
            type="button"
            onClick={() => abrir({ tipo: 'crear' })}
            disabled={!catalogos}
            className={BOTON_PRINCIPAL}
          >
            <Plus size={16} />
            Nuevo producto
          </button>
        )}
      </div>

      {aviso && (
        <div className="mb-4 max-w-xl rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {aviso}
        </div>
      )}
      {error && (
        <div className="mb-4 max-w-xl">
          <CajaError>{error}</CajaError>
        </div>
      )}
      {!datos && !error && <div className="text-gray-500">Cargando…</div>}

      {datos && (datos.alertas.bajo > 0 || datos.alertas.agotado > 0 || filtros.soloAlertas) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="flex items-center gap-2">
            <AlertTriangle size={16} className="shrink-0" />
            {datos.alertas.bajo > 0 &&
              `${datos.alertas.bajo} producto${datos.alertas.bajo === 1 ? '' : 's'} con stock bajo`}
            {datos.alertas.bajo > 0 && datos.alertas.agotado > 0 && ' · '}
            {datos.alertas.agotado > 0 &&
              `${datos.alertas.agotado} agotado${datos.alertas.agotado === 1 ? '' : 's'}`}
            {datos.alertas.bajo === 0 && datos.alertas.agotado === 0 && 'Sin alertas de stock'}
          </span>
          <button
            type="button"
            onClick={() => cambiarFiltro({ soloAlertas: !filtros.soloAlertas })}
            className="rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-medium hover:bg-amber-100"
          >
            {filtros.soloAlertas ? 'Ver todos los productos' : 'Ver solo estos'}
          </button>
        </div>
      )}

      {datos && filas.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          No hay productos que coincidan.
          {puedeCrear && ' Use "Nuevo producto" para registrar el primero.'}
        </div>
      )}

      {filas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-3 font-medium">Código</th>
                <th className="px-3 py-3 font-medium">Producto</th>
                <th className="px-3 py-3 font-medium">Categoría</th>
                <th className="px-3 py-3 font-medium">Unidad</th>
                <th className="px-3 py-3 text-right font-medium">Existencia inicial</th>
                <th className="px-3 py-3 text-right font-medium">Entradas</th>
                <th className="px-3 py-3 text-right font-medium">Salidas</th>
                <th className="px-3 py-3 text-right font-medium">Existencia actual</th>
                {datos?.verCostos && (
                  <th className="px-3 py-3 text-right font-medium">Costo (DOP)</th>
                )}
                <th className="px-3 py-3 font-medium">ITBIS (%)</th>
                {mostrarGanancia && (
                  <th className="px-3 py-3 text-right font-medium">Precio cliente</th>
                )}
                {mostrarGanancia && datos?.verCostos && (
                  <th className="px-3 py-3 text-right font-medium">Ganancia por unidad</th>
                )}
                {mostrarGanancia && datos?.verCostos && (
                  <th className="px-3 py-3 text-right font-medium">Costo total</th>
                )}
                {mostrarGanancia && (
                  <th className="px-3 py-3 text-right font-medium">Venta total</th>
                )}
                <th className="px-3 py-3 font-medium">Estado</th>
                {hayAcciones && <th className="px-3 py-3" />}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-b border-gray-100 last:border-0">
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-xs">{f.codigo}</td>
                  <td className="px-3 py-3 font-medium">{f.nombre}</td>
                  <td className="px-3 py-3">
                    {f.categoria}
                    <div className="text-xs text-gray-500">{f.unidad_negocio}</div>
                  </td>
                  <td className="px-3 py-3">{f.unidad}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    {cantidad(f.existencia_inicial)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right text-green-700">
                    {Number(f.entradas) > 0 ? `+${cantidad(f.entradas)}` : '0'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right text-red-700">
                    {Number(f.salidas) > 0 ? `−${cantidad(f.salidas)}` : '0'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    <div className="text-base font-medium">{cantidad(f.existencia)}</div>
                    {f.alerta === 'agotado' && (
                      <span className="mt-0.5 inline-flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">
                        <PackageX size={12} /> Agotado
                      </span>
                    )}
                    {f.alerta === 'bajo' && (
                      <span className="mt-0.5 inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                        <AlertTriangle size={12} /> Stock bajo
                      </span>
                    )}
                    <div className="text-xs text-gray-400">mín. {cantidad(f.minimo)}</div>
                  </td>
                  {datos?.verCostos && (
                    <td className="whitespace-nowrap px-3 py-3 text-right">
                      {dinero(f.costo)}
                      {f.calculo_costo && Number(f.calculo_costo.itbis) > 0 && (
                        <div className="text-xs text-gray-500">
                          con ITBIS {dinero(f.calculo_costo.total)}
                        </div>
                      )}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3 py-3">{itbisTexto(f.tasa)}</td>
                  {mostrarGanancia && (
                    <td className="whitespace-nowrap px-3 py-3 text-right">
                      {f.calculo_precio ? dinero(f.calculo_precio.total) : '—'}
                      {f.calculo_precio && Number(f.calculo_precio.itbis) > 0 && (
                        <div className="text-xs text-gray-500">
                          sin ITBIS {dinero(f.calculo_precio.base)}
                        </div>
                      )}
                    </td>
                  )}
                  {mostrarGanancia && datos?.verCostos && (
                    <td className="whitespace-nowrap px-3 py-3 text-right">
                      {f.rentabilidad ? (
                        <>
                          <div
                            className={
                              f.rentabilidad.ganancia.startsWith('-')
                                ? 'font-medium text-red-700'
                                : 'font-medium'
                            }
                          >
                            {dinero(f.rentabilidad.ganancia)}
                          </div>
                          <div className="text-xs text-gray-500">
                            margen {f.rentabilidad.margen ?? '—'}%
                          </div>
                          <div className="text-xs text-gray-500">
                            sobre costo {f.rentabilidad.sobreCosto ?? '—'}%
                          </div>
                        </>
                      ) : (
                        <span className="text-gray-400">Sin precio</span>
                      )}
                    </td>
                  )}
                  {mostrarGanancia && datos?.verCostos && (
                    <td className="whitespace-nowrap px-3 py-3 text-right">
                      {dinero(f.costo_total)}
                    </td>
                  )}
                  {mostrarGanancia && (
                    <td className="whitespace-nowrap px-3 py-3 text-right">
                      {dinero(f.venta_total)}
                    </td>
                  )}
                  <td className="px-3 py-3">
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs ${
                        f.is_active
                          ? 'bg-green-50 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {f.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  {hayAcciones && (
                    <td className="whitespace-nowrap px-3 py-3 text-right">
                      <Acciones
                        fila={f}
                        permisos={permisos}
                        puedeEditar={puedeEditar && catalogos !== null}
                        onAbrir={abrir}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {datos && mostrarGanancia && (
              <tfoot className="border-t-2 border-gray-200 bg-gray-50 font-medium">
                <tr>
                  <td className="px-3 py-3" colSpan={datos.verCostos ? 11 : 10}>
                    Totales de {datos.total} producto{datos.total === 1 ? '' : 's'}
                    <div className="text-xs font-normal text-gray-500">
                      Existencia actual × costo y × precio, sin ITBIS
                    </div>
                  </td>
                  {datos.verCostos && (
                    <td className="whitespace-nowrap px-3 py-3 text-right">
                      {dinero(datos.totales.ganancia_total)}
                      {datos.totales.margen_total && (
                        <div className="text-xs font-normal text-gray-500">
                          margen {datos.totales.margen_total}%
                        </div>
                      )}
                    </td>
                  )}
                  {datos.verCostos && (
                    <td className="whitespace-nowrap px-3 py-3 text-right">
                      {dinero(datos.totales.costo_total)}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    {dinero(datos.totales.venta_total)}
                  </td>
                  <td colSpan={hayAcciones ? 2 : 1} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {datos && datos.total > 0 && (
        <div className="mt-3 flex items-center justify-between gap-2 text-sm text-gray-600">
          <span>
            Mostrando {desde}–{hasta} de {datos.total}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={datos.pagina <= 1}
              onClick={() => setFiltros({ ...filtros, pagina: filtros.pagina - 1 })}
              className={`${BOTON_SECUNDARIO} inline-flex items-center gap-1 disabled:opacity-40`}
            >
              <ChevronLeft size={16} /> Anterior
            </button>
            <button
              type="button"
              disabled={datos.pagina >= ultimaPagina}
              onClick={() => setFiltros({ ...filtros, pagina: filtros.pagina + 1 })}
              className={`${BOTON_SECUNDARIO} inline-flex items-center gap-1 disabled:opacity-40`}
            >
              Siguiente <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      <p className="mt-4 max-w-3xl text-xs text-gray-500">
        Existencia actual = existencia inicial + entradas − salidas. Se calcula
        sola con los movimientos (entradas, salidas y ajustes por conteo) y
        nunca se escribe a mano. Las ventas la descontarán cuando exista el
        módulo de Ventas. La ganancia, la venta total y el costo total se
        calculan sin ITBIS. {AVISO_FISCAL}
      </p>

      {modal?.tipo === 'crear' && catalogos && (
        <Ventana
          titulo={creado ? 'Producto creado' : 'Nuevo producto'}
          ancho="max-w-2xl"
          onCerrar={() => setModal(null)}
        >
          {creado ? (
            <CodigoAsignado
              codigo={creado}
              onCerrar={() => setModal(null)}
              onOtro={() => {
                setCreado(null)
                cargarCatalogos()
              }}
            />
          ) : (
            <FormProducto
              token={token}
              catalogos={catalogos}
              verCostos={verCostos}
              minimoPorDefecto={datos?.stockMinimoPorDefecto ?? '5'}
              onListo={(codigo) => {
                setCreado(codigo ?? null)
                setAviso(codigo ? `Producto ${codigo} creado` : '')
                void cargar()
              }}
              onCancelar={() => setModal(null)}
              onSesionVencida={onSesionVencida}
            />
          )}
        </Ventana>
      )}
      {modal?.tipo === 'editar' && catalogos && (
        <Ventana titulo="Editar producto" ancho="max-w-2xl" onCerrar={() => setModal(null)}>
          <FormProducto
            token={token}
            catalogos={catalogos}
            fila={modal.fila}
            verCostos={verCostos}
            minimoPorDefecto={datos?.stockMinimoPorDefecto ?? '5'}
            onListo={() => terminado('Cambios guardados')}
            onCancelar={() => setModal(null)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
      {modal?.tipo === 'entrada' && (
        <Ventana titulo="Entrada de mercancía" ancho="max-w-2xl" onCerrar={() => setModal(null)}>
          <FormEntrada
            token={token}
            fila={modal.fila}
            verCostos={verCostos}
            onListo={terminado}
            onCancelar={() => setModal(null)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
      {modal?.tipo === 'salida' && (
        <Ventana titulo="Salida de mercancía" onCerrar={() => setModal(null)}>
          <FormSalida
            token={token}
            fila={modal.fila}
            verCostos={verCostos}
            onListo={terminado}
            onCancelar={() => setModal(null)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
      {modal?.tipo === 'ajuste' && (
        <Ventana titulo="Ajustar por conteo físico" onCerrar={() => setModal(null)}>
          <FormAjuste
            token={token}
            fila={modal.fila}
            verCostos={verCostos}
            onListo={terminado}
            onCancelar={() => setModal(null)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
      {modal?.tipo === 'costo' && (
        <Ventana titulo="Corregir costo" onCerrar={() => setModal(null)}>
          <FormCorregirCosto
            token={token}
            fila={modal.fila}
            verCostos={verCostos}
            onListo={terminado}
            onCancelar={() => setModal(null)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
      {modal?.tipo === 'kardex' && (
        <Ventana titulo="Kárdex del producto" ancho="max-w-5xl" onCerrar={() => setModal(null)}>
          <VerKardex token={token} fila={modal.fila} onSesionVencida={onSesionVencida} />
        </Ventana>
      )}
      {modal?.tipo === 'estado' && (
        <Ventana
          titulo={modal.fila.is_active ? 'Desactivar producto' : 'Activar producto'}
          onCerrar={() => setModal(null)}
        >
          <ConfirmarEstado
            token={token}
            fila={modal.fila}
            onListo={() =>
              terminado(modal.fila.is_active ? 'Producto desactivado' : 'Producto activado')
            }
            onCancelar={() => setModal(null)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
    </div>
  )
}

// ---------- Página ----------

export default function Inventario({ token, permisos, onSesionVencida }: Props) {
  const [seccion, setSeccion] = useState<'productos' | 'categorias'>('productos')
  const verCategorias = permisos.includes('categorias.ver')

  return (
    <div>
      <div className="mb-4">
        <h1 className="mb-1 text-xl font-medium">Inventario</h1>
        <p className="text-sm text-gray-500">
          Productos con su código, categoría, existencia, costo e ITBIS.
        </p>
      </div>

      {verCategorias && (
        <div className="mb-4 flex gap-1 border-b border-gray-200">
          {(
            [
              ['productos', 'Productos'],
              ['categorias', 'Categorías'],
            ] as const
          ).map(([id, nombre]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSeccion(id)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm ${
                seccion === id
                  ? 'border-[#C8102E] font-medium text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {nombre}
            </button>
          ))}
        </div>
      )}

      {seccion === 'categorias' && verCategorias ? (
        <Categorias
          token={token}
          permisos={permisos}
          onSesionVencida={onSesionVencida}
          incrustada
        />
      ) : (
        <Productos token={token} permisos={permisos} onSesionVencida={onSesionVencida} />
      )}
    </div>
  )
}
