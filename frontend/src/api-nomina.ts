// Nómina: empleados, adelantos, nóminas (regular, regalía y vacaciones) y
// valores de ley.
import { llamar } from './api'

export type Frecuencia = 'semanal' | 'quincenal' | 'mensual'
export type TipoNomina = 'regular' | 'regalia' | 'vacaciones'
export type EstadoNomina = 'borrador' | 'pagada' | 'anulada' | 'descartada'

export type ParametrosNomina = {
  dias_mes: string
  horas_dia: string
  semanas_mes: string
  recargo_extra: string
  recargo_extra_alto: string
  vacaciones_dias: string
  vacaciones_dias_5: string
}

export type PrepararNomina = {
  hoy: string
  cajas: { id: string; nombre: string; sesion_id: string | null }[]
  cuentas: { id: string; nombre: string }[]
  empleadosPorFrecuencia: { frecuencia: Frecuencia; empleados: number }[]
  parametros: ParametrosNomina
}

export type Empleado = {
  id: string
  codigo: string
  nombre: string
  documento: string | null
  telefono: string | null
  direccion: string | null
  cargo: string | null
  fecha_ingreso: string
  frecuencia: Frecuencia
  sueldo_mensual: string
  forma_pago: 'efectivo' | 'banco'
  cuenta_empleado: string | null
  notas: string | null
  is_active: boolean
  fecha_salida: string | null
  debe: string
}

export type DatosEmpleado = {
  nombre: string
  documento: string
  telefono: string
  direccion: string
  cargo: string
  fechaIngreso: string
  frecuencia: Frecuencia
  sueldoMensual: string
  formaPago: 'efectivo' | 'banco'
  cuentaEmpleado: string
  notas: string
}

export type Adelanto = {
  id: string
  codigo: string
  empleado_id: string
  empleado: string
  codigo_empleado: string
  fecha: string
  monto: string
  cuota: string
  forma: 'efectivo' | 'banco'
  motivo: string
  estado: 'activo' | 'anulado'
  motivo_anulacion: string | null
  saldo: string
  usuario: string
}

export type FilaNomina = {
  id: string
  codigo: string
  tipo: TipoNomina
  frecuencia: Frecuencia | null
  desde: string
  hasta: string
  estado: EstadoNomina
  total: string
  fecha_pago: string | null
  notas: string | null
  empleados: number
}

export type LineaNomina = {
  id: string
  empleadoId: string
  codigo: string
  nombre: string
  cargo: string | null
  sueldoMensual: string
  valorHora: string
  formaPago: 'efectivo' | 'banco'
  dias: string | null
  sueldo: string
  horasExtra: string
  horasExtraAlto: string
  montoExtra: string
  comisiones: string
  bonos: string
  adelantos: string
  otrosDescuentos: string
  motivoDescuento: string | null
  neto: string
  notas: string | null
  debe: string
}

export type DetalleNomina = FilaNomina & {
  nombreTipo: string
  motivo_anulacion: string | null
  creada_por: string
  pagada_por: string | null
  anulada_por: string | null
  lineas: LineaNomina[]
  totales: {
    sueldo: string
    extra: string
    comisiones: string
    bonos: string
    adelantos: string
    otrosDescuentos: string
    neto: string
    efectivo: string
    banco: string
  }
}

export type CambioLinea = Partial<{
  sueldo: string
  dias: string
  horasExtra: string
  horasExtraAlto: string
  comisiones: string
  bonos: string
  adelantos: string
  otrosDescuentos: string
  motivoDescuento: string
  formaPago: 'efectivo' | 'banco'
  notas: string
}>

export type HistorialParametro = {
  clave: keyof ParametrosNomina
  valor: string
  vigente_desde: string
  motivo: string
  usuario: string | null
}

export const prepararNomina = (token: string) => llamar<PrepararNomina>('GET', '/nomina/preparar', token)

// ---------- Empleados ----------

export function listarEmpleados(token: string, texto: string, estado: 'activos' | 'inactivos' | 'todos') {
  const q = new URLSearchParams({ estado })
  if (texto.trim()) q.set('texto', texto.trim())
  return llamar<Empleado[]>('GET', `/nomina/empleados?${q.toString()}`, token)
}

export const crearEmpleado = (token: string, d: DatosEmpleado) =>
  llamar<{ id: string; codigo: string }>('POST', '/nomina/empleados', token, d)

export const editarEmpleado = (token: string, id: string, d: DatosEmpleado) =>
  llamar<{ id: string; cambios: number }>('PATCH', `/nomina/empleados/${id}`, token, d)

export const estadoEmpleado = (token: string, id: string, activo: boolean, motivo: string, fechaSalida?: string) =>
  llamar<{ id: string }>('PATCH', `/nomina/empleados/${id}/estado`, token, { activo, motivo, fechaSalida })

// ---------- Adelantos ----------

export function listarAdelantos(token: string, estado: 'pendientes' | 'todos', empleadoId?: string) {
  const q = new URLSearchParams({ estado })
  if (empleadoId) q.set('empleadoId', empleadoId)
  return llamar<Adelanto[]>('GET', `/nomina/adelantos?${q.toString()}`, token)
}

export const darAdelanto = (
  token: string,
  d: { empleadoId: string; monto: string; cuota: string; forma: 'efectivo' | 'banco'; cajaId?: string; cuentaId?: string; motivo: string },
) => llamar<{ id: string; codigo: string }>('POST', '/nomina/adelantos', token, d)

export const cambiarCuota = (token: string, id: string, cuota: string) =>
  llamar<{ id: string }>('PATCH', `/nomina/adelantos/${id}/cuota`, token, { cuota })

export const anularAdelanto = (token: string, id: string, motivo: string, cajaId?: string) =>
  llamar<{ id: string }>('POST', `/nomina/adelantos/${id}/anular`, token, { motivo, cajaId })

// ---------- Nóminas ----------

export function listarNominas(token: string, estado: '' | EstadoNomina, pagina: number) {
  const q = new URLSearchParams({ pagina: String(pagina) })
  if (estado) q.set('estado', estado)
  return llamar<{ filas: FilaNomina[]; total: number; pagina: number; porPagina: number }>(
    'GET',
    `/nomina/nominas?${q.toString()}`,
    token,
  )
}

export const detalleNomina = (token: string, id: string) => llamar<DetalleNomina>('GET', `/nomina/nominas/${id}`, token)

export const crearNomina = (
  token: string,
  d: { tipo: TipoNomina; frecuencia?: Frecuencia; desde: string; hasta: string; empleadoIds?: string[]; notas?: string },
) => llamar<{ id: string; codigo: string }>('POST', '/nomina/nominas', token, d)

export const agregarEmpleadoNomina = (token: string, id: string, empleadoId: string) =>
  llamar<{ id: string }>('POST', `/nomina/nominas/${id}/empleados`, token, { empleadoId })

export const quitarLineaNomina = (token: string, id: string, lineaId: string) =>
  llamar<{ id: string }>('DELETE', `/nomina/nominas/${id}/lineas/${lineaId}`, token)

export const editarLineaNomina = (token: string, id: string, lineaId: string, d: CambioLinea) =>
  llamar<{ neto: string; montoExtra: string; total: string }>('PATCH', `/nomina/nominas/${id}/lineas/${lineaId}`, token, d)

export const descartarNomina = (token: string, id: string, motivo: string) =>
  llamar<{ id: string }>('POST', `/nomina/nominas/${id}/descartar`, token, { motivo })

export const pagarNomina = (token: string, id: string, d: { cajaId?: string; cuentaId?: string }) =>
  llamar<{ codigo: string; total: string; efectivo: string; banco: string }>('POST', `/nomina/nominas/${id}/pagar`, token, d)

export const anularNomina = (token: string, id: string, motivo: string, cajaId?: string) =>
  llamar<{ id: string }>('POST', `/nomina/nominas/${id}/anular`, token, { motivo, cajaId })

// ---------- Valores de ley ----------

export const listarParametros = (token: string) =>
  llamar<{ hoy: string; vigentes: ParametrosNomina; historial: HistorialParametro[] }>('GET', '/nomina/parametros', token)

export const nuevoParametro = (
  token: string,
  d: { clave: keyof ParametrosNomina; valor: string; vigenteDesde: string; motivo: string },
) => llamar<{ clave: string }>('POST', '/nomina/parametros', token, d)
