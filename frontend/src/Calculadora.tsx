import { useCallback, useEffect, useState } from 'react'
import { ArrowDownUp, Check, Copy, RefreshCw } from 'lucide-react'
import { SesionVencida, prepararEnvios } from './api'
import type { TarifaEnvio } from './api'
import { CAMPO, CajaError } from './componentes'
import { dinero, mensajeDe } from './formato'

type Props = {
  token: string
  onSesionVencida: () => void
}

// ---------- Cálculo (igual que el servidor: pesos y gourdes ENTEROS) ----------

// "12.5" con n decimales -> entero escalado.
function escalar(v: string, decimales: number): bigint {
  const [e, d = ''] = v.split('.')
  return BigInt(e || '0') * 10n ** BigInt(decimales) + BigInt((d + '0'.repeat(decimales)).slice(0, decimales) || '0')
}

// a / b redondeando la mitad hacia arriba.
function dividir(a: bigint, b: bigint): bigint {
  return (a * 2n + b) / (b * 2n)
}

function texto(v: bigint): string {
  return `${v}.00`
}

type Resultado = { enviado: string; recibe: string; comision: string; total: string }

// Desde lo que envía el cliente en RD$ enteros (sin la comisión).
function desdeEnviado(enviado: bigint, t: TarifaEnvio): Resultado {
  const comision = dividir(enviado * escalar(t.comision_pct, 2), 10_000n)
  return {
    enviado: texto(enviado),
    recibe: texto(dividir(enviado * escalar(t.tasa, 6), 1_000_000n)),
    comision: texto(comision),
    total: texto(enviado + comision),
  }
}

// Lo que debe llegar en HTG: el envío más pequeño (en pesos) que llegue al menos a eso.
function desdeRecibe(recibe: bigint, t: TarifaEnvio): Resultado {
  const tasa = escalar(t.tasa, 6)
  let enviado = (recibe * 1_000_000n) / tasa
  while (dividir(enviado * tasa, 1_000_000n) < recibe) enviado += 1n
  while (enviado > 1n && dividir((enviado - 1n) * tasa, 1_000_000n) >= recibe) enviado -= 1n
  return desdeEnviado(enviado, t)
}

// Lo que trae el cliente en total: el envío más grande cuyo total no pase de eso.
function desdeTotal(total: bigint, t: TarifaEnvio): Resultado {
  const pct = escalar(t.comision_pct, 2)
  const totalDe = (e: bigint) => e + dividir(e * pct, 10_000n)
  let enviado = (total * 10_000n) / (10_000n + pct)
  while (enviado > 0n && totalDe(enviado) > total) enviado -= 1n
  while (totalDe(enviado + 1n) <= total) enviado += 1n
  return desdeEnviado(enviado, t)
}

// Montos enteros, sin centavos (decisión del dueño).
const ENTERO = /^\d{1,12}$/

type Modo = 'enviado' | 'total' | 'recibe'

const MODOS: [Modo, string, string][] = [
  ['enviado', 'Monto a enviar (RD$)', 'Lo que el cliente quiere enviar, sin la comisión'],
  ['total', 'Lo que trae el cliente (RD$)', 'Todo el dinero que entrega, con la comisión incluida'],
  ['recibe', 'Lo que debe llegar (HTG)', 'Las gourdes que quiere que reciba el beneficiario'],
]

export default function Calculadora({ token, onSesionVencida }: Props) {
  const [tarifa, setTarifa] = useState<TarifaEnvio | null>(null)
  const [error, setError] = useState('')
  const [modo, setModo] = useState<Modo>('enviado')
  const [monto, setMonto] = useState('')
  const [copiado, setCopiado] = useState(false)

  const cargar = useCallback(async () => {
    try {
      setTarifa((await prepararEnvios(token)).tarifa)
      setError('')
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, onSesionVencida])

  // La tasa se vuelve a pedir al entrar y cada 5 minutos (por si cambia).
  useEffect(() => {
    const primera = setTimeout(() => void cargar(), 0)
    const cada = setInterval(() => void cargar(), 300_000)
    return () => {
      clearTimeout(primera)
      clearInterval(cada)
    }
  }, [cargar])

  const valido = ENTERO.test(monto.trim()) && BigInt(monto.trim()) > 0n
  const n = valido ? BigInt(monto.trim()) : 0n
  const r: Resultado | null =
    tarifa && valido
      ? modo === 'enviado'
        ? desdeEnviado(n, tarifa)
        : modo === 'total'
          ? desdeTotal(n, tarifa)
          : desdeRecibe(n, tarifa)
      : null
  const sin = (v: string) => v.replace(/\.00$/, '')
  // Todo es entero: se muestra sin ".00".
  const pesos = (v: string) => dinero(v).replace(/\.00$/, '')
  const gourdes = (v: string) => pesos(v).replace('RD$', 'HTG ')
  const tasaTexto = tarifa ? tarifa.tasa.replace(/\.?0+$/, '') : ''
  const pctTexto = tarifa ? tarifa.comision_pct.replace(/\.?0+$/, '') : ''

  async function copiar() {
    if (!r) return
    const t = [
      'SCITO TRANSFER',
      `Monto enviado: ${pesos(r.enviado)}`,
      `Tasa: 1 RD$ = ${tasaTexto} HTG`,
      `Recibe en Haití: ${gourdes(r.recibe)}`,
      `Comisión (${pctTexto}%): ${pesos(r.comision)}`,
      `Total a pagar: ${pesos(r.total)}`,
    ].join('\n')
    try {
      await navigator.clipboard.writeText(t)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      setError('No se pudo copiar: seleccione el texto a mano')
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="mb-1 text-xl font-medium">Calculadora</h1>
          <p className="text-sm text-gray-500">RD$ ↔ HTG con la tasa y la comisión vigentes de SCITO TRANSFER.</p>
        </div>
        <button type="button" onClick={() => void cargar()} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="Actualizar la tasa" title="Actualizar la tasa">
          <RefreshCw size={16} />
        </button>
      </div>
      {error && <div className="mb-3"><CajaError>{error}</CajaError></div>}
      {!tarifa ? (
        !error && <div className="text-gray-500">Cargando la tasa…</div>
      ) : (
        <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5">
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
            Tasa de hoy: <span className="font-medium">1 RD$ = {tasaTexto} HTG</span> · comisión <span className="font-medium">{pctTexto}%</span>
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <span className="text-gray-600">¿Qué sabe el cliente?</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {MODOS.map(([id, nombre, ayuda]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setModo(id)}
                  title={ayuda}
                  className={`rounded-lg border px-3 py-2 text-left ${modo === id ? 'border-[#C8102E] bg-red-50 font-medium text-[#C8102E]' : 'border-gray-300 hover:bg-gray-50'}`}
                >
                  {nombre}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-500">{MODOS.find((m) => m[0] === modo)?.[2]}.</span>
          </div>

          <label className="flex flex-col gap-1 text-sm text-gray-600">
            {MODOS.find((m) => m[0] === modo)?.[1]}
            <input
              type="text"
              inputMode="decimal"
              value={monto}
              onChange={(e) => setMonto(e.target.value.replace(/[,\s]/g, ''))}
              placeholder="0"
              className={`${CAMPO} h-14 text-2xl`}
              autoFocus
            />
            {monto.trim() !== '' && !valido && <span className="text-xs text-red-600">Escriba un número entero, sin centavos.</span>}
          </label>

          <div className="flex items-center justify-center text-gray-300">
            <ArrowDownUp size={20} />
          </div>

          <dl className="flex flex-col gap-2 rounded-lg border border-gray-100 p-4">
            <div className="flex justify-between text-sm">
              <dt className="text-gray-500">Monto enviado</dt>
              <dd className={modo === 'enviado' ? 'font-medium' : ''}>{r ? pesos(r.enviado) : '—'}</dd>
            </div>
            <div className="flex justify-between text-sm">
              <dt className="text-gray-500">Comisión ({pctTexto}%)</dt>
              <dd>{r ? pesos(r.comision) : '—'}</dd>
            </div>
            <div className="flex justify-between text-xl font-medium">
              <dt>Total a pagar</dt>
              <dd>{r ? pesos(r.total) : '—'}</dd>
            </div>
            <div className="mt-1 flex justify-between border-t border-gray-100 pt-2 text-xl font-medium text-green-800">
              <dt>Recibe en Haití</dt>
              <dd>{r ? gourdes(r.recibe) : '—'}</dd>
            </div>
            {r && modo === 'total' && sin(r.total) !== String(n) && (
              <p className="text-xs text-gray-500">Sobran RD${(n - BigInt(sin(r.total))).toString()} para devolver al cliente (no alcanzan para un peso más de envío).</p>
            )}
            {r && modo === 'recibe' && sin(r.recibe) !== String(n) && (
              <p className="text-xs text-gray-500">Por el redondeo llega {gourdes(r.recibe)}, lo más cercano a lo pedido sin quedarse corto.</p>
            )}
          </dl>

          <button type="button" onClick={() => void copiar()} disabled={!r} className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-lg border border-gray-300 bg-white px-4 text-sm hover:bg-gray-50 disabled:opacity-50">
            {copiado ? <Check size={16} className="text-green-700" /> : <Copy size={16} />}
            {copiado ? 'Copiado' : 'Copiar para WhatsApp'}
          </button>
          <p className="text-xs text-gray-500">
            Es solo un cálculo: no registra nada. Para hacer el envío, use SCITO TRANSFER → Nuevo envío con el “Monto enviado”.
          </p>
        </div>
      )}
    </div>
  )
}
