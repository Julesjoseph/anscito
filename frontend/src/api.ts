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