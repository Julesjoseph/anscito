import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Printer, Search, Trash2 } from 'lucide-react'
import { SesionVencida, listarProductos } from './api'
import type { FilaProducto } from './api'
import { descargarEtiquetas, revisarEtiquetas } from './api-etiquetas'
import type { PedidoEtiquetas, RevisionEtiquetas } from './api-etiquetas'
import { BOTON_PRINCIPAL, BOTON_SECUNDARIO, CAMPO, CajaError } from './componentes'
import { dinero, mensajeDe } from './formato'

// Etiquetas de precio para pegar en los productos: nombre, código de barras
// (Code 128 del código interno) y precio final con ITBIS. Se marcan los
// productos y cuántas etiquetas de cada uno.

type Props = {
  token: string
  onSesionVencida: () => void
}

// Hoja carta: 80 etiquetas (4 columnas × 20 filas), igual que el servidor.
const POR_HOJA = 80

type Marcado = { id: string; codigo: string; nombre: string; precio: string | null; cantidad: string }

export default function Etiquetas({ token, onSesionVencida }: Props) {
  const [texto, setTexto] = useState('')
  const [pagina, setPagina] = useState(1)
  const [filas, setFilas] = useState<FilaProducto[] | null>(null)
  const [total, setTotal] = useState(0)
  const [porPagina, setPorPagina] = useState(20)
  const [marcados, setMarcados] = useState<Marcado[]>([])
  const [formato, setFormato] = useState<'carta' | 'rollo'>('carta')
  const [inicio, setInicio] = useState('1')
  const [revision, setRevision] = useState<RevisionEtiquetas | null>(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const r = await listarProductos(token, { texto, categoriaId: '', estado: 'activos', soloAlertas: false, pagina })
      setFilas(r.filas)
      setTotal(r.total)
      setPorPagina(r.porPagina)
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, texto, pagina, onSesionVencida])

  useEffect(() => {
    const espera = setTimeout(() => void cargar(), 250)
    return () => clearTimeout(espera)
  }, [cargar])

  function marcar(f: FilaProducto) {
    setRevision(null)
    setMarcados((m) =>
      m.some((x) => x.id === f.id)
        ? m.filter((x) => x.id !== f.id)
        : [...m, { id: f.id, codigo: f.codigo, nombre: f.nombre, precio: f.calculo_precio?.total ?? null, cantidad: '1' }],
    )
  }

  const cantidadValida = (c: string) => /^\d{1,3}$/.test(c.trim()) && Number(c) >= 1 && Number(c) <= 500
  const inicioValido = formato === 'rollo' || (/^\d{1,2}$/.test(inicio.trim()) && Number(inicio) >= 1 && Number(inicio) <= POR_HOJA)
  const listo = marcados.length > 0 && marcados.every((m) => cantidadValida(m.cantidad)) && inicioValido
  const totalEtiquetas = marcados.reduce((a, m) => a + (cantidadValida(m.cantidad) ? Number(m.cantidad) : 0), 0)

  const pedido = (): PedidoEtiquetas => ({
    formato,
    inicio: formato === 'carta' ? Number(inicio) : undefined,
    productos: marcados.map((m) => ({ productoId: m.id, cantidad: Number(m.cantidad) })),
  })

  async function imprimir() {
    setOcupado(true)
    setError('')
    try {
      const r = await revisarEtiquetas(token, pedido())
      setRevision(r)
      if (r.listos.length === 0) return
      const { archivo, nombre } = await descargarEtiquetas(token, pedido())
      const url = URL.createObjectURL(archivo)
      const a = document.createElement('a')
      a.href = url
      a.download = nombre
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    } finally {
      setOcupado(false)
    }
  }

  const paginas = Math.max(1, Math.ceil(total / porPagina))

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-500">
        Marque los productos y cuántas etiquetas quiere de cada uno. Cada etiqueta lleva el nombre, el código de barras y el
        precio final con ITBIS.
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="font-medium">1. Productos</h2>
          <div className="relative">
            <Search size={16} className="absolute top-3 left-3 text-gray-400" />
            <input
              className={`${CAMPO} w-full pl-9`}
              type="search"
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value)
                setPagina(1)
              }}
              placeholder="Buscar por código o nombre"
            />
          </div>
          {!filas ? (
            <p className="text-sm text-gray-500">Cargando…</p>
          ) : filas.length === 0 ? (
            <p className="text-sm text-gray-500">No hay productos.</p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {filas.map((f) => {
                const sel = marcados.some((m) => m.id === f.id)
                return (
                  <li key={f.id}>
                    <label className="flex cursor-pointer items-center gap-3 py-2">
                      <input type="checkbox" className="h-4 w-4 accent-[#C8102E]" checked={sel} onChange={() => marcar(f)} />
                      <span className="min-w-0 flex-1">
                        <span className="font-mono text-xs text-gray-500">{f.codigo}</span> {f.nombre}
                      </span>
                      <span className={f.calculo_precio ? 'text-gray-700' : 'text-amber-700'}>
                        {f.calculo_precio ? dinero(f.calculo_precio.total) : 'sin precio'}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
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
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="font-medium">2. Cuántas y en qué papel</h2>
          {marcados.length === 0 ? (
            <p className="text-sm text-gray-500">Marque productos en la lista.</p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {marcados.map((m) => (
                <li key={m.id} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-xs text-gray-500">{m.codigo}</span> {m.nombre}
                    {!m.precio && <span className="ml-1 text-xs text-amber-700">(sin precio: no se imprime)</span>}
                  </span>
                  <input
                    className={`${CAMPO} w-20 text-center ${cantidadValida(m.cantidad) ? '' : 'border-red-400'}`}
                    inputMode="numeric"
                    value={m.cantidad}
                    onChange={(e) => {
                      setRevision(null)
                      setMarcados((l) => l.map((x) => (x.id === m.id ? { ...x, cantidad: e.target.value.replace(/\D/g, '') } : x)))
                    }}
                    aria-label={`Etiquetas de ${m.nombre}`}
                  />
                  <button type="button" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" onClick={() => setMarcados((l) => l.filter((x) => x.id !== m.id))} aria-label={`Quitar ${m.nombre}`}>
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-gray-600">
              Papel
              <select className={CAMPO} value={formato} onChange={(e) => setFormato(e.target.value as 'carta' | 'rollo')}>
                <option value="carta">Hoja carta adhesiva (80 por hoja, tipo Avery 5167, 1¾ × ½ pulgada)</option>
                <option value="rollo">Rollo de impresora de etiquetas (50 × 25 mm)</option>
              </select>
            </label>
            {formato === 'carta' && (
              <label className="flex flex-col gap-1 text-sm text-gray-600">
                Empezar en la etiqueta n.º (1 a {POR_HOJA})
                <input className={`${CAMPO} ${inicioValido ? '' : 'border-red-400'}`} inputMode="numeric" value={inicio} onChange={(e) => setInicio(e.target.value.replace(/\D/g, ''))} />
                <span className="text-xs text-gray-400">Para usar una hoja ya empezada: cuente de izquierda a derecha, fila por fila.</span>
              </label>
            )}
          </div>
          <p className="text-xs text-gray-500">
            {formato === 'carta'
              ? 'Imprima en tamaño real (100 %, sin "ajustar a la página").'
              : 'En la impresora de etiquetas, use el tamaño 50 × 25 mm y escala 100 %.'}
          </p>
          {revision && revision.noSeImprimen.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {revision.noSeImprimen.map((x) => (
                <li key={x.id} className="flex gap-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>
                    {x.codigo} {x.nombre}: {x.motivo} (no se imprimió)
                  </span>
                </li>
              ))}
            </ul>
          )}
          {error && <CajaError>{error}</CajaError>}
          <button type="button" className={BOTON_PRINCIPAL} disabled={!listo || ocupado} onClick={() => void imprimir()}>
            <Printer size={16} /> {ocupado ? 'Preparando…' : `Descargar PDF (${totalEtiquetas} etiqueta${totalEtiquetas === 1 ? '' : 's'})`}
          </button>
        </section>
      </div>
    </div>
  )
}
