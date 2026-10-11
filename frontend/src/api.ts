export const API_URL = 'http://localhost:3000'

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
    rolId: string
    sucursalId: string
  },
) => llamar<{ id: string }>('POST', '/usuarios', token, datos)

export const editarUsuario = (
  token: string,
  id: string,
  datos: { nombre: string; apellido: string; rolId: string; sucursalId: string },
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
}

export type PrepararVenta = {
  formasPago: FormaPago[]
  cajas: { id: string; nombre: string; sesion_id: string | null }[]
  descuentoMaximoPct: string
  puedeDescontar: boolean
  consumidorFinal: { id: string; nombre: string } | null
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
  }
  comprobanteFiscal: string
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
  pagos: {
    monto: string
    recibido: string | null
    devuelta: string | null
    referencia: string | null
    forma_pago: string
  }[]
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
  llamar<{ id: string; numero: string; total: string; devuelta: string | null }>(
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
  caja?: {
    abiertas: { caja: string; usuario: string; abierta_en: string; esperado: string }[]
    total: string
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
}

export type TipoMovimientoCaja = 'venta' | 'devolucion' | 'gasto' | 'retiro' | 'ingreso'

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
}

export type TotalesCaja = {
  ventas: string
  ingresos: string
  gastos: string
  retiros: string
  devoluciones: string
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
