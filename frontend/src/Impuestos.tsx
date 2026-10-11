import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, CalendarClock, Plus, Power, PowerOff } from 'lucide-react'
import {
  SesionVencida,
  cambiarEstadoImpuesto,
  crearImpuesto,
  listarImpuestos,
  nuevaTasaImpuesto,
} from './api'
import type { FilaImpuesto } from './api'
import {
  AREA,
  BOTON_PELIGRO,
  BOTON_PRINCIPAL,
  BOTON_SECUNDARIO,
  CAMPO,
  CajaError,
  Ventana,
} from './componentes'
import { mensajeDe, porcentaje } from './formato'

type Props = {
  token: string
  puedeGestionar: boolean
  onSesionVencida: () => void
}

type PropsForm = {
  token: string
  onListo: () => void
  onCancelar: () => void
  onSesionVencida: () => void
}

type Modal =
  | { tipo: 'crear' }
  | { tipo: 'tasa'; fila: FilaImpuesto }
  | { tipo: 'estado'; fila: FilaImpuesto }
  | null

const AVISO_CONTADOR =
  'Las tasas son valores de configuración que debe confirmar su contador. El sistema no decide qué tasa corresponde.'

function hoy(): string {
  return new Date().toLocaleDateString('en-CA') // AAAA-MM-DD
}

function NuevoImpuesto({ token, onListo, onCancelar, onSesionVencida }: PropsForm) {
  const [codigo, setCodigo] = useState('')
  const [nombre, setNombre] = useState('')
  const [tasa, setTasa] = useState('')
  const [desde, setDesde] = useState(hoy())
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      await crearImpuesto(token, {
        codigo,
        nombre,
        tasa: tasa.trim(),
        vigenteDesde: desde,
      })
      onListo()
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Código
          <input
            type="text"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toLowerCase())}
            placeholder="itbis_reducido"
            autoComplete="off"
            className={CAMPO}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Nombre
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className={CAMPO}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Tasa (%)
          <input
            type="text"
            inputMode="decimal"
            value={tasa}
            onChange={(e) => setTasa(e.target.value)}
            placeholder="0.00"
            className={CAMPO}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Vigente desde
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className={CAMPO}
          />
        </label>
      </div>
      <p className="text-xs text-gray-500">{AVISO_CONTADOR}</p>
      {error && <CajaError>{error}</CajaError>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className={BOTON_SECUNDARIO}>
          Cancelar
        </button>
        <button type="submit" disabled={guardando} className={BOTON_PRINCIPAL}>
          {guardando ? 'Guardando…' : 'Crear impuesto'}
        </button>
      </div>
    </form>
  )
}

function NuevaTasa({
  token,
  fila,
  onListo,
  onCancelar,
  onSesionVencida,
}: PropsForm & { fila: FilaImpuesto }) {
  const [tasa, setTasa] = useState('')
  const [desde, setDesde] = useState(hoy())
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      await nuevaTasaImpuesto(token, fila.id, {
        tasa: tasa.trim(),
        vigenteDesde: desde,
        motivo,
      })
      onListo()
    } catch (err) {
      if (err instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(err))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <p className="text-sm text-gray-600">
        Tasa actual de {fila.nombre}:{' '}
        <span className="font-medium">
          {fila.tasa_vigente ? porcentaje(fila.tasa_vigente) : 'sin tasa vigente'}
        </span>
        . La tasa anterior no se borra: queda en el historial hasta el día
        antes de la nueva fecha. Todos los servicios con este impuesto usarán
        la nueva tasa desde esa fecha.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Nueva tasa (%)
          <input
            type="text"
            inputMode="decimal"
            value={tasa}
            onChange={(e) => setTasa(e.target.value)}
            className={CAMPO}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Vigente desde
          <input
            type="date"
            value={desde}
            min={hoy()}
            onChange={(e) => setDesde(e.target.value)}
            className={CAMPO}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm text-gray-600">
        Motivo (ej: confirmado por el contador, norma que lo establece)
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={2}
          className={AREA}
        />
      </label>
      <p className="text-xs text-gray-500">{AVISO_CONTADOR}</p>
      {error && <CajaError>{error}</CajaError>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className={BOTON_SECUNDARIO}>
          Cancelar
        </button>
        <button type="submit" disabled={guardando} className={BOTON_PELIGRO}>
          <AlertTriangle size={16} />
          {guardando ? 'Guardando…' : 'Programar nueva tasa'}
        </button>
      </div>
    </form>
  )
}

function ConfirmarEstado({
  token,
  fila,
  onListo,
  onCancelar,
  onSesionVencida,
}: PropsForm & { fila: FilaImpuesto }) {
  const activar = !fila.is_active
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function confirmar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      await cambiarEstadoImpuesto(token, fila.id, activar, motivo.trim() || undefined)
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
          ? `¿Activar ${fila.nombre}? Volverá a poder elegirse en los servicios.`
          : `¿Desactivar ${fila.nombre}? No podrá elegirse en servicios nuevos. Solo es posible si ningún servicio activo lo usa.`}
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

export default function Impuestos({ token, puedeGestionar, onSesionVencida }: Props) {
  const [filas, setFilas] = useState<FilaImpuesto[] | null>(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [modal, setModal] = useState<Modal>(null)

  const cargar = useCallback(async () => {
    try {
      setFilas(await listarImpuestos(token))
      setError('')
    } catch (e) {
      if (e instanceof SesionVencida) onSesionVencida()
      else setError(mensajeDe(e))
    }
  }, [token, onSesionVencida])

  useEffect(() => {
    const espera = setTimeout(() => void cargar(), 0)
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
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-2xl text-sm text-gray-500">{AVISO_CONTADOR}</p>
        {puedeGestionar && (
          <button
            type="button"
            onClick={() => abrir({ tipo: 'crear' })}
            className={BOTON_PRINCIPAL}
          >
            <Plus size={16} />
            Nuevo impuesto
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

      {filas && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 text-left text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Impuesto</th>
                <th className="px-4 py-3 font-medium">Tasa vigente hoy</th>
                <th className="px-4 py-3 font-medium">Historial de tasas</th>
                <th className="px-4 py-3 font-medium">Servicios activos</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                {puedeGestionar && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-b border-gray-100 align-top last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{f.nombre}</div>
                    <div className="font-mono text-xs text-gray-500">{f.codigo}</div>
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {f.tasa_vigente ? porcentaje(f.tasa_vigente) : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {f.tasas.map((t) => (
                      <div key={t.vigente_desde}>
                        {porcentaje(t.tasa)} desde {t.vigente_desde}
                        {t.vigente_hasta ? ` hasta ${t.vigente_hasta}` : ''}
                      </div>
                    ))}
                  </td>
                  <td className="px-4 py-3">{f.servicios_activos}</td>
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
                  {puedeGestionar && (
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => abrir({ tipo: 'tasa', fila: f })}
                        className="mr-3 inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                      >
                        <CalendarClock size={14} />
                        Nueva tasa
                      </button>
                      <button
                        type="button"
                        onClick={() => abrir({ tipo: 'estado', fila: f })}
                        className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                      >
                        {f.is_active ? <PowerOff size={14} /> : <Power size={14} />}
                        {f.is_active ? 'Desactivar' : 'Activar'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal?.tipo === 'crear' && (
        <Ventana titulo="Nuevo impuesto" onCerrar={() => setModal(null)}>
          <NuevoImpuesto
            token={token}
            onListo={() => terminado('Impuesto creado')}
            onCancelar={() => setModal(null)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
      {modal?.tipo === 'tasa' && (
        <Ventana titulo={`Nueva tasa: ${modal.fila.nombre}`} onCerrar={() => setModal(null)}>
          <NuevaTasa
            token={token}
            fila={modal.fila}
            onListo={() => terminado('Nueva tasa programada')}
            onCancelar={() => setModal(null)}
            onSesionVencida={onSesionVencida}
          />
        </Ventana>
      )}
      {modal?.tipo === 'estado' && (
        <Ventana
          titulo={modal.fila.is_active ? 'Desactivar impuesto' : 'Activar impuesto'}
          onCerrar={() => setModal(null)}
        >
          <ConfirmarEstado
            token={token}
            fila={modal.fila}
            onListo={() =>
              terminado(
                modal.fila.is_active ? 'Impuesto desactivado' : 'Impuesto activado',
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
