import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Copy, FileCheck2, Pencil, RefreshCw, Repeat, Search } from 'lucide-react'
import {
  SesionVencida,
  cambiarTipoEcf,
  configurarFacturacion,
  corregirEcf,
  detalleVenta,
  emitirEcf,
  listarEcf,
  prepararFacturacion,
} from './api'
import type { DetalleVenta, EstadoEcf, FilaEcf, PaginaEcf, PrepararFacturacion } from './api'
import { BOTON_PRINCIPAL, BOTON_SECUNDARIO, CAMPO, CajaError, Ventana } from './componentes'
import { dinero, mensajeDe } from './formato'

// Facturación electrónica en modo manual: la lista de e-CF "por emitir",
// los datos para copiar en el Facturador Gratuito de la DGII y el e-NCF
// que la DGII devuelve.

type Props = {
  token: string
  permisos: string[]
  onSesionVencida: () => void
}

type Pestana = EstadoEcf | 'config'

const COLOR_TIPO: Record<string, string> = {
  '31': 'bg-blue-100 text-blue-800',
  '32': 'bg-gray-100 text-gray-700',
  '34': 'bg-amber-100 text-amber-800',
}

function fechaCorta(dia: string | null | undefined): string {
  if (!dia) return '—'
  const [a, m, d] = dia.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

function fechaHora(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('es-DO') : '—'
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

function Tipo({ f }: { f: Pick<FilaEcf, 'tipo' | 'tipo_nombre'> }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${COLOR_TIPO[f.tipo] ?? ''}`}>
      {f.tipo} · {f.tipo_nombre}
    </span>
  )
}

// Botón pequeño para copiar un dato y pegarlo en el Facturador de la DGII.
function Copiar({ valor }: { valor: string }) {
  const [hecho, setHecho] = useState(false)
  return (
    <button
      type="button"
      className="text-gray-400 hover:text-gray-700"
      aria-label={`Copiar ${valor}`}
      title="Copiar"
      onClick={() => {
        navigator.clipboard
          ?.writeText(valor)
          .then(() => {
            setHecho(true)
            setTimeout(() => setHecho(false), 1500)
          })
          .catch(() => undefined)
      }}
    >
      {hecho ? <CheckCircle2 size={14} className="text-green-600" /> : <Copy size={14} />}
    </button>
  )
}

export default function Facturacion({ token, permisos, onSesionVencida }: Props) {
  const puedeEmitir = permisos.includes('facturacion.emitir')
  const puedeConfigurar = permisos.includes('facturacion.configurar')
  const [prep, setPrep] = useState<PrepararFacturacion | null>(null)
  const [pestana, setPestana] = useState<Pestana>('por_emitir')
  const [error, setError] = useState('')

  const cargarPrep = useCallback(async () => {
    try {
      setPrep(await prepararFacturacion(token))
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, onSesionVencida])

  useEffect(() => {
    void cargarPrep()
  }, [cargarPrep])

  const pestanas: [Pestana, string, boolean][] = [
    ['por_emitir', `Por emitir${prep ? ` (${prep.porEmitir})` : ''}`, true],
    ['emitido', 'Emitidos', true],
    ['cancelado', 'Cancelados', true],
    ['config', 'Configuración', puedeConfigurar],
  ]

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-medium">Facturación electrónica</h1>
        <p className="text-sm text-gray-500">
          Modo manual: emita cada comprobante en el Facturador Gratuito de la DGII y anote aquí el e-NCF que le dé.
        </p>
      </div>

      {prep && !prep.activa && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span>
            {prep.inicio
              ? `La facturación electrónica empieza el ${fechaCorta(prep.inicio)}. Desde ese día cada venta queda aquí "por emitir".`
              : 'La facturación electrónica todavía no empezó: las ventas no quedan "por emitir" hasta que se ponga la fecha de inicio en Configuración.'}
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-b border-gray-200">
        {pestanas
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
      ) : pestana === 'config' ? (
        <Configuracion token={token} prep={prep} onGuardado={() => void cargarPrep()} onSesionVencida={onSesionVencida} />
      ) : (
        <Lista
          key={pestana}
          token={token}
          estado={pestana}
          hoy={prep.hoy}
          puedeEmitir={puedeEmitir}
          puedeVerVenta={permisos.includes('ventas.ver')}
          onCambio={() => void cargarPrep()}
          onSesionVencida={onSesionVencida}
        />
      )}
    </div>
  )
}

// ---------- Lista ----------

type Accion = { tipo: 'emitir' | 'corregir' | 'tipo'; f: FilaEcf }

function Lista({
  token,
  estado,
  hoy,
  puedeEmitir,
  puedeVerVenta,
  onCambio,
  onSesionVencida,
}: {
  token: string
  estado: EstadoEcf
  hoy: string
  puedeEmitir: boolean
  puedeVerVenta: boolean
  onCambio: () => void
  onSesionVencida: () => void
}) {
  const [texto, setTexto] = useState('')
  const [pagina, setPagina] = useState(1)
  const [datos, setDatos] = useState<PaginaEcf | null>(null)
  const [error, setError] = useState('')
  const [accion, setAccion] = useState<Accion | null>(null)

  const cargar = useCallback(async () => {
    setError('')
    try {
      setDatos(await listarEcf(token, { estado, texto, pagina }))
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, estado, texto, pagina, onSesionVencida])

  useEffect(() => {
    const espera = setTimeout(() => void cargar(), 250)
    return () => clearTimeout(espera)
  }, [cargar])

  const listo = () => {
    setAccion(null)
    void cargar()
    onCambio()
  }
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / datos.porPagina)) : 1

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search size={16} className="absolute top-3 left-3 text-gray-400" />
          <input
            type="search"
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value)
              setPagina(1)
            }}
            placeholder="Cliente, RNC/cédula, e-NCF o número de venta"
            className={`${CAMPO} w-full pl-9`}
          />
        </div>
        <button type="button" className={BOTON_SECUNDARIO} onClick={() => void cargar()}>
          <span className="flex items-center gap-2">
            <RefreshCw size={16} /> Actualizar
          </span>
        </button>
      </div>
      {estado === 'por_emitir' && (
        <p className="text-sm text-gray-600">
          Los más viejos primero. Para cada uno: abra el Facturador Gratuito de la DGII, copie los datos, emita y anote
          el e-NCF y el código de seguridad que le da la DGII.
        </p>
      )}
      {error && <CajaError>{error}</CajaError>}
      {!datos ? (
        !error && <p className="text-sm text-gray-500">Cargando…</p>
      ) : datos.filas.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
          {estado === 'por_emitir' ? 'No hay nada por emitir.' : 'No hay comprobantes en esta lista.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Venta</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Comprador</th>
                <th className="px-3 py-2 text-right font-medium">ITBIS</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 font-medium">{estado === 'emitido' ? 'e-NCF' : estado === 'cancelado' ? 'Motivo' : ''}</th>
              </tr>
            </thead>
            <tbody>
              {datos.filas.map((f) => (
                <tr key={f.id} className="border-t border-gray-100 align-top">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="font-medium">{f.venta_numero_texto}</div>
                    <div className="text-xs text-gray-500">{fechaHora(f.venta_fecha)}</div>
                    {f.venta_estado === 'anulada' && <div className="text-xs text-red-700">Venta anulada</div>}
                  </td>
                  <td className="px-3 py-2">
                    <Tipo f={f} />
                    {f.modifica_encf && <div className="mt-1 text-xs text-gray-500">Modifica {f.modifica_encf}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <div>{f.comprador_nombre}</div>
                    <div className="text-xs text-gray-500">{f.comprador_documento ?? 'Sin documento'}</div>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{dinero(f.itbis)}</td>
                  <td className="px-3 py-2 text-right font-medium whitespace-nowrap">{dinero(f.total)}</td>
                  <td className="px-3 py-2">
                    {estado === 'por_emitir' && puedeEmitir && (
                      <div className="flex flex-wrap justify-end gap-2">
                        {f.tipo !== '34' && (
                          <button
                            type="button"
                            className="flex items-center gap-1 text-xs text-gray-600 hover:underline"
                            onClick={() => setAccion({ tipo: 'tipo', f })}
                          >
                            <Repeat size={14} /> Cambiar a {f.tipo === '31' ? '32' : '31'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="flex items-center gap-1 rounded-lg bg-[#C8102E] px-2 py-1 text-xs font-medium whitespace-nowrap text-white hover:bg-[#a80d26]"
                          onClick={() => setAccion({ tipo: 'emitir', f })}
                        >
                          <FileCheck2 size={14} /> Anotar e-NCF
                        </button>
                      </div>
                    )}
                    {estado === 'emitido' && (
                      <div className="flex items-start justify-between gap-2">
                        <div className="whitespace-nowrap">
                          <div className="font-mono">{f.encf}</div>
                          <div className="text-xs text-gray-500">
                            {fechaCorta(f.fecha_emision)} · código {f.codigo_seguridad}
                          </div>
                          <div className="text-xs text-gray-400">{f.emitido_por_usuario}</div>
                        </div>
                        {puedeEmitir && (
                          <button
                            type="button"
                            className="text-gray-400 hover:text-gray-700"
                            aria-label="Corregir"
                            title="Corregir (si se anotó mal)"
                            onClick={() => setAccion({ tipo: 'corregir', f })}
                          >
                            <Pencil size={15} />
                          </button>
                        )}
                      </div>
                    )}
                    {estado === 'cancelado' && <span className="text-xs text-gray-600">{f.motivo_cancelacion}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {datos && paginas > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button type="button" className={BOTON_SECUNDARIO} disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
            Anterior
          </button>
          <span>
            Página {pagina} de {paginas}
          </span>
          <button type="button" className={BOTON_SECUNDARIO} disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>
            Siguiente
          </button>
        </div>
      )}

      {accion?.tipo === 'tipo' && (
        <CambiarTipo token={token} f={accion.f} onCerrar={() => setAccion(null)} onListo={listo} onSesionVencida={onSesionVencida} />
      )}
      {(accion?.tipo === 'emitir' || accion?.tipo === 'corregir') && (
        <FormEmision
          token={token}
          f={accion.f}
          corregir={accion.tipo === 'corregir'}
          hoy={hoy}
          puedeVerVenta={puedeVerVenta}
          onCerrar={() => setAccion(null)}
          onListo={listo}
          onSesionVencida={onSesionVencida}
        />
      )}
    </div>
  )
}

// ---------- Anotar o corregir el e-NCF ----------

function FormEmision({
  token,
  f,
  corregir,
  hoy,
  puedeVerVenta,
  onCerrar,
  onListo,
  onSesionVencida,
}: {
  token: string
  f: FilaEcf
  corregir: boolean
  hoy: string
  puedeVerVenta: boolean
  onCerrar: () => void
  onListo: () => void
  onSesionVencida: () => void
}) {
  const [encf, setEncf] = useState(corregir ? (f.encf ?? '') : `E${f.tipo}`)
  const [fecha, setFecha] = useState(corregir ? (f.fecha_emision ?? hoy) : hoy)
  const [codigo, setCodigo] = useState(corregir ? (f.codigo_seguridad ?? '') : '')
  const [motivo, setMotivo] = useState('')
  const [venta, setVenta] = useState<DetalleVenta | null>(null)
  const { error, guardando, enviar } = useEnviar(onSesionVencida)

  // Las líneas de la venta, para copiarlas en el Facturador.
  useEffect(() => {
    if (corregir || !puedeVerVenta) return
    detalleVenta(token, f.venta_id)
      .then(setVenta)
      .catch((e) => {
        if (e instanceof SesionVencida) onSesionVencida()
      })
  }, [token, f.venta_id, corregir, puedeVerVenta, onSesionVencida])

  const limpio = encf.toUpperCase().replace(/\s/g, '')
  const encfOk = new RegExp(`^E${f.tipo}\\d{10}$`).test(limpio)
  const codigoOk = /^[A-Za-z0-9]{6}$/.test(codigo.trim())

  return (
    <Ventana titulo={corregir ? `Corregir ${f.encf}` : `Emitir ${f.tipo} · ${f.tipo_nombre}`} onCerrar={onCerrar} ancho="max-w-2xl">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          const datos = { encf: limpio, fechaEmision: fecha, codigoSeguridad: codigo.trim(), motivo: motivo.trim() }
          void enviar(() => (corregir ? corregirEcf(token, f.id, datos) : emitirEcf(token, f.id, datos)), onListo)
        }}
      >
        {!corregir && (
          <div className="flex flex-col gap-2 rounded-lg bg-gray-50 p-3 text-sm">
            <div className="font-medium">1. Datos para el Facturador Gratuito de la DGII</div>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
              <div className="flex items-center gap-2">
                <dt className="text-gray-500">Tipo:</dt>
                <dd>
                  {f.tipo} · {f.tipo_nombre}
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-gray-500">Venta:</dt>
                <dd>
                  {f.venta_numero_texto} · {fechaHora(f.venta_fecha)}
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-gray-500">Comprador:</dt>
                <dd>{f.comprador_nombre}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-gray-500">RNC/Cédula:</dt>
                <dd className="flex items-center gap-1 font-mono">
                  {f.comprador_documento ?? '—'}
                  {f.comprador_documento && <Copiar valor={f.comprador_documento} />}
                </dd>
              </div>
              {f.modifica_encf && (
                <div className="flex items-center gap-2 sm:col-span-2">
                  <dt className="text-gray-500">e-NCF que modifica:</dt>
                  <dd className="flex items-center gap-1 font-mono">
                    {f.modifica_encf} ({fechaCorta(f.modifica_fecha)})
                    <Copiar valor={f.modifica_encf} />
                  </dd>
                </div>
              )}
            </dl>
            {venta && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-gray-500">
                    <tr>
                      <th className="py-1 pr-2 font-medium">Descripción</th>
                      <th className="py-1 pr-2 text-right font-medium">Cant.</th>
                      <th className="py-1 pr-2 text-right font-medium">Precio</th>
                      <th className="py-1 pr-2 text-right font-medium">Desc.</th>
                      <th className="py-1 pr-2 font-medium">ITBIS</th>
                      <th className="py-1 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {venta.lineas.map((l) => (
                      <tr key={l.id} className="border-t border-gray-200">
                        <td className="py-1 pr-2">{l.descripcion}</td>
                        <td className="py-1 pr-2 text-right">{l.cantidad.replace(/\.?0+$/, '')}</td>
                        <td className="py-1 pr-2 text-right whitespace-nowrap">
                          {dinero(l.precio_unitario)}
                          {l.precio_incluye_itbis ? ' (con ITBIS)' : ''}
                        </td>
                        <td className="py-1 pr-2 text-right whitespace-nowrap">{l.descuento === '0.00' ? '—' : dinero(l.descuento)}</td>
                        <td className="py-1 pr-2 whitespace-nowrap">{l.tasa.replace(/\.?0+$/, '')}%</td>
                        <td className="py-1 text-right whitespace-nowrap">{dinero(l.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-x-4 gap-y-1">
              <span>Base {dinero(f.base_imponible)}</span>
              <span>ITBIS {dinero(f.itbis)}</span>
              <span className="font-medium">Total {dinero(f.total)}</span>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {!corregir && <div className="text-sm font-medium">2. Lo que le dio la DGII al emitir</div>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              e-NCF
              <input
                className={`${CAMPO} font-mono`}
                value={encf}
                onChange={(e) => setEncf(e.target.value.toUpperCase())}
                maxLength={16}
                placeholder={`E${f.tipo}0000000001`}
                autoFocus
              />
              <span className={`text-xs ${encfOk || encf.length <= 3 ? 'text-gray-500' : 'text-red-700'}`}>
                E{f.tipo} + 10 números
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Fecha de emisión
              <input type="date" className={CAMPO} value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Código de seguridad
              <input className={`${CAMPO} font-mono`} value={codigo} maxLength={6} onChange={(e) => setCodigo(e.target.value.trim())} />
              <span className="text-xs text-gray-500">6 letras o números de la factura</span>
            </label>
          </div>
          {corregir && (
            <label className="flex flex-col gap-1 text-sm">
              Motivo de la corrección
              <input className={CAMPO} value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} />
            </label>
          )}
        </div>

        {error && <CajaError>{error}</CajaError>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON_SECUNDARIO} onClick={onCerrar}>
            Cancelar
          </button>
          <button
            type="submit"
            className={BOTON_PRINCIPAL}
            disabled={guardando || !encfOk || !codigoOk || (corregir && motivo.trim().length < 5)}
          >
            <FileCheck2 size={16} />
            {guardando ? 'Guardando…' : corregir ? 'Guardar corrección' : 'Marcar como emitido'}
          </button>
        </div>
      </form>
    </Ventana>
  )
}

function CambiarTipo({
  token,
  f,
  onCerrar,
  onListo,
  onSesionVencida,
}: {
  token: string
  f: FilaEcf
  onCerrar: () => void
  onListo: () => void
  onSesionVencida: () => void
}) {
  const nuevo = f.tipo === '31' ? '32' : '31'
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  return (
    <Ventana titulo={`Cambiar a ${nuevo}`} onCerrar={onCerrar}>
      <div className="flex flex-col gap-3 text-sm">
        <p>
          La venta {f.venta_numero_texto} de {f.comprador_nombre} pasará de{' '}
          <strong>{f.tipo === '31' ? '31 · Crédito Fiscal' : '32 · Consumo'}</strong> a{' '}
          <strong>{nuevo === '31' ? '31 · Crédito Fiscal' : '32 · Consumo'}</strong>.
        </p>
        {nuevo === '31' && (
          <p className="text-gray-600">
            El cliente debe tener su RNC o cédula en Clientes. Si la venta se hizo a "Consumidor final", no se puede: haga
            la venta a nombre del cliente.
          </p>
        )}
        {error && <CajaError>{error}</CajaError>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON_SECUNDARIO} onClick={onCerrar}>
            Volver
          </button>
          <button
            type="button"
            className={BOTON_PRINCIPAL}
            disabled={guardando}
            onClick={() => void enviar(() => cambiarTipoEcf(token, f.id, nuevo), onListo)}
          >
            Cambiar a {nuevo}
          </button>
        </div>
      </div>
    </Ventana>
  )
}

// ---------- Configuración ----------

function Configuracion({
  token,
  prep,
  onGuardado,
  onSesionVencida,
}: {
  token: string
  prep: PrepararFacturacion
  onGuardado: () => void
  onSesionVencida: () => void
}) {
  const [inicio, setInicio] = useState(prep.inicio)
  const [umbral, setUmbral] = useState(prep.umbral)
  const [ok, setOk] = useState(false)
  const { error, guardando, enviar } = useEnviar(onSesionVencida)
  return (
    <form
      className="flex max-w-lg flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault()
        setOk(false)
        void enviar(
          () => configurarFacturacion(token, { inicio, umbral: umbral.trim() }),
          () => {
            setOk(true)
            onGuardado()
          },
        )
      }}
    >
      <div className="text-sm">
        <span className="text-gray-500">Modo:</span> manual (Facturador Gratuito de la DGII)
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Fecha de inicio de la facturación electrónica
        <div className="flex gap-2">
          <input type="date" className={`${CAMPO} flex-1`} value={inicio} onChange={(e) => setInicio(e.target.value)} />
          {inicio && (
            <button type="button" className={BOTON_SECUNDARIO} onClick={() => setInicio('')}>
              Quitar
            </button>
          )}
        </div>
        <span className="text-xs text-gray-500">
          Desde ese día cada venta queda "por emitir". Vacía: todavía no se usa. Póngala cuando la DGII lo habilite como
          emisor electrónico.
        </span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Factura de Consumo: pedir cédula o RNC desde (RD$)
        <input className={CAMPO} value={umbral} onChange={(e) => setUmbral(e.target.value)} inputMode="decimal" />
        <span className="text-xs text-gray-500">Confirme este monto con su contador.</span>
      </label>
      {error && <CajaError>{error}</CajaError>}
      {ok && <p className="text-sm text-green-700">Guardado.</p>}
      <button type="submit" className={BOTON_PRINCIPAL} disabled={guardando}>
        {guardando ? 'Guardando…' : 'Guardar'}
      </button>
    </form>
  )
}
