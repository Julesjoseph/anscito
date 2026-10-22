import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Search,
} from 'lucide-react'
import {
  SesionVencida,
  calcularServicio,
  cambiarEstadoServicio,
  catalogosServicios,
  crearServicio,
  editarServicio,
  listarServicios,
} from './api'
import type {
  CatalogosServicios,
  Desglose,
  FilaServicio,
  FiltrosServicios,
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
import { dolares } from './dolar'
import { dinero, mensajeDe, porcentaje } from './formato'
import Impuestos from './Impuestos'
import { montoValido, vistaPrevia } from './itbis'

type Props = {
  token: string
  permisos: string[]
  onSesionVencida: () => void
}

type PropsHijo = {
  token: string
  onSesionVencida: () => void
}

type Modal =
  | { tipo: 'crear' }
  | { tipo: 'editar'; fila: FilaServicio }
  | { tipo: 'estado'; fila: FilaServicio }
  | null

const AVISO_FISCAL =
  'Que un servicio sea "Exento" no significa que quede libre de obligaciones fiscales. Confirme con su contador qué servicios llevan ITBIS y su clasificación fiscal.'

function etiquetaItbis(f: FilaServicio): string {
  if (f.tasa === null) return 'Sin tasa vigente'
  if (Number(f.tasa) === 0) return f.impuesto
  return f.precio_incluye_itbis
    ? `${f.impuesto} ${porcentaje(f.tasa)} incluido`
    : `+ ${f.impuesto} ${porcentaje(f.tasa)}`
}

// ---------- Formulario crear / editar ----------

function FormServicio({
  token,
  catalogos,
  fila,
  onListo,
  onCancelar,
  onSesionVencida,
}: PropsHijo & {
  catalogos: CatalogosServicios
  fila?: FilaServicio
  onListo: () => void
  onCancelar: () => void
}) {
  const [nombre, setNombre] = useState(fila?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(fila?.descripcion ?? '')
  const [unidadNegocioId, setUnidadNegocioId] = useState(
    fila?.unidad_negocio_id ?? '',
  )
  const [categoriaId, setCategoriaId] = useState(fila?.categoria_id ?? '')
  const [unidadMedidaId, setUnidadMedidaId] = useState(
    fila?.unidad_medida_id ?? '',
  )
  const [precio, setPrecio] = useState(fila?.precio ?? '')
  // Moneda del precio (y del costo): en US$ se convierte a RD$ al vender.
  const [moneda, setMoneda] = useState<'DOP' | 'USD'>(fila?.moneda ?? 'DOP')
  const plata = (v: string | null | undefined) => (moneda === 'USD' ? dolares(v) : dinero(v))
  const [costo, setCosto] = useState(fila?.costo ?? '')
  const [gananciaTipo, setGananciaTipo] = useState<'costo' | 'comision'>(
    fila?.ganancia_tipo ?? 'costo',
  )
  // Con comisión: el resto del cobro es de un tercero (solo la comisión es ingreso).
  const [porTercero, setPorTercero] = useState(fila?.por_cuenta_tercero ?? false)
  const [comisionPct, setComisionPct] = useState(
    fila?.comision_pct ? fila.comision_pct.replace(/\.?0+$/, '') : '',
  )
  const [impuestoId, setImpuestoId] = useState(fila?.impuesto_id ?? '')
  const [incluye, setIncluye] = useState(fila?.precio_incluye_itbis ?? false)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  // Resultado del servidor para una combinación concreta de precio/impuesto.
  const [servidor, setServidor] = useState<{
    clave: string
    desglose: Desglose | null
  } | null>(null)

  const impuesto = catalogos.impuestos.find((i) => i.id === impuestoId)
  // Solo las categorías de la unidad elegida.
  const categorias = catalogos.categorias.filter(
    (c) => c.unidad_negocio_id === unidadNegocioId,
  )
  const exento = impuesto !== undefined && Number(impuesto.tasa) === 0
  const local = impuesto ? vistaPrevia(precio, impuesto.tasa, incluye) : null
  const clave = `${precio.trim()}|${impuestoId}|${incluye}`
  const verificado = servidor?.clave === clave ? servidor.desglose : undefined

  useEffect(() => {
    if (!impuestoId || !montoValido(precio)) return
    let activo = true
    const espera = setTimeout(() => {
      calcularServicio(token, {
        precio: precio.trim(),
        impuestoId,
        precioIncluyeItbis: incluye,
      })
        .then((r) => {
          if (activo) setServidor({ clave, desglose: r })
        })
        .catch((err) => {
          if (!activo) return
          if (err instanceof SesionVencida) onSesionVencida()
          else setServidor({ clave, desglose: null })
        })
    }, 400)
    return () => {
      activo = false
      clearTimeout(espera)
    }
  }, [token, precio, impuestoId, incluye, clave, onSesionVencida])

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    const datos = {
      nombre,
      descripcion,
      unidadNegocioId,
      categoriaId,
      unidadMedidaId,
      precio: precio.trim(),
      moneda,
      costo: gananciaTipo === 'costo' ? costo.trim() : '',
      impuestoId,
      precioIncluyeItbis: incluye,
      gananciaTipo,
      comisionPct: comisionPct.trim(),
      porCuentaTercero: gananciaTipo === 'comision' && porTercero,
    }
    try {
      if (fila) await editarServicio(token, fila.id, datos)
      else await crearServicio(token, datos)
      onListo()
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    } finally {
      setGuardando(false)
    }
  }

  const coincide =
    local !== null &&
    verificado != null &&
    local.base === verificado.base &&
    local.itbis === verificado.itbis &&
    local.total === verificado.total
  const mostrar = verificado ?? local

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1 text-sm text-gray-600">
          Código
          <div className="flex h-10 items-center rounded-lg border border-gray-200 bg-gray-50 px-3 font-mono text-gray-700">
            {fila ? fila.codigo : (catalogos.categorias.find((c) => c.id === categoriaId)?.proximo ?? '—')}
          </div>
          <span className="text-xs text-gray-400">
            {fila ? 'No se cambia: está en ventas e informes.' : 'Se crea solo al guardar, según la categoría.'}
          </span>
        </div>
        <label className="flex flex-col gap-1 text-sm text-gray-600 sm:col-span-2">
          Nombre
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Impresión blanco y negro"
            className={CAMPO}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Descripción (opcional)
        <textarea
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          rows={2}
          className={AREA}
        />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Unidad de negocio
          <select
            value={unidadNegocioId}
            onChange={(e) => {
              setUnidadNegocioId(e.target.value)
              setCategoriaId('')
            }}
            className={CAMPO}
          >
            <option value="">Seleccione…</option>
            {catalogos.unidadesNegocio.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
        </label>
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
            disabled={!unidadNegocioId}
            className={`${CAMPO} disabled:bg-gray-100 disabled:text-gray-400`}
          >
            <option value="">
              {unidadNegocioId && categorias.length === 0
                ? 'Esta unidad no tiene categorías: créelas en Categorías'
                : 'Seleccione…'}
            </option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Se cobra por
          <select
            value={unidadMedidaId}
            onChange={(e) => setUnidadMedidaId(e.target.value)}
            className={CAMPO}
          >
            <option value="">Seleccione…</option>
            {catalogos.unidadesMedida.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Precio
          <div className="flex gap-2">
            <select
              value={moneda}
              onChange={(e) => setMoneda(e.target.value as 'DOP' | 'USD')}
              className={`${CAMPO} w-24`}
              aria-label="Moneda del precio"
            >
              <option value="DOP">RD$</option>
              <option value="USD">US$</option>
            </select>
            <input
              type="text"
              inputMode="decimal"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              placeholder="0.00"
              className={`${CAMPO} min-w-0 flex-1`}
            />
          </div>
          {moneda === 'USD' && (
            <span className="text-xs text-gray-500">
              En dólares: al vender se convierte a RD$ con la tasa del día (el costo también va en US$).
            </span>
          )}
          {precio.trim() !== '' && !montoValido(precio) && (
            <span className="text-xs text-red-600">
              Use solo números y punto, con hasta 2 decimales (ej: 150.50)
            </span>
          )}
        </label>
        <div className="flex flex-col gap-1 text-sm text-gray-600">
          ¿Cómo se calcula la ganancia?
          <div className="flex gap-2">
            {(
              [
                ['costo', 'Precio − costo'],
                ['comision', 'Comisión %'],
              ] as const
            ).map(([id, nombre]) => (
              <button
                key={id}
                type="button"
                onClick={() => setGananciaTipo(id)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                  gananciaTipo === id
                    ? 'border-[#C8102E] bg-red-50 font-medium text-[#C8102E]'
                    : 'border-gray-300 hover:bg-gray-50'
                }`}
              >
                {nombre}
              </button>
            ))}
          </div>
          {gananciaTipo === 'costo' ? (
            <input
              type="text"
              inputMode="decimal"
              value={costo}
              onChange={(e) => setCosto(e.target.value)}
              placeholder="Costo interno (opcional)"
              aria-label="Costo interno"
              className={CAMPO}
            />
          ) : (
            <input
              type="text"
              inputMode="decimal"
              value={comisionPct}
              onChange={(e) => setComisionPct(e.target.value)}
              placeholder="Porcentaje de comisión, ej: 20"
              aria-label="Porcentaje de comisión"
              className={CAMPO}
            />
          )}
          {gananciaTipo === 'comision' && local && /^\d{1,3}(\.\d{1,2})?$/.test(comisionPct.trim()) && Number(comisionPct) > 0 && Number(comisionPct) <= 100 && (
            <span className="text-xs text-gray-700">
              Ganancia por cada servicio: {comisionPct.trim()}% de {plata(local.base)} (sin ITBIS) ={' '}
              <span className="font-medium">
                {plata(
                  (() => {
                    const [e, d = ''] = local.base.split('.')
                    const base = BigInt(e) * 100n + BigInt(d.padEnd(2, '0'))
                    const [pe, pd = ''] = comisionPct.trim().split('.')
                    const pct = BigInt(pe) * 100n + BigInt(pd.padEnd(2, '0'))
                    const g = (2n * base * pct + 10000n) / 20000n
                    return `${g / 100n}.${(g % 100n).toString().padStart(2, '0')}`
                  })(),
                )}
              </span>
            </span>
          )}
          {gananciaTipo === 'costo' && costo.trim() === '' && (
            <span className="flex items-start gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              Sin costo, todo lo cobrado cuenta como ganancia en los reportes. Si usted solo gana una comisión
              (el resto es de otro), escoja “Comisión %”.
            </span>
          )}
          {gananciaTipo === 'comision' && (
            <label className="flex items-start gap-2 text-xs text-gray-700">
              <input type="checkbox" className="mt-0.5" checked={porTercero} onChange={(e) => setPorTercero(e.target.checked)} />
              <span>
                Se cobra por cuenta de un tercero: el resto del dinero se le debe a otro (institución o proveedor). En la
                contabilidad, solo la comisión es ingreso del negocio.
              </span>
            </label>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Impuesto
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
        <label
          className={`flex items-center gap-2 self-end pb-2 text-sm ${
            exento ? 'text-gray-400' : 'text-gray-700'
          }`}
        >
          <input
            type="checkbox"
            checked={incluye}
            onChange={(e) => setIncluye(e.target.checked)}
            disabled={exento}
            className="h-4 w-4 accent-[#C8102E]"
          />
          El precio ya incluye ITBIS
        </label>
      </div>

      {impuesto && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
          <div className="mb-2 font-medium text-gray-700">
            Vista previa para el cliente
          </div>
          {mostrar ? (
            <dl className="grid grid-cols-3 gap-2">
              <div>
                <dt className="text-xs text-gray-500">Base</dt>
                <dd className="font-medium">{plata(mostrar.base)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">
                  ITBIS ({porcentaje(impuesto.tasa)})
                </dt>
                <dd className="font-medium">{plata(mostrar.itbis)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Total</dt>
                <dd className="font-medium">{plata(mostrar.total)}</dd>
              </div>
            </dl>
          ) : (
            <div className="text-gray-500">Escriba un precio válido.</div>
          )}
          {mostrar && verificado === undefined && (
            <div className="mt-2 text-xs text-gray-400">
              Verificando con el servidor…
            </div>
          )}
          {verificado && coincide && (
            <div className="mt-2 flex items-center gap-1 text-xs text-green-700">
              <CheckCircle2 size={14} /> Coincide con el cálculo del servidor
            </div>
          )}
          {verificado && !coincide && (
            <div className="mt-2 flex items-center gap-1 text-xs text-amber-800">
              <AlertTriangle size={14} /> Se muestra el cálculo del servidor,
              que es el que vale.
            </div>
          )}
        </div>
      )}

      {exento && <p className="text-xs text-gray-500">{AVISO_FISCAL}</p>}

      {error && <CajaError>{error}</CajaError>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className={BOTON_SECUNDARIO}>
          Cancelar
        </button>
        <button type="submit" disabled={guardando || !categoriaId} className={BOTON_PRINCIPAL}>
          {guardando
            ? 'Guardando…'
            : fila
              ? 'Guardar cambios'
              : 'Crear servicio'}
        </button>
      </div>
    </form>
  )
}

// ---------- Activar / desactivar ----------

function ConfirmarEstado({
  token,
  fila,
  onListo,
  onCancelar,
  onSesionVencida,
}: PropsHijo & {
  fila: FilaServicio
  onListo: () => void
  onCancelar: () => void
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
      await cambiarEstadoServicio(
        token,
        fila.id,
        activar,
        motivo.trim() || undefined,
      )
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
          ? `¿Activar ${fila.codigo} - ${fila.nombre}? Volverá a aparecer en el catálogo.`
          : `¿Desactivar ${fila.codigo} - ${fila.nombre}? Dejará de aparecer en el catálogo, pero no se borra. Quedará registrado quién lo hizo y el motivo.`}
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

// ---------- Catálogo ----------

function Catalogo({ token, permisos, onSesionVencida }: Props) {
  const [catalogos, setCatalogos] = useState<CatalogosServicios | null>(null)
  const [filas, setFilas] = useState<FilaServicio[] | null>(null)
  const [filtros, setFiltros] = useState<FiltrosServicios>({
    texto: '',
    unidadNegocioId: '',
    categoriaId: '',
    estado: 'activos',
  })
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [modal, setModal] = useState<Modal>(null)

  const puedeCrear = permisos.includes('servicios.crear')
  const puedeEditar = permisos.includes('servicios.editar')
  const puedeEstado = permisos.includes('servicios.desactivar')

  const manejar = useCallback(
    (e: unknown) => {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    },
    [onSesionVencida],
  )

  const cargar = useCallback(async () => {
    try {
      setFilas(await listarServicios(token, filtros))
      setError('')
    } catch (e) {
      manejar(e)
    }
  }, [token, filtros, manejar])

  useEffect(() => {
    catalogosServicios(token).then(setCatalogos).catch(manejar)
  }, [token, manejar])

  // Espera a que el usuario deje de escribir antes de buscar.
  useEffect(() => {
    const espera = setTimeout(() => void cargar(), 300)
    return () => clearTimeout(espera)
  }, [cargar])

  function terminado(mensaje: string) {
    setModal(null)
    setAviso(mensaje)
    void cargar()
  }

  function abrir(m: Modal) {
    setAviso('')
    setModal(m)
  }

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
            onChange={(e) => setFiltros({ ...filtros, texto: e.target.value })}
            placeholder="Buscar por código o nombre"
            className={`${CAMPO} w-full pl-9`}
          />
        </div>
        <select
          value={filtros.unidadNegocioId}
          onChange={(e) =>
            setFiltros({
              ...filtros,
              unidadNegocioId: e.target.value,
              categoriaId: '',
            })
          }
          className={CAMPO}
          aria-label="Unidad de negocio"
        >
          <option value="">Todas las unidades</option>
          {catalogos?.unidadesNegocio.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nombre}
            </option>
          ))}
        </select>
        {filtros.unidadNegocioId && (
          <select
            value={filtros.categoriaId}
            onChange={(e) =>
              setFiltros({ ...filtros, categoriaId: e.target.value })
            }
            className={CAMPO}
            aria-label="Categoría"
          >
            <option value="">Todas las categorías</option>
            {catalogos?.categorias
              .filter((c) => c.unidad_negocio_id === filtros.unidadNegocioId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
          </select>
        )}
        <select
          value={filtros.estado}
          onChange={(e) =>
            setFiltros({
              ...filtros,
              estado: e.target.value as FiltrosServicios['estado'],
            })
          }
          className={CAMPO}
          aria-label="Estado"
        >
          <option value="activos">Activos</option>
          <option value="inactivos">Inactivos</option>
          <option value="todos">Todos</option>
        </select>
        {puedeCrear && (
          <button
            type="button"
            onClick={() => abrir({ tipo: 'crear' })}
            disabled={!catalogos}
            className={BOTON_PRINCIPAL}
          >
            <Plus size={16} />
            Nuevo servicio
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
      {!filas && !error && <div className="text-gray-500">Cargando…</div>}

      {filas && filas.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          No hay servicios que coincidan.
          {puedeCrear && ' Use "Nuevo servicio" para agregar el primero.'}
        </div>
      )}

      {filas && filas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 text-left text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Código</th>
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Unidad / categoría</th>
                <th className="px-4 py-3 text-right font-medium">Precio</th>
                <th className="px-4 py-3 font-medium">ITBIS</th>
                <th className="px-4 py-3 text-right font-medium">Total cliente</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                {(puedeEditar || puedeEstado) && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-b border-gray-100 last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                    {f.codigo}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{f.nombre}</div>
                    {f.descripcion && (
                      <div className="text-xs text-gray-500">{f.descripcion}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {f.unidad_negocio}
                    {f.categoria && (
                      <div className="text-xs text-gray-500">{f.categoria}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {f.moneda === 'USD' ? dolares(f.precio) : dinero(f.precio)}
                    <div className="text-xs text-gray-500">
                      por {f.unidad_medida.toLowerCase()}
                    </div>
                    <div className="text-xs text-gray-500">
                      {f.ganancia_tipo === 'comision'
                        ? `Comisión ${f.comision_pct?.replace(/\.?0+$/, '')}%`
                        : f.costo
                          ? `Costo ${f.moneda === 'USD' ? dolares(f.costo) : dinero(f.costo)}`
                          : (
                            <span className="text-amber-700">Sin costo ni comisión: todo cuenta como ganancia</span>
                          )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{etiquetaItbis(f)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-medium">
                    {f.moneda === 'USD' ? dolares(f.calculo?.total) : dinero(f.calculo?.total)}
                  </td>
                  <td className="px-4 py-3">
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
                  {(puedeEditar || puedeEstado) && (
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {puedeEditar && catalogos && (
                        <button
                          type="button"
                          onClick={() => abrir({ tipo: 'editar', fila: f })}
                          className="mr-3 inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                        >
                          <Pencil size={14} />
                          Editar
                        </button>
                      )}
                      {puedeEstado && (
                        <button
                          type="button"
                          onClick={() => abrir({ tipo: 'estado', fila: f })}
                          className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                        >
                          {f.is_active ? <PowerOff size={14} /> : <Power size={14} />}
                          {f.is_active ? 'Desactivar' : 'Activar'}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 max-w-3xl text-xs text-gray-500">
        Los precios del catálogo son de referencia: cada venta guardará el
        precio y la tasa del día en que se haga. {AVISO_FISCAL}
      </p>

      {modal?.tipo === 'crear' && catalogos && (
        <Ventana titulo="Nuevo servicio" ancho="max-w-2xl" onCerrar={() => setModal(null)}>
          <FormServicio
            token={token}
            catalogos={catalogos}
            onListo={() => terminado('Servicio creado correctamente')}
            onCancelar={() => setModal(null)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
      {modal?.tipo === 'editar' && catalogos && (
        <Ventana titulo="Editar servicio" ancho="max-w-2xl" onCerrar={() => setModal(null)}>
          <FormServicio
            token={token}
            catalogos={catalogos}
            fila={modal.fila}
            onListo={() => terminado('Cambios guardados')}
            onCancelar={() => setModal(null)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
      {modal?.tipo === 'estado' && (
        <Ventana
          titulo={modal.fila.is_active ? 'Desactivar servicio' : 'Activar servicio'}
          onCerrar={() => setModal(null)}
        >
          <ConfirmarEstado
            token={token}
            fila={modal.fila}
            onListo={() =>
              terminado(
                modal.fila.is_active ? 'Servicio desactivado' : 'Servicio activado',
              )
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

export default function Servicios({ token, permisos, onSesionVencida }: Props) {
  const [seccion, setSeccion] = useState<'catalogo' | 'impuestos'>('catalogo')
  const verImpuestos = permisos.includes('impuestos.ver')

  return (
    <div>
      <div className="mb-4">
        <h1 className="mb-1 text-xl font-medium">SCITO SERVICE</h1>
        <p className="text-sm text-gray-500">
          Catálogo de servicios que ofrece la empresa, con su precio e impuesto.
        </p>
      </div>

      {verImpuestos && (
        <div className="mb-4 flex flex-wrap gap-1 border-b border-gray-200">
          {(
            [
              ['catalogo', 'Catálogo'],
              ['impuestos', 'Impuestos'],
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

      {seccion === 'impuestos' && verImpuestos ? (
        <Impuestos
          token={token}
          puedeGestionar={permisos.includes('impuestos.gestionar')}
          onSesionVencida={onSesionVencida}
        />
      ) : (
        <Catalogo
          token={token}
          permisos={permisos}
          onSesionVencida={onSesionVencida}
        />
      )}
    </div>
  )
}
