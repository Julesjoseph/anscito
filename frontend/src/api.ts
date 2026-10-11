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

export type CatalogosServicios = {
  unidadesNegocio: Opcion[]
  unidadesMedida: Opcion[]
  impuestos: ImpuestoVigente[]
}

export type DatosServicio = {
  codigo: string
  nombre: string
  descripcion: string
  unidadNegocioId: string
  unidadMedidaId: string
  precio: string
  costo: string
  impuestoId: string
  precioIncluyeItbis: boolean
}

export type FiltrosServicios = {
  texto: string
  unidadNegocioId: string
  estado: 'activos' | 'inactivos' | 'todos'
}

export const listarServicios = (token: string, f: FiltrosServicios) => {
  const q = new URLSearchParams({ estado: f.estado })
  if (f.texto.trim()) q.set('texto', f.texto.trim())
  if (f.unidadNegocioId) q.set('unidadNegocioId', f.unidadNegocioId)
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
