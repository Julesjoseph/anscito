// La dirección del servidor se configura al arrancar (ver entorno.ts).
import { API_URL } from './entorno'
import type { DatosTicket, TicketFilas } from './ticket'
export { API_URL }

export type Usuario = {
  id: string
  username: string
  nombre: string
  apellido: string
}

export type Perfil = Usuario & {
  roles: string[]
  permisos: string[]
  must_change_password: boolean
}

export type FilaUsuario = {
  id: string
  username: string
  nombre: string
  apellido: string
  is_active: boolean
  last_login_at: string | null
  locked_until: string | null
  roles: string
  rol_id: string | null
  // Todos sus roles (los permisos son la suma de todos).
  rol_ids: string[]
  sucursal_id: string | null
  sucursal: string | null
}

export type Rol = { id: string; codigo: string; nombre: string }

export class SesionVencida extends Error {}

async function llamar<T>(
  metodo: string,
  ruta: string,
  token: string,
  cuerpo?: unknown,
): Promise<T> {
  const res = await fetch(`${API_URL}${ruta}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  })
  if (res.status === 401) throw new SesionVencida('Sesión vencida')
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    const mensaje = Array.isArray(data?.message)
      ? data.message.join(', ')
      : data?.message
    throw new Error(mensaje ?? 'No se pudo completar la operación')
  }
  return (await res.json()) as T
}

export const obtenerPerfil = (token: string) =>
  llamar<Perfil>('GET', '/auth/me', token)

export const listarUsuarios = (token: string) =>
  llamar<FilaUsuario[]>('GET', '/usuarios', token)

export const listarRoles = (token: string) =>
  llamar<Rol[]>('GET', '/roles', token)

export const crearUsuario = (
  token: string,
  datos: {
    username: string
    nombre: string
    apellido: string
    password: string
    rolIds: string[]
    sucursalId: string
  },
) => llamar<{ id: string }>('POST', '/usuarios', token, datos)

export const editarUsuario = (
  token: string,
  id: string,
  datos: { nombre: string; apellido: string; rolIds: string[]; sucursalId: string },
) => llamar<{ ok: boolean }>('PATCH', `/usuarios/${id}`, token, datos)

export const cambiarEstadoUsuario = (
  token: string,
  id: string,
  isActive: boolean,
  motivo?: string,
) =>
  llamar<{ ok: boolean }>('PATCH', `/usuarios/${id}/estado`, token, {
    is_active: isActive,
    motivo,
  })

export const resetearPassword = (token: string, id: string) =>
  llamar<{ username: string; passwordTemporal: string }>(
    'POST',
    `/usuarios/${id}/resetear-password`,
    token,
  )

export const desbloquearUsuario = (token: string, id: string) =>
  llamar<{ ok: boolean }>('POST', `/usuarios/${id}/desbloquear`, token)

export async function login(username: string, password: string) {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.message ?? 'No se pudo iniciar sesión')
  }
  return (await res.json()) as {
    token: string
    usuario: Usuario
    debeCambiarPassword: boolean
  }
}
export const cambiarPassword = (token: string, actual: string, nueva: string) =>
  llamar<{ ok: boolean }>('POST', '/auth/cambiar-password', token, {
    actual,
    nueva,
  })

// ---------- Servicios e impuestos ----------

export type Desglose = { base: string; itbis: string; total: string }

export type FilaServicio = {
  id: string
  codigo: string
  nombre: string
  descripcion: string | null
  unidad_negocio_id: string
  unidad_negocio: string
  categoria_id: string | null
  categoria: string | null
  unidad_medida_id: string
  unidad_medida: string
  precio: string
  moneda: 'DOP' | 'USD' // del precio y del costo
  costo: string | null
  impuesto_id: string
  impuesto: string
  tasa: string | null
  precio_incluye_itbis: boolean
  // Ganancia por costo (precio − costo) o por comisión (precio × %).
  ganancia_tipo: 'costo' | 'comision'
  comision_pct: string | null
  por_cuenta_tercero: boolean // con comisión: el resto del cobro es de un tercero
  is_active: boolean
  calculo: Desglose | null
}

export type Opcion = { id: string; codigo: string; nombre: string }
export type ImpuestoVigente = Opcion & { tasa: string }

export type CategoriaOpcion = {
  id: string
  nombre: string
  unidad_negocio_id: string
  impuesto_id: string | null // impuesto sugerido para sus servicios
}

export type CatalogosServicios = {
  unidadesNegocio: Opcion[]
  categorias: CategoriaOpcion[]
  unidadesMedida: Opcion[]
  impuestos: ImpuestoVigente[]
}

export type DatosServicio = {
  codigo: string
  nombre: string
  descripcion: string
  unidadNegocioId: string
  categoriaId: string
  unidadMedidaId: string
  precio: string
  moneda: 'DOP' | 'USD'
  costo: string
  impuestoId: string
  precioIncluyeItbis: boolean
  gananciaTipo: 'costo' | 'comision'
  comisionPct: string
  porCuentaTercero: boolean
}

export type FiltrosServicios = {
  texto: string
  unidadNegocioId: string
  categoriaId: string
  estado: 'activos' | 'inactivos' | 'todos'
}

export const listarServicios = (token: string, f: FiltrosServicios) => {
  const q = new URLSearchParams({ estado: f.estado })
  if (f.texto.trim()) q.set('texto', f.texto.trim())
  if (f.unidadNegocioId) q.set('unidadNegocioId', f.unidadNegocioId)
  if (f.categoriaId) q.set('categoriaId', f.categoriaId)
  return llamar<FilaServicio[]>('GET', `/servicios?${q.toString()}`, token)
}

export const catalogosServicios = (token: string) =>
  llamar<CatalogosServicios>('GET', '/servicios/catalogos', token)

export const calcularServicio = (
  token: string,
  datos: { precio: string; impuestoId: string; precioIncluyeItbis: boolean },
) =>
  llamar<Desglose & { tasa: string }>(
    'POST',
    '/servicios/calcular',
    token,
    datos,
  )

export const crearServicio = (token: string, datos: DatosServicio) =>
  llamar<{ id: string }>('POST', '/servicios', token, datos)

export const editarServicio = (token: string, id: string, datos: DatosServicio) =>
  llamar<{ ok: boolean }>('PATCH', `/servicios/${id}`, token, datos)

export const cambiarEstadoServicio = (
  token: string,
  id: string,
  isActive: boolean,
  motivo?: string,
) =>
  llamar<{ ok: boolean }>('PATCH', `/servicios/${id}/estado`, token, {
    is_active: isActive,
    motivo,
  })

export type TasaHistorial = {
  tasa: string
  vigente_desde: string
  vigente_hasta: string | null
}

export type FilaImpuesto = {
  id: string
  codigo: string
  nombre: string
  is_active: boolean
  tasa_vigente: string | null
  tasas: TasaHistorial[]
  servicios_activos: number
}

export const listarImpuestos = (token: string) =>
  llamar<FilaImpuesto[]>('GET', '/impuestos', token)

export const crearImpuesto = (
  token: string,
  datos: { codigo: string; nombre: string; tasa: string; vigenteDesde: string },
) => llamar<{ id: string }>('POST', '/impuestos', token, datos)

export const nuevaTasaImpuesto = (
  token: string,
  id: string,
  datos: { tasa: string; vigenteDesde: string; motivo: string },
) => llamar<{ ok: boolean }>('POST', `/impuestos/${id}/tasas`, token, datos)

export const cambiarEstadoImpuesto = (
  token: string,
  id: string,
  isActive: boolean,
  motivo?: string,
) =>
  llamar<{ ok: boolean }>('PATCH', `/impuestos/${id}/estado`, token, {
    is_active: isActive,
    motivo,
  })

// ---------- Roles y permisos ----------

export type Permiso = {
  id: string
  codigo: string
  modulo: string
  accion: string
  descripcion: string | null
}

export type FilaRol = {
  id: string
  codigo: string
  nombre: string
  descripcion: string | null
  is_system: boolean
  is_active: boolean
  permisos: string[]
  usuarios: number
}

export type DatosRol = {
  codigo?: string
  nombre: string
  descripcion: string
  permisos: string[]
}

export const listarRolesGestion = (token: string) =>
  llamar<FilaRol[]>('GET', '/roles/gestion', token)

export const listarPermisos = (token: string) =>
  llamar<Permiso[]>('GET', '/roles/permisos', token)

export const crearRol = (token: string, datos: DatosRol) =>
  llamar<{ id: string }>('POST', '/roles', token, datos)

export const editarRol = (token: string, id: string, datos: DatosRol) =>
  llamar<{ ok: boolean }>('PATCH', `/roles/${id}`, token, datos)

export const cambiarEstadoRol = (
  token: string,
  id: string,
  isActive: boolean,
  motivo?: string,
) =>
  llamar<{ ok: boolean }>('PATCH', `/roles/${id}/estado`, token, {
    is_active: isActive,
    motivo,
  })

// ---------- Unidades de negocio y categorías (universales) ----------

export type CategoriaArbol = {
  id: string
  nombre: string
  descripcion: string | null
  is_active: boolean
  prefijo: string | null
  proximo: string | null
  impuesto_id: string | null // impuesto sugerido (vacío = sin sugerencia)
  servicios_activos: number
  productos_activos: number
  productos: number
}

export type UnidadArbol = {
  id: string
  codigo: string
  nombre: string
  is_active: boolean
  servicios_activos: number
  productos_activos: number
  categorias: CategoriaArbol[]
}

export type DatosCategoria = {
  unidadNegocioId: string
  nombre: string
  descripcion: string
  prefijo: string
  impuestoId: string // vacío = sin sugerencia
}

export const impuestosCategorias = (token: string) =>
  llamar<{ id: string; codigo: string; nombre: string }[]>('GET', '/categorias/impuestos', token)

export const arbolCategorias = (token: string) =>
  llamar<UnidadArbol[]>('GET', '/unidades-negocio', token)

export const crearUnidad = (token: string, nombre: string) =>
  llamar<{ id: string }>('POST', '/unidades-negocio', token, { nombre })

export const editarUnidad = (token: string, id: string, nombre: string) =>
  llamar<{ ok: boolean }>('PATCH', `/unidades-negocio/${id}`, token, { nombre })

export const estadoUnidad = (
  token: string,
  id: string,
  isActive: boolean,
  motivo?: string,
) =>
  llamar<{ ok: boolean }>('PATCH', `/unidades-negocio/${id}/estado`, token, {
    is_active: isActive,
    motivo,
  })

export const crearCategoria = (token: string, datos: DatosCategoria) =>
  llamar<{ id: string }>('POST', '/categorias', token, datos)

export const editarCategoria = (
  token: string,
  id: string,
  datos: DatosCategoria,
) => llamar<{ ok: boolean }>('PATCH', `/categorias/${id}`, token, datos)

export const estadoCategoria = (
  token: string,
  id: string,
  isActive: boolean,
  motivo?: string,
) =>
  llamar<{ ok: boolean }>('PATCH', `/categorias/${id}/estado`, token, {
    is_active: isActive,
    motivo,
  })

// ---------- Inventario: productos ----------

export type CategoriaProducto = {
  id: string
  nombre: string
  prefijo: string | null
  impuesto_id: string | null // impuesto sugerido para sus productos
  unidad_negocio: string
  proximo: string | null
}

export type UnidadMedida = {
  id: string
  codigo: string
  nombre: string
  permite_decimales: boolean
}

export type CatalogosInventario = {
  categorias: CategoriaProducto[]
  unidades: UnidadMedida[]
  impuestos: ImpuestoVigente[]
}

export type FilaProducto = {
  id: string
  codigo: string
  nombre: string
  categoria_id: string
  categoria: string
  unidad_negocio: string
  unidad_id: string
  unidad: string
  permite_decimales: boolean
  impuesto_id: string
  impuesto: string
  tasa: string | null
  precio_venta: string | null
  precio_incluye_itbis: boolean
  stock_minimo: string | null
  is_active: boolean
  existencia_inicial: string
  entradas: string
  salidas: string
  existencia: string
  minimo: string
  alerta: 'bajo' | 'agotado' | null
  venta_total: string | null
  calculo_precio: Desglose | null
  // Solo llegan con el permiso inventario.ver_costos.
  costo?: string
  costo_total?: string
  calculo_costo?: Desglose | null
  rentabilidad?: Rentabilidad | null
}

export type Rentabilidad = {
  ganancia: string
  margen: string | null
  sobreCosto: string | null
}

export type PaginaProductos = {
  filas: FilaProducto[]
  total: number
  pagina: number
  porPagina: number
  verCostos: boolean
  totales: {
    venta_total: string
    costo_total?: string
    ganancia_total?: string
    margen_total?: string | null
  }
  alertas: { bajo: number; agotado: number }
  stockMinimoPorDefecto: string
}

export type FiltrosProductos = {
  texto: string
  categoriaId: string
  estado: 'activos' | 'inactivos' | 'todos'
  soloAlertas: boolean
  pagina: number
}

export type DatosProducto = {
  nombre: string
  categoriaId: string
  unidadId: string
  costo: string
  impuestoId: string
  precioVenta: string
  precioIncluyeItbis: boolean
  stockMinimo: string
  existenciaInicial?: string
}

export const listarProductos = (token: string, f: FiltrosProductos) => {
  const q = new URLSearchParams({ estado: f.estado, pagina: String(f.pagina) })
  if (f.texto.trim()) q.set('texto', f.texto.trim())
  if (f.categoriaId) q.set('categoriaId', f.categoriaId)
  if (f.soloAlertas) q.set('alerta', 'si')
  return llamar<PaginaProductos>('GET', `/productos?${q.toString()}`, token)
}

export const catalogosInventario = (token: string) =>
  llamar<CatalogosInventario>('GET', '/productos/catalogos', token)

export const calcularMonto = (
  token: string,
  datos: { monto: string; impuestoId: string; incluyeItbis: boolean },
) =>
  llamar<Desglose & { tasa: string }>(
    'POST',
    '/productos/calcular',
    token,
    datos,
  )

export const crearProducto = (token: string, datos: DatosProducto) =>
  llamar<{ id: string; codigo: string }>('POST', '/productos', token, datos)

export const editarProducto = (
  token: string,
  id: string,
  datos: DatosProducto,
) => llamar<{ ok: boolean }>('PATCH', `/productos/${id}`, token, datos)

export const cambiarEstadoProducto = (
  token: string,
  id: string,
  isActive: boolean,
  motivo?: string,
) =>
  llamar<{ ok: boolean }>('PATCH', `/productos/${id}/estado`, token, {
    is_active: isActive,
    motivo,
  })

// ---------- Inventario: entradas, salidas, ajustes y kárdex ----------

export type MovimientoKardex = {
  id: string
  fecha: string
  tipo: string
  causa: string | null
  cantidad: string
  signo: number
  saldo: string
  costo_unitario?: string
  costo_promedio?: string | null
  proveedor: string | null
  referencia: string | null
  motivo: string | null
  usuario: string
}

export type CorreccionCosto = {
  fecha: string
  anterior: string
  nuevo: string
  motivo: string | null
  usuario: string
}

export type Kardex = {
  producto: { codigo: string; nombre: string; unidad: string }
  movimientos: MovimientoKardex[]
  correcciones: CorreccionCosto[]
  verCostos: boolean
}

export const corregirCosto = (
  token: string,
  id: string,
  datos: { costo: string; motivo: string },
) =>
  llamar<{ costo: string }>('POST', `/productos/${id}/corregir-costo`, token, datos)

export const registrarEntrada = (
  token: string,
  id: string,
  datos: {
    cantidad: string
    // Uno de los dos, sin ITBIS.
    costoUnitario?: string
    costoTotal?: string
    proveedor: string
    referencia: string
    nota: string
  },
) =>
  llamar<{ existencia: string; costo: string; costoUnitario: string }>(
    'POST',
    `/productos/${id}/entradas`,
    token,
    datos,
  )

export const registrarSalida = (
  token: string,
  id: string,
  datos: { cantidad: string; causa: string; motivo: string; referencia: string },
) =>
  llamar<{ existencia: string }>('POST', `/productos/${id}/salidas`, token, datos)

export const ajustarInventario = (
  token: string,
  id: string,
  datos: { conteo: string; motivo: string },
) =>
  llamar<{ existencia: string; tipo: string; diferencia: string }>(
    'POST',
    `/productos/${id}/ajustes`,
    token,
    datos,
  )

export const kardexProducto = (token: string, id: string) =>
  llamar<Kardex>('GET', `/productos/${id}/kardex`, token)

// ---------- Clientes y proveedores ----------

// Ruta de cada lista (son listas separadas con sus propios permisos).
export type RolTercero = 'clientes' | 'proveedores'

export type TipoDocumento = {
  id: string
  codigo: string
  nombre: string
  ayuda: string
}

export type FilaTercero = {
  id: string
  codigo: string | null // SCITO-1801xxxx (solo clientes)
  tipo_documento_id: string | null
  tipo_documento: string | null
  // Enmascarado (********678) sin el permiso terceros.ver_documento.
  numero_documento: string | null
  nombre: string
  nombre_comercial: string | null
  es_contribuyente: boolean
  direccion: string | null
  telefono: string | null
  whatsapp: string | null
  correo: string | null
  notas: string | null
  puede_credito: boolean
  persona_contacto: string | null
  dias_credito: number | null
  es_protegido: boolean
  is_active: boolean
}

export type PaginaTerceros = {
  filas: FilaTercero[]
  total: number
  pagina: number
  porPagina: number
  verDocumento: boolean
}

export type FiltrosTerceros = {
  texto: string
  estado: 'activos' | 'inactivos' | 'todos'
  soloContribuyentes: boolean
  pagina: number
}

export type DatosTercero = {
  tipoDocumentoId: string
  numeroDocumento: string
  nombre: string
  nombreComercial: string
  esContribuyente: boolean
  direccion: string
  telefono: string
  whatsapp: string
  correo: string
  notas: string
  puedeCredito: boolean
  personaContacto: string
  diasCredito: string
}

export const listarTerceros = (
  rol: RolTercero,
  token: string,
  f: FiltrosTerceros,
) => {
  const q = new URLSearchParams({ estado: f.estado, pagina: String(f.pagina) })
  if (f.texto.trim()) q.set('texto', f.texto.trim())
  if (f.soloContribuyentes) q.set('contribuyente', 'si')
  return llamar<PaginaTerceros>('GET', `/${rol}?${q.toString()}`, token)
}

export const tiposDocumento = (rol: RolTercero, token: string) =>
  llamar<TipoDocumento[]>('GET', `/${rol}/tipos-documento`, token)

export const crearTercero = (rol: RolTercero, token: string, datos: DatosTercero) =>
  llamar<{ id: string }>('POST', `/${rol}`, token, datos)

export const editarTercero = (
  rol: RolTercero,
  token: string,
  id: string,
  datos: DatosTercero,
) => llamar<{ ok: boolean }>('PATCH', `/${rol}/${id}`, token, datos)

export const estadoTercero = (
  rol: RolTercero,
  token: string,
  id: string,
  isActive: boolean,
  motivo?: string,
) =>
  llamar<{ ok: boolean }>('PATCH', `/${rol}/${id}/estado`, token, {
    is_active: isActive,
    motivo,
  })

// ---------- Empresa y sucursales ----------

// Pública: se pide antes de iniciar sesión.
export type Marca = {
  nombre_comercial: string
  tiene_logo: boolean
  version: string
}

export async function obtenerMarca(): Promise<Marca> {
  const res = await fetch(`${API_URL}/marca`)
  if (!res.ok) throw new Error('No se pudo cargar la marca')
  return (await res.json()) as Marca
}

export type FichaEmpresa = {
  razon_social: string | null
  nombre_comercial: string
  rnc: string | null
  direccion: string | null
  telefono: string | null
  whatsapp: string | null
  correo: string | null
  sitio_web: string | null
  tiene_logo: boolean
}

export type DatosEmpresa = {
  razonSocial: string
  nombreComercial: string
  rnc: string
  direccion: string
  telefono: string
  whatsapp: string
  correo: string
  sitioWeb: string
}

export const verEmpresa = (token: string) =>
  llamar<FichaEmpresa>('GET', '/empresa', token)

export const editarEmpresa = (token: string, datos: DatosEmpresa) =>
  llamar<{ ok: boolean }>('PATCH', '/empresa', token, datos)

export const subirLogo = (token: string, imagen: string) =>
  llamar<{ ok: boolean }>('PUT', '/empresa/logo', token, { imagen })

export const quitarLogo = (token: string) =>
  llamar<{ ok: boolean }>('DELETE', '/empresa/logo', token)

export type FilaSucursal = {
  id: string
  codigo: string
  nombre: string
  direccion: string | null
  telefono: string | null
  encargado: string | null
  es_principal: boolean
  is_active: boolean
  usuarios: number
}

export type DatosSucursal = {
  codigo: string
  nombre: string
  direccion: string
  telefono: string
  encargado: string
}

export const listarSucursales = (token: string) =>
  llamar<FilaSucursal[]>('GET', '/sucursales', token)

export const crearSucursal = (token: string, datos: DatosSucursal) =>
  llamar<{ id: string }>('POST', '/sucursales', token, datos)

export const editarSucursal = (token: string, id: string, datos: DatosSucursal) =>
  llamar<{ ok: boolean }>('PATCH', `/sucursales/${id}`, token, datos)

export const cambiarEstadoSucursal = (
  token: string,
  id: string,
  isActive: boolean,
  motivo?: string,
) =>
  llamar<{ ok: boolean }>('PATCH', `/sucursales/${id}/estado`, token, {
    is_active: isActive,
    motivo,
  })

export type SucursalOpcion = {
  id: string
  codigo: string
  nombre: string
  es_principal: boolean
}

export const sucursalesParaUsuarios = (token: string) =>
  llamar<SucursalOpcion[]>('GET', '/usuarios/sucursales', token)

// ---------- Ventas ----------

export type FormaPago = {
  id: string
  codigo: string
  nombre: string
  calcula_devuelta: boolean
  requiere_referencia: boolean
  // El efectivo entra a la caja abierta de la computadora.
  usa_caja: boolean
  // La transferencia llega a una cuenta (por confirmar).
  usa_cuenta: boolean
}

export type PrepararVenta = {
  formasPago: FormaPago[]
  cajas: { id: string; nombre: string; sesion_id: string | null }[]
  cuentasVenta: { id: string; nombre: string }[]
  descuentoMaximoPct: string
  puedeDescontar: boolean
  consumidorFinal: { id: string; nombre: string } | null
  // Facturación electrónica: si ya empezó, cada venta deja su e-CF por emitir.
  facturacion: { activa: boolean; umbral: string }
  credito: { puedeVender: boolean; puedeAutorizar: boolean }
  // Tasa del dólar vigente (RD$ por 1 US$), o null si no hay.
  tasaDolar: TasaDolar | null
}

export type TasaDolar = { id: string; tasa: string; vigente_desde: string }

export type ArticuloVenta = {
  tipo: 'producto' | 'servicio'
  id: string
  codigo: string
  nombre: string
  unidad: string
  permite_decimales: boolean
  precio: string // en la moneda del artículo
  moneda: 'DOP' | 'USD'
  precio_incluye_itbis: boolean
  impuesto: string
  tasa: string
  existencia: string | null
}

export type ClienteVenta = {
  id: string
  codigo: string | null
  nombre: string
  nombre_comercial: string | null
  numero_documento: string | null
  es_protegido: boolean
}

export type LineaVentaEntrada = {
  tipo: 'producto' | 'servicio'
  id: string
  cantidad: string
  descuento: string
}

export type TotalesVenta = {
  subtotal: string
  descuento: string
  base_imponible: string
  itbis: string
  total: string
}

export type PrevisualizacionVenta = {
  lineas: (Desglose & { codigo: string; bruto: string; descuento: string; cantidad: string; precio_usd: string | null })[]
  totales: TotalesVenta
  // Para cobrar en dólares: tasa vigente y total en US$ (subido al centavo).
  dolar: { tasa: string; totalUsd: string } | null
}

export type DatosVenta = {
  clienteId: string
  lineas: LineaVentaEntrada[]
  motivoDescuento: string
  pago: {
    formaPagoId: string
    recibido?: string
    referencia?: string
    cajaId?: string
    cuentaId?: string
    // Pago en dólares (solo efectivo).
    moneda?: 'DOP' | 'USD'
    recibidoUsd?: string
    devueltaMoneda?: 'DOP' | 'USD'
  }
  comprobanteFiscal: string
  // '31' Crédito Fiscal, '32' Consumo o '' (según el cliente).
  tipoEcf?: string
  // Venta a crédito: el inicial que paga ahora (puede ser 0) y el plazo.
  credito?: { inicial: string; plazoDias?: string; autorizarMotivo?: string }
  notas: string
}

export type FilaVenta = {
  id: string
  numero: string
  numero_texto: string
  fecha: string
  estado: 'completada' | 'anulada'
  total: string
  descuento: string
  comprobante_fiscal: string | null
  cliente: string
  vendedor: string
  forma_pago: string | null
}

export type PaginaVentas = {
  filas: FilaVenta[]
  total: number
  pagina: number
  porPagina: number
  resumen: { cantidad: number; total: string; itbis: string }
}

export type FiltrosVentas = {
  texto: string
  desde: string
  hasta: string
  estado: 'todas' | 'completadas' | 'anuladas'
  pagina: number
}

export type LineaDetalle = {
  id: string
  tipo: string
  codigo: string
  descripcion: string
  unidad: string
  cantidad: string
  precio_unitario: string
  precio_incluye_itbis: boolean
  impuesto: string
  tasa: string
  bruto: string
  descuento: string
  base: string
  itbis: string
  total: string
  costo_unitario?: string | null
  precio_usd?: string | null
  tasa_dolar?: string | null
}

export type DetalleVenta = {
  id: string
  numero_texto: string
  fecha: string
  estado: 'completada' | 'anulada'
  cliente: string
  cliente_documento: string | null
  cliente_codigo?: string | null
  vendedor: string
  sucursal: string
  subtotal: string
  descuento: string
  motivo_descuento: string | null
  base_imponible: string
  itbis: string
  total: string
  comprobante_fiscal: string | null
  notas: string | null
  anulada_en: string | null
  anulada_por_usuario: string | null
  motivo_anulacion: string | null
  lineas: LineaDetalle[]
  ecf: EcfDeVenta[]
  credito: { monto: string; plazo_dias: number; vencimiento: string; estado: string } | null
  pagos: {
    monto: string
    recibido: string | null
    devuelta: string | null
    referencia: string | null
    forma_pago: string
    moneda?: 'DOP' | 'USD'
    tasa?: string | null
    monto_usd?: string | null
    recibido_usd?: string | null
    devuelta_moneda?: 'DOP' | 'USD' | null
    devuelta_monto?: string | null
  }[]
}

export type EcfDeVenta = {
  tipo: string
  estado: 'por_emitir' | 'emitido'
  encf: string | null
  fecha_emision: string | null
  codigo_seguridad: string | null
}

// Datos para imprimir el comprobante directo (se arma en ticket.ts).
export const obtenerTicket = (token: string, id: string) =>
  llamar<DatosTicket>('GET', `/ventas/${id}/ticket`, token)

export type CobroDolares = {
  tasa: string
  montoUsd: string
  recibidoUsd: string
  devueltaMoneda: 'DOP' | 'USD'
  devueltaMonto: string
  entraUsd: string
  saleDop: string
}

export const tasasDolar = (token: string) =>
  llamar<{
    vigente: TasaDolar | null
    historial: { tasa: string; vigente_desde: string; motivo: string | null; usuario: string }[]
  }>('GET', '/ventas/tasa-dolar', token)

export const registrarTasaDolar = (token: string, datos: { tasa: string; motivo: string }) =>
  llamar<{ id: string; tasa: string }>('POST', '/ventas/tasa-dolar', token, datos)

export const prepararVenta = (token: string) =>
  llamar<PrepararVenta>('GET', '/ventas/preparar', token)

export const buscarArticulos = (token: string, texto: string) =>
  llamar<ArticuloVenta[]>(
    'GET',
    `/ventas/catalogo?${new URLSearchParams({ texto }).toString()}`,
    token,
  )

export const buscarClientesVenta = (token: string, texto: string) =>
  llamar<ClienteVenta[]>(
    'GET',
    `/ventas/clientes?${new URLSearchParams({ texto }).toString()}`,
    token,
  )

export const previsualizarVenta = (token: string, datos: DatosVenta) =>
  llamar<PrevisualizacionVenta>('POST', '/ventas/calcular', token, datos)

export const registrarVenta = (token: string, datos: DatosVenta) =>
  llamar<{
    id: string
    numero: string
    total: string
    devuelta: string | null
    ecf: string | null
    credito: { monto: string; vencimiento: string } | null
    dolares: CobroDolares | null
  }>(
    'POST',
    '/ventas',
    token,
    datos,
  )

export const listarVentas = (token: string, f: FiltrosVentas) => {
  const q = new URLSearchParams({ estado: f.estado, pagina: String(f.pagina) })
  if (f.texto.trim()) q.set('texto', f.texto.trim())
  if (f.desde) q.set('desde', f.desde)
  if (f.hasta) q.set('hasta', f.hasta)
  return llamar<PaginaVentas>('GET', `/ventas?${q.toString()}`, token)
}

export const detalleVenta = (token: string, id: string) =>
  llamar<DetalleVenta>('GET', `/ventas/${id}`, token)

export const anotarComprobante = (token: string, id: string, comprobante: string) =>
  llamar<{ ok: boolean }>('PATCH', `/ventas/${id}/comprobante`, token, { comprobante })

// cajaId: la caja de esta computadora, de donde sale el efectivo devuelto.
export const anularVenta = (
  token: string,
  id: string,
  motivo: string,
  cajaId: string | null,
) =>
  llamar<{ ok: boolean }>('POST', `/ventas/${id}/anular`, token, {
    motivo,
    cajaId: cajaId ?? undefined,
  })

export type FormatoRecibo = '80' | '58' | 'carta'

// El PDF del comprobante interno (se pide con la sesión del usuario).
export async function obtenerRecibo(
  token: string,
  id: string,
  formato: FormatoRecibo,
): Promise<Blob> {
  const res = await fetch(`${API_URL}/ventas/${id}/recibo?formato=${formato}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) throw new SesionVencida('Sesión vencida')
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.message ?? 'No se pudo generar el comprobante')
  }
  return res.blob()
}

// ---------- Panel ----------

export type PeriodoPanel = 'hoy' | 'semana' | 'mes' | 'trimestre' | 'anio'

export type ResumenPanel = {
  periodo: PeriodoPanel
  desde: string
  hasta: string
  // Cada sección solo llega si el usuario tiene el permiso del módulo.
  ventas?: {
    cantidad: number
    total: string
    itbis: string
    base: string
    descuento: string
    total_anterior: string
    anuladas: { cantidad: number; total: string }
    por_forma_pago: { forma: string; total: string; cantidad: number }[]
    mas_vendidos: { codigo: string; descripcion: string; tipo: string; cantidad: string; total: string }[]
    ultimas: { id: string; numero: string; fecha: string; total: string; estado: string; cliente: string }[]
  }
  ganancia?: {
    venta: string
    costo: string
    venta_sin_costo: string
    venta_comision: string
    ganancia_comision: string
    ganancia: string
    margen: string | null
  }
  bancos?: {
    monedas: { moneda: string; simbolo: string; confirmado: string; por_confirmar: string; cuentas: number }[]
    pendientes: number
    no_llegaron: number
  }
  // Cuentas por cobrar hoy (null si no tiene permiso).
  cxc?: { total: string; vencido: string; clientes: number; clientesVencidos: number }
  // Dólares en las cajas abiertas y en las cuentas en US$ (null si no tiene permiso).
  dolares?: {
    caja: string | null
    // Por caja: abierta = lo que debería haber; cerrada = lo contado al cierre.
    cajas: { caja: string; estado: 'abierta' | 'cerrada'; usd: string; fecha: string | null }[] | null
    bancos: string | null
    cuentas: { nombre: string; confirmado: string; por_confirmar: string }[] | null
    total: string
    totalDop: string | null
    tasa: string | null
  }
  caja?: {
    abiertas: { caja: string; usuario: string; abierta_en: string; esperado: string; esperado_usd: string }[]
    total: string
    total_usd: string
  }
  servicios?: {
    cantidad: string
    ventas: number
    total: string
    base: string
    mas_vendido: { descripcion: string; cantidad: string; total: string } | null
    // Solo con el permiso de ver costos.
    ganancia?: string
  }
  remesas?: {
    confirmados: number
    enviado: string
    recibido: string
    pendientes: number
    rechazados: number
    // Solo con el permiso de cuentas de agentes.
    comision?: string
    comision_agentes?: string
    comision_scito?: string
    agentes_deben?: string
    agentes_con_deuda?: number
  }
  inventario?: {
    productos: number
    bajo: number
    agotado: number
    valor_al_costo?: string
    criticos: { codigo: string; nombre: string; existencia: string; minimo: string }[]
  }
  cxp?: {
    dias: number
    deuda: string
    vencidas: { cantidad: number; monto: string }
    porVencer: { cantidad: number; monto: string }
    gastosFijos: AvisoGastoFijo[]
  }
}

export const resumenPanel = (token: string, periodo: PeriodoPanel) =>
  llamar<ResumenPanel>('GET', `/panel?periodo=${periodo}`, token)

// ---------- Caja ----------

export type FilaCaja = {
  id: string
  codigo: string
  nombre: string
  is_active: boolean
  sucursal: string
  // Datos de la sesión abierta (null si la caja está cerrada).
  sesion_id: string | null
  sesion_texto: string | null
  abierta_en: string | null
  fondo_inicial: string | null
  abierta_por: string | null
  esperado: string | null
  esperado_usd: string | null
}

export type PrepararCaja = {
  categoriasGasto: { id: string; codigo: string; nombre: string }[]
  unidadesNegocio: { id: string; nombre: string }[]
  denominaciones: string[]
  denominacionesUsd: string[]
  tasaDolar: TasaDolar | null
  cuentas: { id: string; nombre: string; moneda: string; simbolo: string }[]
}

export type TipoMovimientoCaja =
  | 'venta'
  | 'devolucion'
  | 'gasto'
  | 'retiro'
  | 'ingreso'
  | 'deposito'
  | 'desde_cuenta'
  | 'san_cuota'
  | 'san_mano'
  | 'compra'
  | 'compra_reverso'
  | 'abono_credito'
  | 'abono_anulado'
  | 'cambio'
  | 'cambio_reverso'

export type MovimientoCaja = {
  id: string
  tipo: TipoMovimientoCaja
  monto: string
  fecha: string
  comprobante: string | null
  motivo: string | null
  categoria: string | null
  usuario: string
  venta: string | null
  venta_id: string | null
  // Cuenta del depósito o de donde vino el efectivo.
  cuenta: string | null
}

export type TotalesCaja = {
  ventas: string
  ingresos: string
  gastos: string
  retiros: string
  devoluciones: string
  depositos: string
  desde_cuentas: string
  san_cuotas: string
  san_manos: string
  compras: string
  compras_devueltas: string
  abonos_credito: string
  abonos_anulados: string
  cambios: string // devuelta en RD$ de pagos en US$
  cambios_devueltos: string
  cantidad_ventas: number
}

export type MovimientoCajaUsd = {
  id: string
  tipo: 'venta' | 'devolucion' | 'ingreso' | 'retiro'
  monto: string
  tasa: string
  monto_dop: string
  fecha: string
  motivo: string | null
  usuario: string
  venta: string | null
  venta_id: string | null
}

export type SesionCaja = {
  id: string
  sesion_texto: string
  caja: string
  caja_id: string
  sucursal: string
  estado: 'abierta' | 'cerrada'
  fondo_inicial: string
  abierta_en: string
  abierta_por_usuario: string
  cerrada_en: string | null
  cerrada_por_usuario: string | null
  esperado: string
  contado: string | null
  diferencia: string | null
  conteo: (Record<string, number> & { usd?: Record<string, number> }) | null
  motivo_diferencia: string | null
  notas: string | null
  totales: TotalesCaja
  movimientos: MovimientoCaja[]
  // Dólares (aparte de los pesos).
  fondo_inicial_usd: string
  esperado_usd: string
  contado_usd: string | null
  diferencia_usd: string | null
  totales_usd: { ventas: string; devoluciones: string; ingresos: string; retiros: string; cantidad_ventas: number }
  movimientos_usd: MovimientoCajaUsd[]
}

export type FilaSesionCaja = {
  id: string
  sesion_texto: string
  estado: 'abierta' | 'cerrada'
  caja: string
  abierta_en: string
  abierta_por: string
  cerrada_en: string | null
  cerrada_por: string | null
  fondo_inicial: string
  esperado: string | null
  contado: string | null
  diferencia: string | null
  motivo_diferencia: string | null
  fondo_inicial_usd: string
  esperado_usd: string | null
  contado_usd: string | null
  diferencia_usd: string | null
}

export type PaginaSesionesCaja = {
  filas: FilaSesionCaja[]
  total: number
  pagina: number
  porPagina: number
}

export type FiltrosSesionesCaja = {
  cajaId: string
  desde: string
  hasta: string
  estado: 'todas' | 'abiertas' | 'cerradas'
  pagina: number
}

export const listarCajas = (token: string) =>
  llamar<FilaCaja[]>('GET', '/caja/cajas', token)

export const prepararCaja = (token: string) =>
  llamar<PrepararCaja>('GET', '/caja/preparar', token)

export const crearCaja = (token: string, datos: { codigo: string; nombre: string }) =>
  llamar<{ id: string }>('POST', '/caja/cajas', token, datos)

export const editarCaja = (token: string, id: string, nombre: string) =>
  llamar<{ ok: boolean }>('PATCH', `/caja/cajas/${id}`, token, { nombre })

export const estadoCaja = (
  token: string,
  id: string,
  isActive: boolean,
  motivo?: string,
) =>
  llamar<{ ok: boolean }>('PATCH', `/caja/cajas/${id}/estado`, token, {
    is_active: isActive,
    motivo,
  })

export const abrirCaja = (
  token: string,
  id: string,
  datos: { fondoInicial: string; fondoInicialUsd?: string; notas: string },
) => llamar<{ id: string; sesion: string }>('POST', `/caja/cajas/${id}/abrir`, token, datos)

export const movimientoCajaUsd = (
  token: string,
  sesionId: string,
  datos: { tipo: 'ingreso' | 'retiro'; monto: string; clase: string; motivo: string },
) => llamar<{ esperadoUsd: string }>('POST', `/caja/sesiones/${sesionId}/movimientos-usd`, token, datos)

export const movimientoCaja = (
  token: string,
  sesionId: string,
  datos: {
    tipo: 'gasto' | 'retiro' | 'ingreso'
    monto: string
    categoriaGastoId?: string
    unidadNegocioId?: string // gasto: línea de negocio (vacío = general)
    comprobante?: string
    clase?: string // ingreso: aporte | prestamo | otro; retiro: retiro_dueno | otro
    motivo: string
  },
) =>
  llamar<{ esperado: string }>('POST', `/caja/sesiones/${sesionId}/movimientos`, token, datos)

export const cerrarCaja = (
  token: string,
  sesionId: string,
  datos: { conteo: Record<string, number>; conteoUsd?: Record<string, number>; motivo: string; notas: string },
) =>
  llamar<{
    esperado: string
    contado: string
    diferencia: string
    esperadoUsd: string
    contadoUsd: string
    diferenciaUsd: string
  }>(
    'POST',
    `/caja/sesiones/${sesionId}/cerrar`,
    token,
    datos,
  )

export const detalleSesionCaja = (token: string, id: string) =>
  llamar<SesionCaja>('GET', `/caja/sesiones/${id}`, token)

export const listarSesionesCaja = (token: string, f: FiltrosSesionesCaja) => {
  const q = new URLSearchParams({ estado: f.estado, pagina: String(f.pagina) })
  if (f.cajaId) q.set('cajaId', f.cajaId)
  if (f.desde) q.set('desde', f.desde)
  if (f.hasta) q.set('hasta', f.hasta)
  return llamar<PaginaSesionesCaja>('GET', `/caja/sesiones?${q.toString()}`, token)
}

// El cuadre en PDF (o el estado, si la sesión sigue abierta).
export async function obtenerCuadre(
  token: string,
  sesionId: string,
  formato: FormatoRecibo,
): Promise<Blob> {
  const res = await fetch(`${API_URL}/caja/sesiones/${sesionId}/cuadre?formato=${formato}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) throw new SesionVencida('Sesión vencida')
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.message ?? 'No se pudo generar el cuadre')
  }
  return res.blob()
}

// Llevar efectivo de la caja a una cuenta (depósito o recarga) o traerlo.
export type DatosEfectivoCuenta = {
  cuentaId: string
  monto: string
  montoEntra?: string
  cambiadoPor?: string
  referencia?: string
  motivo?: string
}

export const depositarDesdeCaja = (token: string, cajaId: string, datos: DatosEfectivoCuenta) =>
  llamar<{ id: string; numero: string }>('POST', `/caja/cajas/${cajaId}/depositar`, token, datos)

export const traerACaja = (token: string, cajaId: string, datos: DatosEfectivoCuenta) =>
  llamar<{ id: string; numero: string }>('POST', `/caja/cajas/${cajaId}/traer`, token, datos)

// ---------- Bancos ----------

export type Moneda = { codigo: string; nombre: string; simbolo: string }

export type FilaCuenta = {
  id: string
  codigo: string
  tipo: 'banco' | 'billetera'
  entidad: string
  nombre: string
  tipo_cuenta: 'corriente' | 'ahorro' | null
  moneda: string
  simbolo: string
  ultimos_digitos: string | null
  recibe_ventas: boolean
  is_active: boolean
  confirmado: string
  por_confirmar: string
  disponible: string
  disponible_dop: string
  pendientes: number
  no_llegaron: number
  tiene_saldo_inicial: boolean
}

export type CuentaOpcion = {
  id: string
  nombre: string
  tipo: string
  moneda: string
  simbolo: string
  recibe_ventas: boolean
}

export type PrepararBancos = {
  monedas: Moneda[]
  categoriasGasto: { id: string; codigo: string; nombre: string }[]
  unidadesNegocio: { id: string; nombre: string }[]
  cuentas: CuentaOpcion[]
  cajas: { id: string; nombre: string; sesion_id: string | null }[]
}

export type EstadoMovimiento = 'confirmado' | 'por_confirmar' | 'no_llego'

export type MovimientoCuenta = {
  id: string
  cuenta_id: string
  cuenta: string
  moneda: string
  simbolo: string
  tipo: string
  signo: number
  monto: string
  tasa: string
  monto_dop: string
  fecha: string
  created_at: string
  estado: EstadoMovimiento
  fecha_banco: string | null
  motivo_confirmacion: string | null
  beneficiario: string | null
  comprobante: string | null
  referencia: string | null
  motivo: string | null
  reverso_de: string | null
  categoria: string | null
  usuario: string
  venta: string | null
  transferencia: string | null
  contraparte: string | null
  monto_sale: string | null
  monto_entra: string | null
  cambiado_por: string | null
  reversado: boolean
  // Número del envío (E-000001) si salió de una billetera por un envío.
  envio: string | null
  // Viene de Envíos (envío, entrega o comisión): no se reversa desde Bancos.
  de_envios: boolean
}

export type PaginaMovimientosCuenta = {
  cuenta: {
    id: string
    nombre: string
    entidad: string
    moneda: string
    simbolo: string
    is_active: boolean
    confirmado: string
    por_confirmar: string
    disponible: string
  }
  filas: MovimientoCuenta[]
  total: number
  pagina: number
  porPagina: number
}

export type DatosCuenta = {
  codigo?: string
  tipo?: 'banco' | 'billetera'
  moneda?: string
  entidad: string
  nombre: string
  tipoCuenta: string
  ultimosDigitos: string
  recibeVentas: boolean
}

export type DatosMovimientoCuenta = {
  tipo: 'pago' | 'cargo' | 'interes' | 'ingreso'
  monto: string
  tasa?: string
  fecha?: string
  categoriaGastoId?: string
  unidadNegocioId?: string // pago: línea de negocio (vacío = general)
  clase?: string // ingreso: aporte, prestamo u otro
  beneficiario?: string
  comprobante?: string
  referencia?: string
  motivo: string
}

export type DatosTransferencia = {
  origenCuentaId?: string
  origenCajaId?: string
  destinoCuentaId?: string
  destinoCajaId?: string
  montoSale: string
  montoEntra?: string
  tasa?: string
  cambiadoPor?: string
  referencia?: string
  motivo?: string
  fecha?: string
}

export const prepararBancos = (token: string) =>
  llamar<PrepararBancos>('GET', '/bancos/preparar', token)

export const listarCuentas = (token: string) =>
  llamar<FilaCuenta[]>('GET', '/bancos/cuentas', token)

export const crearCuenta = (token: string, datos: DatosCuenta) =>
  llamar<{ id: string }>('POST', '/bancos/cuentas', token, datos)

export const editarCuenta = (token: string, id: string, datos: DatosCuenta) =>
  llamar<{ ok: boolean }>('PATCH', `/bancos/cuentas/${id}`, token, datos)

export const estadoCuenta = (token: string, id: string, isActive: boolean, motivo?: string) =>
  llamar<{ ok: boolean }>('PATCH', `/bancos/cuentas/${id}/estado`, token, {
    is_active: isActive,
    motivo,
  })

export const saldoInicialCuenta = (
  token: string,
  id: string,
  datos: { monto: string; tasa?: string; fecha?: string },
) => llamar<{ id: string }>('POST', `/bancos/cuentas/${id}/saldo-inicial`, token, datos)

export type FiltrosMovimientosCuenta = {
  desde: string
  hasta: string
  estado: 'todos' | EstadoMovimiento
  pagina: number
}

export const movimientosCuenta = (token: string, id: string, f: FiltrosMovimientosCuenta) => {
  const q = new URLSearchParams({ estado: f.estado, pagina: String(f.pagina) })
  if (f.desde) q.set('desde', f.desde)
  if (f.hasta) q.set('hasta', f.hasta)
  return llamar<PaginaMovimientosCuenta>(
    'GET',
    `/bancos/cuentas/${id}/movimientos?${q.toString()}`,
    token,
  )
}

export const registrarMovimientoCuenta = (
  token: string,
  id: string,
  datos: DatosMovimientoCuenta,
) =>
  llamar<{ id: string; disponible: string }>(
    'POST',
    `/bancos/cuentas/${id}/movimientos`,
    token,
    datos,
  )

export const pendientesBancos = (token: string) =>
  llamar<{ porConfirmar: MovimientoCuenta[]; noLlegaron: MovimientoCuenta[] }>(
    'GET',
    '/bancos/pendientes',
    token,
  )

export const confirmarMovimiento = (
  token: string,
  id: string,
  datos: { resultado: 'confirmado' | 'no_llego'; fechaBanco?: string; motivo?: string },
) => llamar<{ ok: boolean }>('POST', `/bancos/movimientos/${id}/confirmar`, token, datos)

export const reversarMovimiento = (token: string, id: string, motivo: string) =>
  llamar<{ id: string }>('POST', `/bancos/movimientos/${id}/reversar`, token, { motivo })

export const transferirDinero = (token: string, datos: DatosTransferencia) =>
  llamar<{ id: string; numero: string; montoDop: string }>(
    'POST',
    '/bancos/transferencias',
    token,
    datos,
  )

// ---------- Envíos a Haití (remesas) ----------

export type TarifaEnvio = { tasa: string; comision_pct: string; comision_agente_pct: string }

export type AgenteOpcion = { id: string; codigo: string; nombre: string; tipo: 'propio' | 'autorizado' }

export type PrepararEnvios = {
  tarifa: TarifaEnvio
  motivos: { id: string; codigo: string; nombre: string }[]
  agentes: AgenteOpcion[]
  billeteras: { id: string; nombre: string; entidad: string }[]
  documentoDesde: string
  cajas: { id: string; nombre: string; sesion_id: string | null }[]
  cuentasPesos: { id: string; nombre: string }[]
  verDocumento: boolean
}

export type CalculoEnvio = {
  monto_enviado: string
  tasa: string
  monto_recibir: string
  comision_pct: string
  comision: string
  total_pagar: string
  comision_agente_pct: string
  comision_agente: string
  comision_scito: string
}

export type EstadoEnvio = 'pendiente' | 'confirmado' | 'rechazado'

export type FilaEnvio = {
  id: string
  numero_texto: string
  fecha: string
  origen: 'sistema' | 'importado'
  estado: EstadoEnvio
  agente_id: string
  agente_codigo: string
  agente: string
  agente_tipo: string
  remitente_id: string | null
  remitente_nombre: string
  remitente_telefono: string | null
  remitente_documento: string | null
  remitente_tipo_documento: string | null
  beneficiario_nombre: string
  beneficiario_telefono: string | null
  parentesco: string | null
  motivo_envio: string | null
  billetera: string | null
  monto_enviado: string
  tasa: string
  monto_recibir: string
  comision_pct: string
  comision: string
  total_pagar: string
  comision_agente_pct: string
  comision_agente: string
  codigo_externo: string | null
  motivo_rechazo: string | null
  resuelto_en: string | null
  resuelto_por: string | null
  registrado_por: string
  pago_comision_id: string | null
  notas: string | null
}

export type PaginaEnvios = {
  filas: FilaEnvio[]
  total: number
  resumen: { n: number; enviado: string; comision: string; total: string }
  pagina: number
  porPagina: number
}

export type FiltrosEnvios = {
  estado: 'todos' | EstadoEnvio
  agenteId: string
  desde: string
  hasta: string
  texto: string
  pagina: number
}

export type DatosEnvio = {
  agenteId: string
  remitenteId: string
  beneficiarioId?: string
  beneficiarioNuevo?: { nombre: string; telefono: string }
  parentesco: string
  motivoEnvioId: string
  cuentaId: string
  montoEnviado: string
  notas?: string
}

export type BeneficiarioOpcion = {
  id: string
  nombre: string
  telefono: string | null
  ultimo_envio: string | null
}

export type FilaAgente = {
  id: string
  codigo: string
  nombre: string
  telefono: string | null
  tipo: 'propio' | 'autorizado'
  frecuencia_pago: 'semanal' | 'quincenal' | 'mensual' | null
  grupo_whatsapp: string | null
  notas: string | null
  is_active: boolean
}

export type DatosAgente = {
  codigo?: string
  nombre: string
  telefono: string
  tipo: 'propio' | 'autorizado'
  frecuenciaPago: string
  grupoWhatsapp: string
  notas: string
}

export type CuentaAgente = {
  id: string
  codigo: string
  nombre: string
  tipo: 'propio' | 'autorizado'
  frecuencia_pago: string | null
  is_active: boolean
  cobrado: string
  entregado: string
  debe: string
  pendientes: number
  comision_pendiente: string
  envios_sin_pagar: number
  ultimo_pago: string | null
}

export type ReporteDiaAgente = {
  id: string
  codigo: string
  nombre: string
  tipo: string
  confirmados: number
  pendientes: number
  rechazados: number
  enviado: string
  comision: string
  comision_agente: string
  a_entregar: string
  entregado: string
  saldo_total: string
}

export type MovimientosAgente = {
  agente: CuentaAgente
  entregas: {
    id: string
    dia: string
    monto: string
    forma: 'efectivo' | 'deposito'
    referencia: string | null
    notas: string | null
    created_at: string
    usuario: string
  }[]
  pagos: {
    id: string
    desde: string
    hasta: string
    cantidad: number
    monto: string
    forma: 'efectivo' | 'banco'
    referencia: string | null
    created_at: string
    usuario: string
  }[]
}

export type FilaTarifa = TarifaEnvio & {
  id: string
  vigente_desde: string
  motivo: string | null
  usuario: string | null
}

export const prepararEnvios = (token: string) =>
  llamar<PrepararEnvios>('GET', '/remesas/preparar', token)

export const calcularEnvio = (token: string, datos: { agenteId: string; montoEnviado: string }) =>
  llamar<CalculoEnvio>('POST', '/remesas/calcular', token, datos)

export const registrarEnvio = (token: string, datos: DatosEnvio) =>
  llamar<CalculoEnvio & { id: string; numero: string }>('POST', '/remesas/envios', token, datos)

export const listarEnvios = (token: string, f: FiltrosEnvios) => {
  const q = new URLSearchParams({ estado: f.estado, pagina: String(f.pagina) })
  if (f.agenteId) q.set('agenteId', f.agenteId)
  if (f.desde) q.set('desde', f.desde)
  if (f.hasta) q.set('hasta', f.hasta)
  if (f.texto.trim()) q.set('texto', f.texto.trim())
  return llamar<PaginaEnvios>('GET', `/remesas/envios?${q.toString()}`, token)
}

export const detalleEnvio = (token: string, id: string) =>
  llamar<FilaEnvio>('GET', `/remesas/envios/${id}`, token)

export const confirmarEnvio = (token: string, id: string, codigoExterno: string) =>
  llamar<{ ok: boolean }>('POST', `/remesas/envios/${id}/confirmar`, token, { codigoExterno })

export const rechazarEnvio = (token: string, id: string, motivo: string) =>
  llamar<{ ok: boolean }>('POST', `/remesas/envios/${id}/rechazar`, token, { motivo })

export async function obtenerReciboEnvio(
  token: string,
  id: string,
  formato: FormatoRecibo,
): Promise<Blob> {
  const res = await fetch(`${API_URL}/remesas/envios/${id}/recibo?formato=${formato}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) throw new SesionVencida('Sesión vencida')
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.message ?? 'No se pudo generar el recibo')
  }
  return res.blob()
}

export const buscarBeneficiarios = (token: string, texto: string) =>
  llamar<BeneficiarioOpcion[]>(
    'GET',
    `/remesas/beneficiarios?${new URLSearchParams({ texto }).toString()}`,
    token,
  )

export const listarAgentes = (token: string) =>
  llamar<FilaAgente[]>('GET', '/remesas/agentes', token)

export const crearAgente = (token: string, datos: DatosAgente) =>
  llamar<{ id: string }>('POST', '/remesas/agentes', token, datos)

export const editarAgente = (token: string, id: string, datos: DatosAgente) =>
  llamar<{ ok: boolean }>('PATCH', `/remesas/agentes/${id}`, token, datos)

export const estadoAgente = (token: string, id: string, isActive: boolean, motivo?: string) =>
  llamar<{ ok: boolean }>('PATCH', `/remesas/agentes/${id}/estado`, token, {
    is_active: isActive,
    motivo,
  })

export const cuentasAgentes = (token: string) =>
  llamar<CuentaAgente[]>('GET', '/remesas/cuentas-agentes', token)

export const movimientosAgente = (token: string, id: string) =>
  llamar<MovimientosAgente>('GET', `/remesas/cuentas-agentes/${id}`, token)

export const reporteDiaEnvios = (token: string, dia: string) =>
  llamar<{ dia: string; agentes: ReporteDiaAgente[] }>(
    'GET',
    `/remesas/reporte-dia${dia ? `?dia=${dia}` : ''}`,
    token,
  )

export const registrarEntregaAgente = (
  token: string,
  datos: {
    agenteId: string
    dia: string
    monto: string
    forma: 'efectivo' | 'deposito'
    cajaId?: string
    cuentaId?: string
    referencia?: string
    notas?: string
  },
) => llamar<{ id: string; debe: string }>('POST', '/remesas/entregas', token, datos)

export const pagarComisionesAgente = (
  token: string,
  datos: {
    agenteId: string
    hasta: string
    forma: 'efectivo' | 'banco'
    cajaId?: string
    cuentaId?: string
    referencia?: string
  },
) =>
  llamar<{ id: string; monto: string; envios: number; desde: string; hasta: string }>(
    'POST',
    '/remesas/pagos-comision',
    token,
    datos,
  )

export const listarTarifas = (token: string) =>
  llamar<FilaTarifa[]>('GET', '/remesas/tarifas', token)

export const nuevaTarifa = (
  token: string,
  datos: { tasa: string; comisionPct: string; comisionAgentePct: string; motivo: string },
) => llamar<{ id: string }>('POST', '/remesas/tarifas', token, datos)

// ---------- Reportes ----------

export type AreaReporte = 'ventas' | 'envios' | 'caja_bancos' | 'inventario' | 'clientes' | 'cxc' | 'cxp'

export type TipoColumnaReporte =
  | 'texto'
  | 'dinero'
  | 'entero'
  | 'cantidad'
  | 'porcentaje'
  | 'fecha'
  | 'fechahora'

export type ColumnaReporte = {
  clave: string
  titulo: string
  tipo: TipoColumnaReporte
  total?: boolean
}

export type FilaReporte = Record<string, string | number | null>

export type DatosReporte = {
  codigo: string
  titulo: string
  periodo: string
  detalle?: string
  columnas: ColumnaReporte[]
  filas: FilaReporte[]
  totales: FilaReporte | null
  notas: string[]
}

export type OpcionesReportes = {
  reportes: { codigo: string; area: AreaReporte; titulo: string }[]
  agentes: { id: string; codigo: string; nombre: string; is_active: boolean }[]
  cuentas: { id: string; nombre: string; moneda: string; simbolo: string; is_active: boolean }[]
  servicios: { codigo: string; nombre: string }[]
  clientesCxc: { id: string; nombre: string }[]
  proveedoresCxp: { id: string; nombre: string }[]
}

export type FiltrosReporte = {
  desde: string
  hasta: string
  agenteId?: string
  cuentaId?: string
  estado?: string
  servicio?: string
  clienteId?: string
  proveedorId?: string
}

function consultaReporte(f: FiltrosReporte): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) if (v) q.set(k, v)
  return q.toString()
}

export const opcionesReportes = (token: string) =>
  llamar<OpcionesReportes>('GET', '/reportes', token)

export const generarReporte = (token: string, codigo: string, f: FiltrosReporte) =>
  llamar<DatosReporte>('GET', `/reportes/${codigo}?${consultaReporte(f)}`, token)

// Descarga el reporte en Excel o PDF (con el nombre que da el servidor).
export async function descargarReporte(
  token: string,
  codigo: string,
  formato: 'xlsx' | 'pdf',
  f: FiltrosReporte,
): Promise<{ archivo: Blob; nombre: string }> {
  const res = await fetch(`${API_URL}/reportes/${codigo}/${formato}?${consultaReporte(f)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) throw new SesionVencida('Sesión vencida')
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.message ?? 'No se pudo generar el archivo')
  }
  const nombre =
    /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ??
    `${codigo}.${formato}`
  return { archivo: await res.blob(), nombre }
}

// ---------- SAN ----------

export type FrecuenciaSan = 'semanal' | 'quincenal' | 'mensual'
export type EstadoSan = 'preparacion' | 'activo' | 'terminado' | 'cancelado'

export type PrepararSanes = {
  comisionPct: string
  moraPct: string
  diasGracia: number
  cajas: { id: string; nombre: string; sesion_id: string | null }[]
  cuentas: { id: string; nombre: string }[]
  tiposDocumento: TipoDocumento[]
}

export type FilaSan = {
  id: string
  codigo: string
  nombre: string
  frecuencia: FrecuenciaSan
  cuota: string
  cantidad_numeros: number
  fecha_inicio: string
  comision_pct: string
  mora_pct: string
  dias_gracia: number
  estado: EstadoSan
  mano: string
  asignados: number
  entregas: number
  proximo_turno: string | null
}

export type DatosSan = {
  nombre: string
  frecuencia: FrecuenciaSan
  cuota: string
  cantidadNumeros: string
  fechaInicio: string
  comisionPct: string
  moraPct: string
  diasGracia: string
  notas: string
}

export type ParticipacionSan = {
  id: string
  numero: number
  parte: 'completo' | 'medio'
  tercero_id: string
  nombre: string
  telefono: string | null
  cuota: string
  mano: string
  pagados: number
  vencidos: number
  debe_cuotas: string
  debe_mora: string
  entrega: { id: string; numero: string; neto: string; fecha: string } | null
  // Solo en el detalle del SAN.
  contrato?: { id: string; codigo: string; estado: 'generado' | 'firmado'; idioma: IdiomaContrato } | null
  falta?: string[]
}

export type PeriodoSan = {
  turno: number
  fecha: string
  estado: 'pagado' | 'vencido' | 'por_vencer'
  cuota: string
  mora: string
  dias_atraso: number
}

export type DetalleSan = FilaSan & {
  notas: string | null
  hoy: string
  turnos: { turno: number; fecha: string; entregado: number; duenos: number }[]
  participaciones: ParticipacionSan[]
  dinero: {
    cuotas_cobradas: string
    mora_cobrada: string
    manos_entregadas: string
    comision_ganada: string
    fondo: string
    adelantado_scito: string
  }
}

export type CuentaSan = {
  san: Omit<FilaSan, 'mano' | 'asignados' | 'entregas' | 'proximo_turno'>
  hoy: string
  participaciones: (ParticipacionSan & { periodos: PeriodoSan[] })[]
}

export type AtrasadoSan = {
  san_id: string
  san: string
  san_nombre: string
  numero: number
  parte: string
  tercero_id: string
  nombre: string
  telefono: string | null
  vencidos: number
  debe_cuotas: string
  debe_mora: string
  mas_antiguo: string | null
}

export type PreviaEntregaSan = {
  numero: number
  nombre: string
  parte: string
  fecha_turno: string
  puede: boolean
  bruto: string
  comision: string
  descuento: string
  neto: string
  cuotas_descontadas: { turno: number; fecha: string; cuota: string; mora: string }[]
}

export const prepararSanes = (token: string) =>
  llamar<PrepararSanes>('GET', '/sanes/preparar', token)

export const configurarSanes = (
  token: string,
  datos: { comisionPct: string; moraPct: string; diasGracia: string },
) => llamar<{ ok: boolean }>('PATCH', '/sanes/configuracion', token, datos)

export const listarSanes = (token: string) => llamar<FilaSan[]>('GET', '/sanes', token)

export const crearSan = (token: string, datos: DatosSan) =>
  llamar<{ id: string; codigo: string }>('POST', '/sanes', token, datos)

export const editarSan = (token: string, id: string, datos: DatosSan) =>
  llamar<{ ok: boolean }>('PATCH', `/sanes/${id}`, token, datos)

export const detalleSan = (token: string, id: string) =>
  llamar<DetalleSan>('GET', `/sanes/${id}`, token)

export const fechaTurnoSan = (token: string, id: string, turno: number, fecha: string) =>
  llamar<{ ok: boolean }>('PATCH', `/sanes/${id}/turnos`, token, { turno, fecha })

export const asignarNumeroSan = (
  token: string,
  id: string,
  datos: { numero: string; terceroId: string; parte: 'completo' | 'medio' },
) => llamar<{ id: string }>('POST', `/sanes/${id}/numeros`, token, datos)

export const quitarNumeroSan = (token: string, id: string, participacionId: string) =>
  llamar<{ ok: boolean }>('POST', `/sanes/${id}/numeros/${participacionId}/quitar`, token)

export const estadoSan = (token: string, id: string, estado: EstadoSan, motivo?: string) =>
  llamar<{ ok: boolean }>('PATCH', `/sanes/${id}/estado`, token, { estado, motivo })

export const sanesDePersona = (token: string, terceroId: string) =>
  llamar<{ id: string; codigo: string; nombre: string; estado: EstadoSan }[]>(
    'GET',
    `/sanes/persona/${terceroId}`,
    token,
  )

export const cuentaSan = (token: string, id: string, terceroId: string) =>
  llamar<CuentaSan>('GET', `/sanes/${id}/cuenta/${terceroId}`, token)

export const cobrarSan = (
  token: string,
  datos: {
    sanId: string
    terceroId: string
    periodos: { participacionId: string; turno: number }[]
    forma: 'efectivo' | 'transferencia'
    cajaId?: string
    cuentaId?: string
    referencia?: string
  },
) =>
  llamar<{ id: string; recibo: string; cuotas: string; mora: string; total: string }>(
    'POST',
    '/sanes/cobros',
    token,
    datos,
  )

export const previaEntregaSan = (token: string, id: string, participacionId: string) =>
  llamar<PreviaEntregaSan>('GET', `/sanes/${id}/entrega/${participacionId}`, token)

export const entregarSan = (
  token: string,
  datos: {
    sanId: string
    participacionId: string
    forma: 'efectivo' | 'transferencia'
    cajaId?: string
    cuentaId?: string
    referencia?: string
  },
) =>
  llamar<{ id: string; entrega: string; bruto: string; comision: string; descuento: string; neto: string }>(
    'POST',
    '/sanes/entregas',
    token,
    datos,
  )

export const atrasadosSan = (token: string) => llamar<AtrasadoSan[]>('GET', '/sanes/atrasados', token)

// Recibo de cobro (recibos) o de entrega de mano (entregas) en PDF.
export async function pdfSan(
  token: string,
  tipo: 'recibos' | 'entregas',
  id: string,
  formato: FormatoRecibo,
): Promise<Blob> {
  const res = await fetch(`${API_URL}/sanes/${tipo}/${id}/pdf?formato=${formato}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) throw new SesionVencida('Sesión vencida')
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.message ?? 'No se pudo generar el recibo')
  }
  return res.blob()
}

export type ClienteSan = {
  id: string
  codigo?: string | null
  nombre: string
  numero_documento: string | null
  telefono: string | null
}

export const buscarClientesSan = (token: string, texto: string, soloParticipantes: boolean) => {
  const q = new URLSearchParams({ texto: texto.trim() })
  if (soloParticipantes) q.set('participantes', 'si')
  return llamar<ClienteSan[]>('GET', `/sanes/clientes?${q.toString()}`, token)
}

// ---------- Facturación electrónica (e-CF) ----------

export type EstadoEcf = 'por_emitir' | 'emitido' | 'cancelado'

export type PrepararFacturacion = {
  modo: string
  inicio: string
  umbral: string
  hoy: string
  activa: boolean
  porEmitir: number
  emitidos: number
  cancelados: number
}

export type FilaEcf = {
  id: string
  venta_id: string
  tipo: string
  tipo_nombre: string
  estado: EstadoEcf
  comprador_documento: string | null
  comprador_nombre: string
  base_imponible: string
  itbis: string
  total: string
  encf: string | null
  fecha_emision: string | null
  codigo_seguridad: string | null
  emitido_en: string | null
  emitido_por_usuario: string | null
  motivo_cancelacion: string | null
  created_at: string
  venta_numero_texto: string
  venta_fecha: string
  venta_estado: 'completada' | 'anulada'
  modifica_encf: string | null
  modifica_fecha: string | null
}

export type PaginaEcf = {
  filas: FilaEcf[]
  total: number
  pagina: number
  porPagina: number
}

export type DatosEmision = {
  encf: string
  fechaEmision: string
  codigoSeguridad: string
  motivo?: string
}

export const prepararFacturacion = (token: string) =>
  llamar<PrepararFacturacion>('GET', '/facturacion/preparar', token)

export const listarEcf = (
  token: string,
  f: { estado: EstadoEcf | 'todos'; texto: string; pagina: number },
) => {
  const q = new URLSearchParams({ estado: f.estado, pagina: String(f.pagina) })
  if (f.texto.trim()) q.set('texto', f.texto.trim())
  return llamar<PaginaEcf>('GET', `/facturacion?${q.toString()}`, token)
}

export const emitirEcf = (token: string, id: string, datos: DatosEmision) =>
  llamar<{ ok: boolean; encf: string }>('POST', `/facturacion/${id}/emitir`, token, datos)

export const corregirEcf = (token: string, id: string, datos: DatosEmision) =>
  llamar<{ ok: boolean }>('POST', `/facturacion/${id}/corregir`, token, datos)

export const cambiarTipoEcf = (token: string, id: string, tipo: string) =>
  llamar<{ ok: boolean; id: string }>('POST', `/facturacion/${id}/tipo`, token, { tipo })

export const configurarFacturacion = (token: string, datos: { inicio: string; umbral: string }) =>
  llamar<{ ok: boolean }>('PATCH', '/facturacion/configuracion', token, datos)

// ---------- SAN: ficha, referencias, fiador, fotos y contratos ----------

export type IdiomaContrato = 'es' | 'fr' | 'ht'

export type DatosFichaSan = {
  fechaNacimiento: string
  ocupacion: string
  lugarTrabajo: string
  sector: string
  municipio: string
  provincia: string
  referenciaDireccion: string
  emergenciaNombre: string
  emergenciaTelefono: string
  emergenciaRelacion: string
  idioma: IdiomaContrato
  telefono: string
  whatsapp: string
  direccion: string
}

export type DatosGaranteSan = {
  nombre: string
  telefono: string
  relacion: string
  tipoDocumentoId?: string
  numeroDocumento?: string
  direccion?: string
  ocupacion?: string
}

export type DatosPersonaSan = DatosFichaSan & {
  nombre: string
  tipoDocumentoId: string
  numeroDocumento: string
  correo: string
  referencias: DatosGaranteSan[]
  fiador: DatosGaranteSan
}

export type GaranteSan = {
  id: string
  tipo: 'referencia' | 'fiador'
  nombre: string
  telefono: string
  relacion: string
  tipo_documento: string | null
  numero_documento: string | null
  direccion: string | null
  ocupacion: string | null
  confirmado: boolean
  confirmado_en: string | null
  confirmado_por_usuario: string | null
  nota_confirmacion: string | null
}

export type ContratoSan = {
  id: string
  codigo: string
  idioma: IdiomaContrato
  estado: 'generado' | 'firmado' | 'anulado'
  created_at: string
  firmado_en: string | null
  san_codigo: string
  san_nombre: string
  numero_san: number
  parte: string
}

export type FichaSan = {
  cliente: {
    id: string
    codigo: string | null
    nombre: string
    tipo_documento: string | null
    numero_documento: string | null
    telefono: string | null
    whatsapp: string | null
    direccion: string | null
    correo: string | null
  }
  ficha: {
    fecha_nacimiento: string | null
    ocupacion: string
    lugar_trabajo: string | null
    sector: string
    municipio: string
    provincia: string
    referencia_direccion: string
    emergencia_nombre: string | null
    emergencia_telefono: string | null
    emergencia_relacion: string | null
    idioma: IdiomaContrato
  } | null
  garantes: GaranteSan[]
  archivos: { id: string; tipo: 'documento_frente' | 'documento_dorso' | 'contrato_firmado'; mime: string; bytes: number; created_at: string; contrato_id: string | null }[]
  contratos: ContratoSan[]
  falta: string[]
}

export type PlantillaSan = {
  id: string
  idioma: IdiomaContrato
  nombre_idioma: string
  version: number
  titulo: string
  texto: string
  created_at: string
  creada_por: string | null
}

export const crearPersonaSan = (token: string, datos: DatosPersonaSan) =>
  llamar<{ id: string }>('POST', '/sanes/personas', token, datos)

export const fichaSan = (token: string, terceroId: string) =>
  llamar<FichaSan>('GET', `/sanes/fichas/${terceroId}`, token)

export const guardarFichaSan = (token: string, terceroId: string, datos: DatosFichaSan) =>
  llamar<{ ok: boolean }>('PUT', `/sanes/fichas/${terceroId}`, token, datos)

export const agregarGaranteSan = (
  token: string,
  terceroId: string,
  datos: DatosGaranteSan & { tipo: 'referencia' | 'fiador' },
) => llamar<{ id: string }>('POST', `/sanes/fichas/${terceroId}/garantes`, token, datos)

export const confirmarGaranteSan = (token: string, id: string, nota: string) =>
  llamar<{ ok: boolean }>('POST', `/sanes/garantes/${id}/confirmar`, token, { nota })

export const quitarGaranteSan = (token: string, id: string, motivo: string) =>
  llamar<{ ok: boolean }>('POST', `/sanes/garantes/${id}/quitar`, token, { motivo })

export const subirFotoSan = (
  token: string,
  terceroId: string,
  tipo: 'documento_frente' | 'documento_dorso',
  datos: string,
) => llamar<{ id: string }>('POST', `/sanes/fichas/${terceroId}/fotos`, token, { tipo, datos })

export const plantillasSan = (token: string) =>
  llamar<{ plantillas: PlantillaSan[]; marcadores: string[] }>('GET', '/sanes/plantillas', token)

export const nuevaPlantillaSan = (
  token: string,
  datos: { idioma: IdiomaContrato; titulo: string; texto: string },
) => llamar<{ id: string; version: number }>('POST', '/sanes/plantillas', token, datos)

export const generarContratoSan = (
  token: string,
  datos: { participacionId: string; idioma: IdiomaContrato; lugar: string },
) => llamar<{ id: string; codigo: string }>('POST', '/sanes/contratos', token, datos)

export const firmadoContratoSan = (token: string, id: string, datos: string) =>
  llamar<{ id: string }>('POST', `/sanes/contratos/${id}/firmado`, token, { datos })

export const anularContratoSan = (token: string, id: string, motivo: string) =>
  llamar<{ ok: boolean }>('POST', `/sanes/contratos/${id}/anular`, token, { motivo })

// Archivo (foto del documento, contrato firmado) o contrato en PDF.
export async function descargarSan(token: string, ruta: string): Promise<Blob> {
  const res = await fetch(`${API_URL}${ruta}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) throw new SesionVencida('Sesión vencida')
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.message ?? 'No se pudo abrir el archivo')
  }
  return res.blob()
}

// Recibos "de filas" para imprimir directo (se ajustan al papel).
export const ticketEnvio = (token: string, id: string) =>
  llamar<TicketFilas>('GET', `/remesas/envios/${id}/ticket`, token)

export const ticketCuadre = (token: string, sesionId: string) =>
  llamar<TicketFilas>('GET', `/caja/sesiones/${sesionId}/ticket`, token)

export const ticketSan = (token: string, tipo: 'recibos' | 'entregas', id: string) =>
  llamar<TicketFilas>('GET', `/sanes/${tipo}/${id}/ticket`, token)

// ---------- Compras (facturas de proveedor) ----------

export type PrepararCompras = {
  tiposGasto: { codigo: string; nombre: string }[]
  unidadesNegocio: { id: string; nombre: string }[]
  cajas: { id: string; nombre: string; sesion_id: string | null }[]
  cuentas: { id: string; nombre: string }[]
  hoy: string
}

export type ProveedorCompra = {
  id: string
  nombre: string
  nombre_comercial: string | null
  numero_documento: string | null
  dias_credito: number | null
}

export type ProductoCompra = {
  id: string
  codigo: string
  nombre: string
  costo: string
  unidad: string
  permite_decimales: boolean
}

export type DatosCompra = {
  proveedorId: string
  ncf: string
  fechaComprobante: string
  tipoGasto: string
  condicion: 'contado' | 'credito'
  vencimiento?: string
  lineas: { productoId: string; cantidad: string; costoUnitario: string }[]
  otrosBienes: string
  servicios: string
  itbis: string
  itbisRetenido: string
  isrRetenido: string
  descripcion: string
  notas: string
  pago?: { forma: 'efectivo' | 'banco'; cajaId?: string; cuentaId?: string; referencia?: string }
  gastoFijoId?: string
  gastoFijoMes?: string // YYYY-MM: mes al que corresponde la factura
  unidadNegocioId?: string // línea de negocio del gasto (vacío = general)
}

export type FilaCompra = {
  id: string
  codigo: string
  fecha: string
  ncf: string | null
  proveedor: string
  tipo_gasto: string
  condicion: 'contado' | 'credito'
  vencimiento: string
  itbis: string
  total: string
  a_pagar: string
  pagado: string
  saldo: string
  estado: 'registrada' | 'anulada'
}

export type DetalleCompra = FilaCompra & {
  proveedor_documento: string | null
  tipo_gasto_nombre: string
  sucursal: string
  vence: string
  monto_bienes: string
  monto_servicios: string
  itbis_retenido: string
  isr_retenido: string
  descripcion: string | null
  notas: string | null
  registrada_por: string
  created_at: string
  anulada_en: string | null
  anulada_por_usuario: string | null
  motivo_anulacion: string | null
  lineas: { id: string; codigo: string; nombre: string; unidad: string; cantidad: string; costo_unitario: string; subtotal: string }[]
  pagos: {
    id: string
    monto: string
    forma: 'efectivo' | 'banco'
    fecha: string
    referencia: string | null
    usuario: string
    origen: string | null
    comprobante: string | null // PP-000001 si se pagó en Cuentas por Pagar
    vigente: boolean // false si ese pago se anuló
  }[]
}

export const prepararCompras = (token: string) => llamar<PrepararCompras>('GET', '/compras/preparar', token)

export const buscarProveedoresCompra = (token: string, texto: string) =>
  llamar<ProveedorCompra[]>('GET', `/compras/proveedores?${new URLSearchParams({ texto }).toString()}`, token)

export const buscarProductosCompra = (token: string, texto: string) =>
  llamar<ProductoCompra[]>('GET', `/compras/productos?${new URLSearchParams({ texto }).toString()}`, token)

export const listarCompras = (
  token: string,
  f: { texto: string; desde: string; hasta: string; estado: string; pagina: number },
) => {
  const q = new URLSearchParams({ pagina: String(f.pagina) })
  for (const k of ['texto', 'desde', 'hasta', 'estado'] as const) if (f[k].trim()) q.set(k, f[k].trim())
  return llamar<{ filas: FilaCompra[]; total: number; pagina: number; porPagina: number }>('GET', `/compras?${q.toString()}`, token)
}

export const detalleCompra = (token: string, id: string) => llamar<DetalleCompra>('GET', `/compras/${id}`, token)

export const registrarCompra = (token: string, datos: DatosCompra) =>
  llamar<{ id: string; codigo: string; total: string; aPagar: string }>('POST', '/compras', token, datos)

export const anularCompra = (token: string, id: string, datos: { motivo: string; cajaId?: string }) =>
  llamar<{ ok: boolean }>('POST', `/compras/${id}/anular`, token, datos)

// ---------- Cuentas por Cobrar ----------

export type RecargoCxc = { mes: number; fecha: string; base: string; pct: string; monto: string }

export type CuentaCxc = {
  id: string
  venta_id: string
  venta: string
  fecha: string
  plazo_dias: number
  vencimiento: string
  monto: string
  capital_pagado: string
  capital_pendiente: string
  recargos: RecargoCxc[]
  recargo_total: string
  recargo_pagado: string
  recargo_perdonado: string
  recargo_pendiente: string
  total_pendiente: string
  vencida: boolean
  dias_atraso: number
}

export type TotalesCxc = { capital: string; recargo: string; total: string; vencido: string; cuentas_vencidas: number }

export type ResumenCreditoVenta = {
  credito: { limite: string; plazo_dias: number; is_active: boolean } | null
  disponible: string | null
  totales: TotalesCxc
  autorizacionHoy: { motivo: string; por: string } | null
}

export type ClienteCxc = ResumenCreditoVenta & {
  cliente: { id: string; nombre: string; numero_documento: string | null; telefono: string | null; es_protegido: boolean }
  hoy: string
  cuentas: CuentaCxc[]
  abonos: {
    id: string
    codigo: string
    fecha: string
    total: string
    forma: 'efectivo' | 'transferencia'
    referencia: string | null
    estado: 'activo' | 'anulado'
    motivo_anulacion: string | null
    usuario: string
  }[]
}

export type FilaClienteCxc = TotalesCxc & {
  id: string
  codigo: string | null
  nombre: string
  numero_documento: string | null
  telefono: string | null
  limite: string | null
  plazo_dias: number | null
  credito_activo: boolean
  disponible: string | null
}

export type PrepararCxc = {
  cajas: { id: string; nombre: string; sesion_id: string | null }[]
  cuentas: { id: string; nombre: string }[]
  tasas: { desde: string; porcentaje: string; created_at: string }[]
  recargoVigente: string
  hoy: string
}

export const resumenCreditoVenta = (token: string, clienteId: string) =>
  llamar<ResumenCreditoVenta>('GET', `/cxc/clientes/${clienteId}/resumen`, token)

export const prepararCxc = (token: string) => llamar<PrepararCxc>('GET', '/cxc/preparar', token)

export const listarClientesCxc = (token: string, f: { texto: string; solo: string }) => {
  const q = new URLSearchParams()
  if (f.texto.trim()) q.set('texto', f.texto.trim())
  if (f.solo) q.set('solo', f.solo)
  return llamar<{ filas: FilaClienteCxc[]; hoy: string }>('GET', `/cxc/clientes?${q.toString()}`, token)
}

export const buscarClientesCxc = (token: string, texto: string) =>
  llamar<{ id: string; codigo: string | null; nombre: string; numero_documento: string | null; telefono: string | null }[]>(
    'GET',
    `/cxc/buscar-clientes?${new URLSearchParams({ texto }).toString()}`,
    token,
  )

export const clienteCxc = (token: string, id: string) => llamar<ClienteCxc>('GET', `/cxc/clientes/${id}`, token)

export const configurarCreditoCliente = (
  token: string,
  id: string,
  datos: { limite: string; plazoDias: string; activo: boolean; notas?: string },
) => llamar<{ ok: boolean }>('PUT', `/cxc/clientes/${id}/credito`, token, datos)

export const autorizarCreditoHoy = (token: string, id: string, motivo: string) =>
  llamar<{ ok: boolean; validaHasta: string }>('POST', `/cxc/clientes/${id}/autorizacion`, token, { motivo })

export const nuevaTasaRecargo = (token: string, datos: { porcentaje: string; vigenteDesde: string }) =>
  llamar<{ ok: boolean }>('POST', '/cxc/tasas', token, datos)

export const perdonarRecargo = (token: string, cuentaId: string, datos: { monto?: string; motivo: string }) =>
  llamar<{ ok: boolean; perdonado: string }>('POST', `/cxc/cuentas/${cuentaId}/perdonar`, token, datos)

export const registrarAbono = (
  token: string,
  datos: {
    clienteId: string
    monto: string
    forma: 'efectivo' | 'transferencia'
    cajaId?: string
    cuentaId?: string
    referencia?: string
    distribucion?: { cuentaId: string; monto: string }[]
  },
) =>
  llamar<{
    id: string
    codigo: string
    aplicado: { venta: string; recargo: string; capital: string }[]
    debiaAntes: string
    debeAhora: string
  }>('POST', '/cxc/abonos', token, datos)

export const anularAbono = (token: string, id: string, datos: { motivo: string; cajaId?: string }) =>
  llamar<{ ok: boolean }>('POST', `/cxc/abonos/${id}/anular`, token, datos)

export const ticketAbono = (token: string, id: string) =>
  llamar<TicketFilas>('GET', `/cxc/abonos/${id}/ticket`, token)

export async function pdfAbono(token: string, id: string, formato: FormatoRecibo): Promise<Blob> {
  const res = await fetch(`${API_URL}/cxc/abonos/${id}/pdf?formato=${formato}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) throw new SesionVencida('Sesión vencida')
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.message ?? 'No se pudo generar el recibo')
  }
  return res.blob()
}

// ---------- Cuentas por Pagar ----------

export type AvisoGastoFijo = {
  id: string
  nombre: string
  proveedor_id: string
  proveedor: string
  tipo_gasto: string
  monto: string | null
  itbis: string | null
  fecha: string // cuándo vence (este mes o el próximo)
  dias: number // días que faltan (negativo: ya pasó)
}

export type FacturaCxp = {
  id: string
  codigo: string
  proveedor_id: string
  proveedor: string
  ncf: string | null
  fecha: string
  vencimiento: string
  condicion: string
  a_pagar: string
  pagado: string
  saldo: string
  vencida: boolean
  dias_atraso: number
  por_vencer: boolean
  dias_para_vencer: number
}

export type PrepararCxp = {
  cajas: { id: string; nombre: string; sesion_id: string | null }[]
  cuentas: { id: string; nombre: string }[]
  tiposGasto: { codigo: string; nombre: string }[]
  hoy: string
  diasAlerta: number
}

export type AlertasCxp = {
  hoy: string
  dias: number
  vencidas: FacturaCxp[]
  porVencer: FacturaCxp[]
  gastosFijos: AvisoGastoFijo[]
}

export type ProveedorCxp = { id: string; nombre: string; debe: string; vencido: string; por_vencer: string; facturas: number }

export type PagoCxp = {
  id: string
  codigo: string
  numero: string
  fecha: string
  total: string
  forma: 'efectivo' | 'banco'
  referencia: string | null
  estado: 'activo' | 'anulado'
  motivo_anulacion: string | null
  usuario: string
}

export type DetalleProveedorCxp = {
  proveedor: { id: string; nombre: string; numero_documento: string | null; dias_credito: number | null }
  hoy: string
  facturas: FacturaCxp[]
  totales: { debe: string; vencido: string }
  pagos: PagoCxp[]
}

export type GastoFijo = {
  id: string
  nombre: string
  proveedor_id: string
  proveedor: string
  tipo_gasto: string
  tipo_gasto_nombre: string
  dia_mes: number
  monto: string | null
  itbis: string | null
  notas: string | null
  is_active: boolean
}

export type DatosGastoFijo = {
  nombre: string
  proveedorId: string
  tipoGasto: string
  diaMes: string
  monto: string
  itbis: string
  notas: string
  activo: boolean
}

export const prepararCxp = (token: string) => llamar<PrepararCxp>('GET', '/cxp/preparar', token)

export const alertasCxp = (token: string) => llamar<AlertasCxp>('GET', '/cxp/alertas', token)

export const proveedoresCxp = (token: string) => llamar<ProveedorCxp[]>('GET', '/cxp/proveedores', token)

export const proveedorCxp = (token: string, id: string) => llamar<DetalleProveedorCxp>('GET', `/cxp/proveedores/${id}`, token)

export const pagarProveedor = (
  token: string,
  datos: {
    proveedorId: string
    monto: string
    forma: 'efectivo' | 'banco'
    cajaId?: string
    cuentaId?: string
    referencia?: string
    distribucion?: { compraId: string; monto: string }[]
  },
) =>
  llamar<{
    id: string
    codigo: string
    aplicado: { factura: string; ncf: string | null; monto: string }[]
    debiaAntes: string
    debeAhora: string
  }>('POST', '/cxp/pagos', token, datos)

export const anularPagoProveedor = (token: string, id: string, datos: { motivo: string; cajaId?: string }) =>
  llamar<{ ok: boolean }>('POST', `/cxp/pagos/${id}/anular`, token, datos)

export const ticketPagoProveedor = (token: string, id: string) =>
  llamar<TicketFilas>('GET', `/cxp/pagos/${id}/ticket`, token)

export async function pdfPagoProveedor(token: string, id: string, formato: FormatoRecibo): Promise<Blob> {
  const res = await fetch(`${API_URL}/cxp/pagos/${id}/pdf?formato=${formato}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) throw new SesionVencida('Sesión vencida')
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.message ?? 'No se pudo generar el comprobante')
  }
  return res.blob()
}

export const listarGastosFijos = (token: string) => llamar<GastoFijo[]>('GET', '/cxp/gastos-fijos', token)

export const guardarGastoFijo = (token: string, id: string | null, datos: DatosGastoFijo) =>
  id
    ? llamar<{ id: string }>('PUT', `/cxp/gastos-fijos/${id}`, token, datos)
    : llamar<{ id: string }>('POST', '/cxp/gastos-fijos', token, datos)

export const configurarDiasCxp = (token: string, dias: string) =>
  llamar<{ ok: boolean }>('PATCH', '/cxp/configuracion', token, { dias })

export const buscarProveedoresCxp = (token: string, texto: string) =>
  llamar<{ id: string; nombre: string; numero_documento: string | null }[]>(
    'GET',
    `/cxp/buscar-proveedores?${new URLSearchParams({ texto }).toString()}`,
    token,
  )

// ---------- Contabilidad ----------

export type TipoCuentaContable = 'activo' | 'pasivo' | 'capital' | 'ingreso' | 'costo' | 'gasto'

export type CuentaContable = {
  id: string
  codigo: string
  nombre: string
  tipo: TipoCuentaContable
  naturaleza: 'deudora' | 'acreedora'
  padre_id: string | null
  nivel: number
  acepta_movimientos: boolean
  validada: boolean
  notas: string | null
  is_active: boolean
  debitos: string
  creditos: string
  saldo: string // según su naturaleza
  tiene_movimientos: boolean
}

export type PrepararContabilidad = {
  fechaInicio: string | null
  hayAsientos: boolean
  hayApertura: boolean
  hoy: string
  unidadesNegocio: { id: string; nombre: string }[]
  pendientes: number
}

export type ReglaContable = {
  clave: string
  nombre: string
  descripcion: string
  cuenta_id: string
  codigo: string
  cuenta: string
  updated_at: string
  cambiada_por: string | null
}

// Categoría de gasto, tipo 606 o cuenta de banco con su cuenta contable.
export type CuentaDe = {
  id: string
  nombre: string
  cuenta_id: string | null
  codigo: string | null
  cuenta: string | null
}

export type ReglasContables = {
  lineas: { clave: string; nombre: string; unidad_id: string | null; unidad: string | null }[]
  unidades: { id: string; nombre: string }[]
  reglas: ReglaContable[]
  categorias: CuentaDe[]
  tiposGasto: CuentaDe[]
  bancos: CuentaDe[]
}

export type PendienteContable = {
  id: string
  origen_tabla: string
  origen_id: string
  que: string
  documento: string | null
  detalle: string | null
  fecha: string
  error: string
  estado: 'pendiente' | 'resuelto' | 'descartado'
  nota: string | null
  created_at: string
  resuelto_en: string | null
  resuelto_por: string | null
  clasificada: string | null
  asiento: string | null
  clasificable: boolean
}

export type ResultadoContable = { resultado: 'hecho' | 'omitido' | 'pendiente'; error: string | null }

export type FilaAsiento = {
  id: string
  numero: string
  codigo: string
  fecha: string
  concepto: string
  origen: string
  documento: string | null
  estado: 'activo' | 'anulado'
  reverso_de: string | null
  usuario: string
  total: string
}

export type DetalleAsiento = FilaAsiento & {
  motivo_anulacion: string | null
  anulado_en: string | null
  anulado_por: string | null
  reverso_de_codigo: string | null
  reversado_por_codigo: string | null
  created_at: string
  lineas: {
    id: string
    codigo: string
    cuenta: string
    debito: string
    credito: string
    descripcion: string | null
    tercero: string | null
    unidad_negocio: string | null
  }[]
}

export type LineaAsientoEntrada = {
  cuentaId: string
  debito: string
  credito: string
  descripcion: string
  unidadNegocioId: string
}

export type Balanza = {
  hasta: string
  filas: {
    codigo: string
    nombre: string
    tipo: TipoCuentaContable
    naturaleza: string
    debitos: string
    creditos: string
    saldo_deudor: string
    saldo_acreedor: string
  }[]
  totales: { debitos: string; creditos: string; cuadra: boolean }
}

export const prepararContabilidad = (token: string) => llamar<PrepararContabilidad>('GET', '/contabilidad/preparar', token)

export const fijarFechaInicioContable = (token: string, fecha: string) =>
  llamar<{ fechaInicio: string }>('PATCH', '/contabilidad/fecha-inicio', token, { fecha })

export const catalogoCuentas = (token: string) => llamar<CuentaContable[]>('GET', '/contabilidad/cuentas', token)

export const crearCuentaContable = (
  token: string,
  datos: { codigo: string; nombre: string; padreId: string; naturaleza: string; aceptaMovimientos: boolean; notas: string },
) => llamar<{ id: string }>('POST', '/contabilidad/cuentas', token, datos)

export const editarCuentaContable = (
  token: string,
  id: string,
  datos: { nombre: string; naturaleza: string; aceptaMovimientos: boolean; notas: string },
) => llamar<{ ok: boolean }>('PUT', `/contabilidad/cuentas/${id}`, token, datos)

export const validarCuentaContable = (token: string, id: string, validada: boolean) =>
  llamar<{ ok: boolean }>('PATCH', `/contabilidad/cuentas/${id}/validada`, token, { validada })

export const estadoCuentaContable = (token: string, id: string, activo: boolean, motivo: string) =>
  llamar<{ ok: boolean }>('PATCH', `/contabilidad/cuentas/${id}/estado`, token, { activo, motivo })

export const listarAsientos = (
  token: string,
  f: { desde: string; hasta: string; texto: string; origen: string; pagina: number },
) => {
  const q = new URLSearchParams({ pagina: String(f.pagina) })
  for (const k of ['desde', 'hasta', 'texto', 'origen'] as const) if (f[k].trim()) q.set(k, f[k].trim())
  return llamar<{ filas: FilaAsiento[]; total: number; pagina: number; porPagina: number }>('GET', `/contabilidad/asientos?${q.toString()}`, token)
}

export const detalleAsiento = (token: string, id: string) => llamar<DetalleAsiento>('GET', `/contabilidad/asientos/${id}`, token)

export const crearAsientoContable = (
  token: string,
  datos: { fecha: string; concepto: string; apertura: boolean; lineas: LineaAsientoEntrada[] },
) => llamar<{ id: string; codigo: string }>('POST', '/contabilidad/asientos', token, datos)

export const anularAsientoContable = (token: string, id: string, motivo: string) =>
  llamar<{ ok: boolean; reverso: string; fechaReverso: string }>('POST', `/contabilidad/asientos/${id}/anular`, token, { motivo })

export const periodosContables = (token: string) =>
  llamar<{
    fechaInicio: string | null
    periodos: { anio: number; mes: number; estado: 'abierto' | 'cerrado'; cerrado_en: string | null; cerrado_por: string | null }[]
  }>('GET', '/contabilidad/periodos', token)

export const cerrarMesContable = (token: string, anio: number, mes: number) =>
  llamar<{ ok: boolean }>('POST', '/contabilidad/periodos/cerrar', token, { anio, mes })

export const reabrirMesContable = (token: string, anio: number, mes: number, motivo: string) =>
  llamar<{ ok: boolean }>('POST', '/contabilidad/periodos/reabrir', token, { anio, mes, motivo })

export const balanzaComprobacion = (token: string, hasta: string) =>
  llamar<Balanza>('GET', `/contabilidad/balanza?${new URLSearchParams(hasta ? { hasta } : {}).toString()}`, token)

export const reglasContables = (token: string) => llamar<ReglasContables>('GET', '/contabilidad/reglas', token)

export const cambiarReglaContable = (token: string, clave: string, cuentaId: string) =>
  llamar<{ ok: boolean }>('PUT', `/contabilidad/reglas/${encodeURIComponent(clave)}`, token, { cuentaId })

export const cambiarCuentaDe = (token: string, tipo: 'categoria' | 'tipo_gasto' | 'banco', id: string, cuentaId: string) =>
  llamar<{ ok: boolean }>('PUT', `/contabilidad/cuenta-de/${tipo}/${encodeURIComponent(id)}`, token, { cuentaId })

export const pendientesContables = (token: string, estado: 'pendiente' | 'resuelto' | 'descartado' = 'pendiente') =>
  llamar<PendienteContable[]>('GET', `/contabilidad/pendientes?${new URLSearchParams({ estado }).toString()}`, token)

export const reintentarPendiente = (token: string, id: string) =>
  llamar<ResultadoContable>('POST', `/contabilidad/pendientes/${id}/reintentar`, token)

export const reintentarPendientes = (token: string) =>
  llamar<{ hecho: number; omitido: number; pendiente: number }>('POST', '/contabilidad/pendientes/reintentar', token)

export const clasificarPendiente = (token: string, id: string, cuentaId: string, nota: string) =>
  llamar<ResultadoContable>('POST', `/contabilidad/pendientes/${id}/clasificar`, token, { cuentaId, nota })

export const descartarPendiente = (token: string, id: string, nota: string) =>
  llamar<{ ok: boolean }>('POST', `/contabilidad/pendientes/${id}/descartar`, token, { nota })

export type LineaNegocioResultado = {
  unidadId: string | null
  unidad: string
  ingresos: string
  costos: string
  gastos: string
  resultado: string
  cuentas: { codigo: string; cuenta: string; tipo: 'ingreso' | 'costo' | 'gasto'; monto: string }[]
}

export type PorLinea = {
  desde: string
  hasta: string
  lineas: LineaNegocioResultado[]
  total: { ingresos: string; costos: string; gastos: string; resultado: string }
}

export const gananciaPorLinea = (token: string, desde: string, hasta: string) =>
  llamar<PorLinea>('GET', `/contabilidad/por-linea?${new URLSearchParams({ desde, hasta }).toString()}`, token)

export const cambiarLineaContable = (token: string, clave: string, unidadId: string) =>
  llamar<{ ok: boolean }>('PUT', `/contabilidad/lineas/${encodeURIComponent(clave)}`, token, { unidadId })
