// Conciliación bancaria (Bancos).
import { llamar } from './api'

export type FilaConciliacion = {
  id: string
  codigo: string
  fecha_corte: string
  saldo_banco: string
  estado: 'abierta' | 'cerrada' | 'descartada'
  saldo_sistema: string | null
  en_transito: string | null
  notas: string | null
  motivo_descarte: string | null
  creada_por: string
  cerrada_por: string | null
  cerrada_en: string | null
}

export type MovimientoConciliacion = {
  id: string
  tipo: string
  signo: number
  monto: string
  fecha: string
  estado: 'confirmado' | 'por_confirmar' | 'no_llego'
  motivo: string | null
  referencia: string | null
  beneficiario: string | null
  venta: string | null
  cotejado: boolean
}

export type TotalesConciliacion = {
  saldoSistema: string
  transitoEntradas: string
  transitoSalidas: string
  enTransito: string
  saldoAjustado: string
  saldoBanco: string
  diferencia: string
  cotejados: number
}

export type DetalleConciliacion = {
  conciliacion: { id: string; codigo: string; cuenta_id: string; fecha_corte: string; saldo_banco: string; estado: FilaConciliacion['estado']; notas: string | null }
  cuenta: { id: string; nombre: string; moneda: string; simbolo: string }
  movimientos: MovimientoConciliacion[]
  totales: TotalesConciliacion
  contable: { cuenta: string; saldoContable: string; saldoSistemaDop: string; diferencia: string } | null
}

export const listarConciliaciones = (token: string, cuentaId: string) =>
  llamar<FilaConciliacion[]>('GET', `/conciliaciones?${new URLSearchParams({ cuentaId }).toString()}`, token)

export const detalleConciliacion = (token: string, id: string) =>
  llamar<DetalleConciliacion>('GET', `/conciliaciones/${id}`, token)

export const crearConciliacion = (token: string, datos: { cuentaId: string; fechaCorte: string; saldoBanco: string; notas?: string }) =>
  llamar<{ id: string; codigo: string }>('POST', '/conciliaciones', token, datos)

export const editarConciliacion = (token: string, id: string, datos: { saldoBanco: string; notas?: string }) =>
  llamar<{ ok: boolean }>('PATCH', `/conciliaciones/${id}`, token, datos)

export const marcarConciliacion = (token: string, id: string, movimientos: { id: string; cotejado: boolean }[]) =>
  llamar<{ totales: TotalesConciliacion }>('PUT', `/conciliaciones/${id}/partidas`, token, { movimientos })

export const cerrarConciliacion = (token: string, id: string) =>
  llamar<{ ok: boolean; confirmados: number }>('POST', `/conciliaciones/${id}/cerrar`, token)

export const descartarConciliacion = (token: string, id: string, motivo: string) =>
  llamar<{ ok: boolean }>('POST', `/conciliaciones/${id}/descartar`, token, { motivo })
