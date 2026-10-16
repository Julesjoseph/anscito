import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, Download, FileText, RefreshCw } from 'lucide-react'
import { SesionVencida } from './api'
import { descargarFormato, resumenFiscal } from './api-fiscal'
import type { AvisoFiscal, ResumenFiscal } from './api-fiscal'
import { BOTON_SECUNDARIO, CAMPO, CajaError } from './componentes'
import { dinero, mensajeDe } from './formato'

// Formatos de envío de la DGII del mes: 606 (compras), 607 (ventas con e-CF),
// 608 (anulados) y un estimado del ITBIS. El contador los revisa y se
// pre-validan con la herramienta de la DGII antes de enviarlos.

type Props = {
  token: string
  onSesionVencida: () => void
}

const FORMA_PAGO: Record<string, string> = {
  '01': 'Efectivo',
  '02': 'Cheque/transferencia',
  '03': 'Tarjeta',
  '04': 'A crédito',
  '05': 'Permuta',
  '06': 'Nota de crédito',
  '07': 'Mixto',
}

// "20261005" → "05/10/2026"
function fechaDgii(v: string): string {
  return v ? `${v.slice(6, 8)}/${v.slice(4, 6)}/${v.slice(0, 4)}` : '—'
}

// Mes anterior (lo normal es enviar el mes que pasó), como "AAAA-MM".
function mesAnterior(): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function Avisos({ avisos }: { avisos: AvisoFiscal[] }) {
  if (avisos.length === 0) return null
  return (
    <ul className="flex flex-col gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {avisos.map((a, i) => (
        <li key={i} className="flex gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            <span className="font-mono text-xs">{a.documento}</span> · {a.mensaje}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Seccion({ titulo, ayuda, acciones, children }: { titulo: string; ayuda: string; acciones?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-medium">{titulo}</h2>
          <p className="text-xs text-gray-500">{ayuda}</p>
        </div>
        {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
      </div>
      {children}
    </section>
  )
}

function Dato({ nombre, valor, fuerte }: { nombre: string; valor: string; fuerte?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-gray-500">{nombre}</span>
      <span className={fuerte ? 'text-lg font-medium' : ''}>{valor}</span>
    </div>
  )
}

export default function Fiscal({ token, onSesionVencida }: Props) {
  const [mes, setMes] = useState(mesAnterior())
  const [datos, setDatos] = useState<ResumenFiscal | null>(null)
  const [error, setError] = useState('')
  const [bajando, setBajando] = useState('')
  const periodo = mes.replace('-', '')

  const cargar = useCallback(async () => {
    setError('')
    setDatos(null)
    try {
      setDatos(await resumenFiscal(token, periodo))
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, periodo, onSesionVencida])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function bajar(formato: '606' | '607', tipo: 'txt' | 'xlsx') {
    setBajando(`${formato}-${tipo}`)
    setError('')
    try {
      const { archivo, nombre } = await descargarFormato(token, formato, tipo, periodo)
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
      setBajando('')
    }
  }

  const botones = (formato: '606' | '607', cantidad: number) => (
    <>
      <button type="button" className={`${BOTON_SECUNDARIO} flex items-center gap-2`} disabled={!!bajando || !datos?.rnc} onClick={() => void bajar(formato, 'xlsx')}>
        <Download size={14} /> Excel
      </button>
      <button type="button" className={`${BOTON_SECUNDARIO} flex items-center gap-2`} disabled={!!bajando || !datos?.rnc || cantidad === 0} onClick={() => void bajar(formato, 'txt')}>
        <FileText size={14} /> TXT
      </button>
    </>
  )

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-medium">Formatos DGII</h1>
        <p className="text-sm text-gray-500">606 (compras), 607 (ventas), 608 (anulados) y un estimado del ITBIS del mes.</p>
      </div>
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>
          Antes de enviar: su contador revisa los formatos y el TXT se pre-valida con la herramienta de la DGII. Se envían a más
          tardar el día 15 del mes siguiente. Pregúntele también si, como emisor de e-CF, debe enviar el 607.
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Mes
          <input type="month" className={CAMPO} value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} />
        </label>
        <button type="button" className={BOTON_SECUNDARIO} onClick={() => void cargar()} aria-label="Actualizar">
          <RefreshCw size={16} />
        </button>
      </div>
      {error && <CajaError>{error}</CajaError>}
      {!datos ? (
        !error && <p className="text-sm text-gray-500">Cargando…</p>
      ) : (
        <>
          {!datos.rnc && <CajaError>Registre el RNC de la empresa en la pantalla Empresa: los archivos lo necesitan.</CajaError>}

          <Seccion titulo="ITBIS del mes (estimado)" ayuda="Ayuda para la declaración IT-1. No incluye proporcionalidad, saldos a favor anteriores ni retenciones que le hicieron: lo completa el contador.">
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Dato nombre="ITBIS cobrado (ventas)" valor={dinero(datos.itbis.ventas)} />
              <Dato nombre="ITBIS pagado (compras)" valor={dinero(datos.itbis.compras)} />
              {datos.itbis.saldoFavor !== '0.00' ? (
                <Dato nombre="Saldo a favor (estimado)" valor={dinero(datos.itbis.saldoFavor)} fuerte />
              ) : (
                <Dato nombre="A pagar (estimado)" valor={dinero(datos.itbis.aPagar)} fuerte />
              )}
              <Dato nombre="ITBIS retenido a proveedores (se paga aparte)" valor={dinero(datos.itbis.retenidoProveedores)} />
            </div>
          </Seccion>

          <Seccion titulo={`606 · Compras (${datos.f606.totales.cantidad})`} ayuda="Facturas de compra y gastos con NCF del mes (Reg. Facturas de Compras y Gastos)." acciones={botones('606', datos.f606.totales.cantidad)}>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              <Dato nombre="Servicios" valor={dinero(datos.f606.totales.servicios)} />
              <Dato nombre="Bienes" valor={dinero(datos.f606.totales.bienes)} />
              <Dato nombre="ITBIS facturado" valor={dinero(datos.f606.totales.itbis)} />
              <Dato nombre="ITBIS retenido" valor={dinero(datos.f606.totales.itbisRetenido)} />
              <Dato nombre="ISR retenido" valor={dinero(datos.f606.totales.retencionRenta)} />
            </div>
            {datos.f606.sinNcf.cantidad > 0 && (
              <p className="text-xs text-gray-500">
                {datos.f606.sinNcf.cantidad} factura(s) sin NCF ({dinero(datos.f606.sinNcf.total)}) no van en el 606.
              </p>
            )}
            <Avisos avisos={datos.f606.avisos} />
            {datos.f606.filas.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="text-left text-xs text-gray-500">
                    <tr>
                      <th className="py-1 pr-3">NCF</th>
                      <th className="py-1 pr-3">Proveedor</th>
                      <th className="py-1 pr-3">Fecha</th>
                      <th className="py-1 pr-3 text-right">Monto</th>
                      <th className="py-1 pr-3 text-right">ITBIS</th>
                      <th className="py-1 pr-3 text-right">Retenciones</th>
                      <th className="py-1">Pago</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.f606.filas.map((f) => (
                      <tr key={f.compra} className="border-t border-gray-100">
                        <td className="py-1 pr-3 font-mono text-xs">{f.ncf}</td>
                        <td className="py-1 pr-3">
                          {f.proveedor}
                          <div className="font-mono text-xs text-gray-400">{f.rnc || 'sin documento'}</div>
                        </td>
                        <td className="py-1 pr-3">{fechaDgii(f.fechaComprobante)}</td>
                        <td className="py-1 pr-3 text-right">{dinero(f.total)}</td>
                        <td className="py-1 pr-3 text-right">{dinero(f.itbis)}</td>
                        <td className="py-1 pr-3 text-right text-xs">
                          {f.itbisRetenido !== '0.00' && <div>ITBIS {dinero(f.itbisRetenido)}</div>}
                          {f.retencionRenta !== '0.00' && <div>ISR {dinero(f.retencionRenta)}</div>}
                        </td>
                        <td className="py-1 text-xs">
                          {FORMA_PAGO[f.formaPago] ?? f.formaPago}
                          {f.fechaPago && <div className="text-gray-400">{fechaDgii(f.fechaPago)}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Seccion>

          <Seccion titulo={`607 · Ventas (${datos.f607.totales.cantidad})`} ayuda="e-CF emitidos en el mes: crédito fiscal (E31), notas de crédito (E34) y consumo (E32) desde el monto configurado." acciones={botones('607', datos.f607.totales.cantidad)}>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <Dato nombre="Monto facturado (sin ITBIS)" valor={dinero(datos.f607.totales.montoFacturado)} />
              <Dato nombre="ITBIS facturado" valor={dinero(datos.f607.totales.itbis)} />
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
              <div className="font-medium">Resumen de facturas de consumo (para la Oficina Virtual)</div>
              <p className="text-xs text-gray-500">Las E32 menores de {dinero(datos.f607.consumo.desde)} no van en el TXT: se escriben en el resumen al enviar el 607.</p>
              <div className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Dato nombre="Cantidad" valor={String(datos.f607.consumo.cantidad)} />
                <Dato nombre="Monto (sin ITBIS)" valor={dinero(datos.f607.consumo.monto)} />
                <Dato nombre="ITBIS" valor={dinero(datos.f607.consumo.itbis)} />
                <Dato nombre="Total" valor={dinero(datos.f607.consumo.total)} />
              </div>
            </div>
            {datos.f607.porEmitir > 0 && (
              <p className="text-sm text-amber-800">
                {datos.f607.porEmitir} venta(s) del mes tienen el e-CF por emitir: anótelo en Facturación electrónica antes de enviar.
              </p>
            )}
            <Avisos avisos={datos.f607.avisos} />
            {datos.f607.filas.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="text-left text-xs text-gray-500">
                    <tr>
                      <th className="py-1 pr-3">e-NCF</th>
                      <th className="py-1 pr-3">Comprador</th>
                      <th className="py-1 pr-3">Fecha</th>
                      <th className="py-1 pr-3 text-right">Monto</th>
                      <th className="py-1 text-right">ITBIS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.f607.filas.map((f) => (
                      <tr key={f.ncf} className="border-t border-gray-100">
                        <td className="py-1 pr-3 font-mono text-xs">
                          {f.ncf}
                          {f.ncfModificado && <div className="text-gray-400">modifica {f.ncfModificado}</div>}
                        </td>
                        <td className="py-1 pr-3">
                          {f.comprador}
                          <div className="font-mono text-xs text-gray-400">{f.rnc || 'sin documento'}</div>
                        </td>
                        <td className="py-1 pr-3">{fechaDgii(f.fechaComprobante)}</td>
                        <td className="py-1 pr-3 text-right">{dinero(f.montoFacturado)}</td>
                        <td className="py-1 text-right">{dinero(f.itbis)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Seccion>

          <Seccion titulo="608 · Comprobantes anulados" ayuda="Comprobantes fiscales anulados en el mes.">
            <p className="text-sm text-gray-600">
              No hay comprobantes anulados que reportar: un e-CF emitido se corrige con una nota de crédito (va en el 607) y uno
              que no se llegó a emitir no tiene e-NCF. Si no hubo operaciones, el 608 se presenta en cero en la Oficina Virtual
              (Declaraciones en cero).
            </p>
          </Seccion>
        </>
      )}
    </div>
  )
}
