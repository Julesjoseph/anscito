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
  },
) => llamar<{ id: string }>('POST', '/usuarios', token, datos)

export const editarUsuario = (
  token: string,
  id: string,
  datos: { nombre: string; apellido: string; rolId: string },
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
