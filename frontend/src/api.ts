// La dirección del servidor se configura al arrancar (ver entorno.ts).
import { API_URL } from './entorno'
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
  costo: string | null
  impuesto_id: string
  impuesto: string
  tasa: string | null
  precio_incluye_itbis: boolean
  // Ganancia por costo (precio − costo) o por comisión (precio × %).
  ganancia_tipo: 'costo' | 'comision'
  comision_pct: string | null
  is_active: boolean
  calculo: Desglose | null
}

export type Opcion = { id: string; codigo: string; nombre: string }
export type ImpuestoVigente = Opcion & { tasa: string }

export type CategoriaOpcion = {
  id: string
  nombre: string
  unidad_negocio_id: string
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
  costo: string
  impuestoId: string
  precioIncluyeItbis: boolean
  gananciaTipo: 'costo' | 'comision'
  comisionPct: string
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
}

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
}

export type ArticuloVenta = {
  tipo: 'producto' | 'servicio'
  id: string
  codigo: string
  nombre: string
  unidad: string
  permite_decimales: boolean
  precio: string
  precio_incluye_itbis: boolean
  impuesto: string
  tasa: string
  existencia: string | null
}

export type ClienteVenta = {
  id: string
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
  lineas: (Desglose & { codigo: string; bruto: string; descuento: string; cantidad: string })[]
  totales: TotalesVenta
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
  }
  comprobanteFiscal: string
  // '31' Crédito Fiscal, '32' Consumo o '' (según el cliente).
  tipoEcf?: string
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
}

export type DetalleVenta = {
  id: string
  numero_texto: string
  fecha: string
  estado: 'completada' | 'anulada'
  cliente: string
  cliente_documento: string | null
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
  pagos: {
    monto: string
    recibido: string | null
    devuelta: string | null
    referencia: string | null
    forma_pago: string
  }[]
}

export type EcfDeVenta = {
  tipo: string
  estado: 'por_emitir' | 'emitido'
  encf: string | null
  fecha_emision: string | null
  codigo_seguridad: string | null
}

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
  llamar<{ id: string; numero: string; total: string; devuelta: string | null; ecf: string | null }>(
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
  caja?: {
    abiertas: { caja: string; usuario: string; abierta_en: string; esperado: string }[]
    total: string
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
}

export type PrepararCaja = {
  categoriasGasto: { id: string; codigo: string; nombre: string }[]
  denominaciones: string[]
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
  cantidad_ventas: number
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
  conteo: Record<string, number> | null
  motivo_diferencia: string | null
  notas: string | null
  totales: TotalesCaja
  movimientos: MovimientoCaja[]
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
  datos: { fondoInicial: string; notas: string },
) => llamar<{ id: string; sesion: string }>('POST', `/caja/cajas/${id}/abrir`, token, datos)

export const movimientoCaja = (
  token: string,
  sesionId: string,
  datos: {
    tipo: 'gasto' | 'retiro' | 'ingreso'
    monto: string
    categoriaGastoId?: string
    comprobante?: string
    motivo: string
  },
) =>
  llamar<{ esperado: string }>('POST', `/caja/sesiones/${sesionId}/movimientos`, token, datos)

export const cerrarCaja = (
  token: string,
  sesionId: string,
  datos: { conteo: Record<string, number>; motivo: string; notas: string },
) =>
  llamar<{ esperado: string; contado: string; diferencia: string }>(
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

export type AreaReporte = 'ventas' | 'envios' | 'caja_bancos' | 'inventario'

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
}

export type FiltrosReporte = {
  desde: string
  hasta: string
  agenteId?: string
  cuentaId?: string
  estado?: string
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
